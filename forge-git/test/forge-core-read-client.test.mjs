import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../../forge/product/src/store.mjs';
import {OrchestratorService} from '../../forge/product/src/orchestrator-service.mjs';
import {createOrchestratorMcp} from '../../forge/product/src/orchestrator-mcp.mjs';
import {createForgeLoopbackMcp,FORGE_APP_MCP_SCOPE} from '../../forge/product/src/forge-loopback-mcp.mjs';
import {createForgeCoreReadClient,validateForgeEndpoint} from '../forge-core-read-client.mjs';
import {createProtectedForgeConnection} from '../protected-connection.mjs';
import {createTestSecureStoragePort} from './helpers/secure-storage-port.mjs';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
  assert.equal(client.status().receiptLookupAllowed,true);
  // The same Core/SQLite receipt is read again without dispatching GPT.
  await client.refresh(mission.projectId);
  const inspected=await client.inspectUnresolvedReceipt({commandId:sent.commandId});
  assert.deepEqual({
    commandId:inspected.commandId,operation:inspected.operation,
    status:inspected.status,requiresReconciliation:inspected.requiresReconciliation,
    readOnly:inspected.readOnly,externalEffectsVerified:inspected.externalEffectsVerified
  },{
    commandId:sent.commandId,operation:'work_send',status:'uncertain',
    requiresReconciliation:true,readOnly:true,externalEffectsVerified:false
  });
  await assert.rejects(client.inspectUnresolvedReceipt({
    commandId:'command_00000000-0000-4000-8000-000000000000'
  }),/forge_mcp_receipt_not_in_selected_project/);
  assert.equal(calls,1,'receipt lookup never sends a provider message');
  await assert.rejects(client.dispatchWork({
    taskId:mission.taskId,content,draftRevision:saved.draftRevision
  }),/forge_owner_dispatch_preparation_required|forge_owner_dispatch_already_attempted/);
  assert.equal(calls,1);
});

test('late MCP polling cannot replace a newer Task selection or drafted revision',async t=>{
  const f=fixture(t);
  const mission=(await f.service.invoke(f.context,'mission_create',{
    name:'Concorrência',mission:'Preservar a Task selecionada.',
    requestId:'core_ui_polling_race_1'
  })).result;
  const started=await f.transport.start(FORGE_APP_MCP_SCOPE);
  let pauseNext=false,entered,release;
  const fetchImpl=async(url,options)=>{
    const body=options?.body?JSON.parse(options.body):null;
    if(pauseNext&&body?.method==='tools/call'&&
       body.params?.name==='forge_work_list'){
      pauseNext=false;
      const response=await fetch(url,options);
      entered();
      await new Promise(resolve=>{release=resolve;});
      return response;
    }
    return fetch(url,options);
  };
  const client=createForgeCoreReadClient({fetchImpl});
  t.after(()=>client.disconnect());
  await client.connect({endpoint:started.endpoint,token:started.token});
  await client.refresh();

  let enteredPromise=new Promise(resolve=>{entered=resolve;});
  pauseNext=true;
  const staleSelectionPoll=client.refresh();
  await enteredPromise;
  const chosen=await client.selectTask(mission.taskId);
  assert.equal(chosen.selectedTaskId,mission.taskId);
  release();
  assert.equal(await staleSelectionPoll,null,
    'stale poll does not falsely report a fresh MCP read');
  assert.equal(client.projection().selectedTaskId,mission.taskId,
    'old polling must not clear the explicit Task');

  enteredPromise=new Promise(resolve=>{entered=resolve;});
  pauseNext=true;
  const staleDraftPoll=client.refresh();
  await enteredPromise;
  const revision=client.projection().selectedHandoff.selectedTask.draftRevision;
  const receipt=await client.saveWorkDraft({
    taskId:mission.taskId,content:'Manter o rascunho após polling atrasado.',
    expectedRevision:revision
  });
  assert.equal(receipt.readbackVerified,true);
  release();
  assert.equal(await staleDraftPoll,null,
    'stale read cannot report an updated draft as its own read');
  assert.equal(client.projection().selectedTaskId,mission.taskId);
  assert.equal(client.projection().selectedHandoff.selectedTask.draftRevision,
    receipt.draftRevision);
  assert.equal(client.status().preparedDraftRevision,receipt.draftRevision);
});

