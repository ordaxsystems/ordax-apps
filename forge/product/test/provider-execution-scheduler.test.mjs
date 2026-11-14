import test from 'node:test';
import assert from 'node:assert/strict';
import {createProviderExecutionScheduler} from '../src/provider-execution-scheduler.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

function deferred(){
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const lane=(id)=>({id,worker:{id}});

test('single configured lane preserves FIFO, never overlapping provider effects',async()=>{
  const scheduler=createProviderExecutionScheduler({lanes:[lane('primary')]});
  const release=deferred(),events=[];
  const a=scheduler.enqueue('task_a',async worker=>{
    events.push('start_a_'+worker.id);
    await release.promise;
    events.push('end_a');
    return 'answer_a';
  });
  const b=scheduler.enqueue('task_b',async worker=>{
    events.push('start_b_'+worker.id);
    return 'answer_b';
  });
  await tick();
  assert.deepEqual(events,['start_a_primary']);
  assert.deepEqual(scheduler.snapshot(),{lanes:1,active:1,queued:1,pendingTasks:2,closed:false});
  release.resolve();
  assert.equal(await a,'answer_a');
  assert.equal(await b,'answer_b');
  assert.deepEqual(events,['start_a_primary','end_a','start_b_primary']);
  assert.equal(scheduler.snapshot().pendingTasks,0);
});

test('duplicate task cannot enter pending or in-flight twice',async()=>{
  const scheduler=createProviderExecutionScheduler({lanes:[lane('one'),lane('two')]});
  const hold=deferred();
  const first=scheduler.enqueue('same_task',()=>hold.promise);
  await assert.rejects(scheduler.enqueue('same_task',()=>{throw Error('should_never_execute');}),
    /provider_task_already_scheduled/);
  assert.equal(scheduler.snapshot().active,1);
  hold.resolve('ok');assert.equal(await first,'ok');await tick();
  assert.equal(await scheduler.enqueue('same_task',async()=>7),7);
});

test('two simulated lane contracts permit parallel operation without sharing workers or Task IDs',async()=>{
  const scheduler=createProviderExecutionScheduler({lanes:[lane('A'),lane('B')]});
  const firstHold=deferred(),secondHold=deferred(),events=[];
  const first=scheduler.enqueue('task_x',async worker=>{
    events.push(['task_x',worker.id]);return firstHold.promise;
  });
  const second=scheduler.enqueue('task_y',async worker=>{
    events.push(['task_y',worker.id]);return secondHold.promise;
  });
  await tick();
  assert.deepEqual(events,[['task_x','A'],['task_y','B']]);
  assert.equal(scheduler.snapshot().active,2);
  firstHold.resolve('X');assert.equal(await first,'X');
  secondHold.resolve('Y');assert.equal(await second,'Y');
  assert.equal(scheduler.snapshot().pendingTasks,0);
});

test('transport failure is never retried; unrelated queued work may continue',async()=>{
  const scheduler=createProviderExecutionScheduler({lanes:[lane('only')]});
  const uncertain=deferred(),attempts=[];
  const a=scheduler.enqueue('task_uncertain',()=>{attempts.push('uncertain');return uncertain.promise;});
  const b=scheduler.enqueue('task_safe',()=>{attempts.push('safe');return 'ok';});
  await tick();
  uncertain.reject(Error('provider_delivery_uncertain'));
  await assert.rejects(a,/provider_delivery_uncertain/);
  assert.equal(await b,'ok');
  assert.deepEqual(attempts,['uncertain','safe']);
});

test('shutdown cancels queued work without replaying or aborting the already-started Run',async()=>{
  const scheduler=createProviderExecutionScheduler({lanes:[lane('existing')]});
  const hold=deferred(),effects=[];
  const running=scheduler.enqueue('task_one',()=>{effects.push('running');return hold.promise;});
  const queued=scheduler.enqueue('task_two',()=>{effects.push('unexpected_send');});
  await tick();
  assert.equal(scheduler.close(),1);
  await assert.rejects(queued,/provider_scheduler_closed/);
  assert.equal(scheduler.close(),0);
  await assert.rejects(scheduler.enqueue('task_three',()=>{}),/provider_scheduler_closed/);
  hold.resolve('observed_receipt');
  assert.equal(await running,'observed_receipt');
  await tick();
  assert.deepEqual(effects,['running']);
  assert.deepEqual(scheduler.snapshot(),{lanes:1,active:0,queued:0,pendingTasks:0,closed:true});
});

test('shutdown before the microtask starts cannot initiate an external send',async()=>{
  const scheduler=createProviderExecutionScheduler({lanes:[lane('only')]});
  let effects=0;
  const pending=scheduler.enqueue('task_none',()=>{effects++;});
  scheduler.close('provider_worker_destroyed');
  await assert.rejects(pending,/provider_worker_destroyed/);
  assert.equal(effects,0);
});

test('invalid worker configuration and malformed Task IDs are rejected',async()=>{
  assert.throws(()=>createProviderExecutionScheduler({lanes:[]}),/provider_scheduler_lanes_invalid/);
  const shared={};
  assert.throws(()=>createProviderExecutionScheduler({
    lanes:[{id:'one',worker:shared},{id:'two',worker:shared}]
  }),/provider_scheduler_lanes_invalid/);
  assert.throws(()=>createProviderExecutionScheduler({
    lanes:[{id:'one',worker:{}},{id:'one',worker:{}}]
  }),/provider_scheduler_lanes_invalid/);
  const scheduler=createProviderExecutionScheduler({lanes:[lane('one')]});
  for(const id of ['',null,'task/unsafe','x'.repeat(181)]){
    await assert.rejects(scheduler.enqueue(id,()=>{}),/provider_scheduler_input_invalid/);
  }
  await assert.rejects(scheduler.enqueue('task_normal',null),/provider_scheduler_input_invalid/);
  assert.equal(scheduler.snapshot().pendingTasks,0);
});

test('host calls the SAME scheduler from UI task sends, Groq supervisor and orchestrator provider',()=>{
  const here=path.dirname(fileURLToPath(import.meta.url));
  const main=fs.readFileSync(path.join(here,'../desktop/main.mjs'),'utf8');
  assert.doesNotMatch(main,/executionTail/);
  assert.match(main,/createProviderExecutionScheduler/);
  assert.match(main,/enqueueExecution\(String\(taskId\),/);
  assert.match(main,/enqueueExecution\(taskId,/);
  assert.match(main,/registeredScheduler\.close/);
  assert.doesNotMatch(main,/provider_lane_identity_mismatch/);
  // Real send ownership is now carried by the lane worker into runTask,
  // not looked up from the globally visible provider view.
  assert.match(main,/return providerScheduler\.enqueue\(String\(taskId\),operation\)/);
  assert.match(main,/async function runTask\(taskId, prompt, .*runWorker\)/);
  assert.match(main,/providerViews\.resolve\(runWorker\?\.view\?\.webContents\)!==runWorker/);
  assert.match(main,/await runWorker\.sendPrompt\(/);
  assert.match(main,/providerViews\.bindRun\(runWorker,runContext\)/);
  assert.match(main,/providerViews\.unbindRun\(runWorker,runId\)/);
  assert.match(main,/providerWorkers=Array\.from\(\{length:providerWorkerCount\}/);
  assert.match(main,/lanes:providerWorkers\.map\(candidate=>\(\{id:candidate\.id,worker:candidate\}\)\)/);
  assert.doesNotMatch(main,/\bliveRun\b/);
});

test('bounded physical lane refuses overflow without dropping or duplicating accepted work',async()=>{
  const scheduler=createProviderExecutionScheduler({
    lanes:[lane('physical')],maxQueued:2,maxQueueWaitMs:1000
  });
  const hold=deferred(),effects=[];
  const active=scheduler.enqueue('active',async()=>{effects.push('active');await hold.promise;return 'done';});
  await tick();
  const queuedA=scheduler.enqueue('queued_a',()=>{effects.push('a');return 'A';});
  const queuedB=scheduler.enqueue('queued_b',()=>{effects.push('b');return 'B';});
  await assert.rejects(scheduler.enqueue('overflow',()=>{effects.push('OVERFLOW');}),
    /provider_scheduler_queue_full/);
  assert.equal(scheduler.snapshot().queued,2);
  assert.equal(scheduler.metrics().rejectedFull,1);
  assert.equal(scheduler.metrics().peakQueued,2);
  hold.resolve();
  assert.equal(await active,'done');
  assert.equal(await queuedA,'A');
  assert.equal(await queuedB,'B');
  assert.deepEqual(effects,['active','a','b']);
  assert.equal(scheduler.snapshot().pendingTasks,0);
});

test('waiting deadline rejects pre-send only; active uncertain transport is never timed out or retried',async()=>{
  const scheduler=createProviderExecutionScheduler({
    lanes:[lane('physical')],maxQueued:2,maxQueueWaitMs:20
  });
  const hold=deferred(),effects=[];
  const active=scheduler.enqueue('active',async()=>{
    effects.push('real_send');await hold.promise;return 'observed_after_deadline';
  });
  await tick(); // ensure the external effect has actually started.
  const expired=scheduler.enqueue('waiting',()=>{effects.push('forbidden_send');});
  await assert.rejects(expired,/provider_scheduler_queue_wait_timeout/);
  assert.equal(scheduler.metrics().expired,1);
  assert.equal(scheduler.snapshot().active,1,'an active provider call keeps its lane');
  assert.equal(scheduler.snapshot().queued,0);
  hold.resolve();
  assert.equal(await active,'observed_after_deadline');
  assert.deepEqual(effects,['real_send']);
  assert.equal(await scheduler.enqueue('waiting',()=> 'new_owner_approved_request'),'new_owner_approved_request');
  assert.equal(scheduler.metrics().started,2);
});

test('cancellation is permitted only before dispatch; an in-flight send remains owned by its Run',async()=>{
  const scheduler=createProviderExecutionScheduler({
    lanes:[lane('physical')],maxQueued:2,maxQueueWaitMs:1000
  });
  const activeAbort=new AbortController(),queuedAbort=new AbortController(),hold=deferred();
  const effects=[];
  const active=scheduler.enqueue('active',async()=>{
    effects.push('provider_called');await hold.promise;return 'real_result';
  },{signal:activeAbort.signal});
  await tick();
  const cancelled=scheduler.enqueue('cancelled',()=>{
    effects.push('cancelled_provider_called');
  },{signal:queuedAbort.signal});
  queuedAbort.abort();
  await assert.rejects(cancelled,/provider_scheduler_queued_cancelled/);
  activeAbort.abort(); // No ambiguity: active operations cannot be cancelled here.
  hold.resolve('released');
  assert.equal(await active,'real_result');
  assert.deepEqual(effects,['provider_called']);
  assert.equal(scheduler.metrics().cancelled,1);
  assert.equal(scheduler.snapshot().pendingTasks,0);
  const preAborted=new AbortController();preAborted.abort();
  await assert.rejects(scheduler.enqueue('pre_aborted',()=>{}, {signal:preAborted.signal}),
    /provider_scheduler_queued_cancelled/);
  assert.equal(scheduler.metrics().cancelled,2);
});

test('shutdown rejects all queued callers and clears deadlines; never cancels active external effects',async()=>{
  const scheduler=createProviderExecutionScheduler({
    lanes:[lane('physical')],maxQueued:3,maxQueueWaitMs:25
  });
  const hold=deferred(),active=scheduler.enqueue('active',()=>hold.promise);
  await tick();
  const a=scheduler.enqueue('a',()=>{throw Error('unexpected_a');});
  const b=scheduler.enqueue('b',()=>{throw Error('unexpected_b');});
  assert.equal(scheduler.close(),2);
  await assert.rejects(a,/provider_scheduler_closed/);
  await assert.rejects(b,/provider_scheduler_closed/);
  await new Promise(r=>setTimeout(r,40));
  assert.equal(scheduler.metrics().expired,0);
  hold.resolve('receipt');
  assert.equal(await active,'receipt');
  assert.equal(scheduler.snapshot().pendingTasks,0);
});

test('scheduler rejects invalid bounds and never reports unbounded default capacity',()=>{
  for(const opts of [{maxQueued:0},{maxQueued:5000},{maxQueueWaitMs:0},
    {maxQueueWaitMs:60*60_000+1},{clock:null}]){
    assert.throws(()=>createProviderExecutionScheduler({lanes:[lane('one')],...opts}),
      /provider_scheduler_bounds_invalid/);
  }
  const scheduler=createProviderExecutionScheduler({lanes:[lane('one')]});
  assert.equal(scheduler.metrics().maxQueued,64);
  assert.equal(scheduler.metrics().maxQueueWaitMs,10*60_000);
  scheduler.close();
});
