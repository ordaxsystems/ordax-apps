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
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'forge-loopback-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const context={actorId:'owner',clientId:'desktop',workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,
    fileBroker:new ForgeProjectFiles({root:path.join(temp,'files')}),
    authorize:({context:who})=>who===context});
  const makeProject=async nonce=>(await service.invoke(context,'project_quick_create',
    {creationNonce:nonce,requestId:'request_'+nonce})).result.projectId;
  let now=Date.now();
  const transport=createForgeLoopbackMcp({
    createMcp:({projectId,allowedOperations})=>createOrchestratorMcp({
      service,getContext:()=>context,allowedProjectId:projectId,allowedOperations}),
    authorizeProject:projectId=>{
      try{service.requireAccess(context,'project_file_read',projectId);return true;}
      catch{return false;}
    },clock:()=>now
  });
  t.after(()=>transport.stop());
  return {store,service,context,transport,makeProject,advance:delta=>{now+=delta;}};
}
async function rpc(url,token,session,message,extra={}) {
  const response=await fetch(url,{method:'POST',headers:{
    Authorization:'Bearer '+token,'Content-Type':'application/json',
    ...(session?{'Mcp-Session-Id':session}:{}),...extra
  },body:JSON.stringify(message)});
  const text=await response.text();
  return {status:response.status,session:response.headers.get('mcp-session-id'),
    payload:text?JSON.parse(text):null};
}
const initialize={jsonrpc:'2.0',id:1,method:'initialize',params:{
  protocolVersion:'2025-06-18',clientInfo:{name:'forge-test',version:'1'},capabilities:{}
}};
const notify={jsonrpc:'2.0',method:'notifications/initialized'};
const call=(id,name,args)=>({jsonrpc:'2.0',id,method:'tools/call',
  params:{name:'orchestrator_'+name,arguments:args}});
test('loopback MCP requires explicit token and keeps tools inside one project',async t=>{
  const f=fixture(t);
  const a=await f.makeProject('transport_a'),b=await f.makeProject('transport_b');
  assert.equal(f.transport.status().running,false);
  const ready=await f.transport.start(a);
  assert.equal(ready.running,true);
  assert.equal(ready.loopbackOnly,true);
  assert.equal(ready.remoteChatGptConnected,false);
  const {endpoint,token}=ready;
  const missing=await rpc(endpoint,'wrong',null,initialize);
  assert.equal(missing.status,401);
  const web=await rpc(endpoint,token,null,initialize,{'Origin':'https://evil.example'});
  assert.equal(web.status,403);
  const init=await rpc(endpoint,token,null,initialize);
  assert.equal(init.status,200);
  assert.match(init.session,/^[0-9a-f-]{36}$/);
  assert.match(init.payload.result.instructions,new RegExp(a));
  const before=await rpc(endpoint,token,init.session,call(2,'project_files_list',{projectId:a}));
  assert.equal(before.payload.error.code,-32002);
  const initialized=await rpc(endpoint,token,init.session,notify);
  assert.equal(initialized.status,202);
  const listed=await rpc(endpoint,token,init.session,{jsonrpc:'2.0',id:3,method:'tools/list'});
  const tools=listed.payload.result.tools.map(t=>t.name);
  assert.ok(tools.includes('orchestrator_project_file_write'));
  assert.ok(!tools.includes('orchestrator_project_delete'));
  assert.ok(!tools.includes('orchestrator_work_send'));
  assert.ok(!tools.includes('orchestrator_forjador_send'));
  assert.ok(!tools.includes('orchestrator_projects_list'));
  const other=await rpc(endpoint,token,init.session,call(4,'project_files_status',{projectId:b}));
  assert.equal(other.payload.error.code,-32602);
  const wrote=await rpc(endpoint,token,init.session,call(5,'project_file_write',{
    projectId:a,path:'index.html',content:'<main>Forge real</main>',requestId:'mcp_write_1'
  }));
  assert.equal(wrote.payload.result.structuredContent.status,'succeeded');
  const content=await rpc(endpoint,token,init.session,call(6,'project_file_read',{projectId:a,path:'index.html'}));
  assert.equal(content.payload.result.structuredContent.content,'<main>Forge real</main>');
  const repeat=await rpc(endpoint,token,init.session,call(7,'project_file_write',{
    projectId:a,path:'index.html',content:'<main>Forge real</main>',requestId:'mcp_write_1'
  }));
  assert.equal(repeat.payload.result.structuredContent.commandId,
    wrote.payload.result.structuredContent.commandId);
  const denied=await rpc(endpoint,token,init.session,call(8,'project_delete',{projectId:a}));
  assert.equal(denied.payload.error.code,-32602);
  const invalid=await rpc(endpoint,token,'00000000-0000-0000-0000-000000000000',
    call(9,'project_files_status',{projectId:a}));
  assert.equal(invalid.status,404);
  const closed=await fetch(endpoint,{method:'DELETE',headers:{
    Authorization:'Bearer '+token,'Mcp-Session-Id':init.session
  }});
  assert.equal(closed.status,200);
  await f.transport.stop();
  assert.equal(f.transport.status().running,false);
  await assert.rejects(fetch(endpoint),/fetch failed|ECONNREFUSED/);
});