test('explicit project switch wins when background polling starts during its MCP read',async t=>{
  const f=fixture(t);
  const a=(await f.service.invoke(f.context,'mission_create',{
    name:'Projeto A',mission:'Trabalho do projeto A.',
    requestId:'core_ui_switch_a'
  })).result;
  const b=(await f.service.invoke(f.context,'mission_create',{
    name:'Projeto B',mission:'Trabalho do projeto B.',
    requestId:'core_ui_switch_b'
  })).result;
  const started=await f.transport.start(FORGE_APP_MCP_SCOPE);
  let intercepted=false,entered,release;
  const enteredPromise=new Promise(resolve=>{entered=resolve;});
  const fetchImpl=async(url,options)=>{
    const body=options?.body?JSON.parse(options.body):null;
    if(!intercepted&&body?.method==='tools/call'&&
       body.params?.name==='forge_work_list'&&
       body.params?.arguments?.projectId===b.projectId){
      intercepted=true;
      const response=await fetch(url,options);
      entered();
      await new Promise(resolve=>{release=resolve;});
      return response;
    }
    return fetch(url,options);
  };
  const client=createForgeCoreReadClient({fetchImpl});
  t.after(()=>client.disconnect());
  await client.connect({endpoint:started.endpoint,token:started.token});
  await client.refresh(a.projectId);
  const selecting=client.refresh(b.projectId);
  await enteredPromise;
  const during=await client.refresh();
  assert.equal(during,null,'no stale read may claim a fresh projection');
  assert.equal(client.projection().selectedProjectId,a.projectId,
    'project selection is still pending in the Core client');
  release();
  await selecting;
  assert.equal(client.projection().selectedProjectId,b.projectId);
  assert.equal(client.projection().handoff.project.id,b.projectId);
  assert.equal(client.status().selectedProjectId,b.projectId);
  assert.equal(client.projection().selectedTaskId,null,
    'Task must be selected separately for the new project');
});

test('new MCP session does not inherit a pending project selection from revoked session',async t=>{
  const f=fixture(t);
  const a=(await f.service.invoke(f.context,'mission_create',{
    name:'Sessão A',mission:'Verificar projeto após reconexão.',
    requestId:'core_ui_reconnect_a'
  })).result;
  const b=(await f.service.invoke(f.context,'mission_create',{
    name:'Sessão B',mission:'Atrasar leitura da sessão anterior.',
    requestId:'core_ui_reconnect_b'
  })).result;
  const started=await f.transport.start(FORGE_APP_MCP_SCOPE);
  let entered,release,blocked=false;
  const enteredPromise=new Promise(resolve=>{entered=resolve;});
  const fetchImpl=async(url,options)=>{
    const body=options?.body?JSON.parse(options.body):null;
    if(!blocked&&body?.method==='tools/call'&&
       body.params?.name==='forge_work_list'&&
       body.params?.arguments?.projectId===b.projectId){
      blocked=true;
      const response=await fetch(url,options);
      entered();
      await new Promise(resolve=>{release=resolve;});
      return response;
    }
    return fetch(url,options);
  };
  const client=createForgeCoreReadClient({fetchImpl});
  t.after(()=>client.disconnect());
  await client.connect({endpoint:started.endpoint,token:started.token});
  await client.refresh(a.projectId);
  const oldSelection=client.refresh(b.projectId);
  // Observe the expected revocation error immediately, before it can reject.
  void oldSelection.catch(()=>{});
  await enteredPromise;
  client.disconnect();
  assert.equal(client.status().connected,false);
  await client.connect({endpoint:started.endpoint,token:started.token});
  const current=await client.refresh(a.projectId);
  assert.equal(current.selectedProjectId,a.projectId,
    'new grant must not be blocked by old pending project selection');
  release();
  await assert.rejects(oldSelection,/forge_mcp_connection_changed/);
  assert.equal(client.projection().selectedProjectId,a.projectId);
});

