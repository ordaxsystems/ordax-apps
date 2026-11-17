import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {ForgeProjectDevelopment} from '../src/forge-project-development.mjs';
import {ForgeLocalWorkspaces} from '../src/forge-local-workspaces.mjs';
import {ForgeMcpOwnerTrust} from '../src/forge-mcp-owner-trust.mjs';
import {FORGE_APP_MCP_OPERATIONS} from '../src/forge-loopback-mcp.mjs';

const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
async function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-work-accept-'));
  const folder=path.join(dir,'repo');fs.mkdirSync(folder);
  git(folder,'init','-b','main');
  git(folder,'config','user.email','forge-test@ordax.local');
  git(folder,'config','user.name','Forge Test');
  git(folder,'config','core.autocrlf','false');
  fs.writeFileSync(path.join(folder,'README.md'),'base\n');
  git(folder,'add','README.md');git(folder,'commit','-m','base');
  const dbFile=path.join(dir,'forge.sqlite');
  let store=new Store(dbFile);
  const context={actorId:'owner',clientId:'desktop',
    workspaceSessionId:store.getWorkspaceSession().id};
  const workspaces=new ForgeLocalWorkspaces({store,documentsDirectory:dir});
  const trust=new ForgeMcpOwnerTrust({store,appIdentity:dir,
    scopeSignature:id=>{
      const b=workspaces.binding(id);
      return b?'owner-bound:'+b.root+':'+b.identity:'app-private:'+id;
    }});
  const development=new ForgeProjectDevelopment({store,workspaces,ownerTrust:trust});
  let service=new OrchestratorService({store,development,
    authorize:({context:who})=>who===context});
  const invoke=(operation,input)=>service.invoke(context,operation,input);
  const projectId=(await invoke('project_create',{
    name:'Postmerge integration',requestId:'accepted_project'})).result.projectId;
  workspaces.bindSelected(projectId,folder);
  trust.trustApp();trust.trust(projectId);
  development.approve(projectId,{expectedScopeHash:trust.scopeHash(projectId)});
  const orchestratorId=(await invoke('orchestrator_create',{
    projectId,name:'Integrator',mission:'Integrate',requestId:'accepted_coordinator'})).result.orchestratorId;
  const taskId=(await invoke('work_create',{
    projectId,orchestratorId,title:'Feature',requestId:'accept_feature'})).result.taskId;
  const dependent=(await invoke('work_create',{
    projectId,orchestratorId,title:'Dependent',requestId:'accept_child'})).result.taskId;
  await invoke('work_dependency_set',{
    projectId,taskId:dependent,dependsOn:[taskId],requestId:'accept_deps'});
  const accept=(requestId,options)=>invoke('work_accept',{projectId,taskId,requestId,...options});
  const reopen=()=>{
    store.close();
    store=new Store(dbFile);
    service=new OrchestratorService({store,authorize:({context:who})=>who===context});
  };
  t.after(()=>{try{store.close();}catch{}fs.rmSync(dir,{recursive:true,force:true})});
  return {folder,context,projectId,taskId,dependent,workspaces,development,
    accept,invoke,reopen,getStore:()=>store};
}

