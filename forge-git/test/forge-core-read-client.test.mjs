import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../../forge/product/src/store.mjs';
import {OrchestratorService} from '../../forge/product/src/orchestrator-service.mjs';
import {createOrchestratorMcp} from '../../forge/product/src/orchestrator-mcp.mjs';
import {createForgeLoopbackMcp,FORGE_APP_MCP_SCOPE} from '../../forge/product/src/forge-loopback-mcp.mjs';
import {createForgeCoreReadClient,validateForgeEndpoint} from '../forge-core-read-client.mjs';

function fixture(t){
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const context={actorId:'owner',clientId:'desktop',
    workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,authorize:({context:c})=>c===context});
  const transport=createForgeLoopbackMcp({
    createMcp:({projectId,allowedOperations})=>createOrchestratorMcp({
      service,getContext:()=>context,allowedProjectId:projectId,allowedOperations
    }),
    authorizeProject:()=>true
  });
  t.after(()=>transport.stop());
  return {store,service,context,transport};
}

test('rejects remote address, DNS alias and tokens without owner grant',()=>{
  for(const endpoint of [
    'https://forge-mcp.ordax.com.br/mcp',
    'http://localhost:12345/mcp',
    'http://127.0.0.2:12345/mcp',
    'http://127.0.0.1:12345/mcp?admin=true',
    'http://127.0.0.1:80/mcp',
    'http://127.0.0.1:12345/other'
  ])assert.throws(()=>validateForgeEndpoint(endpoint,'x'.repeat(43)),
    /forge_mcp_local_endpoint_invalid/);
  assert.throws(()=>validateForgeEndpoint('http://127.0.0.1:12345/mcp','invalid'),
    /forge_mcp_local_token_invalid/);
});

test('read-only client derives projects, works and blockers from real Forge MCP/SQLite',async t=>{
  const f=fixture(t);
  const mission=(await f.service.invoke(f.context,'mission_create',{
    name:'Pizzaria',mission:'Criar site e testar.',
    requestId:'core_ui_mission_1'
  })).result;
  const started=await f.transport.start(FORGE_APP_MCP_SCOPE);
  const client=createForgeCoreReadClient();
  t.after(()=>client.disconnect());
  const connected=await client.connect({endpoint:started.endpoint,token:started.token});
  assert.equal(connected.connected,true);
  assert.equal(connected.credentialPersisted,false);
  const view=await client.refresh();
  assert.equal(view.source,'forge_mcp_live_read');
  assert.equal(view.liveGithubChecked,false);
  assert.equal(view.selectedProjectId,mission.projectId);
  assert.equal(view.projects[0].id,mission.projectId);
  assert.equal(view.handoff.project.id,mission.projectId);
  assert.equal(view.handoff.provenance.source,'canonical_app_sqlite');
  assert.equal(view.handoff.continuation.automaticDispatchAllowed,false);
  assert.equal(view.handoff.continuation.taskLeaseGranted,false);
  assert.ok(view.works.some(w=>w.id===mission.taskId));
  assert.ok(view.orchestrators.some(o=>o.id===mission.orchestratorId));
  assert.ok(!JSON.stringify(client.status()).includes(started.token));
  assert.ok(!JSON.stringify(client.projection()).includes(started.token));
  await assert.rejects(client.refresh('project_wrong'),/forge_mcp_project_not_authorized/);
  await client.ping();
  client.disconnect();
  assert.equal(client.status().connected,false);
  assert.equal(client.projection(),null);
  await assert.rejects(client.refresh(),/forge_mcp_connection_required/);
});

test('revoked owner grant fails closed and never falls back to local JSON',async t=>{
  const f=fixture(t);
  await f.service.invoke(f.context,'mission_create',{
    name:'Lanchonete',mission:'Criar site responsivo.',
    requestId:'core_ui_mission_2'
  });
  const started=await f.transport.start(FORGE_APP_MCP_SCOPE);
  const client=createForgeCoreReadClient();
  t.after(()=>client.disconnect());
  await client.connect({endpoint:started.endpoint,token:started.token});
  await f.transport.stop();
  await assert.rejects(client.ping());
  assert.equal(client.status().connected,false);
  assert.equal(client.projection(),null);
});

