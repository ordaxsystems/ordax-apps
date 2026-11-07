import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {FORGE_EXECUTOR_PROTOCOL,FORGE_MCP_INSTRUCTIONS} from '../src/forge-executor-context.mjs';
import {ORCHESTRATOR_TOOLS} from '../src/orchestrator-contract.mjs';
import {createOrchestratorMcp} from '../src/orchestrator-mcp.mjs';

test('Forge exposes project context without granting filesystem access or inferring a path',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-context-'));
  const store=new Store(path.join(dir,'data.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const context={actorId:'owner',clientId:'local',workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,authorize:({context:who})=>who===context});
  const project=await service.invoke(context,'mission_create',{
    name:'Cafeteria',mission:'Crie um site de cafeteria',requestId:'demo_create_1'
  });
  assert.equal(project.status,'succeeded');
  const id=project.result.projectId;
  const result=await service.invoke(context,'project_context',{projectId:id});
  assert.equal(result.schema,'ordax.forge.project-context/1');
  assert.equal(result.project.name,'Cafeteria');
  assert.equal(result.work.registered,1);
  assert.equal(result.workspace.fileWriteAvailable,false);
  assert.equal(result.workspace.projectFolderCreated,false);
  assert.equal(result.project.remoteRepositoryAccessVerified,false);
  assert.equal(result.protocol.version,FORGE_EXECUTOR_PROTOCOL.version);
  assert.equal(result.limitations.physicalFileAccess,'requires_verified_project_binding_and_typed_file_tools');
  assert.equal(JSON.stringify(result).includes('C:\\Users\\'),false);
  await assert.rejects(service.invoke(context,'project_context',{projectId:'project_fake'}),
    /orchestrator_project_unavailable|orchestrator_access_denied/);
  const foreign={...context,actorId:'other'};
  await assert.rejects(service.invoke(foreign,'project_context',{projectId:id}),/orchestrator_access_denied/);
});

test('Forge MCP advertises its operating protocol as discovery, not as a new grant',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-mcp-context-'));
  const store=new Store(path.join(dir,'data.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const context={actorId:'owner',clientId:'local',workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,authorize:({context:who})=>who===context});
  assert.equal(ORCHESTRATOR_TOOLS.find(x=>x.name==='orchestrator_project_context')?.readOnly,true);
  const mcp=createOrchestratorMcp({service,getContext:()=>context});
  const hello=await mcp.handle({jsonrpc:'2.0',id:1,method:'initialize',
    params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}});
  assert.equal(hello.result.instructions.includes(FORGE_MCP_INSTRUCTIONS),true);
  assert.equal(hello.result.instructions.includes('general computer shell'),true);
  await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const list=await mcp.handle({jsonrpc:'2.0',id:2,method:'tools/list'});
  assert.equal(list.result.tools.some(x=>x.name==='orchestrator_project_context'),true);
  // Typed project file writes are now explicitly supported; this is NOT a
  // blanket computer shell grant and still requires a verified project binding.
  assert.equal(list.result.tools.some(x=>/shell_exec/.test(x.name)),false);
  assert.equal(list.result.tools.some(x=>x.name==='orchestrator_project_file_write'),true);
});