test('Task acceptance requires real native test on integrated main, persists in SQLite and unlocks DAG',async t=>{
  const f=await fixture(t),p=f.projectId,taskId=f.taskId;
  assert.ok(FORGE_APP_MCP_OPERATIONS.includes('work_accept'));
  const prepared=await f.invoke('project_worktree_prepare',{
    projectId:p,taskId,requestId:'accept_prepare'});
  assert.equal(prepared.status,'succeeded');
  const branch=path.join(f.folder,'.forge-worktrees',taskId);
  fs.mkdirSync(path.join(branch,'test'),{recursive:true});
  fs.writeFileSync(path.join(branch,'test','feature.test.mjs'),
    "import test from 'node:test'; import assert from 'node:assert/strict'; test('feature',()=>assert.equal(2+2,4));\n");
  git(branch,'add','test/feature.test.mjs');
  git(branch,'commit','-m','add-verified-feature');
  const runId=f.getStore().startRun(taskId);
  f.getStore().finishRun(taskId,runId);
  const review=await f.invoke('project_worktree_review',{projectId:p,taskId});
  const verified=await f.invoke('project_worktree_verify',{
    projectId:p,taskId,command:'node --test test/feature.test.mjs',
    requestId:'accept_premerge_test',timeoutMs:30000});
  assert.equal(verified.status,'succeeded');
  assert.equal(verified.result.verified,true);
  const integrated=await f.invoke('project_worktree_integrate',{
    projectId:p,taskId,expectedBranchHeadSha:review.branchHeadSha,
    expectedMainHeadSha:review.mainHeadSha,
    verificationReceiptIds:[verified.commandId],
    requestId:'accept_merge'});
  assert.equal(integrated.status,'succeeded');
  const input={integrationReceiptId:integrated.commandId,
    expectedIntegratedHeadSha:integrated.result.integratedHeadSha,
    testCommand:'node --test test/feature.test.mjs',timeoutMs:30000};
  let plan=(await f.invoke('work_plan',{projectId:p})).plan;
  assert.ok(plan.blocked.includes(f.dependent));
  assert.equal(plan.workers.find(x=>x.taskId===taskId).effectVerified,false);
  // A persisted Run by itself is not an independently confirmed provider send.
  await assert.rejects(f.accept('not_sent',input),
    /forge_work_accept_provider_receipt_missing/);
  const receiptService=new OrchestratorService({store:f.getStore(),
    authorize:({context:who})=>who===f.context});
  receiptService.transaction(()=>{
    const reserved=receiptService.reserve(f.context,'work_send',{
      projectId:p,taskId,requestId:'simulated_confirmed_provider'});
    receiptService.finish(reserved.commandId,{
      taskId,runId,responseObserved:true,effectVerified:false});
  });
  await assert.rejects(f.accept('invalid_echo',{...input,testCommand:'echo PASS'}),
    /forge_work_accept_test_command_invalid/);
  await assert.rejects(f.accept('invalid_head',{
    ...input,expectedIntegratedHeadSha:'a'.repeat(40)}),
    /forge_work_accept_integration_unverified/);
  const failed=await f.accept('real_fail',{
    ...input,testCommand:'node --test test/missing.test.mjs'});
  assert.equal(failed.status,'failed');
  assert.equal(failed.result.accepted,false);
  assert.equal(f.getStore().db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId).status!=='completed',true);
  const accepted=await f.accept('verified_after_merge',input);
  assert.equal(accepted.status,'succeeded');
  assert.equal(accepted.result.verified,true);
  assert.equal(accepted.result.accepted,true);
  assert.equal(accepted.result.testedMainHeadSha,integrated.result.integratedHeadSha);
  assert.equal(accepted.result.acceptanceScope,'verified_integrated_git_milestone');
  assert.deepEqual(await f.accept('verified_after_merge',input),accepted);
  await assert.rejects(f.accept('new_duplicate_acceptance',input),
    /forge_work_accept_run_unverified/);
  plan=(await f.invoke('work_plan',{projectId:p})).plan;
  const work=plan.workers.find(x=>x.taskId===taskId);
  assert.equal(work.state,'succeeded');
  assert.equal(work.effectVerified,true);
  assert.equal(work.verificationRequired,false);
  assert.ok(plan.candidates.includes(f.dependent));
  assert.equal(plan.automaticDispatchAllowed,false);
  assert.equal(plan.qualityCertified,false);
  const handoff=await f.invoke('project_handoff',{projectId:p,taskId});
  const task=handoff.tasks.find(x=>x.taskId===taskId);
  assert.equal(task.completionVerified,true);
  assert.equal(task.acceptanceEvidence.scope,'verified_integrated_git_milestone');
  assert.equal(task.acceptanceEvidence.currentGitHeadVerified,false);
  assert.equal(task.acceptanceEvidence.websitePublished,false);
  assert.equal(f.getStore().db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  f.reopen();
  const persisted=(await f.invoke('work_plan',{projectId:p})).plan;
  assert.ok(persisted.candidates.includes(f.dependent));
  assert.equal(persisted.workers.find(x=>x.taskId===taskId).effectVerified,true);
});

test('manual Task status or forged Run alone never proves integration or acceptance',async t=>{
  const f=await fixture(t);
  const store=f.getStore();
  const runId=store.startRun(f.taskId);store.finishRun(f.taskId,runId);
  store.db.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(f.taskId);
  const p=(await f.invoke('work_plan',{projectId:f.projectId})).plan;
  assert.equal(p.workers.find(x=>x.taskId===f.taskId).effectVerified,false);
  assert.equal(p.workers.find(x=>x.taskId===f.taskId).state,'blocked');
  assert.ok(p.blocked.includes(f.dependent));
  assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
