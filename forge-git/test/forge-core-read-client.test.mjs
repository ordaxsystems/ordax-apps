import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../../forge/product/src/store.mjs';
import {OrchestratorService} from '../../forge/product/src/orchestrator-service.mjs';
import {createOrchestratorMcp} from '../../forge/product/src/orchestrator-mcp.mjs';
import {createForgeLoopbackMcp,FORGE_APP_MCP_SCOPE} from '../../forge/product/src/forge-loopback-mcp.mjs';
import {createForgeCoreReadClient,validateForgeEndpoint} from '../forge-core-read-client.mjs';

function fixture(t,{provider=null,ownerDispatch=null}={}){
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const context={actorId:'owner',clientId:'desktop',
    workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,provider,authorize:({context:c})=>c===context});
  const transport=createForgeLoopbackMcp({
    createMcp:({projectId,allowedOperations})=>createOrchestratorMcp({
      service,getContext:()=>context,allowedProjectId:projectId,allowedOperations
    }),
    authorizeProject:()=>true,ownerDispatch
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
  assert.equal(connected.providerDispatchAllowed,false,
    'old Forge still supports canonical reads without advertising dispatch');
  assert.equal(connected.dispatchBlockReason,'forge_native_dispatch_update_required');
  await assert.rejects(client.dispatchWork({}),/forge_native_dispatch_update_required/);
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

test('owner-only Core dispatch creates a real canonical Run and receipt exactly once',async t=>{
  let f,providerSends=0,ownerApprovals=0;
  const provider={ready:async()=>true,available:()=>true,
    send:async({taskId})=>{
      providerSends++;
      const runId=f.store.startRun(taskId);
      f.store.finishRun(taskId,runId);
      return {confirmed:true,deliveryObserved:true,responseObserved:true,
        effectVerified:false,runId};
    }};
  f=fixture(t,{provider,ownerDispatch:async(input,{isAuthorized})=>{
    assert.equal(isAuthorized(),true);
    ownerApprovals++; // Mock native Forge approval; production uses its dialog.
    const draft=f.store.getTaskDraft(input.taskId);
    assert.equal(draft.draft_revision,input.draftRevision);
    assert.equal(draft.draft,input.content);
    return f.service.invoke(f.context,'work_send',input);
  }});
  const mission=(await f.service.invoke(f.context,'mission_create',{
    name:'Despacho Core',mission:'Criar cardápio com testes.',
    requestId:'mission_owner_dispatch_1'})).result;
  const started=await f.transport.start(FORGE_APP_MCP_SCOPE);
  const client=createForgeCoreReadClient();
  t.after(()=>client.disconnect());
  const connected=await client.connect({endpoint:started.endpoint,token:started.token});
  assert.equal(connected.providerDispatchAllowed,true,
    'owner ingress must be probed before enabling dispatch');
  await client.refresh();
  await client.selectTask(mission.taskId);
  const revision=client.projection().selectedHandoff.selectedTask.draftRevision;
  const content='Executar a Task de cardápio e seus testes.';
  const saved=await client.saveWorkDraft({
    taskId:mission.taskId,content,expectedRevision:revision});
  const result=await client.dispatchWork({
    taskId:mission.taskId,content,draftRevision:saved.draftRevision});
  assert.equal(result.status,'succeeded');
  assert.equal(result.mcpReceiptVerified,true);
  assert.equal(result.effectVerified,false);
  assert.equal(result.retryPermitted,false);
  assert.match(result.runId,/^run_/);
  assert.match(result.commandId,/^command_/);
  assert.equal(ownerApprovals,1);
  assert.equal(providerSends,1);
  const row=f.store.db.prepare('SELECT status FROM runs WHERE id=? AND task_id=?')
    .get(result.runId,mission.taskId);
  assert.equal(row.status,'succeeded');
  const recorded=f.store.db.prepare('SELECT status,operation FROM lab_command_receipts WHERE id=?')
    .get(result.commandId);
  assert.equal(recorded.status,'succeeded');
  assert.equal(recorded.operation,'work_send');
  await assert.rejects(client.dispatchWork({
    taskId:mission.taskId,content,draftRevision:saved.draftRevision
  }),/forge_owner_dispatch_preparation_required|forge_owner_dispatch_already_attempted/);
  assert.equal(providerSends,1,'a second request cannot start another GPT effect');
});

test('owner dispatch refuses missing MCP session, browser origin, tampering and no owner approval',async t=>{
  let called=0;
  const f=fixture(t,{ownerDispatch:async()=>{
    called++;throw Error('native_owner_did_not_approve');
  }});
  const mission=(await f.service.invoke(f.context,'mission_create',{
    name:'Gates',mission:'Plano seguro.',requestId:'mission_owner_dispatch_2'
  })).result;
  const started=await f.transport.start(FORGE_APP_MCP_SCOPE);
  const endpoint=started.endpoint.replace(/\/mcp$/,'/owner-dispatch');
  const body=JSON.stringify({schema:'ordax.forge.owner-dispatch/1',
    operation:'work_send',projectId:mission.projectId,taskId:mission.taskId,
    content:'Testar bloqueio nativo',draftRevision:1,
    requestId:'fg_dispatch_00000000-0000-4000-8000-000000000001'});
  const headers={Authorization:'Bearer '+started.token,
    'Content-Type':'application/json'};
  const missing=await fetch(endpoint,{method:'POST',headers,body});
  assert.equal(missing.status,404);
  const client=createForgeCoreReadClient();
  t.after(()=>client.disconnect());
  await client.connect({endpoint:started.endpoint,token:started.token});
  const fakeToken=await fetch(endpoint,{method:'POST',headers:{
    ...headers,Authorization:'Bearer '+'x'.repeat(43)},body});
  assert.equal(fakeToken.status,401);
  const reply=await fetch(endpoint,{method:'POST',headers:{
    ...headers,Origin:'https://evil.example',
    // No MCP session: the origin rule must win first.
  },body});
  assert.equal(reply.status,403);
  const rpcClient=createForgeCoreReadClient({fetchImpl:async(url,options)=>{
    if(url.endsWith('/owner-dispatch'))return fetch(url,options);
    return fetch(url,options);
  }});
  t.after(()=>rpcClient.disconnect());
  await rpcClient.connect({endpoint:started.endpoint,token:started.token});
  await rpcClient.refresh();
  await rpcClient.selectTask(mission.taskId);
  const original=rpcClient.projection().selectedHandoff.selectedTask.draftRevision;
  const saved=await rpcClient.saveWorkDraft({taskId:mission.taskId,
    content:'Rascunho com confirmação pendente.',expectedRevision:original});
  await assert.rejects(rpcClient.dispatchWork({taskId:mission.taskId,
    content:'CONTEUDO ALTERADO.',draftRevision:saved.draftRevision}),
    /forge_owner_dispatch_draft_changed/);
  assert.equal(called,0);
  await assert.rejects(rpcClient.dispatchWork({taskId:mission.taskId,
    content:'Rascunho com confirmação pendente.',draftRevision:saved.draftRevision}),
    /forge_owner_dispatch_unconfirmed_http_409/);
  assert.equal(called,1,'native Owner denial creates no provider send');
});

test('uncertain Core provider send returns canonical uncertain receipt without any replay',async t=>{
  let f,calls=0;
  f=fixture(t,{
    provider:{ready:async()=>true,available:()=>true,send:async()=>{
      calls++;throw Error('ambiguous_provider_response');
    }},
    ownerDispatch:async(input,{isAuthorized})=>{
      if(!isAuthorized())throw Error('owner_revoked');
      const draft=f.store.getTaskDraft(input.taskId);
      assert.equal(draft.draft,input.content);
      assert.equal(draft.draft_revision,input.draftRevision);
      return f.service.invoke(f.context,'work_send',input);
    }
  });
  const mission=(await f.service.invoke(f.context,'mission_create',{
    name:'Entrega incerta',mission:'Validar uma execução.',requestId:'uncertain_1'
  })).result;
  const listener=await f.transport.start(FORGE_APP_MCP_SCOPE);
  const client=createForgeCoreReadClient();
  t.after(()=>client.disconnect());
  await client.connect({endpoint:listener.endpoint,token:listener.token});
  await client.refresh();await client.selectTask(mission.taskId);
  const initial=client.projection().selectedHandoff.selectedTask.draftRevision;
  const content='Executar uma vez, sem replay automático.';
  const saved=await client.saveWorkDraft({
    taskId:mission.taskId,content,expectedRevision:initial});
  const sent=await client.dispatchWork({
    taskId:mission.taskId,content,draftRevision:saved.draftRevision});
  assert.equal(sent.status,'uncertain');
  assert.equal(sent.responseObserved,false);
  assert.equal(sent.mcpReceiptVerified,true);
  assert.equal(sent.effectVerified,false);
  assert.equal(sent.retryPermitted,false);
  assert.equal(calls,1);
  const receipt=f.store.db.prepare('SELECT status FROM lab_command_receipts WHERE id=?')
    .get(sent.commandId);
  assert.equal(receipt.status,'uncertain');
  await assert.rejects(client.dispatchWork({
    taskId:mission.taskId,content,draftRevision:saved.draftRevision
  }),/forge_owner_dispatch_preparation_required|forge_owner_dispatch_already_attempted/);
  assert.equal(calls,1);
});
