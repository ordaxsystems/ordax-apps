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

function fixture(t,{provider,coordinator,confirmProposal=()=>true,confirmProposalSend=()=>true}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-orchestration-'));
  const file=path.join(dir,'lab.sqlite');
  const store=new Store(file);
  const context=Object.freeze({actorId:'local-test-owner',clientId:'app-test',workspaceSessionId:store.getWorkspaceSession().id});
  let allowed=true;
  const service=new OrchestratorService({store,provider,coordinator,confirmProposal,confirmProposalSend,authorize:({context:c})=>allowed&&c===context});
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
    return {content:'Revisar proposta',proposal:{title:'Investigar erro',content:'Analise o erro sem alterar arquivos.',reason:'Separar a investigação'}};
  }},provider:{send:()=>{sends++;throw Error('must not send');}}}),a=await project(f),b=await project(f,'B');
  const before=f.store.db.prepare('SELECT COUNT(*) n FROM tasks').get().n;
  f.store.setDraft(a.chat,'Prepare uma investigação',1);
  const input={projectId:a.p,orchestratorId:a.o,content:'Prepare uma investigação',draftRevision:1,requestId:'prepare-once'};
  const receipt=await f.call('orchestrator_prepare',input);
  assert.equal(receipt.status,'succeeded');
  assert.equal(f.store.getTaskDraft(a.chat).draft,'');
  assert.equal(f.store.getTaskDraft(a.chat).draft_revision,2);
  assert.equal(f.store.messages(a.chat).filter(message=>message.role==='user').at(-1).content,input.content);
  await f.call('orchestrator_prepare',input);assert.equal(calls,1);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM tasks').get().n,before);
  const actionId=receipt.result.proposalActionId;
  assert.equal((await f.call('proposals_list',{projectId:b.p,orchestratorId:b.o})).proposals.length,0);
  await assert.rejects(f.call('proposal_review',{projectId:b.p,orchestratorId:b.o,actionId,approved:true}),/unavailable/);
  const reopened=new Store(f.file);
  try {
    const recovered=new OrchestratorService({store:reopened,authorize:()=>true});
    assert.equal((await recovered.invoke(f.context,'proposals_list',{projectId:a.p,orchestratorId:a.o})).proposals[0].actionId,actionId);
    const foreign={...f.context,clientId:'other-client'};
    assert.equal((await recovered.invoke(foreign,'proposals_list',{projectId:a.p,orchestratorId:a.o})).proposals.length,0);
    await assert.rejects(recovered.invoke(foreign,'proposal_review',{projectId:a.p,orchestratorId:a.o,actionId,approved:true,requestId:'foreign-review'}),/access_denied/);
  }finally{reopened.close();}
  const review={projectId:a.p,orchestratorId:a.o,actionId,approved:true,requestId:'review-once'};
  const approved=await f.call('proposal_review',review);
  assert.deepEqual(await f.call('proposal_review',review),approved);
  assert.equal(approved.result.providerMessagesSent,0);
  const created=f.store.getTask(approved.result.taskId);
  assert.equal(created.title,'Investigar erro');
  assert.equal(created.draft,'Analise o erro sem alterar arquivos.');
  assert.equal(created.messages.length,0);
  assert.equal((await f.call('work_get',{projectId:a.p,taskId:created.id})).orchestrator_id,a.o);
  await assert.rejects(f.call('proposal_review',{...review,requestId:'review-again'}),/already_reviewed/);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM tasks').get().n,before+1);
  assert.equal(sends,0);
});

