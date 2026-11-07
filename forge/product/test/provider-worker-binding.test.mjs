import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createProviderExecutionScheduler} from '../src/provider-execution-scheduler.mjs';

const source=fs.readFileSync(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),'../desktop/main.mjs'),'utf8');

function extract(start,end){
  const first=source.indexOf(start);
  const last=source.indexOf(end,first);
  assert.ok(first>=0&&last>first,'canonical Electron source segment exists');
  return source.slice(first,last);
}

test('provider Run is bound to the lane worker before any Store mutation or ChatGPT send',()=>{
  const run=extract('async function runTask(', '\nfunction layoutViews()');
  assert.match(run,/runWorker\)/);
  const identify=run.indexOf('providerViews.resolve(runWorker?.view?.webContents)!==runWorker');
  const begin=run.indexOf('store.beginProviderRun(');
  const submit=run.indexOf('await runWorker.sendPrompt(');
  assert.ok(identify>=0&&begin>identify&&submit>begin);
  assert.match(run,/await runWorker.health\(\)/);
  assert.match(run,/providerViews.bindRun\(runWorker,runContext\)/);
  assert.match(run,/providerViews.unbindRun\(runWorker,runId\)/);
  assert.doesNotMatch(run,/\bworker\.(health|sendPrompt|lastFailureMetrics)\b/);
});

test('uncertain delivery recovery, reply navigation and progress remain scoped to selected worker',()=>{
  const run=extract('async function runTask(', '\nfunction layoutViews()');
  assert.match(run,/recoverFailedProviderSubmission\(\{store,worker:runWorker,taskId,runId\}\)/);
  assert.match(run,/observePostCommitNavigation\(\{worker:runWorker,chatUrl:confirmedChatUrl\}\)/);
  assert.match(run,/providerViews.runForWorker\(runWorker\)!==runContext/);
  assert.match(run,/providerViews.runForWorker\(runWorker\)===runContext/);
  assert.doesNotMatch(run,/liveRun\?\.runId/);
  assert.match(run,/if \(liveRun===runContext\) liveRun = null/);
});

test('every existing sender passes the exact scheduler-selected worker into runTask',()=>{
  assert.match(source,/return providerScheduler\.enqueue\(String\(taskId\),operation\)/);
  assert.match(source,/enqueueExecution\(String\(taskId\),runWorker => runTask\(/);
  assert.match(source,/enqueueExecution\(taskId,runWorker => runTask\(/);
  assert.match(source,/enqueueExecution\(taskId,runWorker=>runTask\(/);
  assert.doesNotMatch(source,/provider_lane_identity_mismatch/);
  assert.doesNotMatch(source,/executionTail/);
});

test('window close and stale WebContents destruction only close their own scheduler',()=>{
  const setup=extract('async function createWindowOnce()', "\nipcMain.on('ordax:worker:preload-ready'");
  assert.match(setup,/const registeredScheduler=providerScheduler/);
  assert.match(setup,/registeredScheduler.close\('provider_worker_destroyed'\)/);
  assert.match(setup,/registeredScheduler.close\(\)/);
  assert.doesNotMatch(setup,/providerScheduler\?\.close/);
  // Closing a prior scheduler cannot invalidate a newly created one.
  const old=createProviderExecutionScheduler({lanes:[{id:'first',worker:{}}]});
  const current=createProviderExecutionScheduler({lanes:[{id:'next',worker:{}}]});
  old.close('provider_worker_destroyed');
  assert.equal(current.snapshot().closed,false);
  assert.equal(current.snapshot().lanes,1);
});

test('hardware concurrency remains fail-closed at one worker until real E2E',()=>{
  assert.match(source,/providerScheduler=createProviderExecutionScheduler\(\{lanes:\[\{id:'primary',worker\}\]\}\)/);
  assert.match(source,/if\(liveRun\)throw Error\('orchestrator_executor_busy'\)/);
});