test('old monitor failure after MCP reconnect never revokes the replacement grant',async t=>{
  const f=fixture(t);
  const mission=(await f.service.invoke(f.context,'mission_create',{
    name:'Troca de sessão',mission:'Preservar grant novo após resposta antiga.',
    requestId:'core_ui_monitor_reconnect_1'
  })).result;
  const started=await f.transport.start(FORGE_APP_MCP_SCOPE);
  let hold=false,entered,release;
  const waitForHold=new Promise(resolve=>{entered=resolve;});
  const fetchImpl=async(url,options)=>{
    const body=options?.body?JSON.parse(options.body):null;
    if(hold&&body?.method==='tools/call'&&
       body.params?.name==='forge_work_list'){
      hold=false;
      const response=await fetch(url,options);
      entered();
      await new Promise(resolve=>{release=resolve;});
      return response;
    }
    return fetch(url,options);
  };
  const client=createForgeCoreReadClient({fetchImpl});
  t.after(()=>client.disconnect());
  await client.connect({endpoint:started.endpoint,token:started.token});
  await client.refresh(mission.projectId);
  hold=true;
  const oldMonitor=client.monitorRefresh();
  // Observe expected rejection immediately to avoid an unhandled promise.
  void oldMonitor.catch(()=>{});
  await waitForHold;
  client.disconnect();
  await client.connect({endpoint:started.endpoint,token:started.token});
  const current=await client.refresh(mission.projectId);
  assert.equal(current.selectedProjectId,mission.projectId);
  release();
  await assert.rejects(oldMonitor,/forge_mcp_connection_changed/);
  assert.equal(client.status().connected,true,
    'old polling cannot revoke a newer valid owner grant');
  assert.equal(client.projection().selectedProjectId,mission.projectId);
  await client.ping();
});

test('monitor read failure on current MCP grant disconnects fail closed',async t=>{
  const f=fixture(t);
  await f.service.invoke(f.context,'mission_create',{
    name:'Falha real',mission:'Não manter o Core falsamente conectado.',
    requestId:'core_ui_monitor_transport_1'
  });
  const started=await f.transport.start(FORGE_APP_MCP_SCOPE);
  let dropRead=false;
  const fetchImpl=async(url,options)=>{
    const body=options?.body?JSON.parse(options.body):null;
    if(dropRead&&body?.method==='tools/call'&&
       body.params?.name==='forge_projects_list')
      return new Response('service unavailable',{status:503});
    return fetch(url,options);
  };
  const client=createForgeCoreReadClient({fetchImpl});
  t.after(()=>client.disconnect());
  await client.connect({endpoint:started.endpoint,token:started.token});
  await client.refresh();
  dropRead=true;
  await assert.rejects(client.monitorRefresh(),/forge_mcp_http_503/);
  assert.equal(client.status().connected,false);
  assert.equal(client.projection(),null);
  await assert.rejects(client.dispatchWork({}),/forge_native_dispatch_update_required/);
});

