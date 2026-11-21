import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {createOrchestratorMcp} from '../src/orchestrator-mcp.mjs';
import {ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';

function fixture(t,{repositoryPort=null}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-orchestration-'));
  const file=path.join(dir,'lab.sqlite');
  const store=new Store(file);
  const context=Object.freeze({actorId:'local-test-owner',clientId:'app-test',workspaceSessionId:store.getWorkspaceSession().id});
  let allowed=true;
  const service=new OrchestratorService({store,repositoryPort,authorize:({context:c})=>allowed&&c===context});
  t.after(()=>{try{store.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});});
  let request=0;
  return {file,store,context,service,setAllowed:v=>allowed=v,
    call:(op,input={})=>{const tool=ORCHESTRATOR_TOOLS.find(item=>item.operation===op);
      return service.invoke(context,op,{...(tool&&!tool.readOnly?{requestId:'r'+(++request)}:{}),...input});}};
}
async function project(f,name='Projeto A') {
  const p=(await f.call('project_create',{name,objective:'Criar site'})).result.projectId;
  const o=(await f.call('orchestrator_create',{projectId:p,name:'Arquiteto',mission:'Analisar e evoluir o projeto'})).result;
  const w=(await f.call('work_create',{projectId:p,orchestratorId:o.orchestratorId,title:'Site'})).result.taskId;
  return {p,o:o.orchestratorId,chat:o.chatTaskId,w};
}
test('project deletion requires exact owner confirmation and removes only project-owned App records',async t=>{
  const f=fixture(t),a=await project(f,'Projeto para excluir'),b=await project(f,'Projeto preservado');
  f.store.appendMessage(a.w,'user','Mensagem somente do projeto descartável');
  f.store.event(a.w,'test.event',{source:'test'});
  const runId=f.store.startRun(a.w);f.store.finishRun(a.w,runId);
  const before=f.store.db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n;
  await assert.rejects(f.call('project_delete',{projectId:a.p,confirmName:'nome incorreto'}),/confirmation_invalid/);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,before);
  const receipt=await f.service.invoke(f.context,'project_delete',{
    requestId:'delete-only-this-project',projectId:a.p,confirmName:'Projeto para excluir'});
  assert.equal(receipt.status,'succeeded');
  assert.equal(receipt.result.deleted,true);
  assert.equal(receipt.result.tasksRemoved,2);
  assert.equal(receipt.result.externalFilesRemoved,false);
  const repeated=await f.service.invoke(f.context,'project_delete',{
    requestId:'delete-only-this-project',projectId:a.p,confirmName:'Projeto para excluir'});
  assert.deepEqual(repeated,receipt);
  await assert.rejects(f.service.invoke(f.context,'project_delete',{
    requestId:'delete-only-this-project',projectId:a.p,confirmName:'outro nome'}),/request_conflict/);
  const remaining=(await f.call('projects_list')).projects;
  assert.deepEqual(remaining.map(p=>p.id),[b.p]);
  assert.equal(f.store.getTask(a.w),null);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM events WHERE task_id=?').get(a.w).n,0);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM runs WHERE task_id=?').get(a.w).n,0);
  assert.ok(f.store.getTask(b.w));
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  assert.deepEqual(f.store.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('project deletion refuses active or uncertain work and resource bindings',async t=>{
  const f=fixture(t),a=await project(f,'Protegido');
  const active=f.store.startRun(a.w);
  await assert.rejects(f.call('project_delete',{projectId:a.p,confirmName:'Protegido'}),/orchestrator_project_delete_work_active/);
  f.store.finishRun(a.w,active);
  f.service.transaction(()=>f.service.reserve(f.context,'work_send',{
    requestId:'pending-protected-work',projectId:a.p,taskId:a.w,content:'sensitive'}));
  await assert.rejects(f.call('project_delete',{projectId:a.p,confirmName:'Protegido'}),/orchestrator_project_delete_work_active/);
  assert.ok(f.store.getTask(a.w));
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM lab_projects WHERE id=?').get(a.p).n,1);
  f.store.db.prepare("UPDATE lab_command_receipts SET status='failed' WHERE request_id='pending-protected-work'").run();
  f.store.db.prepare('UPDATE lab_projects SET observation_requested=1 WHERE id=?').run(a.p);
  await assert.rejects(f.call('project_delete',{projectId:a.p,confirmName:'Protegido'}),/observation_active/);
  f.store.db.prepare('UPDATE lab_projects SET observation_requested=0 WHERE id=?').run(a.p);
  const session=f.store.getWorkspaceSession().id;
  f.store.db.prepare('INSERT INTO lab_project_workspaces(id,project_id,workspace_session_id,device_id,resource_id,actor_id,client_id,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run('binding-test',a.p,session,'device-test','resource_test12345678',f.context.actorId,f.context.clientId,new Date().toISOString());
  await assert.rejects(f.call('project_delete',{projectId:a.p,confirmName:'Protegido'}),/workspace_bound/);
});

test('project preflight reports only scoped local evidence, never manufactures external access or dispatches',async t=>{
  let providerSends=0,modelCalls=0;
  const f=fixture(t,{provider:{send:()=>{providerSends++;throw Error('unexpected GPT send');}},
    coordinator:{available:()=>true,send:()=>{modelCalls++;throw Error('unexpected model call');}}});
  const a=await project(f,'A'),b=await project(f,'B');
  f.store.db.prepare('UPDATE lab_projects SET repository_url=? WHERE id=?')
    .run('https://github.com/ordaxsystems/ordax-os',a.p);
  const before=f.store.db.prepare('SELECT COUNT(*) AS total FROM lab_command_receipts').get().total;
  const initial=await f.call('project_preflight',{projectId:a.p,orchestratorId:a.o});
  assert.equal(initial.schema,'ordax.orchestrator.project-preflight/2');
  assert.equal(initial.projectId,a.p);
  assert.equal(initial.provenance.source,'app_sqlite');
  assert.equal(initial.provenance.externalObservation,false);
  assert.deepEqual(initial.repository,{urlRegistered:true,authenticatedRead:'unavailable',lastHistoricalHead:null});
  assert.deepEqual(initial.runtime,{grantVerified:false});
  assert.deepEqual(initial.work,{registered:1,started:0,unresolvedSends:0});
  assert.deepEqual(initial.analysis,{attempts:0,completed:0,lastStatus:null,lastAttemptAt:null});
  assert.deepEqual(initial.blockers,[]);
  assert.equal(initial.gates.recordedWorkAnalysisEligible,true);
  assert.equal(initial.gates.githubObservationVerified,false);
  assert.equal(initial.gates.automaticGptDispatchAllowed,false);
  assert.equal(initial.gates.headlessExecutionVerified,false);
  assert.equal((await f.call('project_preflight',{projectId:b.p,orchestratorId:b.o})).repository.urlRegistered,false);
  const reserved=f.service.reserve(f.context,'orchestrator_analyze',{requestId:'analysis_a',projectId:a.p});
  f.service.finish(reserved.commandId,{provider:'groq',response:'redacted'},'succeeded');
  const analyzed=await f.call('project_preflight',{projectId:a.p,orchestratorId:a.o});
  assert.deepEqual({...analyzed.analysis,lastAttemptAt:null},
    {attempts:1,completed:1,lastStatus:'succeeded',lastAttemptAt:null});
  assert.ok(Number.isFinite(Date.parse(analyzed.analysis.lastAttemptAt)));
  assert.deepEqual((await f.call('project_preflight',{projectId:b.p,orchestratorId:b.o})).analysis,
    {attempts:0,completed:0,lastStatus:null,lastAttemptAt:null});
  await assert.rejects(f.call('project_preflight',{projectId:a.p,orchestratorId:b.o}),/orchestrator_unavailable/);
  f.service.transaction(()=>f.service.reserve(f.context,'work_send',{
    requestId:'pending_work_preflight',projectId:a.p,taskId:a.w,content:'unconfirmed'}));
  const pending=await f.call('project_preflight',{projectId:a.p,orchestratorId:a.o});
  assert.equal(pending.work.unresolvedSends,1);
  assert.deepEqual(pending.blockers,['work_receipts_unresolved']);
  assert.equal(pending.gates.recordedWorkAnalysisEligible,false);
  assert.equal((await f.call('project_preflight',{projectId:b.p,orchestratorId:b.o})).work.unresolvedSends,0);
  f.setAllowed(false);
  await assert.rejects(f.call('project_preflight',{projectId:a.p,orchestratorId:a.o}),/orchestrator_access_denied/);
  f.setAllowed(true);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS total FROM lab_command_receipts').get().total,before+2);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  assert.equal(providerSends,0);assert.equal(modelCalls,0);
});

test('project preflight advertises MCP-only analysis and pause without changing durable tasks',async t=>{
  const f=fixture(t),a=await project(f);
  const ready=await f.call('project_preflight',{projectId:a.p,orchestratorId:a.o});
  assert.deepEqual(ready.blockers,[]);
  assert.deepEqual(ready.analysisEngine,{
    state:'mcp_only',available:false,mode:'gpt_via_forge_mcp',externalModelUsed:false
  });
  assert.equal(ready.gates.recordedWorkAnalysisEligible,true);
  assert.equal(ready.gates.automaticGptDispatchAllowed,false);
  await f.call('orchestrator_pause',{projectId:a.p,orchestratorId:a.o,paused:true});
  const paused=await f.call('project_preflight',{projectId:a.p,orchestratorId:a.o});
  assert.deepEqual(paused.blockers,['orchestrator_paused']);
  assert.equal(paused.gates.recordedWorkAnalysisEligible,false);
  assert.equal(paused.analysisEngine.available,false);
  assert.equal(paused.analysisEngine.mode,'gpt_via_forge_mcp');
  assert.equal(f.store.getTask(a.w).status,'ready');
});

test('authenticated repository observation remains unavailable without a supplied grant port',async t=>{
  const f=fixture(t),a=await project(f);
  f.store.db.prepare('UPDATE lab_projects SET repository_url=? WHERE id=?')
    .run('https://github.com/ordaxsystems/ordax-os',a.p);
  assert.equal((await f.call('status')).repositoryPortAvailable,false);
  await assert.rejects(f.call('repository_observe',{projectId:a.p}),/orchestrator_repository_capability_unavailable/);
  assert.equal((await f.call('project_preflight',{projectId:a.p,orchestratorId:a.o})).repository.authenticatedRead,'unavailable');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_command_receipts WHERE operation='repository_observe'").get().n,0);
});

test('GitHub HEAD read uses a project-scoped grant before and after and never dispatches GPT',async t=>{
  let authCalls=0,reads=0,gptSends=0;
  let f;
  const port={
    authorizeRead:async({context,repositoryUrl})=>{
      authCalls++;
      assert.equal(context.projectId,a.p);
      assert.equal(repositoryUrl,'https://github.com/ordaxsystems/ordax-os');
      return {...context,repositoryUrl,provider:'github',authorized:true,
        grantId:'grant_verified_12345678',expiresAt:Date.now()+120000};
    },
    readSnapshot:async({context,repositoryUrl,grantId})=>{
      reads++;
      assert.equal(context.projectId,a.p);
      assert.equal(grantId,'grant_verified_12345678');
      return {source:'github_rest_authenticated',authenticated:true,repositoryUrl,
        repositoryId:123456,defaultBranch:'main',
        headSha:'a'.repeat(40),observedAt:new Date().toISOString()};
    }
  };
  f=fixture(t,{repositoryPort:port,provider:{send:()=>{gptSends++;throw Error('unexpected');}}});
  const a=await project(f);
  f.store.db.prepare('UPDATE lab_projects SET repository_url=? WHERE id=?')
    .run('https://github.com/ordaxsystems/ordax-os',a.p);
  const before=f.store.db.prepare('SELECT COUNT(*) n FROM lab_command_receipts').get().n;
  assert.equal((await f.call('status')).repositoryPortAvailable,true);
  const snapshot=await f.call('repository_observe',{projectId:a.p});
  assert.equal(snapshot.schema,'ordax.orchestrator.repository-observation/1');
  assert.equal(snapshot.headSha,'a'.repeat(40));
  assert.equal(snapshot.provenance.grantRechecked,true);
  assert.equal(snapshot.provenance.contentsRead,false);
  assert.equal(snapshot.provenance.prsRead,false);
  assert.equal(snapshot.provenance.checksRead,false);
  assert.equal(snapshot.providerMessagesSent,0);
  const historical=(await f.call('project_preflight',{projectId:a.p,orchestratorId:a.o})).repository.lastHistoricalHead;
  assert.equal(historical.headSha,'a'.repeat(40));
  assert.equal(historical.repositoryId,123456);
  assert.equal(historical.provenance.historical,true);
  assert.equal(historical.provenance.currentAccessVerified,false);
  assert.equal(historical.provenance.grantRecheckedAtObservation,true);
  assert.equal(historical.provenance.contentsRead,false);
  assert.equal(historical.provenance.prsRead,false);
  assert.equal(historical.provenance.checksRead,false);
  assert.deepEqual(Object.keys(f.store.db.prepare('SELECT * FROM lab_repository_head_evidence').get()).sort(),
    ['default_branch','head_sha','observed_at','project_id','recorded_at','repository_id','repository_url']);
  assert.equal(authCalls,2);assert.equal(reads,1);assert.equal(gptSends,0);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_command_receipts').get().n,before);
  assert.equal((await f.call('project_preflight',{projectId:a.p,orchestratorId:a.o})).gates.githubObservationVerified,false);
  f.setAllowed(false);
  await assert.rejects(f.call('repository_observe',{projectId:a.p}),/orchestrator_access_denied/);
  assert.equal(authCalls,2);
});

test('repository read fails closed on revoked grants, substituted targets and changed project binding',async t=>{
  for(const mode of ['revoked','substituted','wrong-head','changed-repository','revoked-app-access','expired']) {
    let auth=0,reads=0,f;
    const repository='https://github.com/ordaxsystems/ordax-os';
    const port={
      authorizeRead:async({context,repositoryUrl})=>{
        auth++;
        return {...context,repositoryUrl,provider:'github',authorized:mode!=='revoked'||auth===1,
          grantId:'grant_verified_12345678',expiresAt:mode==='expired'?Date.now()-100:Date.now()+120000};
      },
      readSnapshot:async({repositoryUrl})=>{
        reads++;
        if(mode==='changed-repository')f.store.db.prepare('UPDATE lab_projects SET repository_url=? WHERE id=?')
          .run('https://github.com/ordaxsystems/ordax-surface',a.p);
        if(mode==='revoked-app-access')f.setAllowed(false);
        return {source:'github_rest_authenticated',authenticated:true,
          repositoryUrl:mode==='substituted'?'https://github.com/ordaxsystems/ordax-surface':repositoryUrl,
          repositoryId:1234,defaultBranch:'main',headSha:mode==='wrong-head'?'not-a-sha':'b'.repeat(40),
          observedAt:new Date().toISOString()};
      }
    };
    f=fixture(t,{repositoryPort:port});
    const a=await project(f);
    f.store.db.prepare('UPDATE lab_projects SET repository_url=? WHERE id=?').run(repository,a.p);
    const before=f.store.db.prepare('SELECT COUNT(*) n FROM lab_command_receipts').get().n;
    await assert.rejects(f.call('repository_observe',{projectId:a.p}),/orchestrator_repository_|orchestrator_access_denied/);
    assert.equal(reads,mode==='expired'?0:1);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_repository_head_evidence').get().n,0);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_command_receipts').get().n,before);
  }
});