test('invalid bearer and project-only grant cannot impersonate App MCP catalog',async t=>{
  const f=fixture(t);
  const mission=(await f.service.invoke(f.context,'mission_create',{
    name:'Escopo',mission:'Testar isolamento.',requestId:'core_ui_scope_1'
  })).result;
  const started=await f.transport.start(FORGE_APP_MCP_SCOPE);
  const client=createForgeCoreReadClient();
  t.after(()=>client.disconnect());
  await assert.rejects(client.connect({
    endpoint:started.endpoint,token:'x'.repeat(43)
  }),/forge_mcp_http_401/);
  assert.equal(client.status().connected,false);
  await f.transport.stop();
  const scoped=await f.transport.start(mission.projectId);
  await assert.rejects(client.connect({
    endpoint:scoped.endpoint,token:scoped.token
  }),/forge_mcp_app_scope_required/);
  assert.equal(client.status().connected,false);
});

test('UI connector rejects write operations even with owner MCP permission',async t=>{
  const f=fixture(t);
  await f.service.invoke(f.context,'mission_create',{
    name:'Teste',mission:'Não escrever.',requestId:'core_ui_read_only'
  });
  const started=await f.transport.start(FORGE_APP_MCP_SCOPE);
  const client=createForgeCoreReadClient();
  t.after(()=>client.disconnect());
  await client.connect({endpoint:started.endpoint,token:started.token});
  assert.equal(Object.hasOwn(client,'call'),false);
  assert.equal(Object.hasOwn(client,'send'),false);
});

test('explicit owner draft saves on the same canonical Work Task with CAS and no GPT Run',async t=>{
  const f=fixture(t);
  const mission=(await f.service.invoke(f.context,'mission_create',{
    name:'Continuidade',mission:'Construir o menu e seus testes.',
    requestId:'core_ui_draft_1'
  })).result;
  const started=await f.transport.start(FORGE_APP_MCP_SCOPE);
  const client=createForgeCoreReadClient();
  t.after(()=>client.disconnect());
  await client.connect({endpoint:started.endpoint,token:started.token});
  await client.refresh();
  const selected=await client.selectTask(mission.taskId);
  const before=selected.selectedHandoff.selectedTask.draftRevision;
  assert.equal(selected.selectedTaskId,mission.taskId);
  assert.equal(selected.selectedHandoff.continuation.taskLeaseGranted,false);
  const saved=await client.saveWorkDraft({
    taskId:mission.taskId,content:'Criar menu acessível com testes.',
    expectedRevision:before
  });
  assert.equal(saved.projectId,mission.projectId);
  assert.equal(saved.taskId,mission.taskId);
  assert.equal(saved.draftRevision,before+1);
  assert.equal(saved.providerMessagesSent,0);
  assert.equal(saved.coreReceiptStatus,'succeeded');
  assert.equal(saved.readbackVerified,true);
  assert.match(saved.contentSha256,/^[a-f0-9]{64}$/);
  const authoritative=await f.service.invoke(f.context,'project_handoff',{
    projectId:mission.projectId,taskId:mission.taskId
  });
  assert.equal(authoritative.selectedTask.draftRevision,before+1);
  assert.equal(f.store.getTaskDraft(mission.taskId).draft,'Criar menu acessível com testes.');
  assert.equal(authoritative.tasks.find(t=>t.taskId===mission.taskId).lastRunId,null);
  await assert.rejects(client.saveWorkDraft({
    taskId:mission.taskId,content:'Do not replay first revision.',expectedRevision:before
  }),/task_draft_revision_conflict/);
});

