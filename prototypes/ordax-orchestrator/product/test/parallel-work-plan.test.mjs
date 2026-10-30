import test from 'node:test';
import assert from 'node:assert/strict';
import {planParallelWork,buildContinuationEnvelope} from '../src/parallel-work-plan.mjs';
const task=(id,state='pending',dependsOn=[],projectId='ordax')=>({id,state,dependsOn,projectId});
test('dynamic worker count exceeds GPT A/B with capped parallel dispatch',()=>{
 const tasks=Array.from({length:12},(_,i)=>task('work'+i));
 const a=planParallelWork({tasks,maxParallel:5});
 assert.deepEqual(a.dispatch,['work0','work1','work2','work3','work4']);
 assert.equal(a.remainingReady,7);
});
test('DAG unlocks dependent work only after canonical success',()=>{
 const a=planParallelWork({tasks:[task('base','succeeded'),task('surface','pending',['base']),task('release','pending',['surface'])]});
 assert.deepEqual(a.dispatch,['surface']);assert.deepEqual(a.waiting,['release']);
});
test('uncertain delivery blocks descendants and never silently retries',()=>{
 const a=planParallelWork({tasks:[task('build','uncertain'),task('deploy','pending',['build'])]});
 assert.deepEqual(a.dispatch,[]);assert.deepEqual(a.blocked,['deploy']);
});
test('running workers consume capacity and independent work may proceed',()=>{
 const a=planParallelWork({tasks:[task('a','running'),task('b','running'),task('c'),task('d')],maxParallel:3});
 assert.deepEqual(a.dispatch,['c']);assert.equal(a.inFlight,2);
});
test('cross-project dependencies are prohibited',()=>{
 assert.throws(()=>planParallelWork({tasks:[task('a','succeeded',[],'alpha'),task('b','pending',['a'],'beta')]}),/parallel_dependency_invalid/);
});
test('cycles, duplicates and missing dependencies fail closed',()=>{
 assert.throws(()=>planParallelWork({tasks:[task('a','pending',['b']),task('b','pending',['a'])]}),/parallel_cycle_detected/);
 assert.throws(()=>planParallelWork({tasks:[task('a'),task('a')]}),/parallel_task_invalid/);
 assert.throws(()=>planParallelWork({tasks:[task('a','pending',['missing'])]}),/parallel_dependency_invalid/);
});
test('chat rollover handoff retains provenance and unresolved questions',()=>{
 const envelope=buildContinuationEnvelope({projectId:'ordax',workId:'build',checkpointId:'cp7',
  confirmedFacts:['Buildroot compiled'],unresolved:['Awaiting signed EROFS'],sourceRunIds:['run7'],chatId:'chat-new'});
 assert.equal(envelope.verification,'requires_canonical_receipt_resolution');
 assert.deepEqual(envelope.unresolved,['Awaiting signed EROFS']);
 assert.throws(()=>buildContinuationEnvelope({projectId:'ordax',workId:'build',checkpointId:'cp7',
  confirmedFacts:[],unresolved:[],sourceRunIds:[]}),/continuation_envelope_invalid/);
});

test('transitive failure blocks downstream DAG without marking independent work blocked',()=>{
 const graph=[
  task('source','uncertain'),
  task('compile','pending',['source']),
  task('package','pending',['compile']),
  task('release','pending',['package']),
  task('documentation','pending')
 ];
 const result=planParallelWork({tasks:graph,maxParallel:3});
 assert.deepEqual(result.blocked,['compile','package','release']);
 assert.deepEqual(result.dispatch,['documentation']);
 assert.deepEqual(result.waiting,[]);
});
test('an in-flight dependency is waiting rather than blocked',()=>{
 const result=planParallelWork({tasks:[task('build','running'),task('test','pending',['build'])]});
 assert.deepEqual(result.blocked,[]);
 assert.deepEqual(result.waiting,['test']);
});
