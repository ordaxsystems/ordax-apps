import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../src/store.mjs';
import {ForgeMcpOwnerTrust} from '../src/forge-mcp-owner-trust.mjs';
import {ForgeLocalRepositoryOwnerBindings} from '../src/forge-local-repository-owner-bindings.mjs';
import {ForgeRepositoryOwnerReadPort} from '../src/forge-repository-owner-read-port.mjs';
import {createOrchestratorKernel} from '../src/orchestrator-kernel.mjs';
import {activateDedicatedForgeProject} from '../src/forge-dedicated-project.mjs';
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
