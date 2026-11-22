import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../src/store.mjs';
import {createOrchestratorKernel} from '../src/orchestrator-kernel.mjs';
import {activateDedicatedForgeProject} from '../src/forge-dedicated-project.mjs';
import {ForgeRepositoryOwnerReadPort,ForgeRepositoryOwnerWritePort} from '../src/forge-repository-owner-read-port.mjs';
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
  assert.equal(missing.includes('repository_inspect'),false);
  assert.equal(missing.includes('repository_files_list'),false);
  const present=dedicatedForgeMcpOperations(f.store,FORGE_APP_MCP_OPERATIONS,
    {repositoryReadPortAvailable:true});
  assert.equal(present.includes('repository_file_read'),true);
  assert.equal(present.includes('repository_inspect'),true);
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
  assert.equal(tools.result.tools.some(x=>x.name==='forge_repository_inspect'),true);
  const output=await mcp.handle({jsonrpc:'2.0',id:3,method:'tools/call',
    params:{name:'forge_repository_file_read',arguments:{
      projectId:f.scope.projectId,taskId:f.taskId,repository:REPO,
    claimToken:f.claim.claimToken,claimGeneration:f.claim.claim.generation,
    path:'README.md'
    }}});
  assert.equal(output.result.structuredContent.content,'read-only contract\n');
  assert.equal(output.result.structuredContent.rootPathExposed,false);
  const inspected=await mcp.handle({jsonrpc:'2.0',id:4,method:'tools/call',
    params:{name:'forge_repository_inspect',arguments:{
      projectId:f.scope.projectId,taskId:f.taskId,repository:REPO,
      claimToken:f.claim.claimToken,claimGeneration:f.claim.claim.generation
    }}});
  assert.equal(inspected.result.structuredContent.originVerified,true);
  assert.equal(inspected.result.structuredContent.ownerGrantVerified,true);
  assert.equal(inspected.result.structuredContent.rootPathExposed,false);
  assert.match(inspected.result.structuredContent.headSha,/^[a-f0-9]{40}$/);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM lab_command_receipts').get().n>0,true);
});


test('native repository read rejects forged or stale Forge OAuth/Runtime claims',async t=>{
  const f=await fixture(t);
  const args={projectId:f.scope.projectId,taskId:f.taskId,repository:REPO};
  const cases=[
    {...f.binding,attestation:{...f.binding.attestation,forgeClientId:'22222222-2222-4222-8222-222222222222'}},
    {...f.binding,attestation:{...f.binding.attestation,deviceBindingAttested:false}},
    {...f.binding,attestation:{...f.binding.attestation,repositoryReadGranted:false}},
    {...f.binding,attestation:{...f.binding.attestation,ownerConfirmed:false}},
    {...f.binding,attestation:{...f.binding.attestation,taskId:'task_other'}},
    {...f.binding,attestation:{...f.binding.attestation,source:'forge_prompt_not_authority'}},
    {...f.binding,attestation:{...f.binding.attestation,verifiedAt:'2020-01-01T00:00:00Z'}},
    {...f.binding,validUntil:'2099-01-01T00:00:00Z'},
    {...f.binding,rootIdentity:'0:0'}
  ];
  for(let i=0;i<cases.length;i++){
    const port=new ForgeRepositoryOwnerReadPort({store:f.store,
      repositoryCatalog:f.catalog,resolveOwnerBinding:async()=>cases[i]});
    await assert.rejects(port.inspect(args),
      /forge_repository_owner_port_and_grant_required|forge_repository_root_reparse_denied/,
      'forged grant case '+i);
  }
});

test('released Task claim cannot read files even while a valid Owner binding remains',async t=>{
  const f=await fixture(t);
  const input={projectId:f.scope.projectId,taskId:f.taskId,repository:REPO,
    claimToken:f.claim.claimToken,claimGeneration:f.claim.claim.generation,
    path:'README.md'};
  f.service.repositoryReadPort=f.port;
  const result=await f.service.invoke(f.context,'repository_file_read',input);
  assert.equal(result.content,'read-only contract\n');
  await f.service.invoke(f.context,'work_claim',{
    action:'release',projectId:f.scope.projectId,taskId:f.taskId,
    requestId:'read_port_release_claim',
    claimToken:f.claim.claimToken,generation:f.claim.claim.generation
  });
  await assert.rejects(f.service.invoke(f.context,'repository_file_read',input),
    /forge_work_claim_not_owned/);
  await assert.rejects(f.service.invoke(f.context,'repository_inspect',{
    projectId:input.projectId,taskId:input.taskId,repository:input.repository,
    claimToken:input.claimToken,claimGeneration:input.claimGeneration
  }),/forge_work_claim_not_owned/);
});

