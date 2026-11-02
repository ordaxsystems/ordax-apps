import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {createOrchestratorMcp} from '../src/orchestrator-mcp.mjs';
import {ORCHESTRATOR_TOOLS} from '../src/orchestrator-contract.mjs';
import {createGroqCoordinatorConversation} from '../supervisor/groq-conversation.mjs';

const jsonResponse=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});

function fixture(t,{provider,coordinator,repositoryPort=null,confirmProposal=()=>true,confirmProposalSend=()=>true}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-orchestration-'));
  const file=path.join(dir,'lab.sqlite');
  const store=new Store(file);
  const context=Object.freeze({actorId:'local-test-owner',clientId:'app-test',workspaceSessionId:store.getWorkspaceSession().id});
  let allowed=true;
  const service=new OrchestratorService({store,provider,coordinator,repositoryPort,confirmProposal,confirmProposalSend,authorize:({context:c})=>allowed&&c===context});
  t.after(()=>{try{store.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});});
  let request=0;
  return {file,store,context,service,setAllowed:v=>allowed=v,
    call:(op,input={})=>service.invoke(context,op,{...(!ORCHESTRATOR_TOOLS.find(t=>t.operation===op).readOnly?{requestId:'r'+(++request)}:{}),...input})};
}
async function project(f,name='Projeto A') {
  const p=(await f.call('project_create',{name,objective:'Criar site'})).result.projectId;
  const o=(await f.call('orchestrator_create',{projectId:p,name:'Arquiteto',mission:'Analisar e evoluir o projeto'})).result;
  const w=(await f.call('work_create',{projectId:p,orchestratorId:o.orchestratorId,title:'Site'})).result.taskId;
  return {p,o:o.orchestratorId,chat:o.chatTaskId,w};
}
function executorReceipt(store,taskId) {
  const runId=store.startRun(taskId);store.finishRun(taskId,runId);
  return {confirmed:true,deliveryObserved:true,responseObserved:true,effectVerified:false,runId};
}

async function preparedWork(f) {
  const a=await project(f);
  const actionId=(await f.call('orchestrator_prepare',{projectId:a.p,orchestratorId:a.o,content:'Preparar pesquisa'})).result.proposalActionId;
  const created=await f.call('proposal_review',{projectId:a.p,orchestratorId:a.o,actionId,approved:true});
  return {...a,actionId,taskId:created.result.taskId,draftRevision:1};
}
const proposedReply=async()=>({content:'Proposta para revisão',proposal:{title:'Pesquisar',content:'Compare as alternativas.',reason:'Fundamentar o projeto'}});

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

