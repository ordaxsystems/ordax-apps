import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {ForgeProjectFiles} from '../src/forge-project-files.mjs';
import {createOrchestratorMcp} from '../src/orchestrator-mcp.mjs';
import {createForgeLoopbackMcp} from '../src/forge-loopback-mcp.mjs';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'forge-multi-mcp-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const context={actorId:'owner',clientId:'desktop',
    workspaceSessionId:store.getWorkspaceSession().id};
  const files=new ForgeProjectFiles({root:path.join(root,'files')});
  const service=new OrchestratorService({store,fileBroker:files,
    authorize:({context:who})=>who===context});
  let now=Date.now(),revoked=null;
  const transport=createForgeLoopbackMcp({
    createMcp:({projectId,allowedOperations})=>createOrchestratorMcp({
      service,getContext:()=>context,allowedProjectId:projectId,allowedOperations}),
    authorizeProject:projectId=>{
      if(projectId===revoked)return false;
      try{service.requireAccess(context,'project_file_read',projectId);return true;}
      catch{return false;}
    },
    clock:()=>now
  });
  t.after(()=>transport.stop());
  const project=async name=>(await service.invoke(context,'project_quick_create',
    {creationNonce:name,requestId:'req_'+name})).result.projectId;
  return {transport,project,files,advance:ms=>{now+=ms;},
    revokeAuthority:id=>{revoked=id;}};
}

async function request(endpoint,token,session,message) {
  const response=await fetch(endpoint,{method:'POST',headers:{
    Authorization:'Bearer '+token,'Content-Type':'application/json',
    ...(session?{'Mcp-Session-Id':session}:{})
  },body:JSON.stringify(message)});
  const raw=await response.text();
  return {status:response.status,session:response.headers.get('mcp-session-id'),
    body:raw?JSON.parse(raw):null};
}
const initialize={jsonrpc:'2.0',id:1,method:'initialize',params:{
  protocolVersion:'2025-06-18',clientInfo:{name:'multi-fixture',version:'1'},
  capabilities:{}
}};
const notify={jsonrpc:'2.0',method:'notifications/initialized'};
const invoke=(id,name,args={})=>({jsonrpc:'2.0',id,method:'tools/call',
  params:{name:'orchestrator_'+name,arguments:args}});

test('one MCP localhost listener serves independently authorized projects without token/session crossover',async t=>{
  const f=fixture(t),a=await f.project('alpha'),b=await f.project('beta');
  const first=await f.transport.start(a);
  const second=f.transport.addProject(b);
  assert.equal(second.endpoint,first.endpoint);
  assert.notEqual(second.token,first.token);
  assert.deepEqual(f.transport.status().scopes,[a,b]);
  assert.equal('token' in f.transport.status(),false);
  assert.throws(()=>f.transport.addProject(b),/already_granted/);
  const initA=await request(first.endpoint,first.token,null,initialize);
  const initB=await request(second.endpoint,second.token,null,initialize);
  assert.equal(initA.status,200);
  assert.equal(initB.status,200);
  assert.notEqual(initA.session,initB.session);
  await request(first.endpoint,first.token,initA.session,notify);
  await request(second.endpoint,second.token,initB.session,notify);
  const cross=await request(first.endpoint,second.token,initA.session,
    invoke(2,'forge_discover'));
  assert.equal(cross.status,404);
  const other=await request(second.endpoint,second.token,initB.session,
    invoke(3,'forge_discover',{projectId:a}));
  assert.equal(other.body.error.code,-32602);
  const savedA=await request(first.endpoint,first.token,initA.session,
    invoke(4,'project_file_write',{path:'index.html',content:'alpha',
      requestId:'write_a'}));
  const savedB=await request(second.endpoint,second.token,initB.session,
    invoke(5,'project_file_write',{path:'index.html',content:'beta',
      requestId:'write_b'}));
  assert.equal(savedA.body.result.structuredContent.status,'succeeded');
  assert.equal(savedB.body.result.structuredContent.status,'succeeded');
  assert.equal(f.files.read(a,'index.html').content,'alpha');
  assert.equal(f.files.read(b,'index.html').content,'beta');
  const removed=await f.transport.revokeProject(a);
  assert.deepEqual(removed.scopes,[b]);
  const tokenA=await request(first.endpoint,first.token,initA.session,
    invoke(6,'forge_discover'));
  assert.equal(tokenA.status,401);
  const goodB=await request(second.endpoint,second.token,initB.session,
    invoke(7,'forge_discover'));
  assert.equal(goodB.body.result.structuredContent.projectId,b);
  f.revokeAuthority(b);
  const rejected=await request(second.endpoint,second.token,initB.session,
    invoke(8,'project_file_read',{path:'index.html'}));
  assert.equal(rejected.status,403);
  const stopped=await f.transport.revokeProject(b);
  assert.equal(stopped.running,false);
});


test('opt-in credentials can restore the same local MCP address after process restart',async t=>{
  const f=fixture(t),a=await f.project('secure-reconnect');
  const token='A'.repeat(43);
  const started=await f.transport.start(a,{resumeToken:token});
  assert.equal(started.token,token);
  const port=Number(new URL(started.endpoint).port);
  assert.ok(port>=1024);
  const first=await request(started.endpoint,token,null,initialize);
  assert.equal(first.status,200);
  await f.transport.stop();
  assert.equal(f.transport.status().running,false);
  const restored=await f.transport.start(a,{listenPort:port,resumeToken:token});
  assert.equal(restored.endpoint,started.endpoint);
  assert.equal(restored.token,token);
  const renewed=await request(restored.endpoint,token,null,initialize);
  assert.equal(renewed.status,200);
  assert.notEqual(renewed.session,first.session);
  assert.equal((await request(restored.endpoint,'wrong',null,initialize)).status,401);
  assert.throws(()=>f.transport.addProject(a,{resumeToken:'invalid'}),/already_granted/);
  await f.transport.stop();
  await assert.rejects(fetch(restored.endpoint),/fetch failed|ECONNREFUSED/);
});

test('independent project grants survive elapsed time but never survive revocation or process stop',async t=>{
  const f=fixture(t),a=await f.project('early'),b=await f.project('later');
  const first=await f.transport.start(a);
  f.advance(25*60_000);
  const second=f.transport.addProject(b);
  f.advance(6*60_000);
  assert.deepEqual(f.transport.status().scopes,[a,b]);
  assert.equal((await request(first.endpoint,first.token,null,initialize)).status,200);
  assert.equal((await request(second.endpoint,second.token,null,initialize)).status,200);
  f.advance(180*24*60*60_000);
  assert.equal(f.transport.status().running,true);
  assert.equal((await request(first.endpoint,first.token,null,initialize)).status,200);
  assert.equal((await request(second.endpoint,second.token,null,initialize)).status,200);
  const removed=await f.transport.revokeProject(a);
  assert.deepEqual(removed.scopes,[b]);
  assert.equal((await request(first.endpoint,first.token,null,initialize)).status,401);
  assert.equal((await request(second.endpoint,second.token,null,initialize)).status,200);
  await f.transport.stop();
  assert.equal(f.transport.status().running,false);
  await assert.rejects(fetch(second.endpoint),/fetch failed|ECONNREFUSED/);
});