test('proposal rejection, paused coordinator and transaction failure never create partial work',async t=>{
  const f=fixture(t,{coordinator:{send:async()=>({content:'Proposta',proposal:{title:'Nova frente',content:'Rascunho',reason:'Investigar'}})}}),a=await project(f);
  const prepare=async()=> (await f.call('orchestrator_prepare',{projectId:a.p,orchestratorId:a.o,content:'Planeje'})).result.proposalActionId;
  const actionId=await prepare();
  const scope={projectId:a.p,orchestratorId:a.o,actionId};
  await f.call('orchestrator_pause',{projectId:a.p,orchestratorId:a.o,paused:true});
  await assert.rejects(f.call('proposal_review',{...scope,approved:true}),/paused/);
  await f.call('proposal_review',{...scope,approved:false});
  assert.equal((await f.call('work_list',{projectId:a.p})).works.length,1);
  await f.call('orchestrator_pause',{projectId:a.p,orchestratorId:a.o,paused:false});
  const next=await prepare();
  f.store.db.exec("CREATE TRIGGER reject_draft BEFORE UPDATE OF draft ON tasks BEGIN SELECT RAISE(ABORT,'injected_draft_failure'); END");
  await assert.rejects(f.call('proposal_review',{projectId:a.p,orchestratorId:a.o,actionId:next,approved:true}),/injected_draft_failure/);
  assert.equal((await f.call('work_list',{projectId:a.p})).works.length,1);
  assert.equal((await f.call('proposals_list',{projectId:a.p,orchestratorId:a.o})).proposals[0].actionId,next);
  assert.equal(f.store.db.prepare("SELECT status FROM approval_ledger WHERE action_id=?").get(next).status,'pending');
});

test('invalid model proposal cannot create an approval or work, and the uncertain API call never replays',async t=>{
  let calls=0,valid=false;
  const f=fixture(t,{coordinator:{send:async()=>{calls++;return {content:'Proposal',proposal:{title:'X',content:'Y',reason:'Z',...(!valid?{command:'execute'}:{})}};}}}),a=await project(f);
  const input={projectId:a.p,orchestratorId:a.o,content:'Prepare',requestId:'invalid-proposal'};
  assert.equal((await f.call('orchestrator_prepare',input)).status,'uncertain');
  await f.call('orchestrator_prepare',input);assert.equal(calls,1);
  assert.equal((await f.call('proposals_list',{projectId:a.p,orchestratorId:a.o})).proposals.length,0);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM approval_ledger').get().n,0);
  valid=true;
  const fresh=await f.call('orchestrator_prepare',{...input,requestId:'new-explicit-request',content:'Prepare uma nova proposta'});
  assert.equal(fresh.status,'succeeded');assert.equal(calls,2);
  assert.equal((await f.call('orchestrator_prepare',input)).status,'uncertain');assert.equal(calls,2);
});

test('an approval boolean without trusted native confirmation cannot apply a model proposal',async t=>{
  const f=fixture(t,{confirmProposal:null,coordinator:{send:async()=>({content:'Proposta',proposal:{title:'X',content:'Y',reason:'Z'}})}}),a=await project(f);
  const actionId=(await f.call('orchestrator_prepare',{projectId:a.p,orchestratorId:a.o,content:'Prepare'})).result.proposalActionId;
  await assert.rejects(f.call('proposal_review',{projectId:a.p,orchestratorId:a.o,actionId,approved:true}),/not_approved/);
  assert.equal((await f.call('work_list',{projectId:a.p})).works.length,1);
  assert.equal((await f.call('proposals_list',{projectId:a.p,orchestratorId:a.o})).proposals.length,1);
});

