import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHostApplication} from '../host/host-application.mjs';
import {ForgeMcpOwnerTrust} from '../src/forge-mcp-owner-trust.mjs';
import {FORGE_NODE_REMOTE_MCP_OPERATIONS} from '../src/forge-remote-mcp-owner.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const subject='11111111-2222-4333-8444-555555555555';
const issuer='https://jhfphsjptrpmtnzkpwud.supabase.co/auth/v1';
const sampleToken='PRIVATE_TEST_SESSION_SENTINEL_DO_NOT_PERSIST';
const uuids=['00000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000022',
  '00000000-0000-4000-8000-000000000033'];

async function temporaryRoot(){
  return fs.mkdtemp(path.join(os.tmpdir(),'forge-node-gw-'));
}
function sessionPort(){
  return {
    status:()=>({connected:true,subjectId:subject,issuer}),
    accessToken:async()=>sampleToken
  };
}
function networkStub(){
  const calls=[];
  const fetchImpl=async(url,options)=>{
    const pathname=new URL(url).pathname;
    const payload=JSON.parse(String(options.body||'{}'));
    calls.push({path:pathname,payload,hasToken:options.headers?.authorization==='Bearer '+sampleToken});
    return new Response(JSON.stringify({ok:true,last_seen_at:'2026-11-21T17:00:00.000Z'}),{
      status:200,headers:{'content-type':'application/json'}
    });
  };
  return {fetchImpl,calls};
}
function trustNativeOwner(app,profile){
  const native=new ForgeMcpOwnerTrust({
    store:app.store,appIdentity:path.dirname(profile),
    scopeSignature:projectId=>'app-private:'+projectId
  });
  return native.trustApp({expectedScopeHash:native.appScopeHash()});
}
function job(toolName,argumentsValue,version){
  return {
    request_id:uuids[0],attempt_id:uuids[1],lease_id:uuids[2],
    tool_name:toolName,arguments:argumentsValue,
    version
  };
}

