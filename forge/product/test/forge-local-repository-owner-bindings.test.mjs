import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../src/store.mjs';
import {ForgeMcpOwnerTrust} from '../src/forge-mcp-owner-trust.mjs';
import {ForgeLocalRepositoryOwnerBindings} from '../src/forge-local-repository-owner-bindings.mjs';
import {ForgeRepositoryOwnerReadPort,ForgeRepositoryOwnerWritePort} from '../src/forge-repository-owner-read-port.mjs';
import {ForgeRepositoryOwnerProcessPort} from '../src/forge-repository-owner-process-port.mjs';
import {createOrchestratorKernel} from '../src/orchestrator-kernel.mjs';
import {activateDedicatedForgeProject,dedicatedForgeMcpOperations} from '../src/forge-dedicated-project.mjs';
import {FORGE_APP_MCP_OPERATIONS} from '../src/forge-loopback-mcp.mjs';
import {FORGE_NATIVE_OAUTH_CLIENT_ID} from '../src/forge-product-session.mjs';

const REPO='ordaxsystems/ordax-apps';
const SUBJECT='11111111-2222-4333-8444-555555555555';
const ISSUER='https://jhfphsjptrpmtnzkpwud.supabase.co/auth/v1';
const git=(root,...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',timeout:10000,windowsHide:true}).trim();

async function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-owner-repository-grant-'));
  const root=path.join(dir,'approved-repository');
  fs.mkdirSync(root);
  git(root,'init','-q');
  git(root,'config','user.email','forge-test@example.invalid');
  git(root,'config','user.name','Forge Owner Test');
  git(root,'remote','add','origin','https://github.com/ordaxsystems/ordax-apps.git');
  fs.writeFileSync(path.join(root,'README.md'),'only the selected local repository\n');
  git(root,'add','README.md');git(root,'commit','-qm','fixture');
  const store=new Store(path.join(dir,'forge.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true})});
  let kernel;
  kernel=createOrchestratorKernel({store,
    authorize:({context})=>context===kernel?.context});
  const scope=activateDedicatedForgeProject(kernel.service);
  const catalog={read:()=>({available:true,checkedOrigin:true,
    repositories:[{repo:REPO},{repo:'ordaxsystems/ordax-os'}]})};
  kernel.service.repositoryCatalogPort=catalog;
  const orch=await kernel.service.invoke(kernel.context,'orchestrators_list',
    {projectId:scope.projectId});
  const work=await kernel.service.invoke(kernel.context,'work_create',{
    projectId:scope.projectId,orchestratorId:orch.orchestrators[0].id,
    title:'Local Owner reader fixture',requestId:'local_grant_create'});
  const taskId=work.result.taskId;
  const claim=await kernel.service.invoke(kernel.context,'work_claim',{
    projectId:scope.projectId,taskId,action:'acquire',
    chatLabel:'test',requestId:'local_grant_claim'});
  await kernel.service.invoke(kernel.context,'work_repositories_set',{
    projectId:scope.projectId,taskId,claimToken:claim.result.claimToken,
    claimGeneration:claim.result.claim.generation,repositories:[REPO],
    requestId:'local_grant_assign'});
  const trust=new ForgeMcpOwnerTrust({
    store,appIdentity:path.join(dir,'trusted-user'),
    scopeSignature:projectId=>'app-private:'+projectId});
  let connected=true;
  const session={status:()=>({connected,mode:'oauth',
    clientId:FORGE_NATIVE_OAUTH_CLIENT_ID})};
  const roots=new ForgeLocalRepositoryOwnerBindings({
    store,ownerTrust:trust,repositoryCatalog:catalog,session,
    forbiddenRoots:[path.join(dir,'system-reserved')]});
  return {dir,root,store,kernel,scope,taskId,claim:claim.result,
    catalog,trust,session,roots,setConnected(value){connected=value}};
}

test('unapproved local paths remain invisible and OAuth alone does not grant a repo',async t=>{
  const f=await fixture(t);
  const args={projectId:f.scope.projectId,repository:REPO,selectedRoot:f.root};
  assert.equal(f.roots.hasApprovedRoot(args.projectId),false);
  assert.throws(()=>f.roots.bindSelected(args),
    /forge_local_repository_owner_oauth_required/);
  f.trust.trustApp({expectedScopeHash:f.trust.appScopeHash()});
  assert.equal(f.roots.hasApprovedRoot(args.projectId),false);
  assert.throws(()=>f.roots.bindSelected(args),
    /forge_local_repository_owner_identity_required/);
  f.trust.bindRemoteOwnerIdentity({subjectId:SUBJECT,issuer:ISSUER});
  const proof=f.roots.bindSelected(args);
  assert.equal(proof.configured,true);
  assert.equal(proof.writeGranted,false);
  assert.equal(f.roots.hasApprovedRoot(args.projectId),true);
  assert.throws(()=>f.roots.bindSelected(args),
    /forge_local_repository_already_bound/);
  f.setConnected(false);
  assert.equal(f.roots.hasApprovedRoot(args.projectId),false);
  await assert.rejects(f.roots.resolve({
    projectId:args.projectId,taskId:f.taskId,repository:REPO,access:'read'
  }),/forge_local_repository_owner_oauth_required/);
});

test('real local Owner binding reads only the exact approved repository via Forge MCP',async t=>{
  const f=await fixture(t),projectId=f.scope.projectId;
  f.trust.trustApp({expectedScopeHash:f.trust.appScopeHash()});
  f.trust.bindRemoteOwnerIdentity({subjectId:SUBJECT,issuer:ISSUER});
  f.roots.bindSelected({projectId,repository:REPO,selectedRoot:f.root});
  const port=new ForgeRepositoryOwnerReadPort({
    store:f.store,repositoryCatalog:f.catalog,
    resolveOwnerBinding:scope=>f.roots.resolve(scope)});
  f.kernel.service.repositoryReadPort=port;
  const args={projectId,taskId:f.taskId,repository:REPO,
    claimToken:f.claim.claimToken,
    claimGeneration:f.claim.claim.generation,path:'README.md'};
  const read=await f.kernel.service.invoke(f.kernel.context,'repository_file_read',args);
  assert.equal(read.content,'only the selected local repository\n');
  assert.equal(read.rootPathExposed,false);
  assert.match(read.sha256,/^[a-f0-9]{64}$/);
  const grant=await f.roots.resolve({projectId,taskId:f.taskId,repository:REPO,access:'read'});
  assert.equal(grant.attestation.source,'forge_native_local_owner');
  assert.equal(grant.attestation.deviceBindingAttested,false);
  await assert.rejects(f.kernel.service.invoke(f.kernel.context,'repository_file_read',{
    ...args,repository:'ordaxsystems/ordax-os'
  }),/forge_task_repository_scope_not_assigned/);
  const revoked=f.roots.revoke({projectId,repository:REPO});
  assert.equal(revoked.revoked,true);
  assert.equal(f.roots.hasApprovedRoot(projectId),false);
  await assert.rejects(f.kernel.service.invoke(f.kernel.context,'repository_file_read',args),
    /forge_local_repository_owner_binding_required/);
});

test('physical identity and Git origin are revalidated even after local approval',async t=>{
  const f=await fixture(t),projectId=f.scope.projectId;
  f.trust.trustApp({expectedScopeHash:f.trust.appScopeHash()});
  f.trust.bindRemoteOwnerIdentity({subjectId:SUBJECT,issuer:ISSUER});
  const args={projectId,repository:REPO,selectedRoot:f.root};
  f.roots.bindSelected(args);
  git(f.root,'remote','set-url','origin','https://github.com/unknown/another.git');
  assert.equal(f.roots.hasApprovedRoot(projectId),false);
  await assert.rejects(f.roots.resolve({
    projectId,taskId:f.taskId,repository:REPO,access:'read'
  }),/forge_local_repository_origin_mismatch/);
  assert.throws(()=>f.roots.bindSelected({
    ...args,repository:'ordaxsystems/ordax-os'
  }),/forge_local_repository_origin_mismatch/);
});

test('App Owner revocation denies new reads without a second grant database',async t=>{
  const f=await fixture(t),projectId=f.scope.projectId;
  f.trust.trustApp({expectedScopeHash:f.trust.appScopeHash()});
  f.trust.bindRemoteOwnerIdentity({subjectId:SUBJECT,issuer:ISSUER});
  f.roots.bindSelected({projectId,repository:REPO,selectedRoot:f.root});
  f.trust.revokeApp();
  assert.equal(f.roots.hasApprovedRoot(projectId),false);
  await assert.rejects(f.roots.resolve({
    projectId,taskId:f.taskId,repository:REPO,access:'read'
  }),/forge_local_repository_owner_oauth_required/);
});

test('Owner PROCESS is separate from WRITE and launches a Task-scoped child with receipt and logs',async t=>{
  const f=await fixture(t),projectId=f.scope.projectId;
  f.trust.trustApp({expectedScopeHash:f.trust.appScopeHash()});
  f.trust.bindRemoteOwnerIdentity({subjectId:SUBJECT,issuer:ISSUER});
  f.roots.bindSelected({projectId,repository:REPO,selectedRoot:f.root});
  f.roots.approveWrite({projectId,repository:REPO});
  assert.equal(f.roots.status({projectId,repository:REPO}).processGranted,false);
  await assert.rejects(f.roots.resolve({projectId,taskId:f.taskId,
    repository:REPO,access:'process'}),/forge_local_repository_process_approval_required/);
  f.roots.approveProcess({projectId,repository:REPO});
  const port=new ForgeRepositoryOwnerProcessPort({store:f.store,
    repositoryCatalog:f.catalog,resolveOwnerBinding:x=>f.roots.resolve(x)});
  f.kernel.service.repositoryProcessPort=port;
  const unavailable=dedicatedForgeMcpOperations(f.store,FORGE_APP_MCP_OPERATIONS);
  assert.equal(unavailable.includes('repository_process_start'),false);
  const live=dedicatedForgeMcpOperations(f.store,FORGE_APP_MCP_OPERATIONS,
    {repositoryProcessPortAvailable:true});
  assert.equal(live.includes('repository_process_start'),true);
  assert.equal(live.includes('repository_process_stop'),true);
  assert.equal(live.includes('repository_process_logs'),true);
  const claim={projectId,taskId:f.taskId,repository:REPO,
    claimToken:f.claim.claimToken,claimGeneration:f.claim.claim.generation};
  const input={...claim,requestId:'process_test_once',
    expectedHeadSha:git(f.root,'rev-parse','HEAD'),
    argv:[process.execPath,'-e',
      'console.log("FORGE_PROCESS_CHECKPOINT|{\\\"step\\\":1,\\\"total\\\":1,\\\"stage\\\":\\\"test\\\"}");console.log("RUN_OK")']};
  const first=await f.kernel.service.invoke(f.kernel.context,'repository_process_start',input);
  assert.equal(first.status,'succeeded');
  const replay=await f.kernel.service.invoke(f.kernel.context,'repository_process_start',input);
  assert.equal(replay.id,first.id);
  const processId=first.result.processId;
  let state;
  for(let n=0;n<100;n++){
    state=await f.kernel.service.invoke(f.kernel.context,'repository_process_status',
      {...claim,processId});
    if(state.state!=='running')break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(state.state,'exited');
  assert.equal(state.exitCode,0);
  const logs=await f.kernel.service.invoke(f.kernel.context,
    'repository_process_logs',{...claim,processId});
  assert.match(logs.stdout,/RUN_OK/);
  assert.equal(logs.checkpoint?.source,'unverified_child_stdout');
  assert.equal(logs.externalEffectsVerified,false);
  assert.equal((await f.kernel.service.invoke(f.kernel.context,
    'repository_process_list',claim)).processes.length,1);
  f.roots.revokeProcess({projectId,repository:REPO});
  assert.equal(f.roots.hasApprovedRoot(projectId,{access:'process'}),false);
  assert.equal(f.roots.hasApprovedRoot(projectId,{access:'write'}),true);
  await assert.rejects(f.kernel.service.invoke(f.kernel.context,
    'repository_process_status',{...claim,processId}),
    /forge_local_repository_process_approval_required/);
});
test('missing executable never produces a false accepted-process receipt',async t=>{
  const f=await fixture(t),projectId=f.scope.projectId;
  f.trust.trustApp({expectedScopeHash:f.trust.appScopeHash()});
  f.trust.bindRemoteOwnerIdentity({subjectId:SUBJECT,issuer:ISSUER});
  f.roots.bindSelected({projectId,repository:REPO,selectedRoot:f.root});
  f.roots.approveProcess({projectId,repository:REPO});
  f.kernel.service.repositoryProcessPort=new ForgeRepositoryOwnerProcessPort({
    store:f.store,repositoryCatalog:f.catalog,
    resolveOwnerBinding:x=>f.roots.resolve(x)});
  const input={projectId,taskId:f.taskId,repository:REPO,
    claimToken:f.claim.claimToken,claimGeneration:f.claim.claim.generation,
    requestId:'missing_binary_once',expectedHeadSha:git(f.root,'rev-parse','HEAD'),
    argv:['no-such-forge-owner-test-binary-8cc29.exe']};
  await assert.rejects(f.kernel.service.invoke(f.kernel.context,
    'repository_process_start',input),/forge_repository_process_spawn_failed/);
  const receipt=f.store.db.prepare('SELECT status FROM lab_command_receipts WHERE request_id=?')
    .get(input.requestId);
  assert.equal(receipt.status,'failed');
  await assert.rejects(f.kernel.service.invoke(f.kernel.context,
    'repository_process_start',{...input,requestId:'missing_binary_again'}),
    /forge_repository_process_spawn_failed/);
});
test('Forge process stop terminates only an owned Task child with durable receipt',async t=>{
  const f=await fixture(t),projectId=f.scope.projectId;
  f.trust.trustApp({expectedScopeHash:f.trust.appScopeHash()});
  f.trust.bindRemoteOwnerIdentity({subjectId:SUBJECT,issuer:ISSUER});
  f.roots.bindSelected({projectId,repository:REPO,selectedRoot:f.root});
  f.roots.approveProcess({projectId,repository:REPO});
  const port=new ForgeRepositoryOwnerProcessPort({store:f.store,
    repositoryCatalog:f.catalog,resolveOwnerBinding:x=>f.roots.resolve(x)});
  f.kernel.service.repositoryProcessPort=port;
  const unavailable=dedicatedForgeMcpOperations(f.store,FORGE_APP_MCP_OPERATIONS);
  assert.equal(unavailable.includes('repository_process_start'),false);
  const live=dedicatedForgeMcpOperations(f.store,FORGE_APP_MCP_OPERATIONS,
    {repositoryProcessPortAvailable:true});
  assert.equal(live.includes('repository_process_start'),true);
  assert.equal(live.includes('repository_process_stop'),true);
  assert.equal(live.includes('repository_process_logs'),true);
  const claim={projectId,taskId:f.taskId,repository:REPO,
    claimToken:f.claim.claimToken,claimGeneration:f.claim.claim.generation};
  const first=await f.kernel.service.invoke(f.kernel.context,'repository_process_start',{
    ...claim,requestId:'owner_process_stop_start',
    expectedHeadSha:git(f.root,'rev-parse','HEAD'),
    argv:[process.execPath,'-e','setInterval(()=>console.log("tick"),200)'],
    timeoutMs:30000});
  const processId=first.result.processId;
  const recovered=new ForgeRepositoryOwnerProcessPort({store:f.store,
    repositoryCatalog:f.catalog,resolveOwnerBinding:x=>f.roots.resolve(x)});
  const uncertain=await recovered.status({...claim,processId});
  assert.equal(uncertain.state,'uncertain');
  assert.equal(uncertain.reason,'forge_process_unverified_after_restart');
  await f.kernel.service.invoke(f.kernel.context,'work_claim',{
    projectId,taskId:f.taskId,action:'release',
    claimToken:f.claim.claimToken,generation:f.claim.claim.generation,
    requestId:'process_handoff_release'});
  const replacement=await f.kernel.service.invoke(f.kernel.context,'work_claim',{
    projectId,taskId:f.taskId,action:'acquire',chatLabel:'second-chat',
    requestId:'process_handoff_acquire'});
  const nextClaim={...claim,claimToken:replacement.result.claimToken,
    claimGeneration:replacement.result.claim.generation};
  // Survive a full Owner/process-monitor interval after the original claim
  // is released. The process remains owned by Forge, not by the GPT turn.
  await new Promise(resolve=>setTimeout(resolve,5300));
  const observed=await f.kernel.service.invoke(f.kernel.context,
    'repository_process_status',{...nextClaim,processId});
  assert.equal(observed.state,'running');
  const stopped=await f.kernel.service.invoke(f.kernel.context,'repository_process_stop',{
    ...nextClaim,requestId:'owner_process_stop_once',processId});
  assert.equal(stopped.status,'succeeded');
  assert.equal(stopped.result.stopRequested,true);
  const again=await f.kernel.service.invoke(f.kernel.context,'repository_process_stop',{
    ...nextClaim,requestId:'owner_process_stop_once',processId});
  assert.equal(again.id,stopped.id);
  for(let n=0;n<100;n++){
    const status=await f.kernel.service.invoke(f.kernel.context,
      'repository_process_status',{...nextClaim,processId});
    if(status.state==='stopped'){
      assert.equal(status.externalEffectsVerified,false);
      return;
    }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.fail('owned process did not stop');
});
test('local write approval is independent, persisted, per-repository and revocable without losing read',async t=>{
  const f=await fixture(t),projectId=f.scope.projectId;
  f.trust.trustApp({expectedScopeHash:f.trust.appScopeHash()});
  f.trust.bindRemoteOwnerIdentity({subjectId:SUBJECT,issuer:ISSUER});
  f.roots.bindSelected({projectId,repository:REPO,selectedRoot:f.root});
  assert.equal(f.roots.hasApprovedRoot(projectId,{access:'write'}),false);
  await assert.rejects(f.roots.resolve({projectId,taskId:f.taskId,
    repository:REPO,access:'write'}),/forge_local_repository_write_approval_required/);
  const approved=f.roots.approveWrite({projectId,repository:REPO});
  assert.equal(approved.writeGranted,true);
  assert.equal(f.roots.hasApprovedRoot(projectId,{access:'write'}),true);
  assert.equal(f.roots.status({projectId,repository:REPO}).writeGranted,true);
  const writePort=new ForgeRepositoryOwnerWritePort({
    store:f.store,repositoryCatalog:f.catalog,
    resolveOwnerBinding:scope=>f.roots.resolve(scope)
  });
  f.kernel.service.repositoryWritePort=writePort;
  const args={projectId,taskId:f.taskId,repository:REPO,
    claimToken:f.claim.claimToken,claimGeneration:f.claim.claim.generation,
    requestId:'owner_write_permission_e2e',path:'WRITE.md',
    content:'owner approval proof\n',expectedHeadSha:git(f.root,'rev-parse','HEAD')};
  const proof=await f.kernel.service.invoke(f.kernel.context,'repository_file_write',args);
  assert.equal(proof.status,'succeeded');
  assert.equal(proof.result.verified,true);
  assert.equal(fs.readFileSync(path.join(f.root,'WRITE.md'),'utf8'),args.content);
  const revoked=f.roots.revokeWrite({projectId,repository:REPO});
  assert.equal(revoked.writeRevoked,true);
  assert.equal(f.roots.hasApprovedRoot(projectId,{access:'read'}),true);
  assert.equal(f.roots.hasApprovedRoot(projectId,{access:'write'}),false);
  assert.equal(f.roots.status({projectId,repository:REPO}).readGranted,true);
  await assert.rejects(f.roots.resolve({projectId,taskId:f.taskId,
    repository:REPO,access:'write'}),/forge_local_repository_write_approval_required/);
  await assert.rejects(f.kernel.service.invoke(f.kernel.context,'repository_file_write',{
    ...args,requestId:'owner_write_after_revoke',content:'forbidden'
  }),/forge_local_repository_write_approval_required/);
  assert.equal(fs.readFileSync(path.join(f.root,'WRITE.md'),'utf8'),args.content);
});