test('claim revoked during asynchronous Owner verification never reveals physical file bytes',async t=>{
  const f=await fixture(t);
  let resume=()=>{},started=()=>{};
  const entered=new Promise(resolve=>{started=resolve});
  const paused=new Promise(resolve=>{resume=resolve});
  let count=0;
  f.service.repositoryReadPort=new ForgeRepositoryOwnerReadPort({
    store:f.store,repositoryCatalog:f.catalog,
    resolveOwnerBinding:async()=>{
      if(++count===1){started();await paused}
      return f.binding;
    }
  });
  const input={projectId:f.scope.projectId,taskId:f.taskId,repository:REPO,
    claimToken:f.claim.claimToken,claimGeneration:f.claim.claim.generation,
    path:'README.md'};
  const pending=f.service.invoke(f.context,'repository_file_read',input);
  await entered;
  await f.service.invoke(f.context,'work_claim',{
    action:'release',projectId:f.scope.projectId,taskId:f.taskId,
    requestId:'read_port_revoke_inflight',
    claimToken:f.claim.claimToken,generation:f.claim.claim.generation
  });
  resume();
  await assert.rejects(pending,/forge_work_claim_not_owned/);
});

const writableGrant=f=>({
  ...f.binding,writeAuthorized:true,
  attestation:{...f.binding.attestation,
    schema:'ordax.forge.owner-repository-write-attestation/1',
    repositoryWriteGranted:true}
});
const newWriteInput=f=>({
  projectId:f.scope.projectId,taskId:f.taskId,repository:REPO,
  claimToken:f.claim.claimToken,claimGeneration:f.claim.claim.generation,
  requestId:'r1_owner_write_first',path:'NEWFILE.md',content:'Forge CAS proof\n',
  expectedHeadSha:run(f.root,'rev-parse','HEAD')
});
const makeWritePort=(f,resolver)=>new ForgeRepositoryOwnerWritePort({
  store:f.store,repositoryCatalog:f.catalog,resolveOwnerBinding:resolver
});

test('R1 write port stays hidden without Owner WRITE authority and never upgrades a read grant',async t=>{
  const f=await fixture(t);
  assert.equal(dedicatedForgeMcpOperations(f.store,FORGE_APP_MCP_OPERATIONS)
    .includes('repository_file_write'),false);
  assert.equal(dedicatedForgeMcpOperations(f.store,FORGE_APP_MCP_OPERATIONS,
    {repositoryReadPortAvailable:true}).includes('repository_file_write'),false);
  const input=newWriteInput(f);
  f.service.repositoryWritePort=makeWritePort(f,()=>f.binding);
  await assert.rejects(f.service.invoke(f.context,'repository_file_write',input),
    /forge_repository_owner_port_and_grant_required/);
  assert.equal(fs.existsSync(path.join(f.root,input.path)),false);
});

test('R1 native repository write is CAS, HEAD-fenced, idempotent and receipt-backed',async t=>{
  const f=await fixture(t),grant=writableGrant(f);
  f.service.repositoryWritePort=makeWritePort(f,()=>grant);
  const input=newWriteInput(f);
  const enabled=dedicatedForgeMcpOperations(f.store,FORGE_APP_MCP_OPERATIONS,
    {repositoryWritePortAvailable:true});
  assert.equal(enabled.includes('repository_file_write'),true);
  const first=await f.service.invoke(f.context,'repository_file_write',input);
  assert.equal(first.status,'succeeded');
  assert.equal(first.result.verified,true);
  assert.equal(first.result.rootPathExposed,false);
  assert.equal(first.result.gitHeadSha,input.expectedHeadSha);
  assert.equal(fs.readFileSync(path.join(f.root,input.path),'utf8'),input.content);
  const replay=await f.service.invoke(f.context,'repository_file_write',input);
  assert.equal(replay.commandId,first.commandId);
  assert.equal(replay.status,'succeeded');
  assert.equal(fs.readFileSync(path.join(f.root,input.path),'utf8'),input.content);
  await assert.rejects(f.service.invoke(f.context,'repository_file_write',{
    ...input,requestId:'r1_write_stale_head',expectedHeadSha:'a'.repeat(40)
  }),/forge_repository_head_version_conflict/);
  const stale=await f.service.invoke(f.context,'repository_file_write',{
    ...input,requestId:'r1_write_bad_cas',content:'change without SHA\n'
  }).catch(error=>error);
  assert.match(String(stale?.message||''),/forge_file_version_conflict/);
  assert.equal(fs.readFileSync(path.join(f.root,input.path),'utf8'),input.content);
  const second=await f.service.invoke(f.context,'repository_file_write',{
    ...input,requestId:'r1_write_compare_swap',content:'second revision\n',
    expectedSha256:first.result.sha256
  });
  assert.equal(second.status,'succeeded');
  assert.equal(second.result.created,false);
  assert.equal(fs.readFileSync(path.join(f.root,input.path),'utf8'),'second revision\n');
  await assert.rejects(f.service.invoke(f.context,'repository_file_write',{
    ...input,requestId:'r1_write_traversal',path:'../escape.md'
  }),/orchestrator_invalid_input|forge_file_path_invalid/);
});

