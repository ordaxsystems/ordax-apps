import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {ForgeProjectFiles} from '../src/forge-project-files.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {validateOrchestratorInput} from '../src/forge-contract.mjs';
import {createOrchestratorMcp} from '../src/orchestrator-mcp.mjs';

function fixture(t) {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'forge-project-file-test-'));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const broker=new ForgeProjectFiles({root:path.join(base,'private')});
  const store=new Store(':memory:');t.after(()=>store.close());
  const context={actorId:'owner',clientId:'desktop',workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,fileBroker:broker,authorize:({context:c})=>c===context});
  let next=0;
  const call=(op,input,requestId)=>service.invoke(context,op,{
    ...(!['project_files_status','project_files_list','project_file_read','projects_list'].includes(op)
      ?{requestId:requestId||'file_'+(++next)}:{}),...input});
  return {base,broker,store,context,service,call};
}

test('MCP writes real isolated UTF-8 file with SHA readback, receipts and exact contents',async t=>{
  const {broker,store,service,context,call}=fixture(t);
  const project=(await call('project_quick_create',{creationNonce:'file_create'})).result;
  const projectId=project.projectId;
  const before=await call('project_files_status',{projectId});
  assert.equal(before.mode,'app_isolated_workspace');
  assert.equal(before.exists,false);
  const value='  <h1>Olá, café</h1>\n\n';
  const created=await call('project_file_write',{projectId,path:'src/index.html',content:value},'first_write');
  assert.equal(created.status,'succeeded');
  assert.equal(created.result.created,true);
  assert.equal(created.result.verified,true);
  assert.equal(created.result.source,'forge_app_private_workspace');
  const read=await call('project_file_read',{projectId,path:'src/index.html'});
  assert.equal(read.content,value);
  assert.equal(read.sha256,created.result.sha256);
  const entries=await call('project_files_list',{projectId,directory:'src'});
  assert.deepEqual(entries.entries.map(x=>x.name),['index.html']);
  const receipt=await call('project_file_write',{projectId,path:'src/index.html',content:value},'first_write');
  assert.equal(receipt.commandId,created.commandId);
  const replaced=await call('project_file_write',{projectId,path:'src/index.html',
    content:'<p>Nova versão</p>',expectedSha256:created.result.sha256},'second_write');
  assert.equal(replaced.status,'succeeded');
  assert.equal(replaced.result.created,false);
  assert.equal((await call('project_file_read',{projectId,path:'src/index.html'})).content,
    '<p>Nova versão</p>');
  await assert.rejects(call('project_file_write',{projectId,path:'src/index.html',
    content:'overwrite without hash'},'unconditional'),/forge_file_version_conflict/);
  const failure=store.db.prepare('SELECT status FROM lab_command_receipts WHERE request_id=?')
    .get('unconditional');
  assert.equal(failure.status,'failed');
  assert.equal((await call('project_file_read',{projectId,path:'src/index.html'})).sha256,
    replaced.result.sha256);
  await assert.rejects(service.invoke({...context,actorId:'intruder'},'project_file_read',
    {projectId,path:'src/index.html'}),/orchestrator_access_denied/);
  const mcp=createOrchestratorMcp({service,getContext:()=>context});
  await mcp.handle({jsonrpc:'2.0',id:1,method:'initialize',
    params:{protocolVersion:'2025-06-18',clientInfo:{name:'test',version:'1'},capabilities:{}}});
  await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const tools=await mcp.handle({jsonrpc:'2.0',id:2,method:'tools/list'});
  assert.ok(tools.result.tools.some(t=>t.name==='forge_project_file_write'));
  assert.ok(!tools.result.tools.some(t=>t.name==='forge_forjador_send'));
  assert.ok(fs.existsSync(path.join(broker.root,projectId,'src','index.html')));
});

test('file broker rejects traversal, reserved names, other projects and arbitrary paths',async t=>{
  const {base,broker,call}=fixture(t);
  const project=(await call('project_quick_create',{creationNonce:'scope_file_a'})).result.projectId;
  const foreign=(await call('project_quick_create',{creationNonce:'scope_file_b'})).result.projectId;
  fs.writeFileSync(path.join(base,'outside.txt'),'untouched');
  for(const target of ['../outside.txt','/outside.txt','C:/outside.txt',
    'a/../outside.txt','a\\..\\outside.txt','CON','src/NUL.txt','a//file','file.',
    'file ','foo:bar','.git/config']){
    await assert.rejects(call('project_file_write',{projectId:project,path:target,content:'bad'}),
      /forge_file_path_invalid|orchestrator_invalid_input/,target);
  }
  await call('project_file_write',{projectId:project,path:'docs/README.txt',content:'A'});
  assert.equal((await call('project_files_status',{projectId:foreign})).exists,false);
  await assert.rejects(call('project_file_read',{projectId:foreign,
    path:'docs/README.txt'}),/forge_file_not_found/);
  assert.equal(fs.readFileSync(path.join(base,'outside.txt'),'utf8'),'untouched');
  await assert.rejects(call('project_file_write',{projectId:project,
    path:'docs/oversized.txt',content:'x'.repeat(65537)}),
    /forge_file_size_limit|orchestrator_invalid_input/);
  const root=path.join(broker.root,project);
  const outside=path.join(base,'outside');
  fs.mkdirSync(outside);
  let junction=false;
  try{fs.symlinkSync(outside,path.join(root,'junction'),process.platform==='win32'?'junction':'dir');junction=true;}
  catch(e){if(!['EPERM','EACCES','ENOSYS'].includes(e.code))throw e;}
  if(junction){
    await assert.rejects(call('project_file_write',{projectId:project,
      path:'junction/escape.txt',content:'malicious'}),/forge_file_reparse_denied/);
    assert.equal(fs.existsSync(path.join(outside,'escape.txt')),false);
  }
});