test('native review holds no database transaction and revalidates pause and authorization after confirmation',async t=>{
  let confirm;
  const f=fixture(t,{confirmProposal:()=>new Promise(resolve=>{confirm=resolve;}),
    coordinator:{send:async()=>({content:'Proposta',proposal:{title:'X',content:'Y',reason:'Z'}})}}),a=await project(f);
  const actionId=(await f.call('orchestrator_prepare',{projectId:a.p,orchestratorId:a.o,content:'Prepare'})).result.proposalActionId;
  const input={projectId:a.p,orchestratorId:a.o,actionId,approved:true};
  const pending=f.call('proposal_review',input);
  await assert.rejects(f.call('proposal_review',input),/review_busy/);
  // This metadata transaction must remain possible while the human reviews.
  await f.call('orchestrator_pause',{projectId:a.p,orchestratorId:a.o,paused:true});
  confirm(true);await assert.rejects(pending,/paused/);
  await f.call('orchestrator_pause',{projectId:a.p,orchestratorId:a.o,paused:false});
  const revoked=f.call('proposal_review',input);
  f.setAllowed(false);confirm(true);await assert.rejects(revoked,/access_denied/);
  f.setAllowed(true);
  assert.equal((await f.call('work_list',{projectId:a.p})).works.length,1);
  assert.equal((await f.call('proposals_list',{projectId:a.p,orchestratorId:a.o})).proposals.length,1);
});

test('Groq work preparation parses a strictly bounded JSON proposal without invoking tools',async t=>{
  const f=fixture(t),a=await project(f);
  let response=JSON.stringify({title:'Pesquisar',content:'Pesquise as alternativas.',reason:'Fundamentar o projeto'});
  const adapter=createGroqCoordinatorConversation({store:f.store,getApiKey:()=> 'fixture-only',isEnabled:()=>true,
    fetchImpl:async(_url,options)=>{
      const body=JSON.parse(options.body);assert.equal(body.tools,undefined);
      assert.match(body.messages[0].content,/objeto JSON/);
      return jsonResponse({choices:[{finish_reason:'stop',message:{content:response}}]});
    }});
  const input={taskId:a.chat,projectId:a.p,orchestratorId:a.o,mission:'Pesquisar',prepareWork:true};
  assert.equal((await adapter.send(input)).proposal.title,'Pesquisar');
  response='Not JSON';await assert.rejects(adapter.send(input),/groq_invalid_work_proposal/);
});

