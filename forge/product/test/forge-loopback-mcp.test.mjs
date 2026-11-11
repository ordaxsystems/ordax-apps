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

function fixture(t,{onProjectFileChanged=()=>{}}={}) {
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
    },clock:()=>now,onProjectFileChanged
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
  params:{name:name.startsWith('forge_')?name:'forge_'+name,arguments:args}});
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
  assert.ok(tools.includes('forge_project_file_write'));
  assert.ok(!tools.includes('forge_project_delete'));
  assert.ok(!tools.includes('forge_work_send'));
  assert.ok(!tools.includes('forge_forjador_send'));
  assert.ok(!tools.includes('forge_projects_list'));
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

test('authorized MCP file writes notify owner UI after receipt, without exposing data',async t=>{
  const changed=[];
  const f=fixture(t,{onProjectFileChanged:id=>changed.push(id)});
  const projectId=await f.makeProject('preview_changed');
  const ready=await f.transport.start(projectId);
  const initial=await rpc(ready.endpoint,ready.token,null,initialize);
  await rpc(ready.endpoint,ready.token,initial.session,notify);
  const good=await rpc(ready.endpoint,ready.token,initial.session,
    call(20,'project_file_write',{path:'index.html',content:'<!doctype html><h1>Updated</h1>',
      requestId:'preview_index_1'}));
  assert.equal(good.payload.result.structuredContent.status,'succeeded');
  assert.deepEqual(changed,[projectId]);
  const other=await rpc(ready.endpoint,ready.token,initial.session,
    call(21,'project_file_write',{path:'assets/css.css',content:'h1{color:green}',
      requestId:'preview_css_1'}));
  assert.equal(other.payload.result.structuredContent.status,'succeeded');
  assert.deepEqual(changed,[projectId,projectId]);
  const invalid=await rpc(ready.endpoint,ready.token,initial.session,
    call(22,'project_file_write',{projectId:'project_other',path:'index.html',
      content:'invalid',requestId:'preview_wrong_project'}));
  assert.equal(invalid.payload.error.code,-32602);
  assert.deepEqual(changed,[projectId,projectId]);
  const unknown=await rpc(ready.endpoint,'wrong',initial.session,
    call(23,'project_file_write',{path:'index.html',content:'invalid',requestId:'bad_token'}));
  assert.equal(unknown.status,401);
  assert.deepEqual(changed,[projectId,projectId]);
});

test('real HTTP MCP exposes scoped work identity and messages without allowing cross-project reads',async t=>{
  const f=fixture(t);
  const a=(await f.service.invoke(f.context,'mission_create',{
    requestId:'work_scope_a',name:'Project A',mission:'Create site A'
  })).result;
  const b=(await f.service.invoke(f.context,'mission_create',{
    requestId:'work_scope_b',name:'Project B',mission:'Create site B'
  })).result;
  const ready=await f.transport.start(a.projectId);
  const init=await rpc(ready.endpoint,ready.token,null,initialize);
  assert.equal(init.status,200);
  assert.match(init.payload.result.instructions,/forge_work_list/);
  assert.doesNotMatch(init.payload.result.instructions,/orchestrator_forge_discover/);
  await rpc(ready.endpoint,ready.token,init.session,notify);
  const tools=(await rpc(ready.endpoint,ready.token,init.session,
    {jsonrpc:'2.0',id:60,method:'tools/list'})).payload.result.tools;
  for(const name of ['forge_work_list','forge_work_get','forge_work_messages']){
    const tool=tools.find(item=>item.name===name);
    assert.ok(tool,'typed project work read missing: '+name);
    assert.equal(tool.annotations.readOnlyHint,true);
    assert.ok(!Object.hasOwn(tool.inputSchema.properties,'projectId'));
  }
  const list=await rpc(ready.endpoint,ready.token,init.session,call(61,'work_list',{}));
  assert.equal(list.status,200);
  assert.equal(list.payload.result.structuredContent.works.length,1);
  assert.equal(list.payload.result.structuredContent.works[0].id,a.taskId);
  const work=await rpc(ready.endpoint,ready.token,init.session,
    call(62,'work_get',{taskId:a.taskId}));
  assert.equal(work.payload.result.structuredContent.id,a.taskId);
  const messages=await rpc(ready.endpoint,ready.token,init.session,
    call(63,'work_messages',{taskId:a.taskId,limit:10}));
  assert.equal(messages.status,200);
  assert.ok(Array.isArray(messages.payload.result.structuredContent.messages));
  const forbidden=await rpc(ready.endpoint,ready.token,init.session,
    call(64,'work_get',{taskId:b.taskId}));
  assert.equal(forbidden.payload.result.isError,true);
  assert.ok(!JSON.stringify(forbidden.payload).includes('Create site B'));
  const spoofed=await rpc(ready.endpoint,ready.token,init.session,
    call(65,'work_list',{projectId:b.projectId}));
  assert.equal(spoofed.payload.error.code,-32602);
});

