import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store} from '../src/store.mjs';
import {listTaskUncertainTransportRuns,assertTaskHasNoUncertainTransport} from '../src/provider-uncertain-run-policy.mjs';

function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-lab-uncertain-'));
  const dbFile=path.join(directory,'state.sqlite');
  const store=new Store(dbFile);
  t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
  const task=store.createTask('Testing uncertain delivery');
  return {store,task};
}

test('prepare failure with no submission evidence does NOT block another operation',t=>{
  const {store,task}=fixture(t);
  const id=store.startRun(task.id);
  store.recordRunMetrics(task.id,id,'beta',{failedStage:'prepare',submitAttemptAt:null});
  store.finishRun(task.id,id,'prepare:provider_navigation_timeout');
  assert.deepEqual(listTaskUncertainTransportRuns(store,task.id),[]);
  assert.equal(assertTaskHasNoUncertainTransport(store,task.id),true);
});

test('uncertain live request blocks same Task; another Task still works, no SQL writes',t=>{
  const {store,task}=fixture(t);
  const fresh=store.createTask('Independent Task');
  const id=store.startRun(task.id);
  store.recordRunMetrics(task.id,id,'beta',{
    failedStage:'submit',submitAttemptAt:1792450000000,providerRequestSeenAt:1792450001000,
    submittedAt:null
  });
  store.finishRun(task.id,id,'submit:send_confirmation_unknown');
  const before=store.db.prepare('SELECT COUNT(*) AS n FROM events WHERE task_id=?').get(task.id).n;
  const ambiguous=listTaskUncertainTransportRuns(store,task.id);
  assert.equal(ambiguous.length,1);
  assert.equal(ambiguous[0].runId,id);
  assert.equal(ambiguous[0].submitAttemptObserved,true);
  assert.equal(ambiguous[0].submitConfirmationObserved,false);
  assert.throws(()=>assertTaskHasNoUncertainTransport(store,task.id),{
    message:'task_submission_reconciliation_required'
  });
  assert.equal(assertTaskHasNoUncertainTransport(store,fresh.id),true);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM events WHERE task_id=?').get(task.id).n,before);
});

test('an interrupted Run without metrics cannot be assumed NOT sent',t=>{
  const {store,task}=fixture(t);
  store.startRun(task.id);
  assert.equal(store.recoverInterruptedRuns(),1);
  assert.equal(listTaskUncertainTransportRuns(store,task.id).length,1);
  assert.throws(()=>assertTaskHasNoUncertainTransport(store,task.id),{
    message:'task_submission_reconciliation_required'
  });
});

test('failed Run after submit confirmation but before result must be reconciled',t=>{
  const {store,task}=fixture(t);
  const id=store.startRun(task.id);
  store.recordRunMetrics(task.id,id,'beta',{
    failedStage:'await-response',submitAttemptAt:1792450000000,
    submittedAt:1792450001000
  });
  store.finishRun(task.id,id,'await-response:response_not_observed');
  const row=listTaskUncertainTransportRuns(store,task.id)[0];
  assert.equal(row.submitConfirmationObserved,true);
  assert.throws(()=>assertTaskHasNoUncertainTransport(store,task.id),{
    message:'task_submission_reconciliation_required'
  });
});

test('fail closed on legacy failed submit stage without saved metrics',t=>{
  const {store,task}=fixture(t);
  const id=store.startRun(task.id);
  store.finishRun(task.id,id,'submit:send_confirmation_unknown');
  assert.equal(listTaskUncertainTransportRuns(store,task.id).length,1);
});

test('main enforces guard before local user message and Run creation',()=>{
  const here=path.dirname(fileURLToPath(import.meta.url));
  const main=fs.readFileSync(path.resolve(here,'../desktop/main.mjs'),'utf8');
  const part=main.split('async function runTask(')[1].split('const heartbeat =')[0];
  const guard=part.indexOf('assertTaskHasNoUncertainTransport(store,taskId)');
  const atomic=part.indexOf('store.beginProviderRun(taskId, prompt');
  assert.ok(guard>=0 && atomic>guard);
  assert.ok(part.indexOf('assertProviderSendReadiness(await worker.health())')<atomic);
  assert.doesNotMatch(part,/store\.appendMessage\(taskId, 'user'/);
  assert.doesNotMatch(part,/store\.startRun\(taskId/);
  const ui=fs.readFileSync(path.resolve(here,'../desktop/ui.js'),'utf8');
  assert.match(ui,/task_submission_reconciliation_required/);
});