test('project preflight blocks missing model and paused coordinator without changing durable tasks',async t=>{
  const f=fixture(t),a=await project(f);
  assert.deepEqual((await f.call('project_preflight',{projectId:a.p,orchestratorId:a.o})).blockers,['coordinator_unavailable']);
  await f.call('orchestrator_pause',{projectId:a.p,orchestratorId:a.o,paused:true});
  assert.deepEqual((await f.call('project_preflight',{projectId:a.p,orchestratorId:a.o})).blockers,
    ['coordinator_paused','coordinator_unavailable']);
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

test('native-approved first send uses the existing executor, durable approval and one receipt without coordinator API',async t=>{
  let sends=0,confirms=0;
  const f=fixture(t,{coordinator:{send:proposedReply},confirmProposalSend:async({content})=>{
    confirms++;assert.equal(content,'Compare as alternativas.');return true;
  },provider:{ready:async()=>true,send:async({taskId,content,draftRevision})=>{
    sends++;
    assert.equal(draftRevision,2);
    assert.equal(f.store.db.prepare("SELECT status FROM approval_ledger WHERE task_id=?").get(taskId).status,'approved');
    assert.equal(f.store.db.prepare("SELECT status FROM action_ledger WHERE task_id=? AND action_type='orchestrator.proposal-send'").get(taskId).status,'dispatching');
    const {runId}=f.store.beginProviderRun(taskId,content,{draftRevision});
    f.store.appendMessage(taskId,'assistant','Comparação observada');f.store.finishRun(taskId,runId);
    return {confirmed:true,deliveryObserved:true,responseObserved:true,effectVerified:false,runId};
  }}}),a=await preparedWork(f);
  f.service.coordinator=null;
  assert.equal((await f.call('proposals_list',{projectId:a.p,orchestratorId:a.o})).proposals[0].status,'prepared');
  const input={requestId:'first-send',projectId:a.p,orchestratorId:a.o,actionId:a.actionId,draftRevision:1};
  const result=await f.call('proposal_send',input);
  assert.equal(result.status,'succeeded');assert.equal(result.result.effectVerified,false);
  assert.equal(f.store.getTask(a.taskId).draft,'');
  assert.deepEqual(await f.call('proposal_send',input),result);
  await assert.rejects(f.call('proposal_send',{...input,requestId:'another-send'}),/first_send_unavailable/);
  assert.equal(sends,1);assert.equal(confirms,1);
  assert.equal((await f.call('proposals_list',{projectId:a.p,orchestratorId:a.o})).proposals.length,0);
});

test('missing or cancelled native send confirmation and failed readiness create no send approval or provider call',async t=>{
  for(const mode of ['missing','cancelled','not-ready']) {
    let sends=0,confirms=0;
    const f=fixture(t,{coordinator:{send:proposedReply},
      confirmProposalSend:mode==='missing'?null:async()=>{confirms++;return false;},
      provider:{ready:async()=>mode!=='not-ready',send:()=>{sends++;throw Error('must not send');}}}),a=await preparedWork(f);
    await assert.rejects(f.call('proposal_send',{projectId:a.p,orchestratorId:a.o,actionId:a.actionId,draftRevision:1}),/not_approved|provider_unavailable/);
    assert.equal(sends,0);assert.equal(confirms,mode==='cancelled'?1:0);
    assert.equal(f.store.getTask(a.taskId).draft,'Compare as alternativas.');
    assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM action_ledger WHERE action_type='orchestrator.proposal-send'").get().n,0);
  }
});

test('first send revalidates draft, pause, permission and intervening runs after native review',async t=>{
  for(const mode of ['draft','pause','revocation','run']) {
    let confirm,sends=0;
    const f=fixture(t,{coordinator:{send:proposedReply},confirmProposalSend:()=>new Promise(resolve=>{confirm=resolve;}),
      provider:{send:()=>{sends++;throw Error('must not send');}}}),a=await preparedWork(f);
    const input={projectId:a.p,orchestratorId:a.o,actionId:a.actionId,draftRevision:1};
    const pending=f.call('proposal_send',input);
    // Metadata remains usable while the owner reviews; no SQL transaction is open.
    if(mode==='draft')f.store.setDraft(a.taskId,'Mensagem editada',2);
    if(mode==='pause')await f.call('orchestrator_pause',{projectId:a.p,orchestratorId:a.o,paused:true});
    if(mode==='revocation')f.setAllowed(false);
    if(mode==='run'){const id=f.store.startRun(a.taskId);f.store.finishRun(a.taskId,id);}
    confirm(true);
    await assert.rejects(pending,/draft_changed|paused|access_denied|first_send_unavailable/);
    assert.equal(sends,0);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM action_ledger WHERE action_type='orchestrator.proposal-send'").get().n,0);
  }
});

test('uncertain first send survives recovery and neither same nor new commands replay transport',async t=>{
  let sends=0;
  const f=fixture(t,{coordinator:{send:proposedReply},provider:{send:async({taskId,content,draftRevision})=>{
    sends++;f.store.beginProviderRun(taskId,content,{draftRevision});throw Error('lost transport');
  }}}),a=await preparedWork(f);
  const input={projectId:a.p,orchestratorId:a.o,actionId:a.actionId,draftRevision:1,requestId:'uncertain-first-send'};
  const receipt=await f.call('proposal_send',input);
  assert.equal(receipt.status,'uncertain');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs WHERE task_id=?').get(a.taskId).n,1);
  assert.equal(f.store.db.prepare('SELECT status FROM action_ledger WHERE id=?').get(receipt.result.sendActionId).status,'indeterminate');
  // Simulate process loss before final receipt/action persistence.
  f.store.db.prepare("UPDATE lab_command_receipts SET status='running' WHERE id=?").run(receipt.commandId);
  f.store.db.prepare("UPDATE action_ledger SET status='dispatching' WHERE id=?").run(receipt.result.sendActionId);
  f.store.close();
  const reopened=new Store(f.file);
  try {
    const service=new OrchestratorService({store:reopened,authorize:()=>true,
      provider:{send:()=>{sends++;throw Error('must not replay');}}});
    assert.equal(service.recoverInterruptedCommands(),1);
    assert.equal(service.recoverInterruptedCommands(),0);
    assert.equal((await service.invoke(f.context,'proposal_send',input)).status,'uncertain');
    await assert.rejects(service.invoke(f.context,'proposal_send',{...input,requestId:'new-first-send'}),/first_send_unavailable/);
    assert.equal(reopened.db.prepare('SELECT status FROM action_ledger WHERE id=?').get(receipt.result.sendActionId).status,'indeterminate');
  }finally{reopened.close();}
  assert.equal(sends,1);
});

test('send approval persistence is atomic and project/work-send permissions cannot be bypassed',async t=>{
  let sends=0,confirms=0;
  const f=fixture(t,{coordinator:{send:proposedReply},confirmProposalSend:async()=>{confirms++;return true;},
    provider:{send:()=>{sends++;throw Error('must not send');}}}),a=await preparedWork(f),b=await project(f,'B');
  const input={projectId:a.p,orchestratorId:a.o,actionId:a.actionId,draftRevision:1};
  await assert.rejects(f.call('proposal_send',{...input,projectId:b.p,orchestratorId:b.o}),/unavailable/);
  const authorize=f.service.authorize;
  f.service.authorize=args=>args.operation!=='work_send'&&authorize(args);
  await assert.rejects(f.call('proposal_send',input),/access_denied/);assert.equal(confirms,0);
  f.service.authorize=authorize;
  f.store.db.exec("CREATE TRIGGER reject_send_approval BEFORE INSERT ON approval_ledger BEGIN SELECT RAISE(ABORT,'injected_send_approval'); END");
  await assert.rejects(f.call('proposal_send',input),/injected_send_approval/);
  assert.equal(sends,0);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_command_receipts WHERE operation='proposal_send'").get().n,0);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM action_ledger WHERE action_type='orchestrator.proposal-send'").get().n,0);
  assert.equal(f.store.getTask(a.taskId).draft,'Compare as alternativas.');
});

