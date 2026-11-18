import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../../forge/product/src/store.mjs';
import {OrchestratorService} from '../../forge/product/src/orchestrator-service.mjs';
import {createOrchestratorMcp} from '../../forge/product/src/orchestrator-mcp.mjs';
import {createForgeLoopbackMcp,FORGE_APP_MCP_SCOPE} from '../../forge/product/src/forge-loopback-mcp.mjs';
import {prepareForgeGitPairRequest,inspectForgeGitPairRequest,sealExistingForgeMcpGrant,
  unsealForgeGitPairResponse} from '../../forge/product/src/forge-git-owner-pair-crypto.mjs';
import {createForgeCoreReadClient} from '../forge-core-read-client.mjs';
import {createProtectedForgeConnection} from '../protected-connection.mjs';
import {createTestSecureStoragePort} from './helpers/secure-storage-port.mjs';

function fixture(t,{ownerPair,authorized=()=>true}={}){
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const context={actorId:'owner',clientId:'desktop',
    workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,
    authorize:({context:c})=>c===context});
  const transport=createForgeLoopbackMcp({
    authorizeProject:authorized,
    ownerPair,
    createMcp:({projectId,allowedOperations})=>createOrchestratorMcp({
      service,getContext:()=>context,allowedProjectId:projectId,allowedOperations
    })
  });
  t.after(()=>transport.stop());
  return {store,context,service,transport};
}

async function requestPair(endpoint,request,headers={}){
  return fetch(endpoint.replace(/\/mcp$/,'/owner-pair'),{
    method:'POST',headers:{'Content-Type':'application/json',
      'X-Forge-Git-Pair':'1',...headers},
    body:JSON.stringify(request),signal:AbortSignal.timeout(5000)
  });
}

test('one-time RSA-OAEP handoff exposes no bearer without the private key',()=>{
  const prepared=prepareForgeGitPairRequest();
  const token='A'.repeat(48);
  const inspected=inspectForgeGitPairRequest(prepared.request);
  assert.equal(inspected.code,prepared.code);
  assert.match(prepared.code,/^[A-F0-9]{10}$/);
  assert.equal(JSON.stringify(prepared.request).includes(token),false);
  const encrypted=sealExistingForgeMcpGrant(prepared.request,token);
  assert.equal(JSON.stringify(encrypted).includes(token),false);
  assert.equal(unsealForgeGitPairResponse(prepared,encrypted),token);
  const different=prepareForgeGitPairRequest();
  assert.throws(()=>unsealForgeGitPairResponse(different,encrypted),
    /forge_mcp_pair_response_invalid/);
  assert.throws(()=>unsealForgeGitPairResponse(prepared,{
    ...encrypted,code:'FFFFFFFFFF'}),/forge_mcp_pair_response_invalid/);
  assert.throws(()=>sealExistingForgeMcpGrant({
    ...prepared.request,publicKey:'invalid'},token),/forge_mcp_pair_request_invalid/);
  assert.throws(()=>sealExistingForgeMcpGrant(prepared.request,'short'),
    /forge_mcp_pair_existing_grant_invalid/);
  assert.throws(()=>unsealForgeGitPairResponse(prepared,{
    ...encrypted,ciphertext:'A'.repeat(encrypted.ciphertext.length)
  }),/forge_mcp_pair_response_unseal_failed/);
});

test('one Owner confirmation pairs the existing Forge MCP/SQLite, stores only DPAPI, sends zero GPT',async t=>{
  const approvalCodes=[];
  const f=fixture(t,{ownerPair:async({code},{isAuthorized})=>{
    approvalCodes.push(code);
    return isAuthorized();
  }});
  const mission=(await f.service.invoke(f.context,'mission_create',{
    name:'Pareamento seguro',mission:'Vincular sem duplicar o Core',
    requestId:'fg_pair_e2e_mission_1'
  })).result;
  const listener=await f.transport.start(FORGE_APP_MCP_SCOPE);
  const prepared=prepareForgeGitPairRequest();
  const response=await requestPair(listener.endpoint,prepared.request);
  assert.equal(response.status,200);
  const envelope=await response.json();
  assert.deepEqual(approvalCodes,[prepared.code]);
  const unsealed=unsealForgeGitPairResponse(prepared,envelope);
  assert.equal(unsealed,listener.token);
  assert.equal(JSON.stringify(envelope).includes(listener.token),false);

  const client=createForgeCoreReadClient();
  t.after(()=>client.disconnect());
  await client.connect({endpoint:listener.endpoint,token:unsealed});
  const projection=await client.refresh(mission.projectId);
  assert.equal(projection.selectedProjectId,mission.projectId);
  const dir=mkdtempSync(path.join(os.tmpdir(),'forge-git-pair-e2e-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const secured=createProtectedForgeConnection({directory:dir,platform:'win32',
    secureStorage:createTestSecureStoragePort()});
  secured.save({endpoint:listener.endpoint,token:unsealed});
  assert.equal(secured.recover().token,listener.token);
  assert.equal(f.store.db.prepare('SELECT count(*) AS total FROM runs').get().total,0);
  assert.equal(f.store.db.prepare('SELECT count(*) AS total FROM messages').get().total,0);
  assert.equal(secured.clear(),true);
});

test('browser origin, non-app grants and explicit Owner decline cannot obtain a bearer',async t=>{
  let approvals=0;
  const f=fixture(t,{ownerPair:async()=>{approvals++;return false;}});
  const listener=await f.transport.start(FORGE_APP_MCP_SCOPE);
  const request=prepareForgeGitPairRequest().request;
  const browser=await requestPair(listener.endpoint,request,{Origin:'https://evil.example'});
  assert.equal(browser.status,403);
  assert.equal(approvals,0);
  const badType=await requestPair(listener.endpoint,request,{'Content-Type':'text/plain'});
  assert.equal(badType.status,415);
  assert.equal(approvals,0);
  const refused=await requestPair(listener.endpoint,request);
  assert.equal(refused.status,403);
  assert.equal(approvals,1);
  await f.transport.stop();
  const other=await f.transport.start('project_accepted');
  const excluded=await requestPair(other.endpoint,request);
  assert.equal(excluded.status,403);
  assert.equal(approvals,1);
});

test('a stale Owner approval can never return a bearer after grant revocation',async t=>{
  let entered,release;
  const untilEntered=new Promise(resolve=>{entered=resolve;});
  const f=fixture(t,{ownerPair:async()=>{
    entered();
    return new Promise(resolve=>{release=()=>resolve(true);});
  }});
  const started=await f.transport.start(FORGE_APP_MCP_SCOPE);
  const prepared=prepareForgeGitPairRequest();
  const result=requestPair(started.endpoint,prepared.request)
    .then(async r=>({status:r.status,body:await r.text()}))
    .catch(e=>({status:'closed',reason:String(e?.message||e)}));
  await untilEntered;
  const closing=f.transport.stop();
  release();
  await closing;
  const outcome=await result;
  assert.notEqual(outcome.status,200,'revoked grant cannot yield encrypted bearer');
});