test('two sessions reject stale draft and prevent cross-project Task writes',async t=>{
  const f=fixture(t);
  const a=(await f.service.invoke(f.context,'mission_create',{
    name:'Projeto A',mission:'Implementar A.',requestId:'core_ui_draft_A'
  })).result;
  const b=(await f.service.invoke(f.context,'mission_create',{
    name:'Projeto B',mission:'Implementar B.',requestId:'core_ui_draft_B'
  })).result;
  const started=await f.transport.start(FORGE_APP_MCP_SCOPE);
  const left=createForgeCoreReadClient(),right=createForgeCoreReadClient();
  t.after(()=>{left.disconnect();right.disconnect();});
  for(const client of [left,right]){
    await client.connect({endpoint:started.endpoint,token:started.token});
    await client.refresh(a.projectId);
    await client.selectTask(a.taskId);
  }
  const rev=left.projection().selectedHandoff.selectedTask.draftRevision;
  await left.saveWorkDraft({taskId:a.taskId,content:'Prepare A.',expectedRevision:rev});
  await assert.rejects(right.saveWorkDraft({
    taskId:a.taskId,content:'Stale write.',expectedRevision:rev
  }),/task_draft_revision_conflict/);
  await assert.rejects(left.saveWorkDraft({
    taskId:b.taskId,content:'Cross project.',expectedRevision:rev+1
  }),/forge_mcp_task_not_authorized/);
  await assert.rejects(left.selectTask(b.taskId),/forge_mcp_task_not_authorized/);
  const fresh=await right.refresh(b.projectId);
  assert.equal(fresh.selectedTaskId,null,'cross-project selection clears original Task');
});

test('started Work refuses draft mutation without any direct provider send',async t=>{
  const f=fixture(t);
  const mission=(await f.service.invoke(f.context,'mission_create',{
    name:'Já iniciada',mission:'Não substituir a conversa.',
    requestId:'core_ui_started_work'
  })).result;
  const started=await f.transport.start(FORGE_APP_MCP_SCOPE);
  const client=createForgeCoreReadClient();
  t.after(()=>client.disconnect());
  await client.connect({endpoint:started.endpoint,token:started.token});
  await client.refresh();
  const selected=await client.selectTask(mission.taskId);
  f.store.appendMessage(mission.taskId,'user','Previously started work.',{
    authorSource:'human'
  });
  await assert.rejects(client.saveWorkDraft({
    taskId:mission.taskId,content:'Must not overwrite a running conversation.',
    expectedRevision:selected.selectedHandoff.selectedTask.draftRevision
  }),/forge_mcp_operation_unavailable/);
  assert.equal(Object.hasOwn(client,'send'),false);
});

test('successor Task reads the exact persisted Run and bounded messages from Core',async t=>{
  const f=fixture(t);
  const a=(await f.service.invoke(f.context,'mission_create',{
    name:'Pizzaria sucessora',mission:'Retomar cardápio.',
    requestId:'core_ui_successor_1'
  })).result;
  const b=(await f.service.invoke(f.context,'mission_create',{
    name:'Projeto isolado',mission:'Informação de outro projeto.',
    requestId:'core_ui_successor_2'
  })).result;
  const marker='HISTORICO_EXCLUSIVO_TASK_A';
  f.store.appendMessage(a.taskId,'user',marker,{authorSource:'human'});
  f.store.appendMessage(b.taskId,'user','NAO_DEVE_VAZAR_PROJETO_B',
    {authorSource:'human'});
  const runId=f.store.startRun(a.taskId);
  f.store.finishRun(a.taskId,runId);
  const started=await f.transport.start(FORGE_APP_MCP_SCOPE);
  const client=createForgeCoreReadClient();
  t.after(()=>client.disconnect());
  await client.connect({endpoint:started.endpoint,token:started.token});
  await client.refresh(a.projectId);
  const selected=await client.selectTask(a.taskId);
  const detail=selected.selectedHandoff.taskDetail;
  assert.equal(detail.taskId,a.taskId);
  assert.equal(detail.runs[0].id,runId);
  assert.equal(detail.runs[0].status,'succeeded');
  assert.equal(detail.taskLeaseGranted,false);
  assert.equal(detail.providerMessagesSent,0);
  assert.equal(detail.liveGithubChecked,false);
  assert.ok(detail.messages.some(m=>m.content===marker));
  assert.doesNotMatch(JSON.stringify(selected),/NAO_DEVE_VAZAR_PROJETO_B/);
  await client.refresh(a.projectId);
  assert.equal(client.projection().selectedHandoff.taskDetail.runs[0].id,runId);
  const switched=await client.refresh(b.projectId);
  assert.equal(switched.selectedTaskId,null);
  assert.equal(switched.selectedHandoff,null);
  await assert.rejects(client.selectTask(a.taskId),/forge_mcp_task_not_authorized/);
});