test('missing owner-bound folder is a definitive rejected write, not an uncertain disk effect',async t=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'forge-missing-owner-folder-'));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const store=new Store(':memory:');t.after(()=>store.close());
  const context={actorId:'owner',clientId:'desktop',workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,
    fileBroker:new ForgeProjectFiles({
      root:path.join(base,'private'),workspaceLookup:()=>null,requireOwnerBinding:true
    }),authorize:({context:c})=>c===context});
  const project=(await service.invoke(context,'project_quick_create',{
    creationNonce:'missing_owner_binding',requestId:'missing_owner_project'
  })).result.projectId;
  await assert.rejects(service.invoke(context,'project_file_write',{
    projectId:project,path:'index.html',content:'must not appear',
    requestId:'missing_owner_file_write'
  }),/forge_workspace_binding_required/);
  const receipt=store.db.prepare('SELECT status,result FROM lab_command_receipts WHERE request_id=?')
    .get('missing_owner_file_write');
  assert.equal(receipt.status,'failed','pre-effect rejection must not stay uncertain');
  assert.equal(JSON.parse(receipt.result).reason,'forge_workspace_binding_required');
  assert.equal(fs.existsSync(path.join(base,'private',project,'index.html')),false);
  assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('file receipts survive process restart; interrupted writes remain non-replayable',async t=>{
  // Canonicalize the temp root: Windows CI may mount RUNNER_TEMP via a junction.
  const base=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'forge-file-restart-')));
  let store=null;
  t.after(()=>{
    try{store?.close();}finally{
      fs.rmSync(base,{recursive:true,force:true,maxRetries:8,retryDelay:100});
    }
  });
  const dbFile=path.join(base,'forge.sqlite');
  const ownerFolder=path.join(base,'owner-project');
  fs.mkdirSync(ownerFolder);
  const bindings=new Map();
  const open=()=>{
    store=new Store(dbFile);
    const context={actorId:'owner',clientId:'desktop',
      workspaceSessionId:store.getWorkspaceSession().id};
    const files=new ForgeProjectFiles({root:path.join(base,'private'),
      workspaceLookup:id=>bindings.get(id)||null,requireOwnerBinding:true});
    const service=new OrchestratorService({store,fileBroker:files,
      authorize:({context:who})=>who===context});
    return {store,context,files,service};
  };
  let {context,service}=open();
  const project=(await service.invoke(context,'project_quick_create',{
    creationNonce:'durable_project',requestId:'durable_project_create'
  })).result.projectId;
  bindings.set(project,ownerFolder);
  const good={projectId:project,path:'index.html',content:'<h1>Durable Forge</h1>',
    requestId:'durable_file_write'};
  const successful=await service.invoke(context,'project_file_write',good);
  assert.equal(successful.status,'succeeded');
  assert.equal(successful.result.verified,true);
  store.close();store=null;
  ({context,service}=open());
  assert.equal(service.recoverInterruptedCommands(),0);
  const persisted=service.getReceipt(context,successful.commandId);
  assert.equal(persisted.status,'succeeded');
  const duplicate=await service.invoke(context,'project_file_write',good);
  assert.equal(duplicate.commandId,successful.commandId);
  assert.equal(duplicate.status,'succeeded');
  assert.equal(service.read(context,'project_file_read',{projectId:project,path:'index.html'}).sha256,
    successful.result.sha256);
  assert.deepEqual(fs.readdirSync(ownerFolder),['index.html']);

  // Simulate power loss precisely after a durable reservation, BEFORE the
  // filesystem effect. Recovery must not infer or manufacture success.
  const interrupted={projectId:project,path:'interrupted.html',
    content:'must not be created',requestId:'durable_interrupted_write'};
  const validated=validateOrchestratorInput('project_file_write',interrupted).input;
  service.transaction(()=>service.reserve(context,'project_file_write',validated));
  store.close();store=null;
  ({context,service}=open());
  assert.equal(service.recoverInterruptedCommands(),1);
  const replay=await service.invoke(context,'project_file_write',interrupted);
  assert.equal(replay.status,'uncertain');
  assert.equal(replay.requiresReconciliation,true);
  assert.equal(fs.existsSync(path.join(ownerFolder,'interrupted.html')),false);
  assert.equal(service.read(context,'project_file_read',{projectId:project,path:'index.html'}).sha256,
    successful.result.sha256);
  assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
