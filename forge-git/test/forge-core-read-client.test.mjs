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
