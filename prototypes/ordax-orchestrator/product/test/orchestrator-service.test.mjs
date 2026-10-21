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

function fixture(t,{provider,coordinator}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-orchestration-'));
  const file=path.join(dir,'lab.sqlite');
  const store=new Store(file);
  const context=Object.freeze({actorId:'local-test-owner',clientId:'app-test',workspaceSessionId:store.getWorkspaceSession().id});
  let allowed=true;
  const service=new OrchestratorService({store,provider,coordinator,authorize:({context:c})=>allowed&&c===context});
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

test('coordinator chat is separate from GPT work; calls require a port and persist only observed text',async t=>{
  let calls=0;
  const f=fixture(t,{coordinator:{available:()=>true,send:async({taskId,mission})=>{
    calls++;assert.match(mission,/evoluir/);
    assert.equal(f.store.messages(taskId).at(-1).role,'user');
    return {content:'Podemos começar pelo layout.'};
  }}}),a=await project(f);
  const input={requestId:'chat',projectId:a.p,orchestratorId:a.o,content:'Planeje o site'};
  const reply=await f.call('orchestrator_chat',input);
  assert.equal(reply.status,'succeeded');
  assert.equal(reply.result.proposalsExecuted,0);
  assert.deepEqual(f.store.messages(a.chat).map(m=>m.role),['user','assistant']);
  assert.equal(f.store.messages(a.w).length,0);
  await f.call('orchestrator_chat',input);assert.equal(calls,1);
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

test('late response after authorization revocation is not disclosed or falsely confirmed',async t=>{
  let resolve;
  const gate=new Promise(r=>resolve=r);
  const f=fixture(t,{coordinator:{send:async()=>{await gate;return {content:'Private reply'};}}}),a=await project(f);
  const pending=f.call('orchestrator_chat',{projectId:a.p,orchestratorId:a.o,content:'Olá'});
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
  assert.equal(tools.length,15);
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
      return {ok:true,text:async()=>JSON.stringify({choices:[{finish_reason:'length',message:{content:'Partial'}}]})};
    }});
  await assert.rejects(adapter.send({taskId:a.chat,projectId:a.p,orchestratorId:a.o,mission:'Planejar',
    analysisContext:{works:[{title:'Site',messages:[{content:'api_key=analysis-secret https://analysis.example/path'}]}]}}),/incomplete/);
  assert.equal(calls,1);
  const disabled=createGroqCoordinatorConversation({store:f.store,getApiKey:()=>null,isEnabled:()=>false,
    fetchImpl:async()=>{throw Error('must not call');}});
  assert.equal(disabled.available(),false);
  await assert.rejects(disabled.send({taskId:a.chat,projectId:a.p,mission:'Planejar'}),/disabled/);
});
