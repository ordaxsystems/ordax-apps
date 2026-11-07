import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {ForgeProjectFiles} from '../src/forge-project-files.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
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