test('projects, coordinators and work persist in the same SQLite, with bounded semantic reads',async t=>{
  const f=fixture(t),a=await project(f),b=await project(f,'Projeto B');
  assert.equal((await f.call('projects_list')).projects.length,2);
  assert.deepEqual((await f.call('work_list',{projectId:a.p})).works.map(w=>w.id),[a.w]);
  const work=await f.call('work_get',{projectId:a.p,taskId:a.w});
  assert.equal(work.monitor.mayAutomaticallySend,false);
  assert.equal(work.orchestrator_id,a.o);
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

test('one provider send uses the injected canonical executor and a stable receipt, with no replay',async t=>{
  let calls=0;
  const f=fixture(t,{provider:{send:async({taskId})=>{calls++;return executorReceipt(f.store,taskId);}}}),a=await project(f);
  const input={requestId:'send-once',projectId:a.p,taskId:a.w,content:'Olá'};
  const first=await f.call('work_send',input);
  assert.equal(first.status,'succeeded');
  assert.equal(first.result.effectVerified,false);
  assert.deepEqual(await f.call('work_send',input),first);
  assert.equal(calls,1);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,1,'only the injected canonical executor creates a Run');
});

test('unknown delivery remains uncertain across restart; neither same nor new request can resend',async t=>{
  let calls=0;
  const f=fixture(t,{provider:{send:async()=>{calls++;throw Error('upstream private detail');}}}),a=await project(f);
  const input={requestId:'send-once',projectId:a.p,taskId:a.w,content:'Olá'};
  const result=await f.call('work_send',input);
  assert.equal(result.status,'uncertain');assert.equal(result.requiresReconciliation,true);
  assert.doesNotMatch(JSON.stringify(result),/private detail/);
  assert.equal((await f.call('work_get',{projectId:a.p,taskId:a.w})).monitor.state,'reconciliation_required');
  assert.deepEqual(await f.call('work_send',input),result);
  await assert.rejects(f.call('work_send',{...input,requestId:'different'}),/reconciliation_required/);
  f.store.close();
  const reopened=new Store(f.file);
  try {
    const c={...f.context,workspaceSessionId:reopened.getWorkspaceSession().id};
    const s=new OrchestratorService({store:reopened,authorize:()=>true,provider:{send:async()=>{calls++;}}});
    assert.equal(s.recoverInterruptedCommands(),0);
    assert.deepEqual(await s.invoke(c,'work_send',input),result);
    assert.equal(calls,1);
  }finally{reopened.close();}
});

test('explicitly proven pre-submit failure is retryable without replaying the same request',async t=>{
  let calls=0;
  const f=fixture(t,{provider:{send:async({taskId})=>{
    calls++;
    const runId=f.store.startRun(taskId);
    f.store.recordRunMetrics(taskId,runId,'beta',{
      failedStage:'health',providerDeliveryState:'not_submitted'
    });
    f.store.finishRun(taskId,runId,'health:chatgpt_session_not_observed');
    const error=Object.assign(new Error('health:chatgpt_session_not_observed'),{
      providerDeliveryState:'not_submitted',providerFailureStage:'health',
      providerFailureCode:'chatgpt_session_not_observed'
    });
    throw error;
  }}}),a=await project(f);
  const input={requestId:'pre-submit',projectId:a.p,taskId:a.w,content:'Leia o README'};
  const first=await f.call('work_send',input);
  assert.equal(first.status,'failed');
  assert.equal(first.requiresReconciliation,false);
  assert.equal(first.result.reason,'provider_not_submitted');
  assert.equal(first.result.failureCode,'chatgpt_session_not_observed');
  assert.deepEqual(await f.call('work_send',input),first);
  assert.equal(calls,1,'an identical requestId is idempotent');
  const work=await f.call('work_get',{projectId:a.p,taskId:a.w});
  assert.deepEqual(work.monitor,{state:'failed',retryAllowed:true,mayAutomaticallySend:false});
  const retry=await f.call('work_send',{...input,requestId:'pre-submit-retry'});
  assert.equal(retry.status,'failed');
  assert.equal(calls,2,'only a new explicit request can retry');
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

test('a claimed success without transport evidence and a canonical successful Run stays uncertain',async t=>{
  const f=fixture(t,{provider:{send:async()=>({confirmed:true,runId:'run_12345678'})}}),a=await project(f);
  const result=await f.call('work_send',{projectId:a.p,taskId:a.w,content:'Teste'});
  assert.equal(result.status,'uncertain');
});

test('a complete transport receipt belonging to another Task cannot confirm the current work',async t=>{
  const f=fixture(t,{provider:{send:async()=>executorReceipt(f.store,otherTask)}}),a=await project(f);
  const otherTask=f.store.createTask('Other').id;
  const result=await f.call('work_send',{projectId:a.p,taskId:a.w,content:'Teste'});
  assert.equal(result.status,'uncertain');
  assert.equal(f.store.getTask(a.w).status,'ready');
});

test('in-flight requests do not run twice; pause and a second work cannot bypass the executor',async t=>{
  let resolve,calls=0;
  const gate=new Promise(r=>resolve=r);
  const f=fixture(t,{provider:{send:async({taskId})=>{calls++;await gate;return executorReceipt(f.store,taskId);}}}),a=await project(f);
  const input={requestId:'active',projectId:a.p,taskId:a.w,content:'Trabalhe'};
  const pending=f.call('work_send',input);
  assert.equal((await f.call('work_send',input)).status,'running');
  assert.equal((await f.call('work_get',{projectId:a.p,taskId:a.w})).monitor.mayAutomaticallySend,false);
  await assert.rejects(f.call('work_send',{...input,requestId:'other'}),/executor_busy/);
  await f.call('orchestrator_pause',{projectId:a.p,orchestratorId:a.o,paused:true});
  assert.throws(()=>f.service.assertProviderTaskAvailable(a.w),/paused/);
  assert.throws(()=>f.service.assertProviderTaskAvailable(a.chat),/coordinator_channel/);
  assert.throws(()=>f.service.assertProviderTaskAvailable(a.chat,{allowCoordinator:true}),/paused/);
  resolve();await pending;assert.equal(calls,1);
  await assert.rejects(f.call('work_send',{...input,requestId:'paused'}),/paused/);
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
  let sends=0;
  const f=fixture(t,{provider:{send:async({taskId})=>{sends++;return executorReceipt(f.store,taskId);}}});
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
  await assert.rejects(f.call('work_send',{projectId:a.p,taskId:a.w,content:'Não reenviar'}),
    /reconciliation_required/);
  await assert.rejects(f.call('conversation_rotate',{projectId:a.p,taskId:a.w}),
    /reconciliation_required/);
  await assert.rejects(f.call('work_dependency_set',{projectId:a.p,taskId:a.w,dependsOn:[]}),
    /dependencies_locked_after_execution/);
  assert.equal(sends,0);
  const independent=await f.call('work_send',{projectId:b.p,taskId:b.w,content:'Trabalho autorizado independente'});
  assert.equal(independent.status,'succeeded');
  assert.equal(sends,1);
  const verified=await f.call('work_get',{projectId:b.p,taskId:b.w});
  assert.equal(verified.runs[0].status,'succeeded');
  assert.equal(verified.monitor.state,'awaiting_instruction');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('uncertain first-send target referencing a task in another project cannot quarantine that task',async t=>{
  let sends=0;
  const f=fixture(t,{provider:{send:async({taskId})=>{sends++;return executorReceipt(f.store,taskId);}}});
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
  const confirmed=await f.call('work_send',{projectId:b.p,taskId:b.w,content:'Isolado'});
  assert.equal(confirmed.status,'succeeded');assert.equal(sends,1);
});

test('corrupted advisory receipt does not quarantine independent GPT work',async t=>{
  let sends=0;
  const f=fixture(t,{provider:{send:async({taskId})=>{sends++;return executorReceipt(f.store,taskId);}}});
  const a=await project(f);
  const reserved=f.service.transaction(()=>f.service.reserve(f.context,'orchestrator_chat',{
    requestId:'broken_advisory',projectId:a.p,orchestratorId:a.o,content:'Analisar'}));
  f.store.db.prepare('UPDATE lab_command_receipts SET result=? WHERE id=?')
    .run('{"taskId":',reserved.commandId);
  assert.equal(f.service.recoverInterruptedCommands(),1);
  assert.equal(f.service.coordinatorTurnBusy(a.chat),false);
  assert.equal((await f.call('work_get',{projectId:a.p,taskId:a.w})).monitor.state,'awaiting_instruction');
  assert.equal((await f.call('work_send',{projectId:a.p,taskId:a.w,content:'Enviar explicitamente'})).status,'succeeded');
  assert.equal(sends,1);
});

test('continuation analysis and advisory proposals quarantine unknown provider target without SQL errors',async t=>{
  const f=fixture(t,{coordinator:{available:()=>true,send:async({prepareWork})=>
    prepareWork?{content:'Plano',proposal:{title:'Próxima frente',content:'Verificar continuidade',reason:'Necessário'}}:
      {content:'Análise confirmada'}}});
  const a=await project(f);
  await f.call('continuity_set',{projectId:a.p,orchestratorId:a.o,enabled:true});
  await f.call('continuity_proposals_set',{projectId:a.p,orchestratorId:a.o,enabled:true});
  const run=f.store.startRun(a.w);f.store.finishRun(a.w,run);
  assert.equal(f.service.continuation.scan(),1);
  const reserved=f.service.transaction(()=>f.service.reserve(f.context,'proposal_send',{
    requestId:'broken_continuation',projectId:a.p,orchestratorId:a.o,
    actionId:'action_placeholder',draftRevision:1}));
  f.store.db.prepare('UPDATE lab_command_receipts SET result=? WHERE id=?')
    .run('{"taskId":',reserved.commandId);
  assert.equal(f.service.recoverInterruptedCommands(),1);
  const blocked=await f.service.continuation.tick(f.context);
  assert.equal(blocked.state,'reconciliation_required');
  assert.equal(f.store.db.prepare('SELECT state FROM lab_continuation_reviews WHERE run_id=?').get(run).state,'queued',
    'no Groq analysis is consumed without verified provider provenance');
  f.store.db.prepare("UPDATE lab_continuation_reviews SET state='analyzed' WHERE run_id=?").run(run);
  assert.equal((await f.service.continuation.nextProposal.tick(f.context)).state,'reconciliation_required');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_next_proposals').get().n,0);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('coordinator chat never falls through to GPT Web when Groq is unavailable',async t=>{
  let gptCalls=0;
  const f=fixture(t,{provider:{send:async()=>{gptCalls++;throw Error('wrong_transport');}},
    coordinator:{available:()=>false,send:async()=>{throw Error('must_not_call');}}});
  const a=await project(f);
  f.store.setDraft(a.chat,'Converse com o Orquestrador.',1);
  await assert.rejects(f.call('orchestrator_chat',{
    requestId:'groq-missing',projectId:a.p,orchestratorId:a.o,
    content:'Converse com o Orquestrador.',draftRevision:1
  }),/orchestrator_provider_unavailable/);
  assert.equal(gptCalls,0);
  assert.equal(f.store.messages(a.chat).length,0);
  assert.equal(f.store.getTaskDraft(a.chat).draft,'Converse com o Orquestrador.');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_command_receipts WHERE operation='orchestrator_chat'").get().n,0);
});

test('coordinator chat uses only Groq, stores one message pair and is idempotent',async t=>{
  let gptCalls=0,groqCalls=0,received;
  const f=fixture(t,{provider:{send:async()=>{gptCalls++;throw Error('must_not_send_gpt');}},
    coordinator:{available:()=>true,send:async args=>{
      groqCalls++;received=args;
      return {provider:'groq',content:'Planejarei a missão com você.'};
    }}});
  const a=await project(f);
  f.store.setDraft(a.chat,'Quero organizar o projeto VESTE.',1);
  const input={requestId:'groq-coordinator-one',projectId:a.p,orchestratorId:a.o,
    content:'Quero organizar o projeto VESTE.',draftRevision:1};
  const reply=await f.call('orchestrator_chat',input);
  assert.equal(reply.status,'succeeded');
  assert.equal(reply.result.provider,'groq');
  assert.equal(reply.result.responseObserved,true);
  assert.equal(groqCalls,1);
  assert.equal(gptCalls,0,'coordinator conversation may never use GPT Web executor');
  assert.equal(received.content,input.content);
  assert.equal(received.taskId,a.chat);
  assert.deepEqual(f.store.messages(a.chat).map(m=>[m.role,m.content]),[
    ['user',input.content],['assistant','Planejarei a missão com você.']
  ]);
  assert.equal(f.store.getTaskDraft(a.chat).draft,'');
  assert.equal(f.store.getTaskDraft(a.chat).draft_revision,2);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs WHERE task_id=?').get(a.chat).n,0,
    'coordination must not create a ChatGPT Web Run');
  assert.deepEqual(await f.call('orchestrator_chat',input),reply);
  assert.equal(groqCalls,1,'same durable request never resends');
});

test('Groq rejected and uncertain requests never reroute to GPT Web',async t=>{
  for(const scenario of ['rejected','timeout']){
    let gptCalls=0,groqCalls=0;
    const f=fixture(t,{provider:{send:async()=>{gptCalls++;throw Error('must_not_send_gpt');}},
      coordinator:{available:()=>true,send:async()=>{
        groqCalls++;
        const failure=Error(scenario==='rejected'?'groq_auth_rejected':'groq_request_timeout');
        failure.orchestratorFailureCode=failure.message;
        failure.orchestratorRequestOutcome=scenario==='rejected'?'rejected':'unknown';
        throw failure;
      }}});
    const a=await project(f);
    f.store.setDraft(a.chat,'Mensagem para Groq.',1);
    const input={requestId:'groq-'+scenario,projectId:a.p,orchestratorId:a.o,
      content:'Mensagem para Groq.',draftRevision:1};
    const reply=await f.call('orchestrator_chat',input);
    assert.equal(reply.status,scenario==='rejected'?'failed':'uncertain');
    assert.equal(reply.result.failureCode,scenario==='rejected'?'groq_auth_rejected':'groq_request_timeout');
    assert.equal(gptCalls,0);
    assert.equal(groqCalls,1);
    assert.deepEqual(await f.call('orchestrator_chat',input),reply);
    assert.equal(groqCalls,1,'uncertain/rejected coordinator request is never replayed');
  }
});

test('backend serializes Groq chat, analysis and proposals on one Task without starving another project',async t=>{
  let release,entered,groqCalls=0,heldProjectId=null;
  const started=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture(t,{coordinator:{available:()=>true,send:async args=>{
    groqCalls++;
    if(args.projectId===heldProjectId){entered();await gate;}
    return {provider:'groq',content:'Resposta de coordenação comprovada'};
  }}});
  const a=await project(f,'Projeto A');
  const b=await project(f,'Projeto B');
  heldProjectId=a.p;
  f.store.setDraft(a.chat,'Primeira mensagem Groq',1);
  const firstInput={requestId:'serialized-first',projectId:a.p,orchestratorId:a.o,
    content:'Primeira mensagem Groq',draftRevision:1};
  const first=f.call('orchestrator_chat',firstInput);
  await started;
  assert.equal(f.service.coordinatorTurnBusy(a.chat),true);
  assert.equal((await f.call('orchestrator_chat',firstInput)).status,'running',
    'same requestId returns the durable accepted receipt without another send');
  for(const operation of ['orchestrator_chat','orchestrator_analyze','orchestrator_prepare']){
    const requestId='blocked-'+operation;
    const input={requestId,projectId:a.p,orchestratorId:a.o,
      ...(operation==='orchestrator_analyze'?{}:{content:'Second concurrent operation'})};
    await assert.rejects(f.call(operation,input),/orchestrator_coordinator_busy/);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_command_receipts WHERE request_id=?')
      .get(requestId).n,0,'rejected admission creates no command receipt');
  }
  assert.deepEqual(f.store.messages(a.chat).map(m=>[m.role,m.content]),
    [['user','Primeira mensagem Groq']]);
  f.store.setDraft(b.chat,'Projeto B independente',1);
  const independent=await f.call('orchestrator_chat',{requestId:'other-project',
    projectId:b.p,orchestratorId:b.o,content:'Projeto B independente',draftRevision:1});
  assert.equal(independent.status,'succeeded');
  assert.equal(f.service.coordinatorTurnBusy(b.chat),false);
  release();
  const completed=await first;
  assert.equal(completed.status,'succeeded');
  assert.equal(f.service.coordinatorTurnBusy(a.chat),false);
  assert.equal(groqCalls,2);
  assert.deepEqual(f.store.messages(a.chat).map(x=>x.role),['user','assistant']);
  // A completed request must release admission for the next explicit turn.
  f.store.setDraft(a.chat,'Outra solicitação após liberação',3);
  const resumed=await f.call('orchestrator_chat',{requestId:'after-release',projectId:a.p,
    orchestratorId:a.o,content:'Outra solicitação após liberação',draftRevision:3});
  assert.equal(resumed.status,'succeeded');
  assert.equal(groqCalls,3);
  assert.equal(f.service.coordinatorTurnBusy(a.chat),false);
  assert.deepEqual(f.store.messages(a.chat).map(x=>x.role),
    ['user','assistant','user','assistant']);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
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