test('a missing repository or another project identity cannot borrow a verified GitHub grant',async t=>{
  let authCalls=0;
  const port={authorizeRead:async()=>{authCalls++;throw Error('must not authorize');},
    readSnapshot:()=>{throw Error('must not read');}};
  const f=fixture(t,{repositoryPort:port}),a=await project(f),b=await project(f);
  await assert.rejects(f.call('repository_observe',{projectId:a.p}),/orchestrator_repository_not_configured/);
  await assert.rejects(f.call('repository_observe',{projectId:'project_missing'}),/orchestrator_project_unavailable/);
  f.store.db.prepare('UPDATE lab_projects SET repository_url=? WHERE id=?')
    .run('https://github.com/ordaxsystems/ordax-os',b.p);
  await assert.rejects(f.call('repository_observe',{projectId:b.p}),/must not authorize/);
  assert.equal(authCalls,1);
});

test('verified GitHub HEAD history survives reopen but does not authorize current access or cross-project reads',async t=>{
  let authorizeCalls=0;
  const port={
    authorizeRead:async({context,repositoryUrl})=>{
      authorizeCalls++;return {...context,repositoryUrl,provider:'github',authorized:true,
        grantId:'grant_verified_12345678',expiresAt:Date.now()+120000};
    },
    readSnapshot:async({repositoryUrl})=>({
      source:'github_rest_authenticated',authenticated:true,repositoryUrl,
      repositoryId:9988,defaultBranch:'main',headSha:'c'.repeat(40),
      observedAt:new Date().toISOString()
    })
  };
  const f=fixture(t,{repositoryPort:port}),a=await project(f,'A'),b=await project(f,'B');
  await f.call('project_repository_set',{projectId:a.p,repositoryUrl:'https://github.com/ordaxsystems/ordax-os'});
  await f.call('repository_observe',{projectId:a.p});
  assert.equal(authorizeCalls,2);
  assert.equal((await f.call('project_preflight',{projectId:b.p,orchestratorId:b.o})).repository.lastHistoricalHead,null);
  f.store.close();
  const reopened=new Store(f.file);
  try {
    const context={...f.context,workspaceSessionId:reopened.getWorkspaceSession().id};
    const service=new OrchestratorService({store:reopened,authorize:()=>true});
    const pre=await service.invoke(context,'project_preflight',{projectId:a.p,orchestratorId:a.o});
    assert.equal(pre.repository.authenticatedRead,'unavailable');
    assert.equal(pre.repository.lastHistoricalHead.headSha,'c'.repeat(40));
    assert.equal(pre.repository.lastHistoricalHead.provenance.currentAccessVerified,false);
    assert.equal(pre.gates.githubObservationVerified,false);
    assert.equal((await service.invoke(context,'project_preflight',{projectId:b.p,orchestratorId:b.o})).repository.lastHistoricalHead,null);
    await assert.rejects(service.invoke(context,'repository_observe',{projectId:a.p}),
      /orchestrator_repository_capability_unavailable/);
    assert.equal(authorizeCalls,2);
    await service.invoke(context,'project_repository_set',
      {projectId:a.p,repositoryUrl:'https://github.com/ordaxsystems/ordax-surface',requestId:'change-repo-on-reopen'});
    assert.equal((await service.invoke(context,'project_preflight',{projectId:a.p,orchestratorId:a.o})).repository.lastHistoricalHead,null);
    assert.equal(reopened.db.prepare('SELECT COUNT(*) n FROM lab_repository_head_evidence').get().n,0);
    assert.equal(reopened.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  } finally {reopened.close();}
});

test('project observation intent survives reboot, keeps project isolation and never grants or dispatches',async t=>{
  let modelCalls=0,gptSends=0,githubReads=0;
  const f=fixture(t,{coordinator:{send:()=>{modelCalls++;throw Error('model_not_expected');}},
    provider:{send:()=>{gptSends++;throw Error('gpt_not_expected');}},
    repositoryPort:{authorizeRead:()=>{githubReads++;throw Error('github_not_expected');},
      readSnapshot:()=>{githubReads++;throw Error('github_not_expected');}}});
  const a=await project(f,'A'),b=await project(f,'B');
  const first=await f.call('projects_list');
  assert.ok(first.projects.some(x=>x.id===a.p&&x.observation_requested===0));
  assert.ok(first.projects.some(x=>x.id===b.p&&x.observation_requested===0));
  const before=f.store.db.prepare('SELECT COUNT(*) n FROM lab_command_receipts').get().n;
  const start={projectId:a.p,enabled:true,requestId:'project-start-1'};
  const startReceipt=await f.call('project_observation_set',start);
  assert.equal(startReceipt.status,'succeeded');
  assert.equal(startReceipt.result.requested,true);
  assert.equal(startReceipt.result.active,false);
  assert.equal(startReceipt.result.externalCalls,0);
  assert.equal(startReceipt.result.providerMessagesSent,0);
  assert.deepEqual(await f.call('project_observation_set',start),startReceipt);
  await assert.rejects(f.call('project_observation_set',{...start,enabled:false}),/orchestrator_request_conflict/);
  assert.equal((await f.call('project_preflight',{projectId:a.p,orchestratorId:a.o})).observation.state,
    'awaiting_external_authority');
  assert.equal((await f.call('project_preflight',{projectId:b.p,orchestratorId:b.o})).observation.state,'paused');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_command_receipts').get().n,before+1);
  const cols=f.store.db.prepare('PRAGMA table_info(lab_projects)').all();
  assert.equal(cols.filter(x=>x.name==='observation_requested').length,1);
  f.store.close();
  const reopenedStore=new Store(f.file);
  try {
    const context={...f.context,workspaceSessionId:reopenedStore.getWorkspaceSession().id};
    const service=new OrchestratorService({store:reopenedStore,authorize:()=>true});
    const persisted=await service.invoke(context,'projects_list',{});
    assert.equal(persisted.projects.find(x=>x.id===a.p)?.observation_requested,1);
    assert.equal(persisted.projects.find(x=>x.id===b.p)?.observation_requested,0);
    const stop=await service.invoke(context,'project_observation_set',
      {projectId:a.p,enabled:false,requestId:'project-stop-1'});
    assert.equal(stop.result.state,'paused');
    assert.equal((await service.invoke(context,'project_preflight',{projectId:a.p,orchestratorId:a.o})).observation.active,false);
    assert.equal((await service.invoke(context,'projects_list',{})).projects.find(x=>x.id===a.p).observation_requested,0);
    assert.equal(reopenedStore.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
    assert.equal(modelCalls,0);assert.equal(gptSends,0);assert.equal(githubReads,0);
  } finally {
    // Windows cannot delete a still-open SQLite file. Close this reopened
    // handle before the fixture's existing end-of-test temporary cleanup.
    reopenedStore.close();
  }
});

test('project observation intent blocks retargeting until explicit pause and rejects unauthorized changes',async t=>{
  const f=fixture(t),a=await project(f),b=await project(f);
  await f.call('project_repository_set',{projectId:a.p,repositoryUrl:'https://github.com/ordaxsystems/ordax-os'});
  await f.call('project_observation_set',{projectId:a.p,enabled:true});
  await assert.rejects(f.call('project_repository_set',{
    projectId:a.p,repositoryUrl:'https://github.com/ordaxsystems/ordax-surface'
  }),/orchestrator_repository_change_requires_observation_pause/);
  const rows=(await f.call('projects_list')).projects;
  assert.equal(rows.find(x=>x.id===a.p).repository_url,'https://github.com/ordaxsystems/ordax-os');
  assert.equal(rows.find(x=>x.id===b.p).observation_requested,0);
  f.setAllowed(false);
  await assert.rejects(f.call('project_observation_set',{projectId:a.p,enabled:false}),/orchestrator_access_denied/);
  f.setAllowed(true);
  await f.call('project_observation_set',{projectId:a.p,enabled:false});
  const changed=await f.call('project_repository_set',{
    projectId:a.p,repositoryUrl:'https://github.com/ordaxsystems/ordax-surface'
  });
  assert.equal(changed.result.repositoryUrl,'https://github.com/ordaxsystems/ordax-surface');
  assert.equal((await f.call('project_preflight',{projectId:a.p,orchestratorId:a.o})).observation.state,'paused');
});

test('only one project may request observation in one App profile; pause enables scoped handoff',async t=>{
  const f=fixture(t),a=await project(f,'A'),b=await project(f,'B');
  const first={projectId:a.p,enabled:true,requestId:'exclusive-a'};
  const second={projectId:b.p,enabled:true,requestId:'exclusive-b'};
  const results=await Promise.allSettled([
    f.call('project_observation_set',first),
    f.call('project_observation_set',second)
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.match(String(results.find(r=>r.status==='rejected').reason),/orchestrator_project_observation_exclusive/);
  const active=(await f.call('projects_list')).projects.filter(p=>p.observation_requested===1);
  assert.equal(active.length,1);
  assert.equal(active[0].id,a.p);
  assert.deepEqual(await f.call('project_observation_set',first),results[0].value);
  assert.equal((await f.call('project_preflight',{projectId:b.p,orchestratorId:b.o})).observation.state,'paused');
  await f.call('project_observation_set',{projectId:a.p,enabled:false});
  const promoted=await f.call('project_observation_set',{projectId:b.p,enabled:true});
  assert.equal(promoted.result.state,'awaiting_external_authority');
  assert.equal((await f.call('projects_list')).projects.filter(p=>p.observation_requested===1)[0].id,b.p);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('passive App rejects removed GPT dispatch and decision operations before side effects',async t=>{
  const f=fixture(t),a=await project(f);
  const before={
    runs:f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,
    messages:f.store.db.prepare('SELECT COUNT(*) n FROM messages').get().n,
    receipts:f.store.db.prepare('SELECT COUNT(*) n FROM lab_command_receipts').get().n,
    actions:f.store.db.prepare('SELECT COUNT(*) n FROM action_ledger').get().n
  };
  const attempts=[
    ['work_send',{requestId:'removed_work_send',projectId:a.p,taskId:a.w,content:'nao enviar'}],
    ['forjador_send',{requestId:'removed_forjador',projectId:a.p,orchestratorId:a.o,content:'nao enviar'}],
    ['proposal_send',{requestId:'removed_proposal_send',projectId:a.p,orchestratorId:a.o,actionId:'action_removed'}],
    ['orchestrator_prepare',{requestId:'removed_prepare',projectId:a.p,orchestratorId:a.o,content:'nao decidir'}],
    ['proposal_review',{requestId:'removed_review',projectId:a.p,orchestratorId:a.o,actionId:'action_removed',approved:true}],
    ['orchestrator_analyze',{requestId:'removed_analyze',projectId:a.p,orchestratorId:a.o}]
  ];
  for(const [operation,input] of attempts)
    await assert.rejects(f.service.invoke(f.context,operation,input),/orchestrator_unknown_operation/,operation);
  assert.deepEqual({
    runs:f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,
    messages:f.store.db.prepare('SELECT COUNT(*) n FROM messages').get().n,
    receipts:f.store.db.prepare('SELECT COUNT(*) n FROM lab_command_receipts').get().n,
    actions:f.store.db.prepare('SELECT COUNT(*) n FROM action_ledger').get().n
  },before);
  assert.equal(f.service.provider,undefined);
  assert.equal(f.service.confirmProposal,undefined);
});

test('historical proposal ledger remains readable but cannot execute review',async t=>{
  const f=fixture(t),a=await project(f);
  const proposal={title:'Historico',content:'Registro persistido antigo',reason:'Compatibilidade de leitura'};
  const actionId=f.store.beginAction(a.chat,null,'orchestrator.work-proposal',null,{
    actorId:f.context.actorId,clientId:f.context.clientId,projectId:a.p,orchestratorId:a.o,proposal
  });
  f.store.requestApproval(a.chat,actionId,'Aprovacao historica');
  const corrupt=f.store.beginAction(a.chat,null,'orchestrator.work-proposal',null,{
    actorId:f.context.actorId,clientId:f.context.clientId,projectId:a.p,orchestratorId:a.o,proposal
  });
  f.store.requestApproval(a.chat,corrupt,'Corromper');
  f.store.db.prepare('UPDATE action_ledger SET payload=? WHERE id=?').run('{"broken"',corrupt);
  const listed=await f.call('proposals_list',{projectId:a.p,orchestratorId:a.o});
  assert.deepEqual(listed.proposals.map(item=>item.actionId),[actionId]);
  assert.equal(listed.proposals[0].status,'pending');
  await assert.rejects(f.service.invoke(f.context,'proposal_review',{
    requestId:'no_review',projectId:a.p,orchestratorId:a.o,actionId,approved:true
  }),/orchestrator_unknown_operation/);
  assert.equal(f.store.db.prepare('SELECT status FROM action_ledger WHERE id=?').get(actionId).status,'pending');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_task_bindings WHERE kind=?').get('work').n,1);
});

test('projects, coordinators and work persist in the same SQLite, with bounded semantic reads',async t=>{
  const f=fixture(t),a=await project(f),b=await project(f,'Projeto B');
  assert.equal((await f.call('projects_list')).projects.length,2);
  assert.deepEqual((await f.call('work_list',{projectId:a.p})).works.map(w=>w.id),[a.w]);
  const work=await f.call('work_get',{projectId:a.p,taskId:a.w});
  assert.equal(work.monitor.mayAutomaticallySend,false);
  assert.equal(work.orchestrator_id,a.o);
  assert.deepEqual(work.draftState,{revision:0,prepared:false});
  await assert.rejects(f.call('work_get',{projectId:b.p,taskId:a.w}),/work_unavailable/);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM messages').get().n,0);
  const original=f.store.db.prepare('SELECT COUNT(*) n FROM tasks').get().n;
  f.store.close();
  const reopened=new Store(f.file);
  try {
    new OrchestratorService({store:reopened,authorize:()=>true});
    assert.equal(reopened.db.prepare('SELECT COUNT(*) n FROM tasks').get().n,original);
    assert.equal(reopened.db.prepare('SELECT COUNT(*) n FROM lab_projects').get().n,2);
    assert.equal(reopened.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  }finally{reopened.close();}
});

test('work_get exposes draft CAS version without leaking an unpublished prompt or bypassing scope',async t=>{
  const f=fixture(t),a=await project(f),b=await project(f,'Outro projeto');
  const input={projectId:a.p,taskId:a.w},secret='SEGREDO_DE_RASCUNHO_NAO_PUBLICADO';
  const initial=await f.call('work_get',input);
  assert.deepEqual(initial.draftState,{revision:0,prepared:false});
  assert.equal(JSON.stringify(initial).includes(secret),false);
  const created=await f.call('work_draft_set',{...input,content:secret,draftRevision:1});
  assert.equal(created.status,'succeeded');
  const readback=await f.call('work_get',input);
  assert.deepEqual(readback.draftState,{revision:1,prepared:true});
  assert.equal(JSON.stringify(readback).includes(secret),false);
  await assert.rejects(f.call('work_draft_set',{
    ...input,content:'Rascunho atrasado',draftRevision:1
  }),/task_draft_revision_conflict/);
  assert.equal(f.store.getTaskDraft(a.w).draft,secret);
  await assert.rejects(f.call('work_get',{
    projectId:b.p,taskId:a.w
  }),/work_unavailable/);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs WHERE task_id=?').get(a.w).n,0);
});

test('metadata commands are atomic, idempotent, and reject a reused request with different input',async t=>{
  const f=fixture(t);
  const input={requestId:'create-once',name:'Projeto'};
  const first=await f.call('project_create',input);
  assert.deepEqual(await f.call('project_create',input),first);
  await assert.rejects(f.call('project_create',{...input,name:'Outro'}),/request_conflict/);
  f.store.db.exec("CREATE TRIGGER fail_binding BEFORE INSERT ON lab_task_bindings BEGIN SELECT RAISE(ABORT,'injected'); END");
  await assert.rejects(f.call('orchestrator_create',{projectId:first.result.projectId,name:'A',mission:'B'}),/injected/);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM tasks').get().n,0);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_orchestrators').get().n,0);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_command_receipts').get().n,1);
});

test('one mission atomically creates a project, coordinator and first durable GPT draft',async t=>{
  let providerCalls=0;
  const f=fixture(t,{provider:{send:async()=>{providerCalls++;throw Error('mission_create_must_not_send');}}});
  const mission='Crie uma loja de roupas chamada VESTE, com catálogo e carrinho.';
  const input={requestId:'mission-once',mission,repositoryUrl:'https://github.com/ordaxsystems/veste-store'};
  const first=await f.call('mission_create',input);
  assert.equal(first.status,'succeeded');
  const {projectId,projectName,orchestratorId,chatTaskId,taskId,draftRevision}=first.result;
  assert.equal(projectName,mission);
  assert.equal(draftRevision,1);
  assert.equal(providerCalls,0);
  const projectRow=(await f.call('projects_list')).projects.find(row=>row.id===projectId);
  assert.equal(projectRow.name,mission);
  assert.equal(projectRow.objective,mission);
  assert.equal(projectRow.repository_url,'https://github.com/ordaxsystems/veste-store');
  const coordinator=(await f.call('orchestrators_list',{projectId})).orchestrators[0];
  assert.equal(coordinator.id,orchestratorId);
  assert.equal(coordinator.chat_task_id,chatTaskId);
  assert.equal(coordinator.name,'Orquestrador');
  assert.equal(coordinator.mission,mission);
  const work=(await f.call('work_list',{projectId,orchestratorId})).works[0];
  assert.equal(work.id,taskId);
  assert.equal(f.store.getTask(taskId).draft,mission);
  assert.equal(f.store.getTask(taskId).draft_revision,1);
  assert.deepEqual(await f.call('mission_create',input),first);
  assert.equal((await f.call('projects_list')).projects.length,1);
  await assert.rejects(f.call('mission_create',{...input,mission:'Missão diferente'}),/request_conflict/);
  assert.equal(providerCalls,0);
});

test('mission creation rolls back its project, tasks, bindings and receipt on a binding failure',async t=>{
  const f=fixture(t);
  f.store.db.exec("CREATE TRIGGER fail_mission_binding BEFORE INSERT ON lab_task_bindings BEGIN SELECT RAISE(ABORT,'mission_binding_failed'); END");
  await assert.rejects(f.call('mission_create',{requestId:'mission-fails',mission:'Criar uma loja VESTE'}),/mission_binding_failed/);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_projects').get().n,0);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_orchestrators').get().n,0);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_task_bindings').get().n,0);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM tasks').get().n,0);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_command_receipts WHERE request_id='mission-fails'").get().n,0);
});

test('project rename changes project metadata without changing its remote or work',async t=>{
  const f=fixture(t),a=await project(f,'VESTE inicial');
  await f.call('project_repository_set',{projectId:a.p,repositoryUrl:'https://github.com/ordaxsystems/veste-store'});
  const renamed=await f.call('project_rename',{projectId:a.p,name:'VESTE loja'});
  assert.deepEqual(renamed.result,{projectId:a.p,name:'VESTE loja'});
  const row=(await f.call('projects_list')).projects.find(item=>item.id===a.p);
  assert.equal(row.name,'VESTE loja');
  assert.equal(row.repository_url,'https://github.com/ordaxsystems/veste-store');
  assert.equal((await f.call('work_list',{projectId:a.p,orchestratorId:a.o})).works[0].id,a.w);
  await assert.rejects(f.call('project_rename',{projectId:'project_missing',name:'No'}),/project_unavailable/);
});

test('forged subjects, unknown keys, cross-project bindings and read revocation fail closed',async t=>{
  const f=fixture(t),a=await project(f),b=await project(f,'B');
  await assert.rejects(f.service.invoke({...f.context},'projects_list',{}),/access_denied/);
  await assert.rejects(f.call('project_create',{name:'X',actorId:'owner'}),/invalid_input/);
  await assert.rejects(f.call('work_create',{projectId:b.p,orchestratorId:a.o,title:'No'}),/unavailable/);
  f.setAllowed(false);
  await assert.rejects(f.call('work_messages',{projectId:a.p,taskId:a.w}),/access_denied/);
  await assert.rejects(f.call('command_get',{commandId:'command_unknown'}),/access_denied/);
});

test('legacy provider receipts remain observable while the passive App cannot send',async t=>{
  const f=fixture(t),a=await project(f);
  const legacy=f.service.transaction(()=>f.service.reserve(f.context,'work_send',{
    requestId:'legacy_unknown_send',projectId:a.p,taskId:a.w,content:'registro historico'
  }));
  assert.ok(legacy.commandId);
  assert.equal(f.service.recoverInterruptedCommands(),1);
  assert.equal(f.store.db.prepare('SELECT status FROM lab_command_receipts WHERE id=?')
    .get(legacy.commandId).status,'uncertain');
  const work=await f.call('work_get',{projectId:a.p,taskId:a.w});
  assert.equal(work.monitor.state,'reconciliation_required');
  const beforeRuns=f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n;
  await assert.rejects(f.service.invoke(f.context,'work_send',{
    requestId:'new_send_forbidden',projectId:a.p,taskId:a.w,content:'nao executar'
  }),/orchestrator_unknown_operation/);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,beforeRuns);
  assert.equal(f.store.db.prepare('SELECT status FROM lab_command_receipts WHERE id=?')
    .get(legacy.commandId).status,'uncertain');
});

