import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {ForgeProjectDevelopment} from '../src/forge-project-development.mjs';
import {ForgeLocalWorkspaces} from '../src/forge-local-workspaces.mjs';
import {ForgeMcpOwnerTrust} from '../src/forge-mcp-owner-trust.mjs';
import {FORGE_APP_MCP_OPERATIONS} from '../src/forge-loopback-mcp.mjs';
import {createOrchestratorMcp} from '../src/orchestrator-mcp.mjs';

test('full Forge MCP catalog reuses app operations while preventing recursive GPT dispatch',()=>{
  assert.ok(FORGE_APP_MCP_OPERATIONS.length>40);
  for(const name of ['project_rename','project_delete','project_repository_set',
    'project_development_status','project_command_run','workspace_bind',
    'project_file_write','project_context','command_get'])
    assert.ok(FORGE_APP_MCP_OPERATIONS.includes(name),'tool missing '+name);
  for(const name of ['work_send','forjador_send','proposal_send','autonomous_dialogue_continue'])
    assert.equal(FORGE_APP_MCP_OPERATIONS.includes(name),false);
});

test('one native owner grant enables real terminal, Git and revoke through the same SQLite receipts',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-native-dev-'));
  const folder=path.join(dir,'project');fs.mkdirSync(folder);
  const store=new Store(':memory:');
  t.after(()=>{store.close();fs.rmSync(dir,{force:true,recursive:true})});
  const context={actorId:'owner',clientId:'desktop',workspaceSessionId:store.getWorkspaceSession().id};
  const workspaces=new ForgeLocalWorkspaces({store,documentsDirectory:dir});
  const trust=new ForgeMcpOwnerTrust({store,appIdentity:dir,
    scopeSignature:id=>{
      const bind=workspaces.binding(id);
      return bind?'owner-bound:'+bind.root+':'+bind.identity:'app-private:'+id;
    }});
  const development=new ForgeProjectDevelopment({store,workspaces,ownerTrust:trust});
  const svc=new OrchestratorService({store,development,
    authorize:({context:who})=>who===context});
  const created=await svc.invoke(context,'project_create',{
    name:'Native terminal E2E',requestId:'project_e2e_native_create'});
  const id=created.result.projectId;
  assert.equal((await svc.invoke(context,'project_development_status',{projectId:id})).available,false);
  workspaces.bindSelected(id,folder);
  assert.equal(development.status(id).ownerBoundWorkspace,true);
  assert.equal(development.status(id).available,false);
  await assert.rejects(svc.invoke(context,'project_command_run',{
    projectId:id,requestId:'before_native_approval',command:'echo NEVER_EXECUTE'
  }),/forge_development_owner_approval_required/);
  trust.trustApp();trust.trust(id);
  assert.equal(development.status(id).available,false,'historical MCP approval must not imply terminal approval');
  development.approve(id,{expectedScopeHash:trust.scopeHash(id)});
  assert.equal(development.status(id).available,true);
  const shell=await svc.invoke(context,'project_command_run',{
    projectId:id,requestId:'native_shell_one',command:'echo FORGE_NATIVE_TOOL_OK',
    timeoutMs:15000
  });
  assert.equal(shell.status,'succeeded');
  assert.equal(shell.result.exitCode,0);
  assert.match(shell.result.stdout,/FORGE_NATIVE_TOOL_OK/);
  assert.equal(shell.result.workspaceIsSandbox,false);
  assert.equal(shell.result.externalEffectsVerified,false);
  const previous=await svc.invoke(context,'project_command_run',{
    projectId:id,requestId:'native_shell_one',command:'echo FORGE_NATIVE_TOOL_OK',
    timeoutMs:15000
  });
  assert.equal(previous.commandId,shell.commandId);
  assert.equal(previous.status,'succeeded');
  const git=await svc.invoke(context,'project_command_run',{
    projectId:id,requestId:'native_git_version',command:'git --version',timeoutMs:15000
  });
  assert.equal(git.status,'succeeded');
  assert.match(git.result.stdout,/git version/i);
  await assert.rejects(svc.invoke(context,'project_command_run',{
    projectId:id,requestId:'native_directory_escape',command:'echo NOT_ALLOWED',
    workingDirectory:'../'
  }),/forge_development_directory_invalid/);
  // A revocation also stops an in-flight command rather than merely denying the next one.
  const slow=svc.invoke(context,'project_command_run',{
    projectId:id,requestId:'native_revoke_active',
    command:process.platform==='win32'?'ping -n 8 127.0.0.1 >NUL':'sleep 7',
    timeoutMs:15000
  });
  await new Promise(resolve=>setTimeout(resolve,650));
  development.revoke(id);
  await assert.rejects(slow,/forge_development_scope_changed/);
  const interrupted=store.db.prepare('SELECT status FROM lab_command_receipts WHERE request_id=?').get('native_revoke_active');
  assert.equal(interrupted.status,'uncertain');
  assert.equal(development.status(id).available,false);
  await assert.rejects(svc.invoke(context,'project_command_run',{
    projectId:id,requestId:'native_after_revoke',command:'echo NEVER_EXECUTE'
  }),/forge_development_owner_approval_required/);
  const mcp=createOrchestratorMcp({service:svc,getContext:()=>context,
    allowedOperations:FORGE_APP_MCP_OPERATIONS});
  await mcp.handle({jsonrpc:'2.0',id:1,method:'initialize',
    params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}});
  await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const listed=await mcp.handle({jsonrpc:'2.0',id:2,method:'tools/list'});
  assert.equal(listed.result.tools.some(x=>x.name==='forge_project_command_run'),true);
  assert.equal(listed.result.tools.some(x=>x.name==='forge_project_delete'),true);
  assert.equal(listed.result.tools.some(x=>x.name==='forge_work_send'),false);
});
