import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHostApplication} from '../host/host-application.mjs';
import {ForgeMcpOwnerTrust} from '../src/forge-mcp-owner-trust.mjs';
import {ForgeLocalRepositoryOwnerBindings} from '../src/forge-local-repository-owner-bindings.mjs';
import {FORGE_NATIVE_OAUTH_CLIENT_ID} from '../src/forge-product-session.mjs';
import {readDedicatedForgeProject} from '../src/forge-dedicated-project.mjs';

const OWNER='11111111-2222-4333-8444-555555555555';
const ISSUER='https://jhfphsjptrpmtnzkpwud.supabase.co/auth/v1';
const REPO='ordaxsystems/ordax-apps';
const git=(root,...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',
  timeout:10000,windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
function checkout(root,repository){
  fs.mkdirSync(root,{recursive:true});
  git(root,'init','-q');git(root,'config','user.name','Forge Test');
  git(root,'config','user.email','forge-test@example.invalid');
  git(root,'remote','add','origin','https://github.com/'+repository+'.git');
}
test('local Owner root becomes a real Forge MCP read port only after the Owner restarts',async t=>{
  const folder=await fsp.mkdtemp(path.join(os.tmpdir(),'forge-native-repo-restart-'));
  const userRoot=path.join(folder,'OrdaX','Forge');
  const dataRoot=path.join(userRoot,'data');
  const documentsDirectory=path.join(folder,'Documents');
  const catalog=path.join(documentsDirectory,'GitHub','ordax-os');
  const local=path.join(documentsDirectory,'GitHub','ordax-apps');
  checkout(catalog,'ordaxsystems/ordax-os');
  fs.mkdirSync(path.join(catalog,'docs','contracts'),{recursive:true});
  fs.writeFileSync(path.join(catalog,'docs','contracts','repository-ownership.json'),
    JSON.stringify({status:'canonical',repositories:{
      os:{repo:'ordaxsystems/ordax-os'},
      apps:{repo:REPO}
    }}));
  git(catalog,'add','.');
  git(catalog,'commit','-qm','canonical manifest fixture');
  checkout(local,REPO);
  fs.writeFileSync(path.join(local,'README.md'),'physical Forge Owner root\n');
  git(local,'add','README.md');git(local,'commit','-qm','Owner checkout fixture');
  const session={status:()=>({
    connected:true,mode:'oauth',clientId:FORGE_NATIVE_OAUTH_CLIENT_ID
  }),accessToken:async()=> 'LOCAL_SYNTHETIC_TOKEN_NOT_FOR_NETWORK'};
  let app=null;
  const launch=()=>createHostApplication({
    productRoot:path.resolve(''),dataRoot,remoteSession:session,
    nativeOwner:{userRoot,documentsDirectory,dedicatedProject:true},environment:{}
  });
  t.after(async()=>{app?.close();await fsp.rm(folder,{recursive:true,force:true,maxRetries:5,retryDelay:120})});
  app=launch();
  const projectId=readDedicatedForgeProject(app.store).projectId;
  assert.equal(app.service.repositoryReadPort,null,
    'OAuth and repository catalog alone cannot advertise a native file tool');
  const trust=new ForgeMcpOwnerTrust({
    store:app.store,appIdentity:userRoot,
    scopeSignature:id=>'app-private:'+id
  });
  trust.trustApp({expectedScopeHash:trust.appScopeHash()});
  trust.bindRemoteOwnerIdentity({subjectId:OWNER,issuer:ISSUER});
  const selected=new ForgeLocalRepositoryOwnerBindings({
    store:app.store,ownerTrust:trust,
    repositoryCatalog:app.service.repositoryCatalogPort,session});
  assert.equal(selected.hasApprovedRoot(projectId),false);
  selected.bindSelected({projectId,repository:REPO,selectedRoot:local});
  assert.equal(selected.hasApprovedRoot(projectId),true);
  const coordinator=await app.service.invoke(app.context,'orchestrators_list',{projectId});
  const work=await app.service.invoke(app.context,'work_create',{
    projectId,orchestratorId:coordinator.orchestrators[0].id,
    title:'Owner restart test',requestId:'owner_restart_create'
  });
  const taskId=work.result.taskId;
  const claim=await app.service.invoke(app.context,'work_claim',{
    projectId,taskId,action:'acquire',
    chatLabel:'owner-local',requestId:'owner_restart_claim'
  });
  const proof={projectId,taskId,repository:REPO,
    claimToken:claim.result.claimToken,
    claimGeneration:claim.result.claim.generation};
  await app.service.invoke(app.context,'work_repositories_set',{
    projectId,taskId,claimToken:proof.claimToken,
    claimGeneration:proof.claimGeneration,
    repositories:[REPO],requestId:'owner_restart_assign'
  });
  app.close();app=null;
  app=launch();
  assert.equal(typeof app.service.repositoryReadPort?.read,'function',
    'native Forge Owner must compose its own reader from persisted consent');
  const data=await app.service.invoke(app.context,'repository_file_read',{
    ...proof,path:'README.md'
  });
  assert.equal(data.content,'physical Forge Owner root\n');
  assert.equal(data.rootPathExposed,false);
  assert.equal(data.ownerGrantVerified,true);
  assert.match(data.sha256,/^[0-9a-f]{64}$/);
  const after=new ForgeLocalRepositoryOwnerBindings({
    store:app.store,
    ownerTrust:new ForgeMcpOwnerTrust({
      store:app.store,appIdentity:userRoot,
      scopeSignature:id=>'app-private:'+id
    }),
    repositoryCatalog:app.service.repositoryCatalogPort,session
  });
  assert.equal(after.revoke({projectId,repository:REPO}).revoked,true);
  await assert.rejects(app.service.invoke(app.context,'repository_file_read',{
    ...proof,path:'README.md'
  }),/forge_local_repository_owner_binding_required/);
});