test('command receipt migration adds failed state without losing uncertain history',async t=>{
  const f=fixture(t),a=await project(f);
  const existing=f.store.db.prepare('SELECT * FROM lab_command_receipts ORDER BY rowid LIMIT 1').get();
  const preserved={taskId:a.w,reason:'execution_unconfirmed'};
  f.store.db.prepare("UPDATE lab_command_receipts SET status='uncertain',result=? WHERE id=?")
    .run(JSON.stringify(preserved),existing.id);
  f.store.db.exec('ALTER TABLE lab_command_receipts RENAME TO lab_command_receipts_current');
  f.store.db.exec(`CREATE TABLE lab_command_receipts (
    id TEXT PRIMARY KEY, workspace_session_id TEXT NOT NULL REFERENCES workspace_sessions(id),
    actor_id TEXT NOT NULL, client_id TEXT NOT NULL, request_id TEXT NOT NULL,
    project_id TEXT REFERENCES lab_projects(id), operation TEXT NOT NULL,
    input_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','succeeded','uncertain')),
    result TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(workspace_session_id,actor_id,client_id,request_id)
  )`);
  f.store.db.exec(`INSERT INTO lab_command_receipts
    SELECT id,workspace_session_id,actor_id,client_id,request_id,project_id,operation,input_hash,status,result,created_at,updated_at
    FROM lab_command_receipts_current`);
  f.store.db.exec('DROP TABLE lab_command_receipts_current');

  const migrated=new OrchestratorService({store:f.store,authorize:()=>true});
  const row=f.store.db.prepare('SELECT * FROM lab_command_receipts WHERE id=?').get(existing.id);
  assert.equal(row.status,'uncertain');
  assert.deepEqual(JSON.parse(row.result),preserved);
  f.store.db.prepare("UPDATE lab_command_receipts SET status='failed' WHERE id=?").run(existing.id);
  assert.equal(f.store.db.prepare('SELECT status FROM lab_command_receipts WHERE id=?').get(existing.id).status,'failed');
  assert.equal(migrated.receipt(row).requiresReconciliation,true);
});

