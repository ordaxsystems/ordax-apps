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
  const binding={projectId:scope.projectId,taskId,repository:REPO,
    root,ownerApproved:true,readAuthorized:true,authority:'forge_native_owner',
    validUntil:'2099-01-01T00:00:00Z'};
  const grant=()=>binding;
  const port=new ForgeRepositoryOwnerReadPort({
    store,repositoryCatalog:catalog,resolveOwnerBinding:grant});
  return {store,root,scope,taskId,binding,port,dir,catalog};
}

test('Forge-native read port verifies exact Task, owner grant, Git origin/HEAD and reuses existing safe file broker',async t=>{
  const f=await fixture(t),args={projectId:f.scope.projectId,taskId:f.taskId,repository:REPO};
  const proof=f.port.inspect(args);
  assert.equal(proof.originVerified,true);
  assert.equal(proof.ownerGrantVerified,true);
  assert.equal(proof.rootPathExposed,false);
  assert.match(proof.headSha,/^[a-f0-9]{40}$/);
  const file=f.port.read({...args,path:'README.md'});
  assert.equal(file.content,'read-only contract\n');
  assert.equal(file.sha256,'e42a6beff992cb7c7934a00d2431525575034e299ffa008031ee3b67906f8f6a');
  assert.equal(file.gitHeadSha,proof.headSha);
  assert.equal(file.rootPathExposed,false);
  const list=f.port.list({...args,directory:''});
  assert.equal(list.entries.some(entry=>entry.name==='README.md'),true);
  assert.equal(list.entries.find(entry=>entry.name==='.git')?.kind,'directory');
  assert.throws(()=>f.port.read({...args,path:'../README.md'}),/forge_file_path_invalid/);
  assert.throws(()=>f.port.read({...args,path:'.git/config'}),/forge_file_path_invalid/);
});

test('Forge-native per-repository reader fails closed without exact owner grant, manifest scope or verified root',async t=>{
  const f=await fixture(t),args={projectId:f.scope.projectId,taskId:f.taskId,repository:REPO};
  const port=grant=>new ForgeRepositoryOwnerReadPort({store:f.store,
    repositoryCatalog:f.catalog,resolveOwnerBinding:()=>grant});
  assert.throws(()=>port(null).inspect(args),/forge_repository_owner_port_and_grant_required/);
  assert.throws(()=>port({...f.binding,ownerApproved:false}).inspect(args),/forge_repository_owner_port_and_grant_required/);
  assert.throws(()=>port({...f.binding,readAuthorized:false}).inspect(args),/forge_repository_owner_port_and_grant_required/);
  assert.throws(()=>port({...f.binding,validUntil:'2000-01-01T00:00:00Z'}).inspect(args),/forge_repository_owner_port_and_grant_required/);
  assert.throws(()=>port({...f.binding,taskId:'task_other'}).inspect(args),/forge_repository_owner_port_and_grant_required/);
  assert.throws(()=>f.port.inspect({...args,repository:'ordaxsystems/ordax-os'}),/forge_task_repository_scope_not_assigned/);
  run(f.root,'remote','set-url','origin','https://github.com/unknown/other.git');
  assert.throws(()=>f.port.inspect(args),/forge_repository_origin_mismatch/);
});

test('Forge-native reader rechecks authorization after I/O and does not reveal file after revocation',async t=>{
  const f=await fixture(t),args={projectId:f.scope.projectId,taskId:f.taskId,repository:REPO};
  let calls=0;
  const port=new ForgeRepositoryOwnerReadPort({store:f.store,
    repositoryCatalog:f.catalog,resolveOwnerBinding:()=>{
      calls++;
      return calls===1?f.binding:null;
    }});
  assert.throws(()=>port.read({...args,path:'README.md'}),
    /forge_repository_owner_port_and_grant_required/);
});