test('R1 uncertain write is recorded and never replayed after grant revocation',async t=>{
  const f=await fixture(t),grant=writableGrant(f);
  let checks=0;
  f.service.repositoryWritePort=makeWritePort(f,()=>{
    checks++;
    return checks<=2?grant:null;
  });
  const input=newWriteInput(f);
  await assert.rejects(f.service.invoke(f.context,'repository_file_write',input),
    /forge_repository_owner_port_and_grant_required/);
  const saved=f.store.db.prepare('SELECT id,status FROM lab_command_receipts WHERE request_id=?')
    .get(input.requestId);
  assert.equal(saved.status,'uncertain');
  assert.equal(fs.readFileSync(path.join(f.root,input.path),'utf8'),input.content);
  const replay=await f.service.invoke(f.context,'repository_file_write',input);
  assert.equal(replay.commandId,saved.id);
  assert.equal(replay.status,'uncertain');
  assert.equal(checks,3,'same requestId must never attempt a second physical write');
});

test('R1 released claim cannot perform an Owner-approved write',async t=>{
  const f=await fixture(t),grant=writableGrant(f);
  f.service.repositoryWritePort=makeWritePort(f,()=>grant);
  await f.service.invoke(f.context,'work_claim',{
    action:'release',projectId:f.scope.projectId,taskId:f.taskId,
    requestId:'r1_release_before_write',
    claimToken:f.claim.claimToken,generation:f.claim.claim.generation
  });
  const input=newWriteInput(f);
  await assert.rejects(f.service.invoke(f.context,'repository_file_write',input),
    /forge_work_claim_not_owned/);
  assert.equal(fs.existsSync(path.join(f.root,input.path)),false);
});

test('R1 status and live MCP tools reflect native Owner ports and revoke without reconnect',async t=>{
  const f=await fixture(t);
  const mcp=createOrchestratorMcp({
    service:f.service,getContext:()=>f.context,
    allowedOperations:()=>dedicatedForgeMcpOperations(
      f.store,FORGE_APP_MCP_OPERATIONS,{
        repositoryReadPortAvailable:Boolean(f.service.repositoryReadPort),
        repositoryWritePortAvailable:Boolean(f.service.repositoryWritePort)
      })
  });
  const init=await mcp.handle({jsonrpc:'2.0',id:1,method:'initialize',
    params:{protocolVersion:'2025-11-25',capabilities:{},
      clientInfo:{name:'owner-port-discovery-test',version:'1'}}});
  assert.ok(init.result);
  await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const listed=async id=>(await mcp.handle({
    jsonrpc:'2.0',id,method:'tools/list',params:{}
  })).result.tools.map(tool=>tool.name);
  const status=()=>f.service.invoke(f.context,'status',{});

  const before=await status();
  assert.equal(before.repositoryReadPortAvailable,false);
  assert.equal(before.repositoryWritePortAvailable,false);
  assert.equal(before.tools.includes('forge_repository_file_read'),false);
  assert.equal((await listed(2)).includes('forge_repository_file_read'),false);

  f.service.repositoryReadPort=f.port;
  const read=await status();
  assert.equal(read.repositoryReadPortAvailable,true);
  assert.equal(read.repositoryWritePortAvailable,false);
  assert.equal(read.repositoryPortAvailable,true);
  assert.equal(read.tools.includes('forge_repository_file_read'),true);
  assert.equal(read.tools.includes('forge_repository_file_write'),false);
  assert.equal((await listed(3)).includes('forge_repository_inspect'),true);
  assert.equal((await listed(4)).includes('forge_repository_file_read'),true);
  assert.equal((await listed(5)).includes('forge_repository_file_write'),false);

  f.service.repositoryWritePort=makeWritePort(f,()=>writableGrant(f));
  const full=await status();
  assert.equal(full.repositoryReadPortAvailable,true);
  assert.equal(full.repositoryWritePortAvailable,true);
  assert.equal(full.tools.includes('forge_repository_file_write'),true);
  assert.equal((await listed(6)).includes('forge_repository_file_write'),true);

  f.service.repositoryWritePort=null;
  assert.equal((await listed(7)).includes('forge_repository_file_write'),false);
  f.service.repositoryReadPort=null;
  const revoked=await status();
  assert.equal(revoked.repositoryReadPortAvailable,false);
  assert.equal(revoked.repositoryPortAvailable,false);
  assert.equal(revoked.tools.includes('forge_repository_file_read'),false);
  const hidden=await listed(8);
  assert.equal(hidden.includes('forge_repository_file_read'),false);
  assert.equal(hidden.includes('forge_repository_inspect'),false);
  const noAccess=await mcp.handle({jsonrpc:'2.0',id:9,method:'tools/call',
    params:{name:'forge_repository_inspect',arguments:{
      projectId:f.scope.projectId,taskId:f.taskId,repository:REPO,
      claimToken:f.claim.claimToken,
      claimGeneration:f.claim.claim.generation
    }}});
  assert.equal(noAccess.error?.message,'Unknown tool',
    'same open MCP connection must stop dispatching revoked Owner reads');
});