test('ordinary GPT Tasks without a project binding pass provider preflight without SQLite null parameters',async t=>{
  const f=fixture(t);
  const task=f.store.createTask('GPT Web — conversa independente de projeto');
  assert.doesNotThrow(()=>f.service.assertProviderTaskAvailable(task.id));
  assert.throws(()=>f.service.assertProviderTaskAvailable(task.id,{allowCoordinator:true}),
    /orchestrator_coordinator_task_required/);
  // The canonical transaction can create a Run without a project grant;
  // this does not fabricate an external send or relax a linked project's rules.
  const begun=f.store.beginProviderRun(task.id,'Orçamento com raciocínio real');
  assert.match(begun.runId,/^run_[a-f0-9-]{36}$/);
  assert.equal(f.store.db.prepare('SELECT status FROM runs WHERE id=?')
    .get(begun.runId).status,'running');
  assert.equal(f.store.db.prepare('SELECT role FROM messages WHERE id=?')
    .get(begun.userMessage.id).role,'user');
  f.store.finishRun(task.id,begun.runId);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('status reports uncertain receipt counts per authorized project without replay or cross-project attribution',async t=>{
  const f=fixture(t),a=await project(f,'Projeto com duas pendências'),
    b=await project(f,'Projeto com uma pendência');
  const reserve=(projectId,requestId)=>f.service.transaction(()=>
    f.service.reserve(f.context,'project_command_run',{
      requestId,projectId,command:'echo NEVER_EXECUTED'
    }));
  const first=reserve(a.p,'unc-a1'),second=reserve(a.p,'unc-a2'),
    third=reserve(b.p,'unc-b1');
  assert.equal(f.service.recoverInterruptedCommands(),3);
  const status=await f.call('status');
  assert.equal(status.uncertainCommands,3);
  assert.deepEqual(status.uncertainByProject,[
    {projectId:a.p,count:2},{projectId:b.p,count:1}
  ].sort((x,y)=>x.projectId.localeCompare(y.projectId)));
  for(const id of [first.commandId,second.commandId,third.commandId]){
    const receipt=await f.call('command_get',{commandId:id});
    assert.equal(receipt.status,'uncertain');
    assert.equal(receipt.requiresReconciliation,true);
  }
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,0);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('interrupted command recovery only marks uncertain and cannot dispatch or change existing Tasks',async t=>{
  const f=fixture(t),a=await project(f);
  const reserved=f.service.transaction(()=>f.service.reserve(f.context,'work_send',{
    requestId:'crash',projectId:a.p,taskId:a.w,content:'Olá'}));
  f.store.db.prepare('UPDATE lab_command_receipts SET result=? WHERE id=?')
    .run(JSON.stringify({taskId:a.w}),reserved.commandId);
  assert.equal(f.service.recoverInterruptedCommands(),1);
  assert.equal((await f.call('command_get',{commandId:reserved.commandId})).status,'uncertain');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM messages').get().n,0);
});


test('crash recovery never changes another project action named by a forged first-send receipt',async t=>{
  const f=fixture(t),a=await project(f,'First project'),b=await project(f,'Other project');
  const otherAction=f.store.beginAction(b.w,null,'orchestrator.proposal-send','other_command',
    {source:'unrelated_authorized_work'});
  f.store.db.prepare("UPDATE action_ledger SET status='dispatching' WHERE id=?").run(otherAction);
  const reserved=f.service.transaction(()=>f.service.reserve(f.context,'proposal_send',{
    requestId:'forged_recovery',projectId:a.p,actionId:'action_fake',draftRevision:1,orchestratorId:a.o}));
  f.store.db.prepare('UPDATE lab_command_receipts SET result=? WHERE id=?')
    .run(JSON.stringify({taskId:b.w,sendActionId:otherAction}),reserved.commandId);
  const before=f.store.db.prepare("SELECT COUNT(*) n FROM events WHERE task_id=? AND kind='action.indeterminate'").get(b.w).n;
  assert.equal(f.service.recoverInterruptedCommands(),1);
  assert.equal(f.store.db.prepare('SELECT status FROM action_ledger WHERE id=?').get(otherAction).status,'dispatching',
    'unrelated action cannot be downgraded by another command receipt');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM events WHERE task_id=? AND kind='action.indeterminate'").get(b.w).n,before);
  const receipt=await f.call('command_get',{commandId:reserved.commandId});
  assert.equal(receipt.status,'uncertain');
  assert.equal(receipt.requiresReconciliation,true);
  assert.equal(f.service.recoverInterruptedCommands(),0);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('recovery preserves already terminal first-send action instead of downgrading it',async t=>{
  const f=fixture(t),a=await project(f);
  const input={requestId:'terminal_action',projectId:a.p,orchestratorId:a.o,
    actionId:'action_placeholder',draftRevision:1};
  const reserved=f.service.transaction(()=>f.service.reserve(f.context,'proposal_send',input));
  const actionId=f.store.beginAction(a.w,null,'orchestrator.proposal-send',reserved.commandId,{});
  f.store.db.prepare("UPDATE action_ledger SET status='succeeded' WHERE id=?").run(actionId);
  f.store.db.prepare('UPDATE lab_command_receipts SET result=? WHERE id=?')
    .run(JSON.stringify({taskId:a.w,sendActionId:actionId}),reserved.commandId);
  const prior=f.store.db.prepare("SELECT COUNT(*) n FROM events WHERE task_id=? AND kind='action.indeterminate'").get(a.w).n;
  assert.equal(f.service.recoverInterruptedCommands(),1);
  assert.equal(f.store.db.prepare('SELECT status FROM action_ledger WHERE id=?').get(actionId).status,'succeeded');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM events WHERE task_id=? AND kind='action.indeterminate'").get(a.w).n,prior);
  assert.equal((await f.call('command_get',{commandId:reserved.commandId})).status,'uncertain');
});

test('malformed recovery receipt quarantines the command and remains safely inspectable',async t=>{
  const f=fixture(t),a=await project(f);
  const reserved=f.service.transaction(()=>f.service.reserve(f.context,'proposal_send',{
    requestId:'partial_recovery',projectId:a.p,orchestratorId:a.o,
    actionId:'action_placeholder',draftRevision:1}));
  f.store.db.prepare('UPDATE lab_command_receipts SET result=? WHERE id=?').run('{"taskId":',reserved.commandId);
  const before=f.store.db.prepare('SELECT COUNT(*) n FROM events').get().n;
  assert.equal(f.service.recoverInterruptedCommands(),1);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM events').get().n,before);
  assert.equal(f.service.recoverInterruptedCommands(),0);
  const receipt=await f.call('command_get',{commandId:reserved.commandId});
  assert.equal(receipt.status,'uncertain');
  assert.equal(receipt.requiresReconciliation,true);
  assert.deepEqual(receipt.result,{reason:'receipt_result_unreadable'});
  assert.equal(f.store.db.prepare('SELECT result FROM lab_command_receipts WHERE id=?').get(reserved.commandId).result,'{"taskId":',
    'do not destroy raw forensic evidence');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});


test('truncated provider receipts preserve read models and quarantine only their own project',async t=>{
  const f=fixture(t);
  const a=await project(f,'Interrupted'),b=await project(f,'Independent');
  const reserved=f.service.transaction(()=>f.service.reserve(f.context,'proposal_send',{
    requestId:'truncated_target',projectId:a.p,orchestratorId:a.o,
    actionId:'action_placeholder',draftRevision:1}));
  f.store.db.prepare('UPDATE lab_command_receipts SET result=? WHERE id=?')
    .run('{"taskId":',reserved.commandId);
  assert.equal(f.service.recoverInterruptedCommands(),1);
  const projection=f.store.db.prepare('SELECT task_id,unknown_work_target FROM lab_command_receipt_scope WHERE id=?')
    .get(reserved.commandId);
  assert.equal(projection.task_id,null);
  assert.equal(projection.unknown_work_target,1);
  const work=await f.call('work_get',{projectId:a.p,taskId:a.w});
  assert.equal(work.monitor.state,'reconciliation_required');
  assert.equal((await f.call('work_plan',{projectId:a.p})).plan.workers.length,1);
  assert.equal((await f.call('status')).uncertainCommands,1);
  assert.throws(()=>f.service.assertProviderTaskAvailable(a.w),/reconciliation_required/);
  await assert.rejects(f.service.invoke(f.context,'work_send',{
    requestId:'removed_a',projectId:a.p,taskId:a.w,content:'Não reenviar'
  }),/orchestrator_unknown_operation/);
  await assert.rejects(f.call('conversation_rotate',{projectId:a.p,taskId:a.w}),
    /reconciliation_required/);
  await assert.rejects(f.call('work_dependency_set',{projectId:a.p,taskId:a.w,dependsOn:[]}),
    /dependencies_locked_after_execution/);
  const independent=await f.call('work_get',{projectId:b.p,taskId:b.w});
  assert.equal(independent.monitor.state,'awaiting_instruction');
  assert.equal(independent.runs.length,0);
  await assert.rejects(f.service.invoke(f.context,'work_send',{
    requestId:'removed_b',projectId:b.p,taskId:b.w,content:'Trabalho independente'
  }),/orchestrator_unknown_operation/);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('uncertain first-send target referencing a task in another project cannot quarantine that task',async t=>{
  const f=fixture(t);
  const a=await project(f,'Receipt owner'),b=await project(f,'Separate target');
  const reserved=f.service.transaction(()=>f.service.reserve(f.context,'proposal_send',{
    requestId:'cross_project_target',projectId:a.p,orchestratorId:a.o,
    actionId:'action_placeholder',draftRevision:1}));
  f.store.db.prepare('UPDATE lab_command_receipts SET result=? WHERE id=?')
    .run(JSON.stringify({taskId:b.w}),reserved.commandId);
  assert.equal(f.service.recoverInterruptedCommands(),1);
  const scoped=f.store.db.prepare('SELECT task_id,unknown_work_target FROM lab_command_receipt_scope WHERE id=?')
    .get(reserved.commandId);
  assert.equal(scoped.task_id,null);
  assert.equal(scoped.unknown_work_target,1);
  assert.equal((await f.call('work_get',{projectId:a.p,taskId:a.w})).monitor.state,'reconciliation_required');
  assert.equal((await f.call('work_get',{projectId:b.p,taskId:b.w})).monitor.state,'awaiting_instruction');
  const independent=await f.call('work_get',{projectId:b.p,taskId:b.w});
  assert.equal(independent.runs.length,0);
  await assert.rejects(f.service.invoke(f.context,'work_send',{
    requestId:'removed_cross_project',projectId:b.p,taskId:b.w,content:'Isolado'
  }),/orchestrator_unknown_operation/);
});

test('corrupted historical coordinator receipt does not quarantine independent GPT work',async t=>{
  const f=fixture(t);
  const a=await project(f);
  const reserved=f.service.transaction(()=>f.service.reserve(f.context,'orchestrator_analyze',{
    requestId:'broken_advisory',projectId:a.p,orchestratorId:a.o}));
  f.store.db.prepare('UPDATE lab_command_receipts SET result=? WHERE id=?')
    .run('{"taskId":',reserved.commandId);
  assert.equal(f.service.recoverInterruptedCommands(),1);
  const work=await f.call('work_get',{projectId:a.p,taskId:a.w});
  assert.equal(work.monitor.state,'awaiting_instruction');
  assert.equal(work.runs.length,0);
  await assert.rejects(f.service.invoke(f.context,'work_send',{
    requestId:'removed_after_advisory',projectId:a.p,taskId:a.w,content:'Não executar'
  }),/orchestrator_unknown_operation/);
});

test('continuation is historical read-only and cannot schedule analysis or proposals',async t=>{
  const f=fixture(t),a=await project(f);
  const status=await f.call('continuity_status',{projectId:a.p,orchestratorId:a.o});
  assert.equal(status.enabled,false);
  assert.equal(status.legacyRecordOnly,true);
  assert.equal(status.mode,'legacy_record_only');
  assert.equal(status.automaticGPTSends,false);
  assert.equal(typeof f.service.continuation.tick,'undefined');
  assert.equal(typeof f.service.continuation.configure,'undefined');
  for(const operation of ['continuity_set','continuity_proposals_set','continuity_followup_prepare'])
    await assert.rejects(f.service.invoke(f.context,operation,{
      requestId:'removed_'+operation,projectId:a.p,orchestratorId:a.o
    }),/orchestrator_unknown_operation/);
});

test('retired orchestrator_chat is rejected before receipt or model dispatch',async t=>{
  let gptCalls=0,coordinatorCalls=0;
  const f=fixture(t,{
    provider:{send:async()=>{gptCalls++;throw Error('must_not_send');}},
    coordinator:{available:()=>true,send:async()=>{coordinatorCalls++;throw Error('must_not_send');}}
  });
  const a=await project(f);
  await assert.rejects(f.service.invoke(f.context,'orchestrator_chat',{
    projectId:a.p,orchestratorId:a.o,content:'Legacy chat',delegateWork:true
  }),/orchestrator_unknown_operation/);
  assert.equal(gptCalls,0);
  assert.equal(coordinatorCalls,0);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_command_receipts WHERE operation='orchestrator_chat'").get().n,0);
});

test('removed proposal preparation cannot mutate a coordinator draft',async t=>{
  const f=fixture(t),a=await project(f);
  f.store.setDraft(a.chat,'Mensagem mais recente',3);
  await assert.rejects(f.service.invoke(f.context,'orchestrator_prepare',{
    requestId:'removed_prepare',projectId:a.p,orchestratorId:a.o,
    content:'Texto antigo',draftRevision:2
  }),/orchestrator_unknown_operation/);
  assert.equal(f.store.getTaskDraft(a.chat).draft,'Mensagem mais recente');
  assert.equal(f.store.messages(a.chat).length,0);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_command_receipts WHERE request_id=?")
    .get('removed_prepare').n,0);
});

test('GPT Store keeps user draft and history atomic when draft-clear fails',async t=>{
  const f=fixture(t),a=await project(f);
  f.store.setDraft(a.chat,'Mensagem que precisa sobreviver',1);
  f.store.db.exec(`CREATE TRIGGER refuse_coordinator_draft_clear BEFORE UPDATE OF draft ON tasks
    WHEN NEW.id='${a.chat}' AND NEW.draft='' BEGIN SELECT RAISE(ABORT,'injected_coordinator_draft_clear'); END`);
  assert.throws(()=>f.store.beginProviderRun(a.chat,'Mensagem que precisa sobreviver',{draftRevision:2}),
    /injected_coordinator_draft_clear/);
  assert.equal(f.store.getTaskDraft(a.chat).draft,'Mensagem que precisa sobreviver');
  assert.equal(f.store.getTaskDraft(a.chat).draft_revision,1);
  assert.equal(f.store.messages(a.chat).length,0);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM runs WHERE task_id=?").get(a.chat).n,0);
});

test('project remote repository is persisted and can be changed or cleared without local workspace access',async t=>{
  const f=fixture(t);
  const created=await f.call('project_create',{name:'VESTE',repositoryUrl:'https://github.com/ordaxsystems/veste.git'});
  const projectId=created.result.projectId;
  assert.equal((await f.call('projects_list')).projects.find(item=>item.id===projectId).repository_url,
    'https://github.com/ordaxsystems/veste');
  const updated=await f.call('project_repository_set',{projectId,repositoryUrl:'https://github.com/ordaxsystems/veste-store/'});
  assert.equal(updated.result.repositoryUrl,'https://github.com/ordaxsystems/veste-store');
  await assert.rejects(f.call('project_repository_set',{projectId,repositoryUrl:'https://example.com/repo'}),
    /github_repository_invalid/);
  f.store.close();
  const reopened=new Store(f.file);
  try {
    const service=new OrchestratorService({store:reopened,authorize:()=>true});
    const afterRestart=await service.invoke(f.context,'projects_list',{});
    assert.equal(afterRestart.projects.find(item=>item.id===projectId).repository_url,
      'https://github.com/ordaxsystems/veste-store');
    const cleared=await service.invoke(f.context,'project_repository_set',{
      requestId:'clear-remote',projectId,repositoryUrl:''});
    assert.equal(cleared.result.repositoryUrl,null);
    assert.equal((await service.invoke(f.context,'projects_list',{})).projects.find(item=>item.id===projectId).repository_url,null);
    assert.equal(reopened.db.prepare('SELECT COUNT(*) n FROM lab_command_receipts WHERE operation=?')
      .get('project_repository_set').n,2);
  } finally {reopened.close();}
});

test('existing Lab project schema receives the remote URL column without losing project data',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-project-schema-migration-'));
  const store=new Store(path.join(dir,'lab.sqlite'));
  t.after(()=>{try{store.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});});
  const session=store.getWorkspaceSession();
  store.db.exec(`CREATE TABLE lab_projects (
    id TEXT PRIMARY KEY, workspace_session_id TEXT NOT NULL REFERENCES workspace_sessions(id),
    name TEXT NOT NULL, objective TEXT NOT NULL, created_at TEXT NOT NULL
  )`);
  store.db.prepare('INSERT INTO lab_projects VALUES(?,?,?,?,?)')
    .run('project_legacy',session.id,'Projeto antigo','Continuar a loja','2026-10-21T00:00:00.000Z');
  const service=new OrchestratorService({store,authorize:()=>true});
  const context={actorId:'migration-test',clientId:'app-test',workspaceSessionId:session.id};
  const before=await service.invoke(context,'projects_list',{});
  assert.equal(before.projects[0].name,'Projeto antigo');
  assert.equal(before.projects[0].repository_url,null);
  const columns=store.db.prepare('PRAGMA table_info(lab_projects)').all().map(column=>column.name);
  assert.ok(columns.includes('repository_url'));
  const linked=await service.invoke(context,'project_repository_set',{requestId:'legacy-link',
    projectId:'project_legacy',repositoryUrl:'https://github.com/ordaxsystems/veste'});
  assert.equal(linked.result.repositoryUrl,'https://github.com/ordaxsystems/veste');
});

test('linked GitHub remote remains stored context without an App provider-send path',async t=>{
  const f=fixture(t);
  const projectId=(await f.call('project_create',{
    name:'VESTE',repositoryUrl:'https://github.com/ordaxsystems/veste'
  })).result.projectId;
  const orchestratorId=(await f.call('orchestrator_create',{
    projectId,name:'VESTE',mission:'Evoluir a loja'
  })).result.orchestratorId;
  const taskId=(await f.call('work_create',{projectId,orchestratorId,title:'Loja remota'})).result.taskId;
  const listed=(await f.call('projects_list')).projects.find(item=>item.id===projectId);
  assert.equal(listed.repository_url,'https://github.com/ordaxsystems/veste');
  const preflight=await f.call('project_preflight',{projectId,orchestratorId});
  assert.equal(preflight.repository.urlRegistered,true);
  assert.equal(preflight.analysisEngine.mode,'gpt_via_forge_mcp');
  await assert.rejects(f.service.invoke(f.context,'work_send',{
    requestId:'removed_remote_send',projectId,taskId,content:'nao executar'
  }),/orchestrator_unknown_operation/);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs WHERE task_id=?').get(taskId).n,0);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM messages WHERE task_id=?').get(taskId).n,0);
});

test('analysis context is bounded read-only data and App-owned analyze is absent',async t=>{
  const f=fixture(t),a=await project(f);
  for(let i=0;i<5;i++)await f.call('work_create',{
    projectId:a.p,orchestratorId:a.o,title:`Frente ${i}`
  });
  const other=(await f.call('orchestrator_create',{
    projectId:a.p,name:'Outro orquestrador',mission:'Outra area'
  })).result;
  const otherWork=(await f.call('work_create',{
    projectId:a.p,orchestratorId:other.orchestratorId,title:'OUTRA_FRENTE_PRIVADA'
  })).result.taskId;
  const b=await project(f,'Projeto privado');
  f.store.appendMessage(a.w,'user','Primeira mensagem antiga');
  for(let i=0;i<6;i++)f.store.appendMessage(a.w,i%2?'assistant':'user',`Mensagem recente ${i}`);
  f.store.appendMessage(a.w,'user','api_key=very-secret-value gsk_abcdefghijklmnopqrstuv https://private.example/chat');
  f.store.appendMessage(otherWork,'user','OUTRO_ORQUESTRADOR_PRIVADO');
  f.store.appendMessage(b.w,'user','OUTRO_PROJETO_PRIVADO');
  const analysis=f.service.analysisContext(a.p,a.o);
  assert.equal(analysis.works.length,4);
  const serialized=JSON.stringify(analysis);
  assert.doesNotMatch(serialized,/OUTRO_ORQUESTRADOR_PRIVADO|OUTRO_PROJETO_PRIVADO|OUTRA_FRENTE_PRIVADA/);
  assert.doesNotMatch(serialized,/very-secret-value|gsk_abcdefghijklmnopqrstuv|https:\/\/private\.example/);
  assert.match(serialized,/\[redigido\]|\[credencial redigida\]|\[link omitido\]/);
  assert.doesNotMatch(serialized,/Primeira mensagem antiga/);
  await assert.rejects(f.service.invoke(f.context,'orchestrator_analyze',{
    requestId:'removed_analysis',projectId:a.p,orchestratorId:a.o
  }),/orchestrator_unknown_operation/);
  assert.equal(f.store.db.prepare(
    "SELECT COUNT(*) n FROM lab_command_receipts WHERE operation='orchestrator_analyze'"
  ).get().n,0);
});

test('old unbound tasks remain intact and are not silently adopted into a project',async t=>{
  const f=fixture(t);
  const old=f.store.createTask('Existing');f.store.appendMessage(old.id,'user','Keep');
  const a=await project(f);
  await assert.rejects(f.call('work_get',{projectId:a.p,taskId:old.id}),/work_unavailable/);
  assert.equal(f.store.getTask(old.id).messages[0].content,'Keep');
});

test('MCP initialize/discovery/call use exactly the same App service and persisted state',async t=>{
  const f=fixture(t);
  const postInvokes=[];
  const mcp=createOrchestratorMcp({service:f.service,getContext:()=>f.context,
    afterToolInvoke:({operation,args,output})=>{
      postInvokes.push({operation,projectId:output?.result?.projectId||args?.projectId||null});
      if(operation!=='project_create'||output?.status!=='succeeded')return output;
      return {...output,result:{...output.result,
        workspaceSetup:{configured:true,verified:true,kind:'default'}}};
    }});
  const rpc=(method,params={},id=1)=>mcp.handle({jsonrpc:'2.0',id,method,params});
  assert.equal((await rpc('tools/list')).error.code,-32002);
  const init=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'fixture',version:'1'}});
  assert.equal(init.result.protocolVersion,'2025-11-25');
  assert.equal(init.result.serverInfo.name,'ordax-forge');
  assert.equal(init.result.serverInfo.title,'OrdaX Forge');
  await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const tools=(await rpc('tools/list')).result.tools;
  // The passive Forge catalog contains no GPT dispatch operation.
  const exposed=ORCHESTRATOR_TOOLS.filter(tool=>
    tool.operation!=='project_command_run'||Boolean(f.service.development));
  assert.equal(tools.length,exposed.length);
  assert.deepEqual(new Set(tools.map(tool=>tool.name)),new Set(exposed.map(tool=>tool.name)));
  assert.equal(tools.some(tool=>tool.name==='forge_forjador_send'),false);
  assert.ok(tools.some(tool=>tool.name==='forge_continuity_status'&&tool.annotations.readOnlyHint===true));
  assert.equal(tools.some(tool=>tool.name==='forge_continuity_set'),false);
  assert.ok(tools.every(tool=>tool.inputSchema.additionalProperties===false));
  // Forge's own MCP is a domain adapter, never the external OrdaX computer
  // control transport. A real grant/Runtime port cannot be inferred from
  // successful MCP initialize or tools/list discovery.
  const forgeStatus=(await rpc('tools/call',{name:'forge_status',arguments:{}}))
    .result.structuredContent;
  assert.equal(forgeStatus.engine,'passive-app');
  assert.equal(forgeStatus.externalTransport,'forge_mcp_only');
  assert.equal(forgeStatus.analysisMode,'gpt_via_forge_mcp');
  assert.equal(forgeStatus.analysisAvailable,false);
  assert.equal(forgeStatus.providerExecutionAvailable,false);
  assert.equal(forgeStatus.workspacePortAvailable,false);
  assert.equal(forgeStatus.repositoryPortAvailable,false);
  assert.equal(forgeStatus.autonomousExecution,false);
  const created=await rpc('tools/call',{name:'forge_project_create',arguments:{requestId:'mcp-one',name:'MCP project'}});
  const receipt=created.result.structuredContent;
  assert.equal(receipt.status,'succeeded');
  assert.deepEqual(receipt.result.workspaceSetup,{configured:true,verified:true,kind:'default'});
  assert.equal(postInvokes.at(-1).operation,'project_create');
  assert.equal(postInvokes.at(-1).projectId,receipt.result.projectId);
  assert.equal((await f.call('projects_list')).projects[0].id,receipt.result.projectId);
  const repeated=await rpc('tools/call',{name:'forge_project_create',arguments:{requestId:'mcp-one',name:'MCP project'}});
  assert.deepEqual(repeated.result.structuredContent,receipt);
  assert.equal((await rpc('tools/call',{name:'arbitrary_shell',arguments:{}})).error.code,-32602);
  f.setAllowed(false);
  assert.equal((await rpc('tools/list')).error.code,-32001);
  assert.equal((await mcp.handle([])).error.code,-32600);
});