test('plain Node Host never starts a remote gateway without secure session authority',async t=>{
  const folder=await temporaryRoot(),profile=path.join(folder,'data');
  const app=createHostApplication({productRoot:root,dataRoot:profile,environment:{}});
  t.after(async()=>{app.close();await fs.rm(folder,{recursive:true,force:true})});
  assert.equal(app.remoteGateway,null);
  await assert.rejects(app.startRemoteGateway(),/forge_node_secure_session_port_unavailable/);
  assert.equal(app.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('Node Core uses canonical remote MCP for a gateway job, not browser or filesystem IPC',async t=>{
  const folder=await temporaryRoot(),profile=path.join(folder,'data');
  const {fetchImpl,calls}=networkStub();
  const app=createHostApplication({
    productRoot:root,dataRoot:profile,remoteSession:sessionPort(),
    remoteFetchImpl:fetchImpl,environment:{}
  });
  t.after(async()=>{app.close();await fs.rm(folder,{recursive:true,force:true})});
  assert.ok(app.remoteGateway);
  await assert.rejects(app.remoteGateway.register(),/forge_mcp_app_untrusted/);
  assert.equal(calls.length,0,'no network registration before native Owner trust');
  trustNativeOwner(app,profile);
  await app.remoteGateway.register();
  const registration=calls.find(c=>c.path==='/v1/forge/instance/register');
  assert.ok(registration);
  assert.equal(registration.hasToken,true);
  assert.equal(registration.payload.app_version,
    JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version);
  const catalog=registration.payload.catalog;
  assert.ok(catalog.some(tool=>tool.name==='forge_mission_create'));
  assert.ok(catalog.some(tool=>tool.name==='forge_work_claim'));
  for(const name of ['forge_app_ui_click','forge_project_command_run',
    'forge_project_file_read','forge_project_file_write','forge_project_delete'])
    assert.equal(catalog.some(tool=>tool.name===name),false,
      'Native-only tool must never be claimed by bare Node Core');
  assert.equal(
    app.store.db.prepare('SELECT subject_id subjectId FROM forge_mcp_remote_owner_identity').get().subjectId,
    subject);

  const mission='Forge Node remoto: operação MCP e continuidade verificadas';
  const result=await app.remoteGateway.executeJob(job('forge_mission_create',{
    requestId:'forge_node_remote_demo_once',mission
  }));
  assert.equal(result.ok,true);
  const report=calls.find(c=>c.path==='/v1/forge/instance/report');
  assert.ok(report);
  assert.equal(report.payload.succeeded,true);
  assert.equal(report.payload.result?.structuredContent?.status,'succeeded');
  const projects=app.store.db.prepare('SELECT id,name FROM lab_projects').all();
  assert.equal(projects.length,1);
  assert.equal(projects[0].name,mission);
  // Project creation has no Task-scoped claim event. A SECOND real gateway
  // tools/call against its created Task must persist transport provenance.
  const created=report.payload.result?.structuredContent?.result;
  assert.equal(created.projectId,projects[0].id);
  const claimed=await app.remoteGateway.executeJob(job('forge_work_claim',{
    requestId:'forge_node_remote_claim_once',projectId:created.projectId,
    taskId:created.taskId,action:'acquire',chatLabel:'remote test client'
  }));
  assert.equal(claimed.ok,true);
  const reports=calls.filter(c=>c.path==='/v1/forge/instance/report');
  assert.equal(reports.length,2);
  assert.equal(reports[1].payload.result?.structuredContent?.result?.status,'acquired');
  const observed=app.store.db.prepare(
    "SELECT task_id AS taskId,payload FROM events WHERE kind='forge.mcp.work_tool_observed'"
  ).all();
  assert.equal(observed.length,1);
  assert.equal(observed[0].taskId,created.taskId);
  const proof=JSON.parse(observed[0].payload);
  assert.equal(proof.ingress,'remote_gateway');
  assert.equal(proof.operation,'work_claim');
  assert.equal(proof.outcome,'acquired');
  assert.equal(proof.gpt_run_identity_verified,false);
  assert.equal(proof.chat_identity_verified,false);

  const lease=reports[1].payload.result.structuredContent.result;
  assert.ok(lease.claimToken);
  const shared={
    projectId:created.projectId,taskId:created.taskId,
    claimToken:lease.claimToken,generation:lease.claim.generation
  };
  await app.remoteGateway.executeJob(job('forge_work_progress',{
    ...shared,requestId:'forge_node_remote_checkpoint_once',
    kind:'checkpoint',summary:'Node Core persists progress through the leased MCP ingress'
  }));
  await app.remoteGateway.executeJob(job('forge_work_memory_set',{
    ...shared,requestId:'forge_node_remote_memory_once',
    category:'fact',key:'node-core-continuity',
    content:'One SQLite Core owns the checkpoint and shared memory'
  }));
  const memory=await app.service.invoke(app.context,'project_memory',{
    projectId:created.projectId
  });
  assert.ok(memory.canonical.some(item=>item.key==='node-core-continuity'));
  assert.ok(memory.canonical.every(item=>item.verifiedExternalEffect!==true));
  const allObserved=app.store.db.prepare(
    "SELECT payload FROM events WHERE kind='forge.mcp.work_tool_observed'"
  ).all().map(row=>JSON.parse(row.payload));
  assert.deepEqual(new Set(allObserved.map(row=>row.operation)),
    new Set(['work_claim','work_progress','work_memory_set']));
  assert.ok(allObserved.every(row=>row.ingress==='remote_gateway'&&
    row.gpt_run_identity_verified===false&&row.chat_identity_verified===false));

  assert.equal(JSON.stringify(app.remoteGateway.status()).includes(sampleToken),false);
  assert.equal(JSON.stringify(projects).includes(sampleToken),false);
  assert.equal(app.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('Electron and Node import one remote ingress factory, without another gateway',()=>{
  const electron=readFileSync(path.join(root,'desktop/main.mjs'),'utf8');
  const node=readFileSync(path.join(root,'host/host-application.mjs'),'utf8');
  assert.match(electron,/createForgeRemoteMcpOwner\(\{/);
  assert.match(node,/createForgeRemoteMcpOwner\(\{/);
  assert.doesNotMatch(electron,/new ForgeRemoteGatewayClient\(/);
  assert.doesNotMatch(node,/new ForgeRemoteGatewayClient\(/);
  assert.doesNotMatch(node,/forgeProductSession\.enc|safeStorage\.decryptString|remoteSession:process\.env/);
  assert.ok(!Object.keys(process.env).some(key=>key==='ORDAX_FORGE_HOST_REMOTE_BEARER'));
});

test('Node-only advertised operations remain a subset of the canonical app MCP contract',()=>{
  assert.ok(FORGE_NODE_REMOTE_MCP_OPERATIONS.includes('work_claim'));
  assert.ok(FORGE_NODE_REMOTE_MCP_OPERATIONS.includes('work_progress'));
  assert.ok(FORGE_NODE_REMOTE_MCP_OPERATIONS.includes('work_memory_set'));
  for(const operation of ['app_ui_click','project_command_run','project_files_list',
    'project_file_write','project_worktree_verify','project_delete'])
    assert.equal(FORGE_NODE_REMOTE_MCP_OPERATIONS.includes(operation),false);
});
