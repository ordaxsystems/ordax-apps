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
  assert.match(main,/providerScheduler\?\.close/);
  assert.doesNotMatch(main,/provider_lane_identity_mismatch/);
  // Real send ownership is now carried by the lane worker into runTask,
  // not looked up from the globally visible provider view.
  assert.match(main,/return providerScheduler\.enqueue\(String\(taskId\),operation\)/);
  assert.match(main,/async function runTask\(taskId, prompt, .*runWorker\)/);
  assert.match(main,/providerViews\.resolve\(runWorker\?\.view\?\.webContents\)!==runWorker/);
  assert.match(main,/await runWorker\.sendPrompt\(/);
  assert.match(main,/providerViews\.bindRun\(runWorker,runContext\)/);
  assert.match(main,/providerViews\.unbindRun\(runWorker,runId\)/);
  assert.match(main,/lanes:\[\{id:'primary',worker\}\]/);
});
