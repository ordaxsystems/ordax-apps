import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {createOrchestratorMcp} from '../src/orchestrator-mcp.mjs';
import {ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';

function fixture(t) {
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const context={actorId:'owner',clientId:'desktop',workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,
    authorize:({context:who})=>who===context});
  let count=0;
  const invoke=(operation,input={})=>service.invoke(context,operation,
    ORCHESTRATOR_TOOLS.find(tool=>tool.operation===operation)?.readOnly
      ?input:{requestId:'admin_'+(++count),...input});
  return {store,service,context,invoke};
}
test('GPT Administrator stages a sourced proposal, not a verified fact',async t=>{
  const {store,invoke}=fixture(t);
  const project=(await invoke('project_quick_create',{creationNonce:'admin_project'})).result;
  const assistant=store.appendMessage(project.chatTaskId,'assistant',
    'Decidimos construir o site com HTML estático primeiro. Ainda não há arquivos confirmados.');
  const input={projectId:project.projectId,taskId:project.chatTaskId,
    sourceMessageId:assistant.id,category:'decision',key:'Tecnologia inicial',
    content:'O projeto terá uma primeira versão HTML estática.',
    evidence:'Decidimos construir o site com HTML estático primeiro.'};
  const result=(await invoke('project_memory_propose',input)).result;
  assert.equal(result.status,'pending');
  assert.equal(result.created,true);
  assert.equal(result.canonicalUpdated,false);
  assert.equal(result.externalEffectVerified,false);
  const snapshot=await invoke('project_memory',{projectId:project.projectId});
  assert.equal(snapshot.counts.canonicalMemories,0);
  assert.equal(snapshot.counts.pendingSuggestions,1);
  assert.equal(snapshot.suggested[0].content,input.content);
  assert.equal(snapshot.suggested[0].evidence,input.evidence);
  assert.equal(snapshot.suggested[0].sourceMessageId,assistant.id);
  assert.equal(snapshot.suggested[0].sourceRole,'assistant');
  assert.equal(snapshot.suggested[0].status,'requires_review');
  assert.equal(snapshot.suggested[0].verifiedExternalEffect,false);
  const onceMore=(await invoke('project_memory_propose',input)).result;
  assert.equal(onceMore.id,result.id);
  assert.equal(onceMore.created,false);
  assert.equal((await invoke('project_memory',{projectId:project.projectId})).counts.pendingSuggestions,1);
  const approved=store.memoryCandidates.review(project.chatTaskId,result.id,'accept');
  assert.equal(approved.content,input.content);
  assert.equal(approved.source_ref,assistant.id);
  const after=await invoke('project_memory',{projectId:project.projectId});
  assert.equal(after.counts.canonicalMemories,1);
  assert.equal(after.counts.pendingSuggestions,0);
  assert.equal(after.canonical[0].status,'accepted_editorial_memory');
  assert.equal(after.canonical[0].verifiedExternalEffect,false);
});

test('a GPT cannot fabricate or cross project source evidence or approve itself',async t=>{
  const {store,invoke,service,context}=fixture(t);
  const p=(await invoke('project_quick_create',{creationNonce:'scope_a'})).result;
  const other=(await invoke('project_quick_create',{creationNonce:'scope_b'})).result;
  const badUser=store.appendMessage(p.chatTaskId,'user','Decidimos adotar SQLite.');
  const foreign=store.appendMessage(other.chatTaskId,'assistant','Decidimos adotar SQLite.');
  const valid=store.appendMessage(p.chatTaskId,'assistant','Decidimos adotar HTML local no MVP.');
  const input={projectId:p.projectId,taskId:p.chatTaskId,category:'decision',key:'Tecnologia',
    content:'Usar HTML local como primeira etapa.',evidence:'Decidimos adotar HTML local no MVP.'};
  await assert.rejects(invoke('project_memory_propose',{...input,sourceMessageId:foreign.id}),
    /project_memory_source_not_found/);
  await assert.rejects(invoke('project_memory_propose',{...input,sourceMessageId:badUser.id}),
    /project_memory_source_not_found/);
  await assert.rejects(invoke('project_memory_propose',{...input,sourceMessageId:valid.id,evidence:'O GPT criou todos os arquivos.'}),
    /project_memory_evidence_must_quote_source/);
  await assert.rejects(invoke('project_memory_propose',{...input,taskId:other.chatTaskId,sourceMessageId:foreign.id}),
    /orchestrator_work_unavailable|orchestrator_task_unavailable|orchestrator_project_unavailable/);
  await assert.rejects(service.invoke({...context,actorId:'unknown'},'project_memory_propose',
    {requestId:'foreign_attempt',...input,sourceMessageId:valid.id}),/orchestrator_access_denied/);
  const snapshot=await invoke('project_memory',{projectId:p.projectId});
  assert.equal(snapshot.counts.pendingSuggestions,0);
});