test('lost owner-dispatch HTTP response clears prepared draft and never repeats GPT',async t=>{
  let f,providerSends=0,dispatchRequests=0;
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
    return f.service.invoke(f.context,'work_send',input);
  }});
  const mission=(await f.service.invoke(f.context,'mission_create',{
    name:'Resposta perdida',mission:'Não reexecutar operação já confirmada no Core.',
    requestId:'core_ui_dispatch_response_lost_1'
  })).result;
  const started=await f.transport.start(FORGE_APP_MCP_SCOPE);
  const fetchImpl=async(url,options)=>{
    if(url.endsWith('/owner-dispatch')&&options.method==='POST'){
      dispatchRequests++;
      const response=await fetch(url,options);
      assert.equal(response.status,200);
      // The Core may have already committed a Run before the TCP result is lost.
      throw Error('simulated_lost_http_response_after_core_commit');
    }
    return fetch(url,options);
  };
  const client=createForgeCoreReadClient({fetchImpl});
  t.after(()=>client.disconnect());
  await client.connect({endpoint:started.endpoint,token:started.token});
  await client.refresh(mission.projectId);
  await client.selectTask(mission.taskId);
  const revision=client.projection().selectedHandoff.selectedTask.draftRevision;
  const content='Executar no Core uma única vez e preservar o recibo.';
  const saved=await client.saveWorkDraft({
    taskId:mission.taskId,content,expectedRevision:revision
  });
  assert.equal(client.status().preparedDraftRevision,saved.draftRevision);
  await assert.rejects(client.dispatchWork({
    taskId:mission.taskId,content,draftRevision:saved.draftRevision
  }),/forge_owner_dispatch_result_uncertain_check_core_no_retry/);
  assert.equal(providerSends,1);
  assert.equal(dispatchRequests,1);
  assert.equal(client.status().preparedTaskId,null,
    'the UI must not present the old revision as ready to send');
  assert.equal(client.status().preparedDraftRevision,null);
  await assert.rejects(client.dispatchWork({
    taskId:mission.taskId,content,draftRevision:saved.draftRevision
  }),/forge_owner_dispatch_preparation_required/);
  assert.equal(providerSends,1);
  assert.equal(dispatchRequests,1);
  const stored=f.store.db.prepare('SELECT count(*) AS count FROM runs WHERE task_id=?')
    .get(mission.taskId);
  assert.equal(stored.count,1,'the Core has the only durable GPT Run');
});

test('optional receipt lookup capability is never inferred from a forged or absent tool',async t=>{
  const f=fixture(t);
  await f.service.invoke(f.context,'mission_create',{
    name:'Compatibilidade',mission:'MCP antigo sem leitura de recibos.',
    requestId:'forge_git_receipt_optional'
  });
  const listener=await f.transport.start(FORGE_APP_MCP_SCOPE);
  const client=createForgeCoreReadClient({fetchImpl:async(url,options)=>{
    const body=options?.body?JSON.parse(options.body):null;
    const response=await fetch(url,options);
    if(body?.method!=='tools/list'||response.status!==200)return response;
    const data=await response.json();
    data.result.tools=data.result.tools.map(tool=>tool.name==='forge_command_get'
      ?{...tool,annotations:{...tool.annotations,readOnlyHint:false}}
      :tool);
    return new Response(JSON.stringify(data),{status:200,headers:response.headers});
  }});
  t.after(()=>client.disconnect());
  const state=await client.connect({endpoint:listener.endpoint,token:listener.token});
  assert.equal(state.connected,true);
  assert.equal(state.receiptLookupAllowed,false,
    'read-only permission must be verified rather than assumed');
  await client.refresh();
  await assert.rejects(client.inspectUnresolvedReceipt({
    commandId:'command_00000000-0000-4000-8000-000000000001'
  }),/forge_mcp_receipt_read_unavailable/);
});

