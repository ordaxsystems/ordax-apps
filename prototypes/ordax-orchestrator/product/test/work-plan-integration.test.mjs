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

test('prerequisites are immutable after the target has started a Run, including after restart',async t=>{
  const f=fixture(t),{projectId,work}=await f.makeProject();
  const build=await work('Build'),audit=await work('Audit'),release=await work('Release');
  await f.call('work_dependency_set',{projectId,taskId:release,dependsOn:[build]});
  const started=f.getStore().startRun(release);
  await assert.rejects(f.call('work_dependency_set',{projectId,taskId:release,dependsOn:[audit]}),
    /orchestrator_dependencies_locked_after_execution/);
  f.getStore().finishRun(release,started);
  f.reopen();
  await assert.rejects(f.call('work_dependency_set',{projectId,taskId:release,dependsOn:[]}),
    /orchestrator_dependencies_locked_after_execution/);
  const listing=await f.call('work_list',{projectId});
  assert.deepEqual(listing.works.find(w=>w.id===release).dependsOn,[build]);
  assert.equal(f.effects(),0);
});
test('uncertain provider outcome without a Run freezes prerequisite edits',async t=>{
  const f=fixture(t),{projectId,work}=await f.makeProject();
  const build=await work('Build'),release=await work('Release');
  await f.call('work_dependency_set',{projectId,taskId:release,dependsOn:[]});
  const outcome=await f.call('work_send',{projectId,taskId:release,content:'Investigate'});
  assert.equal(outcome.status,'uncertain');
  assert.equal(f.effects(),1);
  await assert.rejects(f.call('work_dependency_set',{projectId,taskId:release,dependsOn:[build]}),
    /orchestrator_dependencies_locked_after_execution/);
  const listing=await f.call('work_list',{projectId});
  assert.deepEqual(listing.works.find(w=>w.id===release).dependsOn,[]);
  assert.equal(f.effects(),1);
});

test('Groq sees 35 scoped work fronts, prioritizes failures and recovers the overview from SQLite',async t=>{
  const f=fixture(t),a=await f.makeProject();
  const first=await a.work('Foundation needs attention');
  const run=f.getStore().startRun(first);
  f.getStore().finishRun(first,run,'root_cause_not_resolved');
  for(let i=0;i<34;i++)await a.work('Independent task '+i);
  const other=(await f.call('orchestrator_create',{
    projectId:a.projectId,name:'Other team',mission:'Private team'
  })).result.orchestratorId;
  const foreign=(await f.call('work_create',{
    projectId:a.projectId,orchestratorId:other,title:'OTHER_TEAM_PRIVATE'
  })).result.taskId;
  const another=await f.makeProject();
  const foreignProjectWork=await another.work('OTHER_PROJECT_PRIVATE');
  const context=f.analysis(a.projectId,a.orchestratorId);
  assert.equal(context.scope.totalWorkCount,35);
  assert.equal(context.scope.overviewCount,32);
  assert.equal(context.scope.overviewTruncated,true);
  assert.equal(context.scope.workLimit,4);
  assert.equal(context.scope.messageLimitPerWork,5);
  assert.equal(context.works.length,4);
  assert.equal(context.workOverview.length,32);
  assert.equal(context.workOverview[0].title,'Foundation needs attention');
  assert.equal(context.workOverview[0].readiness,'failed');
  assert.equal(context.planning.workCount,35);
  assert.equal(context.planning.candidateTaskIds.includes(foreign),false);
  assert.equal(context.planning.candidateTaskIds.includes(foreignProjectWork),false);
  assert.doesNotMatch(JSON.stringify(context),/OTHER_TEAM_PRIVATE|OTHER_PROJECT_PRIVATE/);
  assert.equal(context.planning.automaticDispatchAllowed,false);
  assert.equal(f.effects(),0);
  f.reopen();
  const recovered=f.analysis(a.projectId,a.orchestratorId);
  assert.equal(recovered.scope.totalWorkCount,35);
  assert.equal(recovered.workOverview[0].readiness,'failed');
});