test('MCP reclaims abandoned sessions only when full and preserves active sessions and grants',async t=>{
  const f=fixture(t);
  const projectId=await f.makeProject('session_slots');
  const ready=await f.transport.start(projectId);
  const sessions=[];
  for(let i=0;i<64;i++){
    const start=await rpc(ready.endpoint,ready.token,null,{...initialize,id:100+i});
    assert.equal(start.status,200);
    assert.ok(start.session);
    sessions.push(start.session);
  }
  assert.equal(f.transport.status().sessions,64);
  // Never displace a recent/active session just because a 65th client asks.
  const full=await rpc(ready.endpoint,ready.token,null,{...initialize,id:199});
  assert.equal(full.status,409);
  assert.equal(full.payload.error,'forge_mcp_session_limit');
  f.advance(45*60_000);
  const active=await rpc(ready.endpoint,ready.token,sessions[0],notify);
  assert.equal(active.status,202);
  f.advance(20*60_000);
  const replacement=await rpc(ready.endpoint,ready.token,null,{...initialize,id:200});
  assert.equal(replacement.status,200,'reclaims long-idle orphaned sessions');
  assert.equal(f.transport.status().sessions,2);
  const preserved=await rpc(ready.endpoint,ready.token,sessions[0],{
    jsonrpc:'2.0',id:201,method:'tools/list'
  });
  assert.equal(preserved.status,200,'actively used client survives capacity pressure');
  const missing=await rpc(ready.endpoint,ready.token,sessions[1],{
    jsonrpc:'2.0',id:202,method:'tools/list'
  });
  assert.equal(missing.status,404,'abandoned session no longer has authority');
  assert.equal(f.transport.status().running,true);
  assert.equal(f.transport.status().expiresAt,null);
  const newlyActive=await rpc(ready.endpoint,ready.token,replacement.session,notify);
  assert.equal(newlyActive.status,202);
});