test('MCP safe workflow rejection returns bounded action diagnosis and never exposes arbitrary errors',async t=>{
  const f=fixture(t),a=await project(f);
  const mcp=createOrchestratorMcp({service:f.service,getContext:()=>f.context,
    afterToolInvoke:({operation,output})=>{
      if(operation==='work_get')throw Error('secret:C:/private/tokens/chatgpt');
      return output;
    }
  });
  const rpc=(id,name,args)=>mcp.handle({jsonrpc:'2.0',id,method:'tools/call',params:{
    name:'forge_'+name,arguments:args
  }});
  const initialized=await mcp.handle({jsonrpc:'2.0',id:1,method:'initialize',
    params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}});
  assert.ok(initialized.result.serverInfo);
  await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const conflict=await rpc(2,'work_draft_set',{projectId:a.p,taskId:a.w,
    content:'Rascunho não enviado',draftRevision:2,requestId:'safe_conflict'});
  assert.equal(conflict.result.isError,true);
  assert.deepEqual(conflict.result.structuredContent,{
    schema:'ordax.forge.mcp-workflow-rejection/1',status:'rejected',
    reason:'task_draft_revision_conflict',
    recovery:'Read forge_work_get.draftState and use only the next revision. Preserve any newer draft.',
    requiresReconciliation:true
  });
  assert.equal(JSON.stringify(conflict).includes('Rascunho não enviado'),false);
  const empty=await rpc(3,'work_parallel_launch',{projectId:a.p,
    taskIds:[a.w,a.w],requestId:'safe_duplicate'});
  assert.equal(empty.error.code,-32602);
  assert.equal(empty.result,undefined);
  const secret=await rpc(4,'work_get',{projectId:a.p,taskId:a.w});
  assert.equal(secret.result.isError,true);
  assert.equal(JSON.stringify(secret).includes('C:/private'),false);
  assert.equal(JSON.stringify(secret).includes('secret:'),false);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,0);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM messages').get().n,0);
});

