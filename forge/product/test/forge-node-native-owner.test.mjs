import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHostApplication} from '../host/host-application.mjs';
import {ForgeLocalWorkspaces} from '../src/forge-local-workspaces.mjs';
import {ForgeMcpOwnerTrust} from '../src/forge-mcp-owner-trust.mjs';
import {FORGE_NATIVE_OAUTH_CLIENT_ID} from '../src/forge-product-session.mjs';
import {ForgeProjectDevelopment} from '../src/forge-project-development.mjs';
import {forgeOwnerWorkspaceScope} from '../src/forge-owner-workspace-scope.mjs';
import {
  FORGE_NODE_REMOTE_MCP_OPERATIONS,FORGE_NODE_NATIVE_REMOTE_MCP_OPERATIONS
} from '../src/forge-remote-mcp-owner.mjs';

const product=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const issuer='https://jhfphsjptrpmtnzkpwud.supabase.co/auth/v1';
const owner='11111111-2222-4333-8444-555555555555';
function remoteSession(){return {
  status:()=>({connected:true,subjectId:owner,issuer}),
  accessToken:async()=> 'TOKEN_ONLY_FOR_NATIVE_PARITY_TEST_NOT_A_REAL_BEARER'
}}
function gatewayStub(){
  const calls=[];
  const fetchImpl=async(url,options)=>{
    const data=JSON.parse(String(options.body||'{}'));
    calls.push({path:new URL(url).pathname,data});
    return new Response(JSON.stringify({ok:true,last_seen_at:new Date().toISOString()}),{
      status:200,headers:{'content-type':'application/json'}
    });
  };
  return {calls,fetchImpl};
}
function job(toolName,args,n){
  return {request_id:'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),
    attempt_id:'10000000-0000-4000-8000-'+String(n).padStart(12,'0'),
    lease_id:'20000000-0000-4000-8000-'+String(n).padStart(12,'0'),
    tool_name:toolName,arguments:args};
}
test('Native Node exposes real Owner workspace/file/terminal/Git operations only with existing grants',
  async t=>{
    const folder=await fsp.mkdtemp(path.join(os.tmpdir(),'forge-native-node-owner-'));
    const userRoot=path.join(folder,'OrdaX','Forge');
    const dataRoot=path.join(userRoot,'data');
    const documentsDirectory=path.join(folder,'Documents');
    const selectedFolder=path.join(documentsDirectory,'verified-project');
    fs.mkdirSync(selectedFolder,{recursive:true});
    fs.writeFileSync(path.join(selectedFolder,'README.md'),'exact physical workspace\n');
    const git=(...args)=>execFileSync('git',args,{cwd:selectedFolder,stdio:'pipe',windowsHide:true});
    git('init');git('config','user.name','Forge Native Test');
    git('config','user.email','forge-native@test.invalid');
    git('add','README.md');git('commit','-m','Create isolated workspace fixture');
    const transport=gatewayStub();
    const app=createHostApplication({
      productRoot:product,dataRoot,remoteSession:remoteSession(),
      remoteFetchImpl:transport.fetchImpl,
      nativeOwner:{userRoot,documentsDirectory},environment:{}
    });
    t.after(async()=>{app.close();await fsp.rm(folder,{recursive:true,force:true,maxRetries:4,retryDelay:120})});
    // The same canonical Owner scope metadata must be used by Electron and
    // Node, not converted into an app-private/legacy approval on cutover.
    const workspaces=new ForgeLocalWorkspaces({store:app.store,documentsDirectory});
    const trust=new ForgeMcpOwnerTrust({store:app.store,appIdentity:userRoot,
      scopeSignature:id=>forgeOwnerWorkspaceScope(workspaces,id)});
    const development=new ForgeProjectDevelopment({
      store:app.store,workspaces,ownerTrust:trust,devAutonomy:false
    });
    const mission=await app.service.invoke(app.context,'mission_create',{
      requestId:'node_native_owner_mission',mission:'Node native Owner parity test'
    });
    assert.equal(mission.status,'succeeded');
    const {projectId,taskId}=mission.result;
    await assert.rejects(app.remoteGateway.register(),/forge_mcp_app_untrusted/);
    assert.equal(transport.calls.length,0);
    assert.equal((await app.service.invoke(app.context,
      'project_development_status',{projectId})).available,false);
    workspaces.bindSelected(projectId,selectedFolder);
    assert.equal((await app.service.invoke(app.context,
      'project_files_status',{projectId})).verified,true);
    // No grant is manufactured by attaching the physical workspace.
    trust.trustApp({expectedScopeHash:trust.appScopeHash()});
    trust.trust(projectId,{expectedScopeHash:trust.scopeHash(projectId)});
    assert.equal((await app.service.invoke(app.context,
      'project_development_status',{projectId})).available,false);
    await app.remoteGateway.register();
    const registered=transport.calls.find(v=>v.path.endsWith('/register')).data.catalog;
    for(const tool of ['forge_project_file_read','forge_project_file_write',
      'forge_project_files_list','forge_project_development_status',
      'forge_project_worktree_prepare','forge_project_worktree_review',
      'forge_project_worktree_verify','forge_project_worktree_integrate',
      'forge_project_command_run'])
      assert.ok(registered.some(item=>item.name===tool),'missing '+tool);
    for(const tool of ['forge_app_ui_click','forge_app_ui_inspect',
      'forge_project_delete','forge_workspace_bind'])
      assert.equal(registered.some(item=>item.name===tool),false,
        'Node must not invent an Electron UI/folder-picker authority');
    const fileRead=await app.remoteGateway.executeJob(job('forge_project_file_read',{
      projectId,path:'README.md'
    },1));
    assert.equal(fileRead.ok,true);
    const firstRead=transport.calls.findLast(v=>v.path.endsWith('/report')).data;
    assert.equal(firstRead.succeeded,true);
    assert.equal((await app.service.invoke(app.context,'project_file_read',{
      projectId,path:'README.md'
    })).content,'exact physical workspace\n');

    // Real terminal remains disabled until the explicit project development
    // approval, independently of App and Project MCP consent.
    development.approve(projectId,{expectedScopeHash:trust.scopeHash(projectId)});
    const ready=await app.service.invoke(app.context,
      'project_development_status',{projectId});
    assert.equal(ready.available,true);
    assert.equal(ready.ownerBoundWorkspace,true);
    const lease=await app.remoteGateway.executeJob(job('forge_work_claim',{
      requestId:'node_native_owner_claim',projectId,taskId,action:'acquire',
      chatLabel:'native owner e2e'
    },2));
    assert.equal(lease.ok,true);
    const claim=transport.calls.findLast(v=>v.path.endsWith('/report'))
      .data.result.structuredContent.result;
    assert.equal(claim.status,'acquired');
    const claimScope={projectId,taskId,claimToken:claim.claimToken,
      claimGeneration:claim.claim.generation};
    const prepared=await app.remoteGateway.executeJob(job('forge_project_worktree_prepare',{
      ...claimScope,requestId:'node_native_worktree_prepare_once'
    },3));
    assert.equal(prepared.ok,true);
    assert.equal(workspaces.taskWorktree(projectId,taskId).status,'active');
    const target=workspaces.rootForProject(projectId,taskId);
    const write=await app.remoteGateway.executeJob(job('forge_project_file_write',{
      ...claimScope,path:'new-note.txt',content:'written by existing Forge broker',
      requestId:'node_native_file_write_once'
    },4));
    assert.equal(write.ok,true);
    assert.equal(fs.readFileSync(path.join(target,'new-note.txt'),'utf8'),
      'written by existing Forge broker');
    const command=await app.remoteGateway.executeJob(job('forge_project_command_run',{
      ...claimScope,command:'echo FORGE_NATIVE_NODE_OWNER_OK',
      requestId:'node_native_command_once',timeoutMs:15000
    },5));
    assert.equal(command.ok,true);
    const terminal=transport.calls.findLast(v=>v.path.endsWith('/report'))
      .data.result.structuredContent.result;
    assert.equal(terminal.exitCode,0);
    assert.match(terminal.stdout,/FORGE_NATIVE_NODE_OWNER_OK/);
    const beforeRevocation=development.status(projectId);
    assert.equal(beforeRevocation.available,true);
    development.revoke(projectId);
    assert.equal(development.status(projectId).available,false);
    assert.equal(app.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  });
test('native catalog is additive and never enables Electron-only control',()=>{
  for(const operation of FORGE_NODE_REMOTE_MCP_OPERATIONS)
    assert.ok(FORGE_NODE_NATIVE_REMOTE_MCP_OPERATIONS.includes(operation),operation);
  for(const operation of ['project_file_read','project_file_write','project_command_run',
    'project_worktree_review','project_worktree_integrate'])
    assert.ok(FORGE_NODE_NATIVE_REMOTE_MCP_OPERATIONS.includes(operation),operation);
  for(const operation of ['app_ui_click','app_ui_inspect','project_delete','workspace_bind'])
    assert.equal(FORGE_NODE_NATIVE_REMOTE_MCP_OPERATIONS.includes(operation),false);
});


test('Node Owner only composes multi-repository reads from its private Forge OAuth grant resolver',{timeout:60000},async t=>{
  const folder=await fsp.mkdtemp(path.join(os.tmpdir(),'forge-node-repository-owner-'));
  let withResolver=null;
  // Release the Owner SQLite/Core before attempting Windows directory removal.
  t.after(async()=>{
    withResolver?.close();
    await fsp.rm(folder,{recursive:true,force:true,maxRetries:4,retryDelay:100});
  });
  let connected=true,reads=0;
  const session={status:()=>({connected,mode:'oauth',
    clientId:FORGE_NATIVE_OAUTH_CLIENT_ID}),
    accessToken:async()=> 'SYNTHETIC_TOKEN_NOT_VALID_FOR_NETWORK'};
  const create=(suffix,resolver)=>{
    const userRoot=path.join(folder,suffix,'OrdaX','Forge');
    const dataRoot=path.join(userRoot,'data');
    const documentsDirectory=path.join(folder,suffix,'Documents');
    const nativeOwner={userRoot,documentsDirectory,dedicatedProject:true,
      ...(resolver===undefined?{}:{repositoryReadGrantResolver:resolver})};
    return createHostApplication({productRoot:product,dataRoot,
      nativeOwner,remoteSession:session,environment:{}});
  };
  const without=create('no-grant');
  assert.equal(without.service.repositoryReadPort,null,
    'the Node Owner must not invent a permission from its OAuth connection');
  without.close();
  withResolver=create('trusted-resolver',async scope=>{
    reads++;
    return {observed:scope.repository};
  });
  assert.equal(typeof withResolver.service.repositoryReadPort?.read,'function');
  const argument={projectId:'project_abc',taskId:'task_abc',
    repository:'ordaxsystems/ordax-os',access:'read'};
  assert.deepEqual(await withResolver.service.repositoryReadPort.resolveOwnerBinding(argument),
    {observed:'ordaxsystems/ordax-os'});
  assert.equal(reads,1);
  connected=false;
  await assert.rejects(withResolver.service.repositoryReadPort.resolveOwnerBinding(argument),
    /forge_native_repository_oauth_unavailable/);
  assert.equal(reads,1,'revoked Forge OAuth must fail before touching the native adapter');
});