test('protected owner grant survives native listener and Forge Git client restart without new consent or GPT send',async t=>{
  const step=async(label,task)=>{
    try{return await task();}
    catch(error){throw new Error('protected_resume_stage_'+label+': '+String(error?.message||error),{cause:error});}
  };
  const f=fixture(t);
  const mission=(await f.service.invoke(f.context,'mission_create',{
    name:'Retomada segura',mission:'Continuar na mesma Task sem novo envio.',
    requestId:'core_ui_protected_resume_restart_1'
  })).result;
  const dir=mkdtempSync(path.join(os.tmpdir(),'forge-git-e2e-resume-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const storage=createTestSecureStoragePort();
  const cache=createProtectedForgeConnection({directory:dir,
    secureStorage:storage,platform:'win32'});
  const initial=await f.transport.start(FORGE_APP_MCP_SCOPE);
  const originalClient=createForgeCoreReadClient();
  t.after(()=>originalClient.disconnect());
  await step('first_connect',()=>originalClient.connect({endpoint:initial.endpoint,token:initial.token}));
  await step('first_refresh',()=>originalClient.refresh(mission.projectId));
  assert.equal(originalClient.projection().selectedProjectId,mission.projectId);
  assert.equal(originalClient.projection().works[0].id,mission.taskId);
  assert.equal(originalClient.status().providerDispatchAllowed,false);
  cache.save({endpoint:initial.endpoint,token:initial.token});

  const sealed=readFileSync(path.join(dir,'forge-git-mcp-connection.sealed.json'),'utf8');
  assert.equal(sealed.includes(initial.token),false,'no plaintext bearer in the saved UI profile');
  originalClient.disconnect();
  await step('first_stop',()=>f.transport.stop());

  // The native Forge Core restores its *existing* owner grant using the
  // canonical listener's fixed port and restored token. No second authority.
  const port=Number(new URL(initial.endpoint).port);
  const resumed=await step('native_resume',()=>f.transport.start(FORGE_APP_MCP_SCOPE,{
    listenPort:port,resumeToken:initial.token
  }));
  assert.equal(resumed.endpoint,initial.endpoint);
  assert.equal(resumed.token,initial.token);
  const successorClient=createForgeCoreReadClient();
  t.after(()=>successorClient.disconnect());
  const recovered=cache.recover();
  assert.deepEqual(recovered,{endpoint:initial.endpoint,token:initial.token});
  await step('successor_connect',()=>successorClient.connect(recovered));
  const readBack=await step('successor_refresh',()=>successorClient.refresh(mission.projectId));
  assert.equal(successorClient.status().connected,true);
  assert.equal(readBack.selectedProjectId,mission.projectId);
  assert.equal(readBack.handoff.project.id,mission.projectId);
  assert.ok(readBack.works.some(work=>work.id===mission.taskId));
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS total FROM runs').get().total,0,
    'resume must not start a provider Run');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS total FROM messages').get().total,0,
    'resume must not send a GPT message');

  // The old sealed bearer cannot renew access after the Core rotates it.
  successorClient.disconnect();
  await step('second_stop',()=>f.transport.stop());
  const rotated=await step('rotate',()=>f.transport.start(FORGE_APP_MCP_SCOPE,{listenPort:port}));
  assert.notEqual(rotated.token,initial.token);
  const revokedClient=createForgeCoreReadClient();
  t.after(()=>revokedClient.disconnect());
  // Node's pooled HTTP socket can be reset once when the local listener
  // restarts on the same port. Only the idempotent initialization handshake
  // may be retried; a bearer rejection must never be bypassed or replay work.
  let revokeConfirmed=false;
  for(let attempt=0;attempt<3;attempt++){
    try{
      await revokedClient.connect(cache.recover());
      throw Error('revoked_owner_grant_unexpectedly_accepted');
    }catch(error){
      const reason=String(error?.message||error);
      if(reason==='forge_mcp_http_401'){
        revokeConfirmed=true;
        break;
      }
      if(reason!=='fetch failed')throw error;
    }
  }
  assert.equal(revokeConfirmed,true,
    'a stale TCP connection cannot be mistaken for Owner approval');
  assert.equal(revokedClient.status().connected,false);
  cache.clear(); // Same revoked-grant cleanup performed by the Forge Git shell.
  assert.equal(cache.recover(),null);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS total FROM runs').get().total,0);
});