test('Live native View MCP uses SQLite receipts and never replays uncertain clicks',async t=>{
  const f=fixture(t),a=await project(f);
  let calls=0,clicked=0;
  const base={projectId:a.p,taskId:a.w,assetId:'asset_test',
    expectedRevision:'a'.repeat(64),controlIndex:0,expectedLabel:'Mudar'};
  f.service.viewPort={
    live:async(operation,input)=>{
      calls++;
      assert.equal(input.projectId,a.p);
      assert.equal(operation==='project_view_live_click'||operation==='project_view_live_inspect',true);
      if(operation==='project_view_live_inspect')
        return {schema:'ordax.forge.live-view/1',revision:base.expectedRevision};
      clicked++;
      return {schema:'ordax.forge.live-view-action/1',
        source:'active_native_view',projectId:a.p,taskId:a.w,
        assetId:base.assetId,sha256:'a'.repeat(64),
        action:'click',dispatched:true,controlIndex:base.controlIndex,
        expectedLabel:base.expectedLabel,
        beforeRevision:base.expectedRevision,afterRevision:'b'.repeat(64),
        observableDomChanged:true,statePersistedInLiveView:true,
        projectFilesModified:false,externalEffectsVerified:false,
        websitePublished:false};
    }
  };
  const inspect=await f.call('project_view_live_inspect',{
    projectId:a.p,taskId:a.w,assetId:base.assetId});
  assert.equal(inspect.revision,base.expectedRevision);
  assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM lab_command_receipts WHERE operation='project_view_live_inspect'").get().n,0);
  const input={requestId:'live_once',...base};
  const receipt=await f.service.invoke(f.context,'project_view_live_click',input);
  assert.equal(receipt.status,'succeeded');
  assert.equal(receipt.result.statePersistedInLiveView,true);
  assert.equal(clicked,1);
  assert.deepEqual(await f.service.invoke(f.context,'project_view_live_click',input),receipt);
  assert.equal(clicked,1);
  await assert.rejects(f.service.invoke(f.context,'project_view_live_click',
    {...input,expectedLabel:'Outra ação'}),/request_conflict/);
  assert.equal(clicked,1);

  f.service.viewPort.live=async()=>{calls++;throw Error('forge_view_live_stale');};
  const stale=await f.service.invoke(f.context,'project_view_live_click',
    {...base,requestId:'live_stale'});
  assert.equal(stale.status,'failed');
  assert.equal(stale.result.reason,'forge_view_live_stale');

  let unknownCalls=0;
  f.service.viewPort.live=async()=>{
    unknownCalls++;
    const err=Error('renderer_timeout');err.forgeLiveActionSubmitted=true;
    throw err;
  };
  const pending={...base,requestId:'live_uncertain'};
  const uncertain=await f.service.invoke(f.context,'project_view_live_click',pending);
  assert.equal(uncertain.status,'uncertain');
  assert.equal(uncertain.requiresReconciliation,true);
  assert.equal(unknownCalls,1);
  assert.deepEqual(await f.service.invoke(f.context,'project_view_live_click',pending),uncertain);
  assert.equal(unknownCalls,1);

  // A native port may return without enough evidence to prove the click.
  // Treat malformed/misattributed replies as uncertain, not succeeded, and
  // never silently click again on a repeated requestId.
  let invalidCalls=0;
  f.service.viewPort.live=async()=>{
    invalidCalls++;
    return {schema:'ordax.forge.live-view-action/1',dispatched:true};
  };
  const malformed={...base,requestId:'live_malformed'};
  const invalid=await f.service.invoke(f.context,'project_view_live_click',malformed);
  assert.equal(invalid.status,'uncertain');
  assert.equal(invalid.requiresReconciliation,true);
  assert.equal(invalid.result.reason,'forge_view_live_action_unconfirmed');
  assert.deepEqual(await f.service.invoke(f.context,'project_view_live_click',malformed),invalid);
  assert.equal(invalidCalls,1);

  f.setAllowed(false);
  await assert.rejects(f.call('project_view_live_inspect',{
    projectId:a.p,taskId:a.w,assetId:base.assetId}),/orchestrator_access_denied/);
  await assert.rejects(f.service.invoke(f.context,'project_view_live_click',
    {...base,requestId:'live_denied'}),/orchestrator_access_denied/);
  assert.equal(unknownCalls,1);
  f.setAllowed(true);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('live text fill uses canonical receipts, redacts value and never replays uncertain effects',async t=>{
  const f=fixture(t),a=await project(f);
  const input={requestId:'live_fill_once',projectId:a.p,taskId:a.w,
    assetId:'asset_example',expectedRevision:'a'.repeat(64),
    controlIndex:1,expectedLabel:'Busca',value:'  palavra exata  '};
  let fills=0;
  f.service.viewPort={live:async(operation,request)=>{
    assert.equal(operation,'project_view_live_fill');
    assert.equal(request.projectId,a.p);
    assert.equal(request.value,input.value);
    fills++;
    return {schema:'ordax.forge.live-view-action/1',source:'active_native_view',
      projectId:a.p,taskId:a.w,assetId:input.assetId,sha256:'c'.repeat(64),
      controlIndex:input.controlIndex,expectedLabel:input.expectedLabel,
      action:'fill',dispatched:true,beforeRevision:input.expectedRevision,
      afterRevision:'d'.repeat(64),observableDomChanged:true,
      valueVerifiedAfterInput:true,statePersistedInLiveView:true,
      projectFilesModified:false,externalEffectsVerified:false,
      websitePublished:false};
  }};
  const successful=await f.service.invoke(f.context,'project_view_live_fill',input);
  assert.equal(successful.status,'succeeded');
  assert.equal(successful.result.valueVerifiedAfterInput,true);
  assert.doesNotMatch(JSON.stringify(successful),/palavra exata/);
  assert.equal(fills,1);
  assert.deepEqual(await f.service.invoke(f.context,'project_view_live_fill',input),successful);
  assert.equal(fills,1);
  await assert.rejects(f.service.invoke(f.context,'project_view_live_fill',
    {...input,value:'alterado'}),/request_conflict/);

  f.service.viewPort.live=async()=>{fills++;return {
    schema:'ordax.forge.live-view-action/1',source:'active_native_view',
    projectId:a.p,taskId:a.w,assetId:input.assetId,sha256:'c'.repeat(64),
    controlIndex:input.controlIndex,expectedLabel:input.expectedLabel,
    action:'fill',dispatched:true,beforeRevision:input.expectedRevision,
    afterRevision:'d'.repeat(64),observableDomChanged:true,
    valueVerifiedAfterInput:false,statePersistedInLiveView:true,
    projectFilesModified:false,externalEffectsVerified:false,websitePublished:false
  };};
  const pending={...input,requestId:'live_fill_uncertain'};
  const uncertain=await f.service.invoke(f.context,'project_view_live_fill',pending);
  assert.equal(uncertain.status,'uncertain');
  assert.equal(uncertain.requiresReconciliation,true);
  assert.doesNotMatch(JSON.stringify(uncertain),/palavra exata/);
  assert.equal(fills,2);
  assert.deepEqual(await f.service.invoke(f.context,'project_view_live_fill',pending),uncertain);
  assert.equal(fills,2);
  f.setAllowed(false);
  await assert.rejects(f.service.invoke(f.context,'project_view_live_fill',
    {...input,requestId:'live_fill_denied'}),/orchestrator_access_denied/);
  assert.equal(fills,2);
  f.setAllowed(true);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('real Electron app UI MCP action receipts are idempotent and unknown effects never replay',async t=>{
  const f=fixture(t);
  const revision='a'.repeat(64);
  let calls=0;
  f.service.viewPort={ui:async(operation,input)=>{
    calls++;
    if(operation==='app_ui_inspect')return {schema:'ordax.forge.app-ui-inspection/1',
      revision,source:'active_forge_renderer'};
    const action=operation.slice('app_ui_'.length);
    return {schema:'ordax.forge.app-ui-action/1',
      source:'active_forge_renderer',action,dispatched:true,
      beforeRevision:revision,afterRevision:'b'.repeat(64),
      observableDomChanged:true,inputValuesIncluded:false,
      semanticEffectVerified:false,externalEffectsVerified:false,
      focusChanged:false,
      ...(action==='scroll'?{scrollIndex:input.scrollIndex,deltaY:input.deltaY}:
        {controlIndex:input.controlIndex,expectedLabel:input.expectedLabel}),
      ...(action==='fill'?{rendererValueVerified:true}:{})};
  }};
  const read=await f.call('app_ui_inspect');
  assert.equal(read.revision,revision);
  const click={requestId:'app_ui_click_once',expectedRevision:revision,
    controlIndex:3,expectedLabel:'Novo projeto'};
  const first=await f.service.invoke(f.context,'app_ui_click',click);
  assert.equal(first.status,'succeeded');
  assert.equal(first.result.dispatched,true);
  assert.equal(first.result.semanticEffectVerified,false);
  assert.equal(calls,2);
  assert.deepEqual(await f.service.invoke(f.context,'app_ui_click',click),first);
  assert.equal(calls,2);
  await assert.rejects(f.service.invoke(f.context,'app_ui_click',
    {...click,expectedLabel:'Excluir projeto'}),/request_conflict/);

  const fill={requestId:'app_ui_fill_once',expectedRevision:revision,
    controlIndex:4,expectedLabel:'Nome',value:'  texto privado  '};
  const saved=await f.service.invoke(f.context,'app_ui_fill',fill);
  assert.equal(saved.status,'succeeded');
  assert.equal(saved.result.rendererValueVerified,true);
  assert.doesNotMatch(JSON.stringify(saved),/texto privado/);
  assert.equal(calls,3);
  assert.deepEqual(await f.service.invoke(f.context,'app_ui_fill',fill),saved);
  assert.equal(calls,3);
  const scroll=await f.service.invoke(f.context,'app_ui_scroll',{
    requestId:'app_ui_scroll_once',expectedRevision:revision,
    scrollIndex:0,deltaY:300});
  assert.equal(scroll.status,'succeeded');
  assert.equal(scroll.result.scrollIndex,0);
  assert.equal(calls,4);

  f.service.viewPort.ui=async()=>{calls++;return {
    schema:'ordax.forge.app-ui-action/1',source:'active_forge_renderer',
    action:'click',dispatched:false,beforeRevision:revision,
    afterRevision:'c'.repeat(64),observableDomChanged:false,
    inputValuesIncluded:false,semanticEffectVerified:false,
    externalEffectsVerified:false,focusChanged:false,
    controlIndex:3,expectedLabel:'Novo projeto'};};
  const uncertainInput={...click,requestId:'app_ui_uncertain_once'};
  const uncertain=await f.service.invoke(f.context,'app_ui_click',uncertainInput);
  assert.equal(uncertain.status,'uncertain');
  assert.equal(uncertain.requiresReconciliation,true);
  const beforeReplay=calls;
  assert.deepEqual(await f.service.invoke(f.context,'app_ui_click',uncertainInput),uncertain);
  assert.equal(calls,beforeReplay);

  f.service.viewPort.ui=async()=>{calls++;const error=Error('forge_app_ui_stale');
    error.forgeAppUiActionNotSubmitted=true;throw error;};
  const stale=await f.service.invoke(f.context,'app_ui_click',
    {...click,requestId:'app_ui_stale_once'});
  assert.equal(stale.status,'failed');
  assert.equal(stale.result.reason,'forge_app_ui_stale');
  // Native shutdown cannot be acknowledged after the process disappears.
  // A remote click on the exit control must fail before DOM dispatch,
  // not produce another uncertain command or get replayed on recovery.
  f.service.viewPort.ui=async()=>{calls++;const error=Error('forge_app_ui_self_termination_blocked');
    error.forgeAppUiActionNotSubmitted=true;throw error;};
  const exitInput={...click,requestId:'app_ui_exit_denied',
    controlIndex:27,expectedLabel:'Sair completamente do Forge'};
  const exit=await f.service.invoke(f.context,'app_ui_click',exitInput);
  assert.equal(exit.status,'failed');
  assert.equal(exit.requiresReconciliation,false);
  assert.equal(exit.result.reason,'forge_app_ui_self_termination_blocked');
  const afterExit=calls;
  assert.deepEqual(await f.service.invoke(f.context,'app_ui_click',exitInput),exit);
  assert.equal(calls,afterExit);
  f.setAllowed(false);
  await assert.rejects(f.service.invoke(f.context,'app_ui_click',
    {...click,requestId:'app_ui_access_denied'}),/access_denied/);
});


test('work failover rotates only a terminal failed GPT attempt and records a fenced checkpoint without sending',async t=>{
  let sends=0;
  const f=fixture(t,{provider:{send:async()=>{sends++;throw Error('must_not_send');}}});
  const a=await project(f,'Failover seguro');
  f.store.setChatUrl(a.w,'https://chatgpt.com/c/11111111-1111-4111-8111-111111111111');
  const sourceRun=f.store.startRun(a.w,'worker_original');
  f.store.recordRunMetrics(a.w,sourceRun,'auto',{
    failedStage:'health',providerDeliveryState:'not_submitted',runStartedAt:Date.now()
  });
  f.store.finishRun(a.w,sourceRun,'provider_session_failed');
  const result=await f.call('work_failover_prepare',{projectId:a.p,taskId:a.w});
  assert.equal(result.status,'succeeded');
  assert.equal(result.result.sourceRunId,sourceRun);
  assert.equal(result.result.failoverGeneration,1);
  assert.equal(result.result.rotationPrepared,true);
  assert.equal(result.result.providerMessagesSent,0);
  assert.equal(result.result.effectsReplayed,false);
  assert.equal(sends,0);
  assert.equal(f.store.getTask(a.w).chat_url,null);
  const conversations=f.store.listConversations(a.w);
  assert.equal(conversations.length,1);
  assert.equal(conversations[0].status,'archived');
  const checkpoint=f.store.latestCheckpoint(a.w);
  assert.equal(checkpoint.version,result.result.checkpointVersion);
  assert.equal(checkpoint.payload.failover_generation,1);
  assert.equal(checkpoint.payload.source_run_id,sourceRun);
  assert.equal(checkpoint.payload.external_effect_replayed,false);
  const event=f.store.db.prepare("SELECT payload FROM events WHERE task_id=? AND kind='provider.failover.prepared' ORDER BY seq DESC LIMIT 1").get(a.w);
  assert.equal(JSON.parse(event.payload).generation,1);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('work failover refuses running, interrupted and unresolved attempts while independent work remains available',async t=>{
  const f=fixture(t);
  const a=await project(f,'Alvo'),b=await project(f,'Independente');
  const running=f.store.startRun(a.w,'worker_stuck');
  await assert.rejects(f.call('work_failover_prepare',{projectId:a.p,taskId:a.w}),/failover_source_still_running/);
  f.store.finishRun(a.w,running,'provider_process_interrupted');
  f.store.db.prepare("UPDATE runs SET status='interrupted',error='process_interrupted' WHERE id=?").run(running);
  f.store.db.prepare("UPDATE tasks SET status='interrupted' WHERE id=?").run(a.w);
  await assert.rejects(f.call('work_failover_prepare',{projectId:a.p,taskId:a.w}),/reconciliation_required/);
  const reserved=f.service.transaction(()=>f.service.reserve(f.context,'work_send',{
    requestId:'uncertain_failover_source',projectId:a.p,taskId:a.w,content:'efeito possivelmente enviado'}));
  f.service.finish(reserved.commandId,{taskId:a.w,reason:'transport_unknown'},'uncertain');
  await assert.rejects(f.call('work_failover_prepare',{projectId:a.p,taskId:a.w}),/reconciliation_required/);
  const independent=await f.call('work_get',{projectId:b.p,taskId:b.w});
  assert.equal(independent.monitor.state,'awaiting_instruction');
  assert.equal(independent.runs.length,0);
  const claim=await f.call('work_claim',{
    projectId:b.p,taskId:b.w,action:'acquire',chatLabel:'Chat independente'
  });
  assert.equal(claim.result.status,'acquired');
  assert.equal(claim.result.claim.taskId,b.w);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});


test('work failover accepts only a latest succeeded Run with durable reconciliation evidence',async t=>{
  const f=fixture(t,{provider:{send:async()=>{throw Error('must_not_send');}}});
  const a=await project(f,'Failover reconciliado');
  f.store.setChatUrl(a.w,'https://chatgpt.com/c/22222222-2222-4222-8222-222222222222');
  const sourceRun=f.store.startRun(a.w,'worker_original');
  f.store.finishRun(a.w,sourceRun);
  await assert.rejects(
    f.call('work_failover_prepare',{projectId:a.p,taskId:a.w}),
    /failover_source_not_reconciled/
  );
  f.store.event(a.w,'provider.response.reconciled',{
    run_id:'run_other',response_sha256:'a'.repeat(64)
  });
  await assert.rejects(
    f.call('work_failover_prepare',{projectId:a.p,taskId:a.w}),
    /failover_source_not_reconciled/
  );
  f.store.event(a.w,'provider.response.reconciled',{
    run_id:sourceRun,response_sha256:'b'.repeat(64)
  });
  const result=await f.call('work_failover_prepare',{projectId:a.p,taskId:a.w});
  assert.equal(result.status,'succeeded');
  assert.equal(result.result.sourceRunId,sourceRun);
  assert.equal(result.result.sourceReconciledResponse,true);
  assert.equal(result.result.providerMessagesSent,0);
  assert.equal(result.result.effectsReplayed,false);
  const checkpoint=f.store.latestCheckpoint(a.w);
  assert.equal(checkpoint.payload.source_reconciled_response,true);
  assert.equal(checkpoint.payload.source_run_id,sourceRun);
  assert.equal(f.store.getTask(a.w).chat_url,null);
  const event=f.store.db.prepare("SELECT payload FROM events WHERE task_id=? AND kind='provider.failover.prepared' ORDER BY seq DESC LIMIT 1").get(a.w);
  assert.equal(JSON.parse(event.payload).source_reconciled_response,true);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});


test('reconciled provider Run closes exactly one matching uncertain work_send receipt before failover',async t=>{
  const f=fixture(t,{provider:{send:async()=>{throw Error('must_not_send');}}});
  const a=await project(f,'Failover físico reconciliado');
  f.store.setChatUrl(a.w,'https://chatgpt.com/c/33333333-3333-4333-8333-333333333333');
  const reserved=f.service.transaction(()=>f.service.reserve(f.context,'work_send',{
    requestId:'physical_recovered_send',projectId:a.p,taskId:a.w,content:'Resposta longa'
  }));
  const sourceRun=f.store.startRun(a.w,'worker_interrupted');
  f.service.finish(reserved.commandId,{taskId:a.w},'uncertain');
  f.store.finishRun(a.w,sourceRun);
  f.store.event(a.w,'provider.response.reconciled',{
    run_id:sourceRun,response_sha256:'c'.repeat(64)
  });
  const recovered=f.service.reconcileRecoveredWorkReceipt(a.w,sourceRun);
  assert.equal(recovered.reconciled,true);
  assert.equal(recovered.commandId,reserved.commandId);
  const receipt=f.store.db.prepare('SELECT status,result FROM lab_command_receipts WHERE id=?').get(reserved.commandId);
  assert.equal(receipt.status,'succeeded');
  assert.deepEqual(JSON.parse(receipt.result),{
    taskId:a.w,runId:sourceRun,responseObserved:true,effectVerified:false,
    provider:'chatgpt_web',recovered:true,reconciled:true
  });
  assert.equal(f.service.hasUnresolvedWorkReceipt(a.p,a.w,{includeRunning:true}),false);
  const failover=await f.call('work_failover_prepare',{projectId:a.p,taskId:a.w});
  assert.equal(failover.status,'succeeded');
  assert.equal(failover.result.sourceRunId,sourceRun);
  assert.equal(failover.result.sourceReconciledResponse,true);
  const event=f.store.db.prepare("SELECT payload FROM events WHERE task_id=? AND kind='provider.command.reconciled' ORDER BY seq DESC LIMIT 1").get(a.w);
  assert.equal(JSON.parse(event.payload).command_id,reserved.commandId);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('recovered work receipt reconciliation fails closed when uncertain command attribution is ambiguous',async t=>{
  const f=fixture(t);
  const a=await project(f,'Failover ambíguo');
  for(const requestId of ['ambiguous_send_a','ambiguous_send_b']){
    const reserved=f.service.transaction(()=>f.service.reserve(f.context,'work_send',{
      requestId,projectId:a.p,taskId:a.w,content:'Mesmo alvo'
    }));
    f.service.finish(reserved.commandId,{taskId:a.w},'uncertain');
  }
  const sourceRun=f.store.startRun(a.w,'worker_reconciled');
  f.store.finishRun(a.w,sourceRun);
  f.store.event(a.w,'provider.response.reconciled',{
    run_id:sourceRun,response_sha256:'d'.repeat(64)
  });
  assert.throws(()=>f.service.reconcileRecoveredWorkReceipt(a.w,sourceRun),
    /recovered_work_receipt_ambiguous/);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_command_receipts WHERE status='uncertain'").get().n,2);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
