import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {ForgeProjectFiles} from '../src/forge-project-files.mjs';
import {createOrchestratorMcp} from '../src/orchestrator-mcp.mjs';
import {createForgeLoopbackMcp,FORGE_APP_MCP_SCOPE} from '../src/forge-loopback-mcp.mjs';

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
  const scopeRevisions=new Map();
  const transport=createForgeLoopbackMcp({
    createMcp:({projectId,allowedOperations})=>createOrchestratorMcp({
      service,getContext:()=>context,allowedProjectId:projectId,allowedOperations}),
    authorizeProject:projectId=>{
      if(projectId===revoked)return false;
      try{service.requireAccess(context,'project_file_read',projectId);return true;}
      catch{return false;}
    },
    projectScope:projectId=>scopeRevisions.get(projectId)??projectId,
    clock:()=>now
  });
  t.after(()=>transport.stop());
  const project=async name=>(await service.invoke(context,'project_quick_create',
    {creationNonce:name,requestId:'req_'+name})).result.projectId;
  return {transport,project,files,advance:ms=>{now+=ms;},
    changeVerifiedScope:(id,scope)=>scopeRevisions.set(id,scope),
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
  params:{name:name.startsWith('forge_')?name:'forge_'+name,arguments:args}});

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


test('workspace rebinding never revives old MCP tokens even after a new owner approval',async t=>{
  const f=fixture(t),a=await f.project('rebind_a'),b=await f.project('rebind_b');
  const first=await f.transport.start(a);
  const second=f.transport.addProject(b);
  const initA=await request(first.endpoint,first.token,null,initialize);
  const initB=await request(second.endpoint,second.token,null,initialize);
  assert.equal(initA.status,200);
  assert.equal(initB.status,200);
  await request(first.endpoint,first.token,initA.session,notify);
  await request(second.endpoint,second.token,initB.session,notify);
  // Owner replaces the verified folder; a later reapproval uses the same
  // project ID but must never restore access to the previous folder bearer.
  f.changeVerifiedScope(a,'sha256-new-owner-verified-workspace');
  assert.deepEqual(f.transport.status().scopes,[b]);
  assert.equal(f.transport.localGrant(a),null);
  assert.equal((await request(first.endpoint,first.token,initA.session,
    invoke(31,'forge_discover'))).status,401);
  const goodB=await request(second.endpoint,second.token,initB.session,
    invoke(32,'forge_discover'));
  assert.equal(goodB.body.result.structuredContent.projectId,b);
  // Explicit Owner approval creates a different grant for the new scope.
  const renewed=f.transport.addProject(a);
  assert.notEqual(renewed.token,first.token);
  assert.equal((await request(renewed.endpoint,first.token,null,initialize)).status,401);
  assert.equal((await request(renewed.endpoint,renewed.token,initA.session,
    invoke(33,'forge_discover'))).status,404);
  const initNew=await request(renewed.endpoint,renewed.token,null,initialize);
  assert.equal(initNew.status,200);
  await request(renewed.endpoint,renewed.token,initNew.session,notify);
  const newDiscovery=await request(renewed.endpoint,renewed.token,initNew.session,
    invoke(34,'forge_discover'));
  assert.equal(newDiscovery.body.result.structuredContent.projectId,a);
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

test('one app MCP token discovers projects and writes only verified owner folders',async t=>{
  // Production rejects reparse roots; test fixtures must use a physical root.
  const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'forge-app-global-mcp-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:75}));
  const store=new Store(':memory:');t.after(()=>store.close());
  const context={actorId:'owner',clientId:'desktop',workspaceSessionId:store.getWorkspaceSession().id};
  const bindings=new Map();
  const files=new ForgeProjectFiles({root:path.join(root,'private'),
    requireOwnerBinding:true,workspaceLookup:id=>bindings.get(id)||null});
  const service=new OrchestratorService({store,fileBroker:files,
    authorize:({context:c})=>c===context});
  const project=async name=>(await service.invoke(context,'project_quick_create',{
    creationNonce:name,requestId:'forge_app_'+name})).result.projectId;
  const a=await project('global_alpha'),b=await project('global_beta'),
    unbound=await project('global_unbound');
  for(const id of [a,b]){
    const folder=path.join(root,id);fs.mkdirSync(folder);
    bindings.set(id,folder);
  }
  let ownerApproved=false;
  const events=[];
  const transport=createForgeLoopbackMcp({
    createMcp:({projectId,allowedOperations})=>createOrchestratorMcp({
      service,getContext:()=>context,allowedProjectId:projectId,allowedOperations,
      authorizeFileRead:requestedId=>{
        try{return Boolean(files.boundRoot(requestedId));}
        catch{return false;}
      }
    }),
    authorizeProject:scope=>scope===FORGE_APP_MCP_SCOPE&&ownerApproved,
    projectScope:scope=>scope===FORGE_APP_MCP_SCOPE?'forge-dev-profile-identity':scope,
    onProjectFileChanged:projectId=>events.push(projectId)
  });
  t.after(()=>transport.stop());
  await assert.rejects(transport.start(FORGE_APP_MCP_SCOPE),/not_authorized/);
  ownerApproved=true; // only an explicit test grant; never grants production authority.
  const app=await transport.start(FORGE_APP_MCP_SCOPE);
  assert.equal(app.scope,FORGE_APP_MCP_SCOPE);
  assert.deepEqual(app.scopes,[FORGE_APP_MCP_SCOPE]);
  assert.equal(app.remoteChatGptConnected,false);
  assert.equal('token' in transport.status(),false);
  assert.throws(()=>transport.addProject(a),/forge_mcp_app_scope_exclusive/);
  const init=await request(app.endpoint,app.token,null,initialize);
  assert.equal(init.status,200);
  assert.match(init.body.result.instructions,/Forge/i);
  await request(app.endpoint,app.token,init.session,notify);
  const list=await request(app.endpoint,app.token,init.session,
    {jsonrpc:'2.0',id:2,method:'tools/list'});
  const tools=list.body.result.tools.map(tool=>tool.name);
  for(const tool of ['forge_projects_list','forge_project_file_write','forge_project_file_read'])
    assert.ok(tools.includes(tool),tool+' must be available on the app');
  // One Owner-approved app grant may create a new isolated local project;
  // project-scoped grants never gain this operation.
  assert.ok(tools.includes('forge_project_quick_create'));
  for(const tool of ['forge_project_delete','forge_forjador_send'])
    assert.ok(!tools.includes(tool),tool+' must not be exposed');
  const catalog=await request(app.endpoint,app.token,init.session,invoke(3,'projects_list'));
  assert.equal(catalog.body.result.structuredContent.projects.length,3);
  const writeA=await request(app.endpoint,app.token,init.session,
    invoke(4,'project_file_write',{projectId:a,path:'index.html',
      content:'<main>Alpha</main>',requestId:'app_global_write_alpha'}));
  const writeB=await request(app.endpoint,app.token,init.session,
    invoke(5,'project_file_write',{projectId:b,path:'index.html',
      content:'<main>Beta</main>',requestId:'app_global_write_beta'}));
  for(const written of [writeA,writeB]){
    assert.equal(written.body.result.structuredContent.status,'succeeded');
    assert.equal(written.body.result.structuredContent.result.verification,'sha256_readback');
  }
  assert.equal(files.read(a,'index.html').content,'<main>Alpha</main>');
  assert.equal(files.read(b,'index.html').content,'<main>Beta</main>');
  assert.deepEqual(events,[a,b]);
  const denied=await request(app.endpoint,app.token,init.session,
    invoke(6,'project_file_write',{projectId:unbound,path:'index.html',
      content:'denied',requestId:'app_global_unbound'}));
  assert.equal(denied.body.result.isError,true);
  const failed=store.db.prepare('SELECT status,result FROM lab_command_receipts WHERE request_id=?')
    .get('app_global_unbound');
  assert.equal(failed.status,'failed');
  assert.equal(JSON.parse(failed.result).reason,'forge_workspace_binding_required');
  assert.equal(fs.existsSync(path.join(root,'private',unbound,'index.html')),false);
  // Old Forge-private files remain readable to the trusted native UI for
  // migration, but an app-wide MCP token must not disclose those bytes.
  const legacy=path.join(root,'private',unbound);
  fs.mkdirSync(legacy,{recursive:true});
  fs.writeFileSync(path.join(legacy,'old.txt'),'legacy native-only content');
  assert.equal(files.read(unbound,'old.txt').content,'legacy native-only content');
  const leak=await request(app.endpoint,app.token,init.session,
    invoke(61,'project_file_read',{projectId:unbound,path:'old.txt'}));
  assert.equal(leak.body.result.isError,true);
  assert.equal(JSON.stringify(leak.body).includes('legacy native-only content'),false);
  const listing=await request(app.endpoint,app.token,init.session,
    invoke(62,'project_files_list',{projectId:unbound}));
  assert.equal(listing.body.result.isError,true);
  // New projects are Forge resources. No new MCP token or tunnel is created.
  const c=await project('global_new_after_start');
  const folderC=path.join(root,c);fs.mkdirSync(folderC);bindings.set(c,folderC);
  const writeC=await request(app.endpoint,app.token,init.session,
    invoke(7,'project_file_write',{projectId:c,path:'index.html',
      content:'<main>New project</main>',requestId:'app_global_write_new'}));
  assert.equal(writeC.body.result.structuredContent.status,'succeeded');
  assert.equal(transport.status().scopes.length,1);
  assert.equal(transport.localGrant(FORGE_APP_MCP_SCOPE).token,app.token);
  assert.deepEqual(events,[a,b,c]);
  ownerApproved=false;
  const revoked=await request(app.endpoint,app.token,init.session,invoke(8,'projects_list'));
  assert.equal(revoked.status,403); // Owner trust is checked for every request.
  assert.equal(transport.status().running,true); // Listener closes only on explicit stop.
  await transport.stop();
  assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