test('parallel MCP handshakes respect the 64-session capacity without oversubscription',async t=>{
  const f=fixture(t);
  const projectId=await f.makeProject('parallel_session_slots');
  const ready=await f.transport.start(projectId);
  const responses=await Promise.all(Array.from({length:96},(_,i)=>
    rpc(ready.endpoint,ready.token,null,{...initialize,id:300+i})));
  assert.equal(responses.filter(result=>result.status===200).length,64);
  assert.equal(responses.filter(result=>result.status===409&&
    result.payload.error==='forge_mcp_session_limit').length,32);
  assert.equal(f.transport.status().sessions,64);
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
  const discover=tools.find(tool=>tool.name==='forge_discover');
  assert.ok(discover,'Forge must advertise a first-party live capability discovery tool');
  assert.deepEqual(discover.inputSchema.required,[]);
  assert.ok(!Object.hasOwn(discover.inputSchema.properties,'projectId'));
  const fileWrite=tools.find(tool=>tool.name==='forge_project_file_write');
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

test('parallel start requests cannot create an orphaned MCP listener',async t=>{
  const f=fixture(t);
  const a=await f.makeProject('parallel_start_a');
  const b=await f.makeProject('parallel_start_b');
  const first=f.transport.start(a);
  const second=f.transport.start(b);
  await assert.rejects(second,/forge_mcp_start_in_progress/);
  const started=await first;
  assert.equal(started.scope,a);
  assert.deepEqual(f.transport.status().scopes,[a]);
  const init=await rpc(started.endpoint,started.token,null,initialize);
  assert.equal(init.status,200);
  await f.transport.stop();
  assert.equal(f.transport.status().running,false);
  await assert.rejects(fetch(started.endpoint),/fetch failed|ECONNREFUSED/);
  const newStart=await f.transport.start(b);
  assert.deepEqual(newStart.scopes,[b]);
  await f.transport.stop();
});

test('stop during pending MCP listen cancels startup without restoring access',async t=>{
  const f=fixture(t);
  const a=await f.makeProject('cancel_start_a');
  const start=f.transport.start(a);
  const stopped=f.transport.stop();
  await assert.rejects(start,/forge_mcp_start_cancelled/);
  await stopped;
  assert.equal(f.transport.status().running,false);
  assert.deepEqual(f.transport.status().scopes,[]);
  const restarted=await f.transport.start(a);
  assert.equal(restarted.running,true);
  await f.transport.stop();
});

test('a late MCP result cannot leak after the owner revokes a project',async t=>{
  const projectId='project_delayed-revocation';
  let release,entered;
  const inside=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const transport=createForgeLoopbackMcp({
    authorizeProject:project=>project===projectId,
    createMcp:()=>({handle:async()=>{
      entered();
      await gate;
      return {jsonrpc:'2.0',id:1,result:{protocolVersion:'2025-06-18',
        secret:'must_never_escape_after_revoke'}};
    }})
  });
  t.after(()=>transport.stop());
  const started=await transport.start(projectId);
  const pending=rpc(started.endpoint,started.token,null,initialize);
  await inside;
  const revoking=transport.revokeProject(projectId);
  release();
  // Immediate owner revocation can close the socket before sending 403.
  // Both outcomes are fail-closed: no delayed result reaches the caller.
  const reply=await pending.catch(error=>{
    assert.match(String(error),/fetch failed|socket|closed/i);
    return null;
  });
  await revoking;
  if(reply){
    assert.equal(reply.status,403);
    assert.equal(reply.payload.error,'forge_mcp_project_revoked');
  }
  assert.equal(JSON.stringify(reply).includes('must_never_escape'),false);
  assert.equal(transport.status().running,false);
  assert.equal(transport.status().sessions,0);
});

test('closing an MCP session cancels an in-flight reply on that session',async t=>{
  const projectId='project_closed-session-response';
  let release,entered;
  const inside=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const transport=createForgeLoopbackMcp({
    authorizeProject:project=>project===projectId,
    createMcp:()=>({handle:async message=>{
      if(message.method==='initialize')
        return {jsonrpc:'2.0',id:message.id,result:{protocolVersion:'2025-06-18'}};
      if(message.method==='tools/call'){
        entered();
        await gate;
        return {jsonrpc:'2.0',id:message.id,
          result:{secret:'must_never_escape_after_session_delete'}};
      }
      return null;
    }})
  });
  t.after(()=>transport.stop());
  const started=await transport.start(projectId);
  const handshake=await rpc(started.endpoint,started.token,null,initialize);
  assert.equal(handshake.status,200);
  assert.ok(handshake.session);
  const pending=rpc(started.endpoint,started.token,handshake.session,
    call(99,'project_file_read',{path:'index.html'}));
  await inside;
  const closed=await fetch(started.endpoint,{
    method:'DELETE',headers:{
      Authorization:'Bearer '+started.token,
      'Mcp-Session-Id':handshake.session
    }
  });
  assert.equal(closed.status,200);
  // Session DELETE must not revoke this project's independently authorized
  // transport; another handshake can proceed while the old call is pending.
  const next=await rpc(started.endpoint,started.token,null,initialize);
  assert.equal(next.status,200);
  assert.notEqual(next.session,handshake.session);
  release();
  const reply=await pending;
  assert.equal(reply.status,404);
  assert.equal(reply.payload.error,'forge_mcp_session_unavailable');
  assert.equal(JSON.stringify(reply).includes('must_never_escape'),false);
  assert.equal(transport.status().sessions,1);
});

test('disabling MCP closes an unresponsive active HTTP request promptly',async t=>{
  const projectId='project_shutdown-long-call';
  let release,entered;
  const inside=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const transport=createForgeLoopbackMcp({
    authorizeProject:project=>project===projectId,
    createMcp:()=>({handle:async message=>{
      if(message.method==='initialize')
        return {jsonrpc:'2.0',id:message.id,result:{protocolVersion:'2025-06-18'}};
      if(message.method==='tools/call'){
        entered();
        await gate;
        return {jsonrpc:'2.0',id:message.id,result:{secret:'late-after-stop'}};
      }
      return null;
    }})
  });
  t.after(()=>transport.stop());
  const started=await transport.start(projectId);
  const handshake=await rpc(started.endpoint,started.token,null,initialize);
  const pending=rpc(started.endpoint,started.token,handshake.session,
    call(112,'project_file_read',{path:'index.html'})).catch(()=>null);
  await inside;
  const shuttingDown=transport.stop();
  const completed=await Promise.race([
    shuttingDown.then(()=>true),
    new Promise(resolve=>setTimeout(()=>resolve(false),1000))
  ]);
  // Release the fake long-running task in either case so test teardown
  // cannot leave a listener or an unresolved promise behind.
  release();
  const reply=await pending;
  await shuttingDown;
  assert.equal(completed,true,'owner_stop_waited_for_unresponsive_mcp_tool');
  assert.equal(reply?.payload?.result?.secret,undefined);
  assert.equal(transport.status().running,false);
  assert.equal(transport.status().sessions,0);
});
