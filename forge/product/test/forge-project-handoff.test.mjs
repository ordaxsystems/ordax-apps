import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';
import {createOrchestratorMcp} from '../src/orchestrator-mcp.mjs';

function fixture(t) {
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const context={actorId:'owner',clientId:'desktop',
    workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,authorize:({context:c})=>c===context});
  let serial=0;
  const invoke=(operation,input={})=>service.invoke(context,operation,
    ORCHESTRATOR_TOOLS.find(tool=>tool.operation===operation)?.readOnly
      ?input:{requestId:'handoff_'+(++serial),...input});
  return {store,service,context,invoke};
}

test('project handoff restores bounded real context without promoting assistant claims',async t=>{
  const {store,invoke}=fixture(t);
  const p=(await invoke('project_quick_create',{creationNonce:'handoff_a'})).result;
  const work=(await invoke('work_create',{projectId:p.projectId,
    orchestratorId:p.orchestratorId,title:'Cardápio'})).result;
  const other=(await invoke('project_quick_create',{creationNonce:'handoff_other'})).result;
  store.appendMessage(other.chatTaskId,'assistant','SEGREDO DE OUTRO PROJETO');
  const source=store.appendMessage(p.chatTaskId,'assistant',
    'Decidimos fazer o cardápio em HTML e ainda não há arquivos verificados.');
  const proposal=(await invoke('project_memory_propose',{projectId:p.projectId,
    taskId:p.chatTaskId,sourceMessageId:source.id,category:'decision',
    key:'Linguagem',content:'Usar HTML no cardápio.',
    evidence:'Decidimos fazer o cardápio em HTML'})).result;
  store.memoryCandidates.review(p.chatTaskId,proposal.id,'accept');
  const runId=store.startRun(work.taskId);
  store.appendMessage(work.taskId,'user','Crie o cardápio');
  store.appendMessage(work.taskId,'assistant','Criei os arquivos. Sem confirmação independente.');
  store.finishRun(work.taskId,runId);
  for(let i=0;i<11;i++)store.appendMessage(work.taskId,'user','Mensagem '+i);
  const packet=await invoke('project_handoff',{projectId:p.projectId,taskId:work.taskId});
  assert.equal(packet.schema,'ordax.forge.project-handoff/1');
  assert.equal(packet.selectedTask.taskId,work.taskId);
  assert.equal(packet.counts.acceptedMemories,1);
  assert.equal(packet.acceptedMemory[0].sourceRef,source.id);
  assert.equal(packet.acceptedMemory[0].externalEffectVerified,false);
  assert.equal(packet.tasks.find(x=>x.taskId===work.taskId).lastRunStatus,'succeeded');
  assert.equal(packet.tasks.find(x=>x.taskId===work.taskId).completionVerified,false);
  assert.equal(packet.recentMessages.length,8);
  assert.equal(packet.limits.messagesTruncated,true);
  assert.equal(packet.nextSession.automaticSendAllowed,false);
  assert.equal(packet.provenance.physicalFilesInspected,false);
  assert.equal(JSON.stringify(packet).includes('SEGREDO DE OUTRO PROJETO'),false);
  await assert.rejects(invoke('project_handoff',{projectId:p.projectId,
    taskId:other.chatTaskId}),/orchestrator_task_unavailable/);
});

test('handoff exposes unresolved commands without replay or external effects',async t=>{
  const {store,invoke,context,service}=fixture(t);
  const p=(await invoke('project_quick_create',{creationNonce:'handoff_uncertain'})).result;
  const now=store.now();
  store.db.prepare(`INSERT INTO lab_command_receipts
    (id,workspace_session_id,actor_id,client_id,request_id,project_id,
    operation,input_hash,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run('cmd_uncertain',context.workspaceSessionId,
    context.actorId,context.clientId,'unresolved',p.projectId,
    'forjador_send','sample_hash','uncertain',now,now);
  const before=store.db.prepare('SELECT COUNT(*) AS n FROM lab_command_receipts').get().n;
  const handoff=await invoke('project_handoff',{projectId:p.projectId});
  const after=store.db.prepare('SELECT COUNT(*) AS n FROM lab_command_receipts').get().n;
  assert.equal(before,after);
  assert.equal(handoff.unresolvedCommands[0].commandId,'cmd_uncertain');
  assert.equal(handoff.nextSession.checkUncertainReceiptsBeforeRetry,true);
  assert.equal(handoff.nextSession.automaticRotationPerformed,false);
  await assert.rejects(service.invoke({...context,actorId:'attacker'},
    'project_handoff',{projectId:p.projectId}),/orchestrator_access_denied/);
  const mcp=createOrchestratorMcp({service,getContext:()=>context});
  await mcp.handle({jsonrpc:'2.0',id:1,method:'initialize',
    params:{protocolVersion:'2025-06-18',clientInfo:{name:'test',version:'1'},capabilities:{}}});
  await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const listed=await mcp.handle({jsonrpc:'2.0',id:2,method:'tools/list'});
  assert.ok(listed.result.tools.some(x=>x.name==='forge_project_handoff'));
});