test('MCP lists sourced proposal but no privilege to mark it accepted',async t=>{
  const {store,service,context,invoke}=fixture(t);
  const p=(await invoke('project_quick_create',{creationNonce:'mcp_admin'})).result;
  const message=store.appendMessage(p.chatTaskId,'assistant','Decidimos criar a versão inicial em HTML.');
  const server=createOrchestratorMcp({service,getContext:()=>context});
  const hello=await server.handle({jsonrpc:'2.0',id:1,method:'initialize',
    params:{protocolVersion:'2025-06-18',clientInfo:{name:'test',version:'1'},capabilities:{}}});
  assert.ok(hello.result);
  await server.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const tools=await server.handle({jsonrpc:'2.0',id:2,method:'tools/list'});
  const names=tools.result.tools.map(x=>x.name);
  assert.ok(names.includes('orchestrator_project_memory_propose'));
  assert.ok(!names.includes('orchestrator_project_memory_review'));
  assert.ok(!names.includes('forge_forjador_send'));
  const proposal=await server.handle({jsonrpc:'2.0',id:3,method:'tools/call',
    params:{name:'orchestrator_project_memory_propose',arguments:{
      requestId:'model_review_1',projectId:p.projectId,taskId:p.chatTaskId,
      sourceMessageId:message.id,category:'decision',key:'Frontend',
      content:'A primeira versão será em HTML.',evidence:'Decidimos criar a versão inicial em HTML.'
    }}});
  assert.equal(proposal.result.structuredContent.status,'succeeded');
  assert.equal(proposal.result.structuredContent.result.canonicalUpdated,false);
});


test('Administrator reads one project-wide evidence snapshot without inventing completions',async t=>{
  const {store,invoke,service,context}=fixture(t);
  const p=(await invoke('project_quick_create',{creationNonce:'snap_a'})).result;
  const other=(await invoke('project_quick_create',{creationNonce:'snap_b'})).result;
  const a=(await invoke('work_create',{projectId:p.projectId,orchestratorId:p.orchestratorId,title:'Página inicial'})).result;
  assert.ok(a.taskId);
  const runId=store.startRun(a.taskId);
  store.appendMessage(a.taskId,'user','Crie a página');
  store.appendMessage(a.taskId,'assistant','Foi criada uma página HTML, ainda sem verificação física.');
  store.finishRun(a.taskId,runId);
  const response=store.appendMessage(p.chatTaskId,'assistant',
    'Decidimos usar HTML local no primeiro protótipo.');
  store.appendMessage(other.chatTaskId,'assistant','Segredo de projeto diferente');
  await invoke('project_memory_propose',{projectId:p.projectId,taskId:p.chatTaskId,
    sourceMessageId:response.id,category:'decision',key:'Frontend',
    content:'Usar HTML local inicialmente.',
    evidence:'Decidimos usar HTML local no primeiro protótipo.'});
  const overview=await invoke('project_administrator_snapshot',{projectId:p.projectId});
  assert.equal(overview.schema,'ordax.forge.project-administrator/1');
  assert.equal(overview.totals.works,1);
  assert.equal(overview.totals.pendingNotes,1);
  assert.equal(overview.works[0].lastRunId,runId);
  assert.equal(overview.works[0].lastRunStatus,'succeeded');
  assert.equal(overview.works[0].physicalArtifactVerified,false);
  assert.equal(overview.administrator.status,'not_invoked');
  assert.equal(overview.administrator.canAutomaticallyDispatch,false);
  assert.equal(overview.administrator.canApproveMemory,false);
  assert.equal(overview.provenance.externalFilesInspected,false);
  assert.equal(overview.memory.pending[0].sourceMessageId,response.id);
  assert.equal(JSON.stringify(overview).includes('Segredo de projeto diferente'),false);
  await assert.rejects(service.invoke({...context,actorId:'outsider'},
    'project_administrator_snapshot',{projectId:p.projectId}),/orchestrator_access_denied/);
});
