import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const source=fs.readFileSync(path.resolve(here,'../desktop/main.mjs'),'utf8');
const worker=fs.readFileSync(path.resolve(here,'../desktop/embedded-worker.mjs'),'utf8');

test('Electron App starts one observational provider view and no worker pool',()=>{
  assert.match(source,/new EmbeddedChatWorker\(\{id:'primary',allowSend:false\}\)/);
  assert.match(source,/providerWorkers=\[worker\]/);
  assert.match(source,/providerViews\.register\(worker\)/);
  assert.match(source,/attachProviderView\(worker,providerHostWindow\)/);
  assert.doesNotMatch(source,/providerWorkers=Array\.from|providerWorkerCount|agent-|createProviderExecutionScheduler|providerScheduler/);
});

test('observational provider view rejects sendPrompt before enqueue or provider UI mutation',()=>{
  const start=worker.indexOf('  async sendPrompt({');
  assert.ok(start>=0,'sendPrompt source exists for isolated transport users');
  const guard=worker.indexOf("if(this.allowSend!==true)throw new Error('provider_send_disabled_for_passive_app')",start);
  const enqueue=worker.indexOf('return this.enqueue(async () => {',start);
  assert.ok(guard>start&&enqueue>guard,'passive guard runs before worker queue or UI access');
  assert.match(worker,/constructor\(\{id='primary',partition='persist:ordax-forge-chatgpt',allowSend=true\}/);
});

test('App status advertises zero local GPT execution capacity',()=>{
  assert.match(source,/maxConcurrentSends:0,active:0,queued:0,pendingTasks:0,availableSlots:0,closed:true/);
  assert.doesNotMatch(source,/createOrchestratorKernel\(\{[\s\S]{0,1600}\bprovider\s*:/);
  assert.doesNotMatch(source,/ownerDispatch/);
  assert.doesNotMatch(source,/async function runTask\(|providerViews\.bindRun\(|enqueueExecution\(/);
});
