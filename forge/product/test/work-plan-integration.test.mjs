import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';

function fixture(t,{persistent=false}={}){
  const dir=persistent?fs.mkdtempSync(path.join(os.tmpdir(),'ordax-dag-')):null;
  const file=persistent?path.join(dir,'lab.sqlite'):':memory:';
  let store=new Store(file);
  const context=Object.freeze({actorId:'test-owner',clientId:'test-client',
    workspaceSessionId:store.getWorkspaceSession().id});
  let seq=0;
  let service=new OrchestratorService({store,authorize:({context:ctx})=>ctx===context});
  const call=(op,input={})=>service.invoke(context,op,{
    ...(!ORCHESTRATOR_TOOLS.find(x=>x.operation===op)?.readOnly
      ?{requestId:'request_'+(++seq)}:{}),...input
  });
  const makeProject=async()=>{
    const projectId=(await call('project_create',{name:'OrdaX',objective:'Parallel operations'})).result.projectId;
    const orchestratorId=(await call('orchestrator_create',{
      projectId,name:'Forge',mission:'Coordinate without dispatch'
    })).result.orchestratorId;
    const work=async title=>(await call('work_create',{projectId,orchestratorId,title})).result.taskId;
    return {projectId,orchestratorId,work};
  };
  const reopen=()=>{
    if(!persistent)throw Error('test_requires_persistent_store');
    store.close();store=new Store(file);
    service=new OrchestratorService({store,authorize:({context:ctx})=>ctx===context});
  };
  t.after(()=>{try{store.close();}catch{}if(dir)fs.rmSync(dir,{recursive:true,force:true});});
  return {call,makeProject,reopen,getStore:()=>store,effects:()=>0,
    analysis:(projectId,orchestratorId)=>service.analysisContext(projectId,orchestratorId)};
}

