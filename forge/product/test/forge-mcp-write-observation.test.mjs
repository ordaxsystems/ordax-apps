import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {ForgeProjectFiles} from '../src/forge-project-files.mjs';
import {createOrchestratorMcp} from '../src/orchestrator-mcp.mjs';
import {observeMcpFileWrite} from '../src/forge-mcp-write-observation.mjs';
import {forgeProjectFileReceiptView} from '../src/forge-project-file-receipts.mjs';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'forge-mcp-ingress-proof-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const context={actorId:'owner',clientId:'desktop',workspaceSessionId:store.getWorkspaceSession().id};
  const files=new ForgeProjectFiles({root:path.join(root,'files')});
  const service=new OrchestratorService({store,fileBroker:files,authorize:({context:who})=>who===context});
  let transport='remote_gateway';
  const mcp=createOrchestratorMcp({service,getContext:()=>context,afterToolInvoke:({operation,output})=>{
    observeMcpFileWrite({store,operation,output,ingress:transport});
    return output;
  }});
  const project=async nonce=>{
    const x=await service.invoke(context,'project_quick_create',{requestId:'create_'+nonce,creationNonce:'nonce_'+nonce});
    const projectId=x.result.projectId;
    await service.invoke(context,'orchestrator_create',{projectId,name:'Forjador',mission:'Atestar ingressos MCP',requestId:'owner_'+nonce});
    return projectId;
  };
  const call=async(id,operation,args)=>{
    const response=await mcp.handle({jsonrpc:'2.0',id,method:'tools/call',params:{
      name:'forge_'+operation,arguments:args}});
    return response?.result?.structuredContent;
  };
  return {store,service,context,files,mcp,project,call,
    setIngress:x=>{transport=x},
    view:id=>forgeProjectFileReceiptView(store,id,{limit:24}),
    events:()=>store.db.prepare("SELECT task_id,payload FROM events WHERE kind='forge.mcp.file_write_observed' ORDER BY seq").all()
  };
}

test('actual MCP tools/call proves only ingress of matching verified write; direct service call stays unattributed',async t=>{
  const f=fixture(t),p=await f.project('alpha');
  const ready=await f.mcp.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{
    protocolVersion:'2025-11-25',clientInfo:{name:'test',version:'1'},capabilities:{}
  }});
  assert.ok(ready.result?.protocolVersion);
  await f.mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const direct=await f.service.invoke(f.context,'project_file_write',{
    projectId:p,requestId:'direct_write',path:'direct.txt',content:'direct'});
  assert.equal(direct.status,'succeeded');
  assert.equal(f.view(p).items.find(x=>x.commandId===direct.commandId).mcpToolCallObserved,false);
  const first=await f.call(2,'project_file_write',{
    projectId:p,requestId:'mcp_write',path:'mcp.txt',content:'MCP verified'});
  assert.equal(first.status,'succeeded');
  const row=f.view(p).items.find(x=>x.commandId===first.commandId);
  assert.equal(row.historicalReadbackVerified,true);
  assert.equal(row.mcpToolCallObserved,true);
  assert.equal(row.mcpIngress,'remote_gateway');
  assert.equal(row.gptToolInvocationVerified,false);
  assert.equal(row.deviceBindingVerified,false);
  assert.equal(f.view(p).originAttribution,'not_provided_by_this_ledger');
  assert.equal(f.view(p).items.find(x=>x.commandId===direct.commandId).mcpToolCallObserved,false);
  assert.equal(f.events().length,1);
  assert.deepEqual(Object.keys(JSON.parse(f.events()[0].payload)).sort(),
    ['command_id','gpt_run_identity_verified','ingress','project_id','receipt_sha256'].sort());
  assert.ok(!JSON.stringify(f.events()).includes('MCP verified'));
  // Replaying requestId is a receipt read; no duplicate event or file mutation.
  const same=await f.call(3,'project_file_write',{
    projectId:p,requestId:'mcp_write',path:'mcp.txt',content:'MCP verified'});
  assert.equal(same.commandId,first.commandId);
  assert.equal(f.events().length,1);
  assert.equal(f.files.read(p,'mcp.txt').content,'MCP verified');
});

test('two independent MCP writes keep project scope, ingress and SHA isolated',async t=>{
  const f=fixture(t),a=await f.project('alpha'),b=await f.project('beta');
  await f.mcp.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{
    protocolVersion:'2025-11-25',clientInfo:{name:'test',version:'1'},capabilities:{}
  }});
  await f.mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const one=await f.call(2,'project_file_write',{projectId:a,requestId:'a',path:'a.txt',content:'a'});
  f.setIngress('owner_loopback');
  const two=await f.call(3,'project_file_write',{projectId:b,requestId:'b',path:'b.txt',content:'b'});
  assert.equal(f.view(a).items.length,1);
  assert.equal(f.view(b).items.length,1);
  assert.equal(f.view(a).items[0].commandId,one.commandId);
  assert.equal(f.view(b).items[0].commandId,two.commandId);
  assert.equal(f.view(a).items[0].mcpIngress,'remote_gateway');
  assert.equal(f.view(b).items[0].mcpIngress,'owner_loopback');
  assert.equal(f.events().length,2);
  assert.equal(f.view(a).items[0].gptToolInvocationVerified,false);
  assert.equal(f.view(b).items[0].gptToolInvocationVerified,false);
});

test('wrong SHA, forged state, missing owner and unknown transport fail closed',async t=>{
  const f=fixture(t),p=await f.project('alpha');
  const direct=await f.service.invoke(f.context,'project_file_write',{
    projectId:p,requestId:'no_ingress',path:'file.txt',content:'proof'});
  assert.equal(observeMcpFileWrite({store:f.store,operation:'project_file_write',
    output:{...direct,result:{...direct.result,sha256:'0'.repeat(64)}},
    ingress:'remote_gateway'}),false);
  assert.equal(observeMcpFileWrite({store:f.store,operation:'project_file_write',
    output:{...direct,status:'failed'},ingress:'remote_gateway'}),false);
  assert.equal(observeMcpFileWrite({store:f.store,operation:'project_file_write',
    output:direct,ingress:'untrusted_chat_sender'}),false);
  assert.equal(observeMcpFileWrite({store:f.store,operation:'project_file_read',
    output:direct,ingress:'remote_gateway'}),false);
  assert.equal(f.events().length,0);
  assert.equal(f.view(p).items[0].mcpToolCallObserved,false);
});
