import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../src/store.mjs';
import {createOrchestratorKernel} from '../src/orchestrator-kernel.mjs';
import {activateDedicatedForgeProject} from '../src/forge-dedicated-project.mjs';
import {ForgeRepositoryOwnerReadPort} from '../src/forge-repository-owner-read-port.mjs';
import {createOrchestratorMcp} from '../src/orchestrator-mcp.mjs';
import {dedicatedForgeMcpOperations} from '../src/forge-dedicated-project.mjs';
import {FORGE_APP_MCP_OPERATIONS} from '../src/forge-loopback-mcp.mjs';
import {FORGE_NATIVE_OAUTH_CLIENT_ID} from '../src/forge-product-session.mjs';

const REPO='ordaxsystems/ordax-apps';
const run=(cwd,...argv)=>execFileSync('git',argv,{cwd,encoding:'utf8',timeout:10000,windowsHide:true}).trim();
async function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-repository-read-'));
  const root=path.join(dir,'repository');fs.mkdirSync(root);
  run(root,'init','-q');run(root,'config','user.email','forge-test@example.invalid');
  run(root,'config','user.name','Forge Test');
  run(root,'remote','add','origin','https://github.com/ordaxsystems/ordax-apps.git');
  fs.writeFileSync(path.join(root,'README.md'),'read-only contract\n');
  run(root,'add','README.md');run(root,'commit','-qm','fixture');
  const store=new Store(path.join(dir,'app.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true})});
  let kernel;
  kernel=createOrchestratorKernel({store,
    authorize:({context})=>context===kernel?.context});
  const svc=kernel.service,ctx=kernel.context;
  const scope=activateDedicatedForgeProject(svc);
  const catalog={read:()=>({available:true,checkedOrigin:true,
    repositories:[{repo:REPO},{repo:'ordaxsystems/ordax-os'}]})};
  svc.repositoryCatalogPort=catalog;
  const orchestrators=await svc.invoke(ctx,'orchestrators_list',{projectId:scope.projectId});
  const work=await svc.invoke(ctx,'work_create',{
    projectId:scope.projectId,
    orchestratorId:orchestrators.orchestrators[0].id,
    title:'Review repository',requestId:'read_port_create'});
  const taskId=work.result.taskId;
  const claim=await svc.invoke(ctx,'work_claim',{projectId:scope.projectId,taskId,
    action:'acquire',chatLabel:'fixture',requestId:'read_port_claim'});
  await svc.invoke(ctx,'work_repositories_set',{projectId:scope.projectId,taskId,
    claimToken:claim.result.claimToken,claimGeneration:claim.result.claim.generation,
    repositories:[REPO],requestId:'read_port_assign'});
  const stat=fs.statSync(root,{bigint:true});
  const identity=stat.dev.toString()+':'+stat.ino.toString();
  const binding={projectId:scope.projectId,taskId,repository:REPO,
    root,rootIdentity:identity,ownerApproved:true,readAuthorized:true,
    authority:'forge_native_owner',
    validUntil:new Date(Date.now()+120000).toISOString(),
    attestation:{
      schema:'ordax.forge.owner-repository-read-attestation/1',
      source:'forge_platform_runtime',forgeClientId:FORGE_NATIVE_OAUTH_CLIENT_ID,
      deviceId:'33333333-3333-4333-8333-333333333333',
      projectId:scope.projectId,taskId,repository:REPO,
      ownerConfirmed:true,deviceBindingAttested:true,
      repositoryReadGranted:true,verifiedAt:new Date().toISOString()
    }};
  const grant=()=>binding;
  const port=new ForgeRepositoryOwnerReadPort({
    store,repositoryCatalog:catalog,resolveOwnerBinding:grant});
  return {store,root,scope,taskId,binding,port,dir,catalog,service:svc,context:ctx,claim:claim.result};
}

test('Forge-native read port verifies exact Task, owner grant, Git origin/HEAD and reuses existing safe file broker',async t=>{
  const f=await fixture(t),args={projectId:f.scope.projectId,taskId:f.taskId,repository:REPO};
  const proof=await f.port.inspect(args);
  assert.equal(proof.originVerified,true);
  assert.equal(proof.ownerGrantVerified,true);
  assert.equal(proof.rootPathExposed,false);
  assert.match(proof.headSha,/^[a-f0-9]{40}$/);
  const file=await f.port.read({...args,path:'README.md'});
  assert.equal(file.content,'read-only contract\n');
  assert.equal(file.sha256,'e42a6beff992cb7c7934a00d2431525575034e299ffa008031ee3b67906f8f6a');
  assert.equal(file.gitHeadSha,proof.headSha);
  assert.equal(file.rootPathExposed,false);
  const list=await f.port.list({...args,directory:''});
  assert.equal(list.entries.some(entry=>entry.name==='README.md'),true);
  assert.equal(list.entries.find(entry=>entry.name==='.git')?.kind,'directory');
  await assert.rejects(f.port.read({...args,path:'../README.md'}),/forge_file_path_invalid/);
  await assert.rejects(f.port.read({...args,path:'.git/config'}),/forge_file_path_invalid/);
});

test('Forge-native per-repository reader fails closed without exact owner grant, manifest scope or verified root',async t=>{
  const f=await fixture(t),args={projectId:f.scope.projectId,taskId:f.taskId,repository:REPO};
  const port=grant=>new ForgeRepositoryOwnerReadPort({store:f.store,
    repositoryCatalog:f.catalog,resolveOwnerBinding:()=>grant});
  await assert.rejects(port(null).inspect(args),/forge_repository_owner_port_and_grant_required/);
  await assert.rejects(port({...f.binding,ownerApproved:false}).inspect(args),/forge_repository_owner_port_and_grant_required/);
  await assert.rejects(port({...f.binding,readAuthorized:false}).inspect(args),/forge_repository_owner_port_and_grant_required/);
  await assert.rejects(port({...f.binding,validUntil:'2000-01-01T00:00:00Z'}).inspect(args),/forge_repository_owner_port_and_grant_required/);
  await assert.rejects(port({...f.binding,taskId:'task_other'}).inspect(args),/forge_repository_owner_port_and_grant_required/);
  await assert.rejects(f.port.inspect({...args,repository:'ordaxsystems/ordax-os'}),/forge_task_repository_scope_not_assigned/);
  run(f.root,'remote','set-url','origin','https://github.com/unknown/other.git');
  await assert.rejects(f.port.inspect(args),/forge_repository_origin_mismatch/);
});

test('Forge-native reader rechecks authorization after I/O and does not reveal file after revocation',async t=>{
  const f=await fixture(t),args={projectId:f.scope.projectId,taskId:f.taskId,repository:REPO};
  let calls=0;
  const port=new ForgeRepositoryOwnerReadPort({store:f.store,
    repositoryCatalog:f.catalog,resolveOwnerBinding:()=>{
      calls++;
      return calls===1?f.binding:null;
    }});
  await assert.rejects(port.read({...args,path:'README.md'}),
    /forge_repository_owner_port_and_grant_required/);
});

test('dedicated MCP hides native reads without Owner port and serves only scoped read with one',async t=>{
  const f=await fixture(t);
  const missing=dedicatedForgeMcpOperations(f.store,FORGE_APP_MCP_OPERATIONS);
  assert.equal(missing.includes('repository_file_read'),false);
  assert.equal(missing.includes('repository_files_list'),false);
  const present=dedicatedForgeMcpOperations(f.store,FORGE_APP_MCP_OPERATIONS,
    {repositoryReadPortAvailable:true});
  assert.equal(present.includes('repository_file_read'),true);
  assert.equal(present.includes('repository_files_list'),true);
  await assert.rejects(f.service.invoke(f.context,'repository_file_read',{
    projectId:f.scope.projectId,taskId:f.taskId,repository:REPO,
    claimToken:f.claim.claimToken,claimGeneration:f.claim.claim.generation,
    path:'README.md'
  }),/forge_repository_owner_port_and_grant_required/);
  f.service.repositoryReadPort=f.port;
  const mcp=createOrchestratorMcp({
    service:f.service,getContext:()=>f.context,allowedOperations:present
  });
  const hello=await mcp.handle({jsonrpc:'2.0',id:1,method:'initialize',
    params:{protocolVersion:'2025-06-18',capabilities:{},
      clientInfo:{name:'read-port-test',version:'1'}}});
  assert.ok(hello.result);
  await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const tools=await mcp.handle({jsonrpc:'2.0',id:2,method:'tools/list'});
  assert.equal(tools.result.tools.some(x=>x.name==='forge_repository_file_read'),true);
  const output=await mcp.handle({jsonrpc:'2.0',id:3,method:'tools/call',
    params:{name:'forge_repository_file_read',arguments:{
      projectId:f.scope.projectId,taskId:f.taskId,repository:REPO,
    claimToken:f.claim.claimToken,claimGeneration:f.claim.claim.generation,
    path:'README.md'
    }}});
  assert.equal(output.result.structuredContent.content,'read-only contract\n');
  assert.equal(output.result.structuredContent.rootPathExposed,false);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM lab_command_receipts').get().n>0,true);
});
