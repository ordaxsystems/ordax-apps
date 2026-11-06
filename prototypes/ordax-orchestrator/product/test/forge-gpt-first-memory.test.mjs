import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {ORCHESTRATOR_TOOLS} from '../src/orchestrator-contract.mjs';
import {createOrchestratorMcp} from '../src/orchestrator-mcp.mjs';

function fixture(t,provider){
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const context=Object.freeze({actorId:'owner',clientId:'app',workspaceSessionId:store.getWorkspaceSession().id});
  let groqCalls=0;
  const service=new OrchestratorService({store,provider,
    coordinator:{available:()=>true,send:async()=>{groqCalls++;throw Error('unexpected_groq');}},
    authorize:({context:who})=>who===context});
  let seq=0;
  const call=(name,input={})=>service.invoke(context,name,{
    ...(!ORCHESTRATOR_TOOLS.find(x=>x.operation===name)?.readOnly?{requestId:'request_'+(++seq)}:{}),
    ...input
  });
  return {store,context,service,call,getGroqCalls:()=>groqCalls};
}
test('Forjador routes direct to GPT once, persists canonical reply, and never calls Groq',async t=>{
  let calls=0,ports=null;let f=null;
  const provider={send:async args=>{
    calls++;ports=args;
    f.store.appendMessage(args.taskId,'user',args.content);
    const runId=f.store.startRun(args.taskId);
    f.store.appendMessage(args.taskId,'assistant','Olá! Como posso ajudar?');
    f.store.finishRun(args.taskId,runId);
    return {confirmed:true,deliveryObserved:true,responseObserved:true,effectVerified:false,runId};
  }};
  f=fixture(t,provider);
  const created=(await f.call('project_quick_create',{creationNonce:'gptfirst'})).result;
  const payload={projectId:created.projectId,orchestratorId:created.orchestratorId,
    content:'Bom dia',draftRevision:1,requestId:'forjador_first'};
  const first=await f.service.invoke(f.context,'forjador_send',payload);
  assert.equal(first.status,'succeeded');
  assert.equal(first.result.provider,'chatgpt_web');
  assert.equal(first.result.effectVerified,false);
  assert.equal(calls,1);
  assert.equal(ports.taskId,created.chatTaskId);
  assert.equal(ports.taskKind,'orchestrator');
  assert.equal(ports.authorSource,'orchestrator');
  assert.equal(f.getGroqCalls(),0);
  const repeated=await f.service.invoke(f.context,'forjador_send',payload);
  assert.deepEqual(repeated,first);
  assert.equal(calls,1);
  const messages=(await f.call('work_messages',{projectId:created.projectId,taskId:created.chatTaskId})).messages;
  assert.deepEqual(messages.map(x=>x.role),['user','assistant']);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,1);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_task_bindings WHERE kind='work'").get().n,0);
});

test('uncertain GPT response never becomes a completed Forjador message or verified effect',async t=>{
  let sends=0;
  const f=fixture(t,{send:async()=>{sends++;return {confirmed:false,deliveryObserved:false,responseObserved:false,effectVerified:false};}});
  const created=(await f.call('project_quick_create',{creationNonce:'uncertain'})).result;
  const payload={projectId:created.projectId,orchestratorId:created.orchestratorId,content:'Faça algo',requestId:'try_once'};
  const receipt=await f.service.invoke(f.context,'forjador_send',payload);
  assert.equal(receipt.status,'uncertain');
  assert.equal(receipt.requiresReconciliation,true);
  assert.equal(sends,1);
  assert.deepEqual(await f.service.invoke(f.context,'forjador_send',payload),receipt);
  await assert.rejects(f.service.invoke(f.context,'forjador_send',
    {...payload,requestId:'new_request_must_not_replay'}),/orchestrator_reconciliation_required/);
  assert.equal(sends,1);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM messages').get().n,0);
  assert.equal(f.getGroqCalls(),0);
});

test('project MCP memory reads existing verified editorial memory and pending proposals by project only',async t=>{
  const f=fixture(t,null);
  const a=(await f.call('project_quick_create',{creationNonce:'memory_a'})).result;
  const b=(await f.call('project_quick_create',{creationNonce:'memory_b'})).result;
  f.store.upsertProjectMemory(a.chatTaskId,{category:'decision',key:'framework',
    content:'Utilizar HTML estático',source_type:'manual'});
  f.store.upsertProjectMemory(b.chatTaskId,{category:'constraint',key:'private',
    content:'SEGREDO DE B',source_type:'manual'});
  const memory=await f.call('project_memory',{projectId:a.projectId});
  assert.equal(memory.schema,'ordax.forge.project-memory/1');
  assert.equal(memory.counts.canonicalMemories,1);
  assert.equal(memory.canonical[0].content,'Utilizar HTML estático');
  assert.equal(memory.canonical[0].verifiedExternalEffect,false);
  assert.equal(memory.provenance.externalFilesInspected,false);
  assert.equal(memory.provenance.gptClaimsAreVerifiedEffects,false);
  assert.equal(memory.limitations.administratorModel,'not_invoked');
  assert.equal(JSON.stringify(memory).includes('SEGREDO DE B'),false);
  assert.equal(f.getGroqCalls(),0);
  await assert.rejects(f.service.invoke({...f.context,actorId:'other'},'project_memory',{projectId:a.projectId}),
    /orchestrator_access_denied/);
});


test('MCP exposes project memory but never the recursive Forjador-to-GPT send',async t=>{
  const f=fixture(t,null);
  const mcp=createOrchestratorMcp({service:f.service,getContext:()=>f.context});
  const initialize=await mcp.handle({jsonrpc:'2.0',id:1,method:'initialize',
    params:{protocolVersion:'2025-06-18',capabilities:{},
      clientInfo:{name:'test',version:'1'}}});
  assert.equal(initialize.result.protocolVersion,'2025-06-18');
  await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const listed=await mcp.handle({jsonrpc:'2.0',id:2,method:'tools/list'});
  const names=listed.result.tools.map(x=>x.name);
  assert.ok(names.includes('orchestrator_project_memory'));
  assert.ok(!names.includes('orchestrator_forjador_send'));
  const call=await mcp.handle({jsonrpc:'2.0',id:3,method:'tools/call',
    params:{name:'orchestrator_forjador_send',
      arguments:{requestId:'model_try',projectId:'project_other',
        orchestratorId:'orchestrator_other',content:'loop'}}});
  assert.equal(call.error.code,-32602);
});


test('Forjador GPT turn reserves the same single physical executor lane as work sends',async t=>{
  let release,entered;
  const enteredProvider=new Promise(resolve=>{entered=resolve;});
  const f=fixture(t,{send:async()=>{entered();return new Promise(resolve=>{release=resolve;});},busy:()=>false});
  const created=(await f.call('project_quick_create',{creationNonce:'busy_lane'})).result;
  const pending=f.service.invoke(f.context,'forjador_send',{requestId:'live_lane',
    projectId:created.projectId,orchestratorId:created.orchestratorId,content:'Olá'});
  await enteredProvider;
  const inFlight=f.service.executorAdmission();
  assert.equal(inFlight.maxConcurrentSends,1);
  assert.equal(inFlight.availableSlots,0);
  assert.ok(inFlight.activeCommands>=1);
  release({confirmed:false,deliveryObserved:false,responseObserved:false,effectVerified:false});
  const final=await pending;
  assert.equal(final.status,'uncertain');
  assert.equal(f.service.executorAdmission().activeCommands,0);
});