test('local MCP remains usable beyond 30 minutes until explicit revocation or Forge shutdown',async t=>{
  const f=fixture(t);
  const a=await f.makeProject('transport_continuity');
  const ready=await f.transport.start(a);
  const init=await rpc(ready.endpoint,ready.token,null,initialize);
  await rpc(ready.endpoint,ready.token,init.session,notify);
  f.advance(31*60_000);
  let alive=await rpc(ready.endpoint,ready.token,init.session,
    call(2,'project_files_status',{}));
  assert.equal(alive.status,200);
  f.advance(100*24*60*60_000);
  alive=await rpc(ready.endpoint,ready.token,init.session,
    call(3,'project_files_status',{}));
  assert.equal(alive.status,200);
  assert.equal(f.transport.status().running,true);
  assert.equal(f.transport.status().expiresAt,null);
  assert.equal(f.transport.status().tokenPersisted,false);
  assert.equal(f.transport.status().authorizationLifetime,'until_revoke_or_forge_exit');
  await f.transport.revokeProject(a);
  assert.equal(f.transport.status().running,false);
  await assert.rejects(fetch(ready.endpoint),/fetch failed|ECONNREFUSED/);
});

test('Forge MCP discovers its own rules, authorized project and live state without a prompt or projectId argument',async t=>{
  const f=fixture(t);
  const projectId=await f.makeProject('self_discover');
  const started=await f.transport.start(projectId);
  const session=(await rpc(started.endpoint,started.token,null,initialize)).session;
  await rpc(started.endpoint,started.token,session,notify);
  const tools=(await rpc(started.endpoint,started.token,session,
    {jsonrpc:'2.0',id:11,method:'tools/list'})).payload.result.tools;
  const discover=tools.find(tool=>tool.name==='orchestrator_forge_discover');
  assert.ok(discover,'Forge must advertise a first-party live capability discovery tool');
  assert.deepEqual(discover.inputSchema.required,[]);
  assert.ok(!Object.hasOwn(discover.inputSchema.properties,'projectId'));
  const fileWrite=tools.find(tool=>tool.name==='orchestrator_project_file_write');
  assert.ok(!Object.hasOwn(fileWrite.inputSchema.properties,'projectId'));
  assert.ok(!fileWrite.inputSchema.required.includes('projectId'));
  const reply=await rpc(started.endpoint,started.token,session,call(12,'forge_discover',{}));
  const live=reply.payload.result.structuredContent;
  assert.equal(live.projectId,projectId);
  assert.equal(live.workspace.selection,'owned_by_forge_not_by_gpt');
  assert.equal(live.workspace.requiresPathInUserPrompt,false);
  assert.equal(live.workspace.privateFileWriteAvailable,true);
  assert.equal(live.workspace.externalFolderWriteAvailable,false);
  assert.equal(live.verification.modelReplyIsFileProof,false);
  assert.equal(live.projectState.repositoryAccessVerified,false);
  const resources=(await rpc(started.endpoint,started.token,session,
    {jsonrpc:'2.0',id:13,method:'resources/list'})).payload.result.resources;
  assert.deepEqual(resources.map(resource=>resource.uri),[
    'forge://app/guide','forge://project/current']);
  const guide=(await rpc(started.endpoint,started.token,session,{
    jsonrpc:'2.0',id:14,method:'resources/read',params:{uri:'forge://app/guide'}
  })).payload.result.contents[0];
  assert.equal(guide.mimeType,'application/json');
  assert.match(JSON.parse(guide.text).instructions,/do not/i);
  const current=(await rpc(started.endpoint,started.token,session,{
    jsonrpc:'2.0',id:15,method:'resources/read',params:{uri:'forge://project/current'}
  })).payload.result.contents[0];
  assert.equal(JSON.parse(current.text).projectId,projectId);
  const write=await rpc(started.endpoint,started.token,session,
    call(16,'project_file_write',{path:'site/index.html',
      content:'<html><title>Café</title></html>',requestId:'self_doc_write'}));
  assert.equal(write.payload.result.structuredContent.status,'succeeded');
  const now=await rpc(started.endpoint,started.token,session,call(17,'forge_discover',{}));
  assert.equal(now.payload.result.structuredContent.workspace.appPrivate.exists,true);
  const read=await rpc(started.endpoint,started.token,session,
    call(18,'project_file_read',{path:'site/index.html'}));
  assert.equal(read.payload.result.structuredContent.content,'<html><title>Café</title></html>');
  const other=await f.makeProject('self_discover_other');
  const denied=await rpc(started.endpoint,started.token,session,
    call(19,'forge_discover',{projectId:other}));
  assert.equal(denied.payload.error.code,-32602);
  const unknown=await rpc(started.endpoint,started.token,session,{
    jsonrpc:'2.0',id:20,method:'resources/read',params:{uri:'forge://computer/secrets'}
  });
  assert.equal(unknown.payload.error.code,-32002);
});
