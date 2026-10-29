import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {ORCHESTRATOR_TOOLS} from '../src/orchestrator-contract.mjs';

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-dag-'));
  const file=path.join(dir,'lab.sqlite');
  let store=new Store(file);
  const context=Object.freeze({actorId:'test-owner',clientId:'test-client',
    workspaceSessionId:store.getWorkspaceSession().id});
  let effects=0,seq=0;
  let service=new OrchestratorService({store,authorize:({context:ctx})=>ctx===context,
    provider:{send:()=>{effects++;throw Error('unexpected_provider_send');}}});
  const call=(op,input={})=>service.invoke(context,op,{
    ...(!ORCHESTRATOR_TOOLS.find(x=>x.operation===op)?.readOnly
      ?{requestId:'request_'+(++seq)}:{}),...input
  });
  const makeProject=async()=>{
    const projectId=(await call('project_create',{name:'OrdaX',objective:'Parallel operations'})).result.projectId;
    const orchestratorId=(await call('orchestrator_create',{
      projectId,name:'Groq',mission:'Coordinate without dispatch'
    })).result.orchestratorId;
    const work=async title=>(await call('work_create',{projectId,orchestratorId,title})).result.taskId;
    return {projectId,orchestratorId,work};
  };
  const reopen=()=>{
    store.close();store=new Store(file);
    service=new OrchestratorService({store,authorize:({context:ctx})=>ctx===context,
      provider:{send:()=>{effects++;throw Error('unexpected_provider_send');}}});
  };
  t.after(()=>{try{store.close();}catch{} fs.rmSync(dir,{recursive:true,force:true});});
  return {call,makeProject,reopen,getStore:()=>store,effects:()=>effects,
    analysis:(projectId,orchestratorId)=>service.analysisContext(projectId,orchestratorId)};
}
test('real SQLite: multi-worker dependency persists across restart and unlocks only after a successful Run',async t=>{
  const f=fixture(t),{projectId,work}=await f.makeProject();
  const a=await work('Foundation'),b=await work('Surface'),c=await work('Release'),d=await work('Documentation');
  await f.call('work_dependency_set',{projectId,taskId:b,dependsOn:[a]});
  await f.call('work_dependency_set',{projectId,taskId:c,dependsOn:[b]});
  let plan=(await f.call('work_plan',{projectId,maxParallel:2})).plan;
  assert.equal(plan.workCount,4);
  assert.deepEqual(plan.candidates,[a,d]);
  assert.deepEqual(plan.waiting,[b,c]);
  assert.equal(plan.automaticDispatchAllowed,false);
  f.reopen();
  plan=(await f.call('work_plan',{projectId,maxParallel:2})).plan;
  assert.deepEqual(plan.waiting,[b,c]);
  const run=f.getStore().startRun(a);
  assert.equal((await f.call('work_plan',{projectId})).plan.waiting.includes(b),true);
  f.getStore().finishRun(a,run);
  plan=(await f.call('work_plan',{projectId,maxParallel:2})).plan;
  assert.deepEqual(plan.candidates,[b,d]);
  assert.deepEqual(plan.waiting,[c]);
  assert.equal(f.effects(),0);
});
test('real SQLite: failed prerequisite transitively blocks descendants, not unrelated workers',async t=>{
  const f=fixture(t),{projectId,work}=await f.makeProject();
  const a=await work('Build'),b=await work('Integration'),c=await work('Release'),d=await work('Docs');
  await f.call('work_dependency_set',{projectId,taskId:b,dependsOn:[a]});
  await f.call('work_dependency_set',{projectId,taskId:c,dependsOn:[b]});
  const run=f.getStore().startRun(a);
  f.getStore().finishRun(a,run,'build_failed');
  const plan=(await f.call('work_plan',{projectId})).plan;
  assert.deepEqual(plan.blocked,[b,c]);
  assert.deepEqual(plan.candidates,[d]);
  assert.equal(plan.automaticDispatchAllowed,false);
});
test('real SQLite: cycle rejection is atomic and cross-project references are forbidden',async t=>{
  const f=fixture(t),first=await f.makeProject();
  const a=await first.work('A'),b=await first.work('B');
  await f.call('work_dependency_set',{projectId:first.projectId,taskId:b,dependsOn:[a]});
  await assert.rejects(f.call('work_dependency_set',{projectId:first.projectId,taskId:a,dependsOn:[b]}),/orchestrator_dependency_cycle/);
  const second=await f.makeProject();const foreign=await second.work('Foreign');
  await assert.rejects(f.call('work_dependency_set',{projectId:first.projectId,taskId:b,dependsOn:[foreign]}),/orchestrator_work_unavailable/);
  const plan=(await f.call('work_plan',{projectId:first.projectId})).plan;
  assert.deepEqual(plan.workers.find(w=>w.taskId===b).dependsOn,[a]);
  assert.deepEqual(plan.workers.find(w=>w.taskId===a).dependsOn,[]);
});
test('real SQLite: capped candidates support more than two independent chats without sending',async t=>{
  const f=fixture(t),{projectId,work}=await f.makeProject();
  for(let i=0;i<12;i++)await work('worker '+i);
  const plan=(await f.call('work_plan',{projectId,maxParallel:5})).plan;
  assert.equal(plan.workCount,12);
  assert.equal(plan.candidates.length,5);
  assert.equal(plan.remainingCandidates,7);
  assert.equal(f.effects(),0);
});
test('read model: empty project is legal and no worker is dispatched',async t=>{
  const f=fixture(t),{projectId}=await f.makeProject();
  const plan=(await f.call('work_plan',{projectId})).plan;
  assert.equal(plan.workCount,0);
  assert.deepEqual(plan.candidates,[]);
  assert.equal(plan.automaticDispatchAllowed,false);
});

test('coordinator receives bounded SSOT dependencies without an execution grant',async t=>{
  const f=fixture(t),{projectId,orchestratorId,work}=await f.makeProject();
  const build=await work('Build'),publish=await work('Publish'),docs=await work('Docs');
  await f.call('work_dependency_set',{projectId,taskId:publish,dependsOn:[build]});
  const analysis=f.analysis(projectId,orchestratorId);
  assert.equal(analysis.planning.state,'available');
  assert.deepEqual(analysis.planning.candidateTaskIds,[build,docs]);
  assert.equal(analysis.planning.waitingCount,1);
  assert.equal(analysis.planning.automaticDispatchAllowed,false);
  assert.equal(analysis.planning.qualityCertified,false);
  const run=f.getStore().startRun(build);f.getStore().finishRun(build,run,'test_failure');
  const later=f.analysis(projectId,orchestratorId);
  assert.equal(later.planning.blockedCount,1);
  assert.equal(later.planning.candidateTaskIds.includes(publish),false);
  assert.equal(f.effects(),0);
});

test('work send honors persisted prerequisites and checks again before the provider',async t=>{
  const f=fixture(t),{projectId,work}=await f.makeProject();
  const predecessor=await work('Source'),dependent=await work('Publish');
  await f.call('work_dependency_set',{projectId,taskId:dependent,dependsOn:[predecessor]});
  await assert.rejects(f.call('work_send',{projectId,taskId:dependent,content:'Publish now'}),
    /orchestrator_work_prerequisite_not_confirmed/);
  assert.equal(f.effects(),0);
  const confirmedRun=f.getStore().startRun(predecessor);
  f.getStore().finishRun(predecessor,confirmedRun);
  const receipt=await f.call('work_send',{projectId,taskId:dependent,content:'Publish after prerequisite'});
  assert.equal(receipt.status,'uncertain');
  assert.equal(f.effects(),1);
});