test('coordinator work proposal survives restart and approval creates exactly one scoped work and draft without GPT',async t=>{
  let calls=0,sends=0;
  const f=fixture(t,{coordinator:{send:async({prepareWork})=>{
    calls++;assert.equal(prepareWork,true);
    return {cont…10080 tokens truncated…').get().quick_check,'ok');
});

test('Groq coordinator remains available while the GPT Web executor is busy',async t=>{
  let groqCalls=0,gptCalls=0;
  const f=fixture(t,{
    provider:{busy:()=>true,send:async()=>{gptCalls++;throw Error('unexpected_gpt_send');}},
    coordinator:{available:()=>true,send:async()=>{groqCalls++;return {content:'A conversa de coordenação está disponível.'};}}
  }),a=await project(f);
  f.store.setDraft(a.chat,'Você está disponível?',1);
  const result=await f.call('orchestrator_chat',{
    requestId:'groq-while-gpt-busy',projectId:a.p,orchestratorId:a.o,
    content:'Você está disponível?',draftRevision:1
  });
  assert.equal(result.status,'succeeded');
  assert.equal(result.result.provider,'groq');
  assert.equal(groqCalls,1);
  assert.equal(gptCalls,0);
  assert.equal(f.service.executorAdmission().availableSlots,0);
});

test('coordinator rejects stale revisions before a Groq request or any GPT work',async t=>{
  let gptCalls=0,groqCalls=0;
  const f=fixture(t,{provider:{send:async()=>{gptCalls++;throw Error('must_not_send_gpt');}},
    coordinator:{available:()=>true,send:async()=>{groqCalls++;return {content:'Unexpected'};}}}),a=await project(f);
  f.store.setDraft(a.chat,'Mensagem mais recente',3);
  await assert.rejects(f.call('orchestrator_chat',{requestId:'stale-draft',projectId:a.p,orchestratorId:a.o,
    content:'Texto antigo',draftRevision:2}),/task_draft_revision_conflict/);
  assert.equal(gptCalls,0);
  assert.equal(groqCalls,0);
  assert.equal(f.store.getTaskDraft(a.chat).draft,'Mensagem mais recente');
  assert.equal(f.store.messages(a.chat).length,0);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_command_receipts WHERE request_id=?").get('stale-draft').n,0);
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

test('work send targets the linked GitHub remote and clearly reports that no local workspace is attached',async t=>{
  let received;
  const f=fixture(t,{provider:{send:async({taskId,content,repositoryUrl})=>{
    received={content,repositoryUrl};
    const runId=f.store.startRun(taskId);
    f.store.appendMessage(taskId,'assistant','Consulta remota indisponível nesta fixture.');
    f.store.finishRun(taskId,runId);
    return {confirmed:true,deliveryObserved:true,responseObserved:true,effectVerified:false,runId};
  }}});
  const projectId=(await f.call('project_create',{name:'VESTE',repositoryUrl:'https://github.com/ordaxsystems/veste'})).result.projectId;
  const orchestratorId=(await f.call('orchestrator_create',{projectId,name:'VESTE',mission:'Evoluir a loja'})).result.orchestratorId;
  const taskId=(await f.call('work_create',{projectId,orchestratorId,title:'Loja remota'})).result.taskId;
  const receipt=await f.call('work_send',{projectId,taskId,content:'Inspecione a loja e proponha a primeira alteração.'});
  assert.equal(receipt.status,'succeeded');
  assert.equal(received.repositoryUrl,'https://github.com/ordaxsystems/veste');
  assert.match(received.content,/Repositório padrão: https:\/\/github\.com\/ordaxsystems\/veste/);
  assert.match(received.content,/Nenhuma pasta local está conectada/);
  assert.equal(receipt.result.effectVerified,false);
  await assert.rejects(f.call('project_repository_set',{projectId,repositoryUrl:'https://github.com/ordaxsystems/another-repo'}),
    /repository_change_requires_new_project/);
  assert.equal((await f.call('projects_list')).projects.find(item=>item.id===projectId).repository_url,
    'https://github.com/ordaxsystems/veste');
});

test('Groq planning keeps its own project history and never submits to GPT',async t=>{
  const f=fixture(t),a=await project(f);
  await f.call('project_repository_set',{projectId:a.p,repositoryUrl:'https://github.com/ordaxsystems/veste'});
  const requests=[];
  f.service.coordinator=createGroqCoordinatorConversation({store:f.store,getApiKey:()=> 'fixture-only',isEnabled:()=>true,
    fetchImpl:async(_url,options)=>{
      const body=JSON.parse(options.body);requests.push(body);
      assert.match(body.messages[0].content,/API não consultou o GitHub nem recebeu conteúdo/);
      assert.ok(body.messages[0].content.includes('https://github.com/ordaxsystems/veste'));
      return jsonResponse({choices:[{finish_reason:'stop',message:{
        content:JSON.stringify({title:'Revisar catálogo',content:'Pesquisar itens',reason:'Planejar projeto'})}}]});
    }});
  const first=await f.call('orchestrator_prepare',{projectId:a.p,orchestratorId:a.o,content:'Vamos criar a loja VESTE.'});
  const second=await f.call('orchestrator_prepare',{projectId:a.p,orchestratorId:a.o,content:'Continue pela etapa de catálogo.'});
  assert.equal(first.status,'succeeded');assert.equal(second.status,'succeeded');
  assert.equal(requests.length,2);
  const secondHistory=JSON.stringify(requests[1].messages.slice(1));
  assert.match(secondHistory,/Vamos criar a loja VESTE/);
  assert.match(secondHistory,/Continue pela etapa de catálogo/);
  assert.equal(f.store.messages(a.chat).filter(m=>m.role==='assistant').length,2);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs WHERE task_id=?').get(a.chat).n,0);
});

test('explicit coordinator analysis is bounded to one project and orchestrator and never sends GPT work',async t=>{
  let analysis,calls=0,providerCalls=0;
  const f=fixture(t,{provider:{send:async()=>{providerCalls++;throw Error('must_not_send');}},
    coordinator:{available:()=>true,send:async args=>{calls++;analysis=args.analysisContext;return {content:'A frente precisa de revisão; recomendo verificar a resposta mais recente.'};}}});
  const a=await project(f);
  for(let i=0;i<5;i++)await f.call('work_create',{projectId:a.p,orchestratorId:a.o,title:`Frente ${i}`});
  const other=(await f.call('orchestrator_create',{projectId:a.p,name:'Outro orquestrador',mission:'Outra área'})).result;
  const otherWork=(await f.call('work_create',{projectId:a.p,orchestratorId:other.orchestratorId,title:'OUTRA_FRENTE_PRIVADA'})).result.taskId;
  const b=await project(f,'Projeto privado');
  f.store.appendMessage(a.w,'user','Primeira mensagem antiga');
  for(let i=0;i<6;i++)f.store.appendMessage(a.w,i%2?'assistant':'user',`Mensagem recente ${i}`);
  f.store.appendMessage(a.w,'user','api_key=very-secret-value gsk_abcdefghijklmnopqrstuv https://private.example/chat');
  f.store.appendMessage(otherWork,'user','OUTRO_ORQUESTRADOR_PRIVADO');
  f.store.appendMessage(b.w,'user','OUTRO_PROJETO_PRIVADO');
  const input={requestId:'analysis-once',projectId:a.p,orchestratorId:a.o};
  const receipt=await f.call('orchestrator_analyze',input);
  assert.equal(receipt.status,'succeeded');
  assert.deepEqual(receipt.result.analysis,{workCount:4,messageCount:5});
  assert.equal(calls,1);assert.equal(providerCalls,0);
  assert.equal(analysis.works.length,4);
  assert.ok(analysis.works.every(work=>work.title!=='OUTRA_FRENTE_PRIVADA'));
  const serialized=JSON.stringify(analysis);
  assert.doesNotMatch(serialized,/OUTRO_ORQUESTRADOR_PRIVADO|OUTRO_PROJETO_PRIVADO|OUTRA_FRENTE_PRIVADA/);
  assert.doesNotMatch(serialized,/very-secret-value|gsk_abcdefghijklmnopqrstuv|https:\/\/private\.example/);
  assert.match(serialized,/\[redigido\]|\[credencial redigida\]|\[link omitido\]/);
  assert.equal(analysis.works.find(work=>work.title==='Site').messages.length,5);
  assert.doesNotMatch(serialized,/Primeira mensagem antiga/);
  assert.deepEqual(f.store.messages(a.chat).map(message=>message.role).sort(),['assistant','user']);
  await f.call('orchestrator_analyze',input);assert.equal(calls,1,'same receipt never repeats the API request');
});

test('late Groq planning reply after authorization revocation is not disclosed or confirmed',async t=>{
  let resolve;
  const gate=new Promise(r=>resolve=r);
  const f=fixture(t,{coordinator:{available:()=>true,send:async()=>{await gate;return {content:'Private reply'};}}});
  const a=await project(f);
  f.store.appendMessage(a.w,'user','Analise o andamento.');
  const pending=f.call('orchestrator_analyze',{projectId:a.p,orchestratorId:a.o});
  f.setAllowed(false);resolve();
  await assert.rejects(pending,/access_denied/);
  assert.equal(f.store.messages(a.chat).length,1);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_command_receipts WHERE status='uncertain'").get().n,1);
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
  const mcp=createOrchestratorMcp({service:f.service,getContext:()=>f.context});
  const rpc=(method,params={},id=1)=>mcp.handle({jsonrpc:'2.0',id,method,params});
  assert.equal((await rpc('tools/list')).error.code,-32002);
  const init=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'fixture',version:'1'}});
  assert.equal(init.result.protocolVersion,'2025-11-25');
  await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const tools=(await rpc('tools/list')).result.tools;
  assert.equal(tools.length,ORCHESTRATOR_TOOLS.length);
  assert.deepEqual(new Set(tools.map(tool=>tool.name)),new Set(ORCHESTRATOR_TOOLS.map(tool=>tool.name)));
  assert.ok(tools.some(tool=>tool.name==='orchestrator_continuity_status'&&tool.annotations.readOnlyHint===true));
  assert.ok(tools.some(tool=>tool.name==='orchestrator_continuity_set'&&tool.annotations.readOnlyHint===false));
  assert.ok(tools.every(tool=>tool.inputSchema.additionalProperties===false));
  const created=await rpc('tools/call',{name:'orchestrator_project_create',arguments:{requestId:'mcp-one',name:'MCP project'}});
  const receipt=created.result.structuredContent;
  assert.equal(receipt.status,'succeeded');
  assert.equal((await f.call('projects_list')).projects[0].id,receipt.result.projectId);
  const repeated=await rpc('tools/call',{name:'orchestrator_project_create',arguments:{requestId:'mcp-one',name:'MCP project'}});
  assert.deepEqual(repeated.result.structuredContent,receipt);
  assert.equal((await rpc('tools/call',{name:'arbitrary_shell',arguments:{}})).error.code,-32602);
  f.setAllowed(false);
  assert.equal((await rpc('tools/list')).error.code,-32001);
  assert.equal((await mcp.handle([])).error.code,-32600);
});

test('Groq coordinator is opt-in, project scoped and refuses a truncated response without retries',async t=>{
  const f=fixture(t),a=await project(f),b=await project(f,'Other secret project');
  f.store.appendMessage(a.chat,'user','Planeje api_key=history-secret https://private.example/path');
  f.store.appendMessage(b.chat,'user','OTHER_PRIVATE_TEXT');
  let calls=0;
  const adapter=createGroqCoordinatorConversation({store:f.store,getApiKey:()=> 'fixture-only',isEnabled:()=>true,
    fetchImpl:async(_url,options)=>{
      calls++;const body=JSON.parse(options.body);
      assert.doesNotMatch(JSON.stringify(body),/OTHER_PRIVATE_TEXT|Other secret project|fixture-only|history-secret|https:\/\/private\.example/);
      assert.doesNotMatch(JSON.stringify(body),/analysis-secret|https:\/\/analysis\.example/);
      assert.match(body.messages[0].content,/somente consultiva/);
      assert.match(options.headers.Authorization,/fixture-only/);
      return jsonResponse({choices:[{finish_reason:'length',message:{content:'Partial'}}]});
    }});
  await assert.rejects(adapter.send({taskId:a.chat,projectId:a.p,orchestratorId:a.o,mission:'Planejar',
    analysisContext:{works:[{title:'Site',messages:[{content:'api_key=analysis-secret https://analysis.example/path'}]}]}}),/incomplete/);
  assert.equal(calls,1);
  const disabled=createGroqCoordinatorConversation({store:f.store,getApiKey:()=>null,isEnabled:()=>false,
    fetchImpl:async()=>{throw Error('must not call');}});
  assert.equal(disabled.available(),false);
  await assert.rejects(disabled.send({taskId:a.chat,projectId:a.p,mission:'Planejar'}),/disabled/);
});

test('Groq coordinator receives only bounded workspace facts and is instructed not to invent local evidence',async t=>{
  const f=fixture(t),a=await project(f);
  const adapter=createGroqCoordinatorConversation({store:f.store,getApiKey:()=> 'fixture-only',isEnabled:()=>true,
    fetchImpl:async(_url,options)=>{
      const body=JSON.parse(options.body),system=body.messages[0].content;
      assert.match(system,/única evidência sobre o workspace/);
      assert.match(system,/não afirme branch, HEAD nem estado do Git/);
      assert.match(system,/nenhum conteúdo de arquivo foi lido/);
      assert.match(system,/"state":"capability_unavailable"/);
      assert.match(system,/"filesRead":0/);
      assert.doesNotMatch(system,/C:\\private\\VESTE|resource_private-id/);
      return jsonResponse({choices:[{finish_reason:'stop',message:{content:'Nenhum arquivo foi lido.'}}]});
    }});
  const result=await adapter.send({taskId:a.chat,projectId:a.p,orchestratorId:a.o,mission:'Planejar',
    workspaceObservation:{state:'capability_unavailable',capabilityAvailable:false,snapshotObserved:false,
      gitMetadataAvailable:false,fileContentAvailable:false,filesRead:0,filesWritten:0,
      absolutePath:'C:\\private\\VESTE',resourceId:'resource_private-id'}});
  assert.equal(result.content,'Nenhum arquivo foi lido.');
});


test('pause and immediate resume quarantine late Groq chat, analysis and proposal replies',async t=>{
  for(const operation of ['orchestrator_chat','orchestrator_analyze','orchestrator_prepare']){
    let entered,release,groqCalls=0,gptCalls=0;
    const started=new Promise(resolve=>{entered=resolve;});
    const gate=new Promise(resolve=>{release=resolve;});
    const f=fixture(t,{provider:{send:async()=>{gptCalls++;throw Error('gpt_must_not_send');}},
      coordinator:{available:()=>true,send:async()=>{
        groqCalls++;entered();await gate;
        return {provider:'groq',content:'A resposta antiga não pode confirmar progresso',
          proposal:{title:'Não criar',content:'Sem envio',reason:'Resposta tardia'}};
      }}});
    const a=await project(f,'Projeto pause '+operation);
    f.store.appendMessage(a.w,'user','Contexto do trabalho confirmado.');
    const input={requestId:'paused_'+operation,projectId:a.p,orchestratorId:a.o,
      ...(operation==='orchestrator_analyze'?{}:{content:'Planeje e revise esta missão.'})};
    const pending=f.call(operation,input);
    await started;
    assert.equal(f.store.db.prepare('SELECT status FROM lab_command_receipts WHERE request_id=?')
      .get(input.requestId).status,'running');
    await f.call('orchestrator_pause',{projectId:a.p,orchestratorId:a.o,paused:true});
    assert.equal(f.store.db.prepare('SELECT status FROM lab_command_receipts WHERE request_id=?')
      .get(input.requestId).status,'uncertain');
    await f.call('orchestrator_pause',{projectId:a.p,orchestratorId:a.o,paused:false});
    release();
    const result=await pending;
    assert.equal(result.status,'uncertain');
    assert.equal(result.result.reason,'coordinator_paused_inflight');
    assert.equal(result.result.taskId,a.chat);
    assert.equal(result.requiresReconciliation,true);
    assert.equal(groqCalls,1);
    assert.equal(gptCalls,0);
    assert.deepEqual(f.store.messages(a.chat).map(m=>m.role),['user'],
      'late model response must not create assistant evidence');
    assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM action_ledger WHERE action_type='orchestrator.work-proposal'").get().n,0,
      'late planning must not create a reviewable proposal');
    assert.deepEqual(await f.call(operation,input),result,'same requestId must never replay');
    assert.equal(groqCalls,1);
    assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  }
});

test('a late Groq error after pause preserves receipt while another project remains independent',async t=>{
  let entered,release,groqCalls=0;
  const started=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  let heldProject=null;
  const f=fixture(t,{coordinator:{available:()=>true,send:async input=>{
    groqCalls++;
    if(input.projectId===heldProject){entered();await gate;throw Error('network_lost_after_pause');}
    return {content:'Projeto independente confirmado',provider:'groq'};
  }}});
  const a=await project(f,'Projeto A'),b=await project(f,'Projeto B');
  heldProject=a.p;
  const input={requestId:'pause_network_error',projectId:a.p,orchestratorId:a.o,content:'Aguardar Groq'};
  const pending=f.call('orchestrator_chat',input);
  await started;
  await f.call('orchestrator_pause',{projectId:a.p,orchestratorId:a.o,paused:true});
  assert.equal((await f.call('orchestrator_chat',{requestId:'b_independent',projectId:b.p,
    orchestratorId:b.o,content:'Continuar B'})).status,'succeeded');
  await f.call('orchestrator_pause',{projectId:a.p,orchestratorId:a.o,paused:false});
  release();
  const sealed=await pending;
  assert.equal(sealed.status,'uncertain');
  assert.equal(sealed.result.reason,'coordinator_paused_inflight');
  assert.deepEqual(f.store.messages(a.chat).map(m=>m.role),['user']);
  assert.deepEqual(f.store.messages(b.chat).map(m=>m.role),['user','assistant']);
  assert.equal(groqCalls,2);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});


test('corrupt proposal payload does not block legitimate pending review or reveal another project',async t=>{
  let providerSends=0;
  const f=fixture(t,{coordinator:{available:()=>true,send:async()=>({
    content:'Proposta para revisão',
    proposal:{title:'Verificar evidências',content:'Inspecione o resultado sem executar.',reason:'Aceite'}})},
    provider:{send:async()=>{providerSends++;throw Error('unexpected_gpt_send');}}});
  const a=await project(f,'Projeto A');
  const b=await project(f,'Projeto B');
  const validA=(await f.call('orchestrator_prepare',{projectId:a.p,orchestratorId:a.o,
    content:'Proposta A válida'})).result.proposalActionId;
  const invalidA=(await f.call('orchestrator_prepare',{projectId:a.p,orchestratorId:a.o,
    content:'Outra proposta A'})).result.proposalActionId;
  const validB=(await f.call('orchestrator_prepare',{projectId:b.p,orchestratorId:b.o,
    content:'Proposta independente B'})).result.proposalActionId;
  const db=f.store.db;
  db.prepare('UPDATE action_ledger SET payload=? WHERE id=?').run('{"truncated"',invalidA);
  const listed=await f.call('proposals_list',{projectId:a.p,orchestratorId:a.o});
  assert.deepEqual(listed.proposals.map(x=>x.actionId),[validA]);
  assert.equal((await f.call('proposals_list',{projectId:b.p,orchestratorId:b.o})).proposals[0].actionId,validB);
  assert.equal(db.prepare('SELECT payload FROM action_ledger WHERE id=?').get(invalidA).payload,'{"truncated"',
    'evidence must be preserved, not rewritten by a list read');
  await assert.rejects(f.call('proposal_review',{projectId:a.p,orchestratorId:a.o,
    actionId:invalidA,approved:true}));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lab_task_bindings WHERE kind=?').get('work').n,2);
  assert.equal(providerSends,0);
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('prepared proposals require canonical approved ledger and ignore corrupted result or shape',async t=>{
  let providerSends=0;
  const f=fixture(t,{coordinator:{available:()=>true,send:async()=>({
    content:'Proposta revisável',proposal:{title:'Nova frente',content:'Revisar evidência',reason:'Aceite'}})},
    provider:{send:async()=>{providerSends++;throw Error('unexpected_gpt_send');}}});
  const a=await project(f);
  const makeProposal=async content=>(await f.call('orchestrator_prepare',{
    projectId:a.p,orchestratorId:a.o,content})).result.proposalActionId;
  const good=await makeProposal('Boa proposta');
  const approved=await f.call('proposal_review',{projectId:a.p,orchestratorId:a.o,actionId:good,approved:true});
  assert.equal(approved.status,'succeeded');
  const malformed=await makeProposal('Corrupt result');
  const other=await f.call('proposal_review',{projectId:a.p,orchestratorId:a.o,actionId:malformed,approved:true});
  assert.equal(other.status,'succeeded');
  const pending=await makeProposal('Pending valid');
  const db=f.store.db;
  assert.deepEqual(new Set((await f.call('proposals_list',{projectId:a.p,orchestratorId:a.o}))
    .proposals.map(x=>x.actionId)),new Set([pending,malformed,good]));
  db.prepare('UPDATE action_ledger SET result=? WHERE id=?').run('{"broken"',malformed);
  db.prepare("UPDATE approval_ledger SET status='rejected' WHERE action_id=?").run(good);
  const visible=(await f.call('proposals_list',{projectId:a.p,orchestratorId:a.o})).proposals;
  assert.deepEqual(visible.map(x=>x.actionId),[pending]);
  assert.equal(visible[0].status,'pending');
  assert.equal(db.prepare('SELECT result FROM action_ledger WHERE id=?').get(malformed).result,'{"broken"');
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  assert.equal(providerSends,0);
});


test('in-flight Groq coordinator does not occupy the single GPT Web executor',async t=>{
  let enterGroq,releaseGroq,groqCalls=0,gptCalls=0;
  const started=new Promise(resolve=>{enterGroq=resolve;});
  const gate=new Promise(resolve=>{releaseGroq=resolve;});
  const f=fixture(t,{
    coordinator:{available:()=>true,send:async()=>{
      groqCalls++;enterGroq();await gate;return {content:'Consulta de coordenação confirmada'};
    }},
    provider:{busy:()=>false,send:async({taskId})=>{
      gptCalls++;
      const runId=f.store.startRun(taskId);
      f.store.appendMessage(taskId,'assistant','Resposta GPT confirmada pela fixture');
      f.store.finishRun(taskId,runId);
      return {confirmed:true,deliveryObserved:true,responseObserved:true,effectVerified:false,runId};
    }}
  });
  const a=await project(f,'Coordenação A'),b=await project(f,'Execução B');
  const pending=f.call('orchestrator_chat',{requestId:'groq-held',projectId:a.p,
    orchestratorId:a.o,content:'Coordene projeto A'});
  await started;
  const duringGroq=f.service.executorAdmission();
  assert.equal(duringGroq.activeRuns,0);
  assert.equal(duringGroq.activeCommands,0,
    'a running Groq command must not be counted as a GPT submission');
  assert.equal(duringGroq.availableSlots,1);
  const result=await f.call('work_send',{requestId:'gpt-during-groq',projectId:b.p,
    taskId:b.w,content:'Verifique trabalho B'});
  assert.equal(result.status,'succeeded');
  assert.equal(gptCalls,1);
  assert.equal(groqCalls,1);
  assert.equal(f.service.coordinatorTurnBusy(a.chat),true,
    'GPT completion must not interrupt coordinator A');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  releaseGroq();
  assert.equal((await pending).status,'succeeded');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('GPT admission still serializes provider sends while Groq is in flight',async t=>{
  let enterGroq,releaseGroq,enterGPT,releaseGPT,gptCalls=0;
  const groqStarted=new Promise(resolve=>{enterGroq=resolve;});
  const groqGate=new Promise(resolve=>{releaseGroq=resolve;});
  const gptStarted=new Promise(resolve=>{enterGPT=resolve;});
  const gptGate=new Promise(resolve=>{releaseGPT=resolve;});
  const f=fixture(t,{
    coordinator:{available:()=>true,send:async()=>{
      enterGroq();await groqGate;return {content:'Coordenação preservada'};
    }},
    provider:{busy:()=>false,send:async({taskId})=>{
      gptCalls++;
      if(gptCalls===1){enterGPT();await gptGate;}
      const runId=f.store.startRun(taskId);
      f.store.appendMessage(taskId,'assistant','GPT confirmado');
      f.store.finishRun(taskId,runId);
      return {confirmed:true,deliveryObserved:true,responseObserved:true,effectVerified:false,runId};
    }}
  });
  const a=await project(f,'Groq A'),b=await project(f,'GPT B'),c=await project(f,'GPT C');
  const groq=f.call('orchestrator_chat',{requestId:'held-groq',projectId:a.p,
    orchestratorId:a.o,content:'Analisar A'});
  await groqStarted;
  const provider=f.call('work_send',{requestId:'held-gpt',projectId:b.p,
    taskId:b.w,content:'Executar B'});
  await gptStarted;
  const admission=f.service.executorAdmission();
  assert.equal(admission.activeCommands,1);
  assert.equal(admission.availableSlots,0);
  await assert.rejects(f.call('work_send',{requestId:'second-gpt-blocked',projectId:c.p,
    taskId:c.w,content:'Executar C'}),/executor_busy/);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_command_receipts WHERE request_id=?')
    .get('second-gpt-blocked').n,0,'a rejected send must not reserve or transmit');
  assert.equal(gptCalls,1);
  releaseGPT();
  assert.equal((await provider).status,'succeeded');
  assert.equal(f.service.executorAdmission().availableSlots,1,
    'Groq A must not keep GPT capacity reserved after GPT B completes');
  assert.equal((await f.call('work_send',{requestId:'gpt-after-gpt',projectId:c.p,
    taskId:c.w,content:'Executar C'})).status,'succeeded');
  assert.equal(gptCalls,2);
  releaseGroq();
  assert.equal((await groq).status,'succeeded');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
