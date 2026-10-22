import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {ORCHESTRATOR_TOOLS} from '../src/orchestrator-contract.mjs';

const RESOURCE='resource_fixture_987654321',DEVICE='device_fixture_1';
function fixture(t,port=null) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-workspace-scope-'));
  const file=path.join(dir,'work.sqlite');
  const store=new Store(file);
  const context={actorId:'owner-fixture',clientId:'lab-fixture',workspaceSessionId:store.getWorkspaceSession().id};
  let allowed=true,counter=0;
  const authorize=({context:c})=>allowed&&c===context;
  const service=new OrchestratorService({store,workspacePort:port,authorize});
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const invoke=(op,data={},ctx=context)=>service.invoke(ctx,op,{
    ...(!ORCHESTRATOR_TOOLS.find(t=>t.operation===op).readOnly?{requestId:'req_'+(++counter)}:{}),...data
  });
  return {file,store,service,context,invoke,setAllowed:v=>{allowed=v;}};
}
async function project(f,name='Projeto A') {
  return (await f.invoke('project_create',{name})).result.projectId;
}
function trustedPort() {
  let permitted=true,reads=0,checks=0;
  return {
    setPermitted(v){permitted=v;},
    get reads(){return reads;},get checks(){return checks;},
    async verifyBinding({context,deviceId,resourceId}) {
      checks++;
      return {authorized:permitted,projectId:context.projectId,deviceId,resourceId,
        actorId:context.actorId,clientId:context.clientId,workspaceSessionId:context.workspaceSessionId};
    },
    async snapshot({deviceId,resourceId}) {
      reads++;
      return {authorized:true,deviceId,resourceId,state:'connected',
        revision:'rev_25',observedAt:'2026-10-21T19:00:00-03:00',
        fileCount:8,changedCount:1,git:{isRepository:true,branch:'test/fixture',head:'abcdef1234'},
        path:'C:\\private\\DO_NOT_EXPOSE',files:[{content:'SECRET_NEVER_PRINT'}]};
    }
  };
}
test('no Runtime workspace port: report unavailable, never read filesystem or bind',async t=>{
  const f=fixture(t),projectId=await project(f);
  const status=await f.invoke('workspace_status',{projectId});
  assert.equal(status.available,false);
  assert.equal(status.state,'capability_unavailable');
  assert.equal(status.filesRead,0);assert.equal(status.filesWritten,0);
  await assert.rejects(f.invoke('workspace_bind',{projectId,deviceId:DEVICE,resourceId:RESOURCE}),
    /workspace_capability_unavailable/);
  assert.deepEqual((await f.invoke('workspace_status',{projectId})).bindings,[]);
});
test('a verified opaque Runtime resource attaches once; read-only snapshot excludes paths and file contents',async t=>{
  const port=trustedPort(),f=fixture(t,port),projectId=await project(f);
  const requestId='same_binding';
  const input={projectId,deviceId:DEVICE,resourceId:RESOURCE,requestId};
  const receipt=await f.invoke('workspace_bind',input);
  assert.equal(receipt.status,'succeeded');
  assert.equal(receipt.result.created,true);
  assert.deepEqual(await f.invoke('workspace_bind',input),receipt);
  assert.equal((await f.invoke('workspace_status',{projectId})).bindings.length,1);
  const result=await f.invoke('workspace_snapshot',{projectId,bindingId:receipt.result.bindingId});
  assert.deepEqual(result,{bindingId:receipt.result.bindingId,state:'connected',verified:true,
    revision:'rev_25',observedAt:'2026-10-21T19:00:00-03:00',
    fileCount:8,changedCount:1,git:{isRepository:true,branch:'test/fixture',head:'abcdef1234'}});
  assert.ok(!JSON.stringify(result).includes('SECRET_NEVER_PRINT'));
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.equal(port.reads,1);
});
test('project isolation, foreign identity, arbitrary paths and forged grant are rejected',async t=>{
  const port=trustedPort(),f=fixture(t,port),a=await project(f,'A'),b=await project(f,'B');
  const result=await f.invoke('workspace_bind',{projectId:a,deviceId:DEVICE,resourceId:RESOURCE});
  const bindingId=result.result.bindingId;
  await assert.rejects(f.invoke('workspace_snapshot',{projectId:b,bindingId}),/workspace_binding_unavailable/);
  await assert.rejects(f.invoke('workspace_bind',{projectId:b,deviceId:DEVICE,resourceId:'C:\\Users\\Downloads'}),/orchestrator_invalid_input/);
  await assert.rejects(f.invoke('workspace_bind',{projectId:b,deviceId:DEVICE,resourceId:'resource_fake'}),/orchestrator_invalid_input/);
  assert.equal((await f.invoke('workspace_status',{projectId:b})).bindings.length,0);
  await assert.rejects(f.invoke('workspace_snapshot',{projectId:a,bindingId}, {...f.context,actorId:'attacker'}),/orchestrator_access_denied/);
  assert.equal(port.reads,0);
});
test('revoked grant never serves a stale binding snapshot; loss of Runtime reports capability unavailable',async t=>{
  const port=trustedPort(),f=fixture(t,port),projectId=await project(f);
  const {result}=await f.invoke('workspace_bind',{projectId,deviceId:DEVICE,resourceId:RESOURCE});
  port.setPermitted(false);
  await assert.rejects(f.invoke('workspace_snapshot',{projectId,bindingId:result.bindingId}),/workspace_grant_unverified/);
  assert.equal(port.reads,0);
  const noPort=new OrchestratorService({store:f.store,authorize:({context:c})=>c===f.context});
  assert.equal((await noPort.invoke(f.context,'workspace_status',{projectId})).state,'capability_unavailable');
  const offline=await noPort.invoke(f.context,'workspace_snapshot',{projectId,bindingId:result.bindingId});
  assert.equal(offline.state,'capability_unavailable');assert.equal(offline.verified,false);
});
test('revocation during awaited grant verification prevents persistence and receipts',async t=>{
  let release,started;
  const gate=new Promise(resolve=>{release=resolve;});
  const entered=new Promise(resolve=>{started=resolve;});
  const port=trustedPort();
  const verify=port.verifyBinding;
  port.verifyBinding=async input=>{started();await gate;return verify(input);};
  const f=fixture(t,port),projectId=await project(f);
  const promise=f.invoke('workspace_bind',{projectId,deviceId:DEVICE,resourceId:RESOURCE});
  await entered;f.setAllowed(false);release();
  await assert.rejects(promise,/orchestrator_access_denied/);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_project_workspaces').get().n,0);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_command_receipts WHERE operation='workspace_bind'").get().n,0);
});
test('malformed Runtime snapshot is rejected, including unverified Git/provenance',async t=>{
  const port=trustedPort(),f=fixture(t,port),projectId=await project(f);
  const {result}=await f.invoke('workspace_bind',{projectId,deviceId:DEVICE,resourceId:RESOURCE});
  port.snapshot=async()=>({authorized:true,deviceId:DEVICE,resourceId:RESOURCE,state:'connected',
    revision:'../../secret',observedAt:'yesterday',fileCount:2,changedCount:1,
    git:{isRepository:true,branch:'main',head:'nohash'}});
  await assert.rejects(f.invoke('workspace_snapshot',{projectId,bindingId:result.bindingId}),/workspace_snapshot_invalid/);
});