test('real SQLite: multi-worker dependency persists across restart and is not unlocked by a GPT Run alone',async t=>{
  const f=fixture(t,{persistent:true}),{projectId,work}=await f.makeProject();
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
  assert.deepEqual(plan.candidates,[d]);
  assert.deepEqual(plan.blocked,[b,c]);
  assert.deepEqual(plan.verificationRequired,[a]);
  assert.deepEqual(plan.workers.find(w=>w.taskId===a),{
    taskId:a,state:'blocked',dependsOn:[],responseObserved:true,
    effectVerified:false,verificationRequired:true
  });
  assert.equal(f.effects(),0);
});
test('real SQLite: unverified GPT completion stays blocked without effect verification',async t=>{
  const f=fixture(t),{projectId,work}=await f.makeProject();
  const draft=await work('Research'),implementation=await work('Implement');
  await f.call('work_dependency_set',{projectId,taskId:implementation,dependsOn:[draft]});
  const run=f.getStore().startRun(draft);
  f.getStore().finishRun(draft,run);
  const plan=(await f.call('work_plan',{projectId})).plan;
  assert.deepEqual(plan.verificationRequired,[draft]);
  assert.deepEqual(plan.blocked,[implementation]);
  assert.equal(plan.workers.find(w=>w.taskId===draft).effectVerified,false);
  assert.equal(plan.workers.find(w=>w.taskId===implementation).state,'pending');
  assert.equal(plan.automaticDispatchAllowed,false);
  assert.equal(f.effects(),0);
});
test('real SQLite: failed prerequisite transitively blocks descendants, not unrelated workers',async t=>{
  const f=fixture(t),{projectId,work}=await f.makeProject();
  const a=await work('Build'),b=await work('Integration'),c=await work('Release'),d=await work('Docs');
  // Simulate the normal case in which multiple Tasks share a timestamp.
  // Read-model order must follow insertion, never randomly ordered UUIDs.
  f.getStore().db.prepare('UPDATE tasks SET created_at=? WHERE id IN (?,?,?,?)')
    .run('2026-11-04T00:00:00.000Z',a,b,c,d);
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
test('atomic batch registers 12 distinct specialists with one receipt',async t=>{
  const f=fixture(t),{projectId,orchestratorId}=await f.makeProject();
  const titles=Array.from({length:12},(_,i)=>'Especialista '+(i+1));
  const command={projectId,orchestratorId,titles,requestId:'atomic-batch-12'};
  const first=await f.call('work_batch_create',command);
  assert.equal(first.status,'succeeded');
  assert.equal(first.result.created,12);
  assert.equal(first.result.taskIds.length,12);
  assert.equal(new Set(first.result.taskIds).size,12);
  assert.equal(first.result.providerMessagesSent,0);
  assert.deepEqual(await f.call('work_batch_create',command),first);
  let plan=(await f.call('work_plan',{projectId,maxParallel:6})).plan;
  assert.equal(plan.workCount,12);
  assert.equal(plan.candidates.length,6);
  assert.equal(plan.remainingCandidates,6);
  assert.equal(plan.automaticDispatchAllowed,false);
  plan=(await f.call('work_plan',{projectId,maxParallel:6})).plan;
  assert.equal(plan.workCount,12);
  assert.equal(plan.candidates.length,6);
  assert.equal(f.effects(),0);
});
test('atomic batch rejects existing fronts across request IDs without partial creation',async t=>{
  const f=fixture(t),{projectId,orchestratorId}=await f.makeProject();
  const scope={projectId,orchestratorId};
  const original=(await f.call('work_create',{...scope,title:'Fonte Oficial'})).result.taskId;
  const first=await f.call('work_batch_create',{...scope,titles:['Design','Testes']});
  assert.equal(first.status,'succeeded');
  await assert.rejects(f.call('work_batch_create',{
    ...scope,titles:['Nova frente','  FONTE  oficial  ']
  }),/orchestrator_batch_title_already_exists/);
  await assert.rejects(f.call('work_batch_create',{
    ...scope,titles:['Outra frente',' design ']
  }),/orchestrator_batch_title_already_exists/);
  assert.equal((await f.call('work_plan',{projectId})).plan.workCount,3);
  await assert.rejects(f.call('work_batch_create',{
    ...scope,titles:['Depois do reinício','TESTES']
  }),/orchestrator_batch_title_already_exists/);
  const works=(await f.call('work_list',scope)).works;
  assert.equal(works.length,3);
  assert.ok(works.some(work=>work.id===original));
  assert.equal(f.effects(),0);
});
test('atomic batch rejects duplicates, invalid sizes and foreign coordinator with no partial work',async t=>{
  const f=fixture(t),a=await f.makeProject(),b=await f.makeProject();
  const scope={projectId:a.projectId,orchestratorId:a.orchestratorId};
  for(const titles of [['Only one'],['Build','build'],['Build','  Build  '],['Valid','Invalid\nLine']]){
    await assert.rejects(f.call('work_batch_create',{...scope,titles}),
      /orchestrator_batch_titles_invalid/);
  }
  await assert.rejects(f.call('work_batch_create',{...scope,titles:Array.from({length:17},(_,i)=>'Work '+i)}),
    /orchestrator_invalid_input/);
  await assert.rejects(f.call('work_batch_create',{
    projectId:a.projectId,orchestratorId:b.orchestratorId,titles:['A','B']
  }),/orchestrator_unavailable|orchestrator_access_denied|orchestrator_project_unavailable/);
  const works=(await f.call('work_list',{projectId:a.projectId,orchestratorId:a.orchestratorId})).works;
  assert.deepEqual(works,[]);
  assert.equal(f.effects(),0);
});
test('real SQLite rolls back the entire batch when the second binding insert fails',async t=>{
  const f=fixture(t),{projectId,orchestratorId}=await f.makeProject();
  const db=f.getStore().db;
  db.exec(`CREATE TRIGGER reject_second_bulk_work BEFORE INSERT ON lab_task_bindings
    WHEN NEW.kind='work' AND
      (SELECT COUNT(*) FROM lab_task_bindings
        WHERE project_id=NEW.project_id AND kind='work')>0
    BEGIN SELECT RAISE(ABORT,'injected_batch_binding_failure'); END`);
  await assert.rejects(f.call('work_batch_create',{
    projectId,orchestratorId,titles:['Rollback Alpha','Rollback Beta']
  }),/injected_batch_binding_failure/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tasks WHERE title LIKE 'Rollback %'").get().n,0);
  assert.equal((await f.call('work_plan',{projectId})).plan.workCount,0);
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

test('work plan never upgrades a Run-only prerequisite into verified readiness',async t=>{
  const f=fixture(t),{projectId,work}=await f.makeProject();
  const predecessor=await work('Source'),dependent=await work('Publish');
  await f.call('work_dependency_set',{projectId,taskId:dependent,dependsOn:[predecessor]});
  const before=(await f.call('work_plan',{projectId})).plan;
  assert.deepEqual(before.waiting,[dependent]);
  assert.equal(ORCHESTRATOR_TOOLS.some(tool=>tool.operation==='work_send'),false);
  const confirmedRun=f.getStore().startRun(predecessor);
  f.getStore().finishRun(predecessor,confirmedRun);
  const after=(await f.call('work_plan',{projectId})).plan;
  assert.deepEqual(after.verificationRequired,[predecessor]);
  assert.deepEqual(after.blocked,[dependent]);
  assert.equal(after.workers.find(w=>w.taskId===dependent)?.state,'pending');
  assert.equal(after.automaticDispatchAllowed,false);
});
test('prerequisites are immutable after the target has started a Run',async t=>{
  const f=fixture(t),{projectId,work}=await f.makeProject();
  const build=await work('Build'),audit=await work('Audit'),release=await work('Release');
  await f.call('work_dependency_set',{projectId,taskId:release,dependsOn:[build]});
  const started=f.getStore().startRun(release);
  await assert.rejects(f.call('work_dependency_set',{projectId,taskId:release,dependsOn:[audit]}),
    /orchestrator_dependencies_locked_after_execution/);
  f.getStore().finishRun(release,started);
  await assert.rejects(f.call('work_dependency_set',{projectId,taskId:release,dependsOn:[]}),
    /orchestrator_dependencies_locked_after_execution/);
  const listing=await f.call('work_list',{projectId});
  assert.deepEqual(listing.works.find(w=>w.id===release).dependsOn,[build]);
  assert.equal(f.effects(),0);
});
test('historical uncertain provider receipt still freezes prerequisite edits',async t=>{
  const f=fixture(t),{projectId,work}=await f.makeProject();
  const build=await work('Build'),release=await work('Release');
  await f.call('work_dependency_set',{projectId,taskId:release,dependsOn:[]});
  const db=f.getStore().db,now=f.getStore().now();
  db.prepare('INSERT INTO lab_command_receipts (id,workspace_session_id,actor_id,client_id,request_id,project_id,operation,input_hash,status,result,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(
    'legacy_uncertain_send',f.getStore().getWorkspaceSession().id,
    'test-owner','test-client','legacy_uncertain_request',projectId,'work_send',
    'a'.repeat(64),'uncertain',JSON.stringify({taskId:release}),now,now);
  await assert.rejects(
    f.call('work_dependency_set',{projectId,taskId:release,dependsOn:[build]}),
    /orchestrator_dependencies_locked_after_execution/
  );
  const listing=await f.call('work_list',{projectId});
  assert.deepEqual(listing.works.find(w=>w.id===release).dependsOn,[]);
  assert.equal(ORCHESTRATOR_TOOLS.some(tool=>tool.operation==='work_send'),false);
});
test('analysis view sees 35 scoped work fronts and prioritizes failures from canonical SQLite',async t=>{
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
  assert.equal(context.workOverview[0].readiness,'uncertain');
  assert.equal(context.planning.workCount,35);
  assert.equal(context.planning.candidateTaskIds.includes(foreign),false);
  assert.equal(context.planning.candidateTaskIds.includes(foreignProjectWork),false);
  assert.doesNotMatch(JSON.stringify(context),/OTHER_TEAM_PRIVATE|OTHER_PROJECT_PRIVATE/);
  assert.equal(context.planning.automaticDispatchAllowed,false);
  assert.equal(f.effects(),0);
  const recovered=f.analysis(a.projectId,a.orchestratorId);
  assert.equal(recovered.scope.totalWorkCount,35);
  assert.equal(recovered.workOverview[0].readiness,'uncertain');
});

test('planner has no App-owned provider lane admission',()=>{
  const service=fs.readFileSync(new URL('../src/orchestrator-service.mjs',import.meta.url),'utf8');
  const main=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(service,/providerCapacity|this\.provider|dispatchCore|operation==='work_send'/);
  assert.doesNotMatch(main,/createProviderExecutionScheduler|providerScheduler|enqueueExecution/);
  assert.match(main,/maxConcurrentSends:0,active:0,queued:0,pendingTasks:0,availableSlots:0,closed:true/);
});
