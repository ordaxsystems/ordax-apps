import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';

function fixture(t,{linked=false}={}) {
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const task=store.createTask('W4 atomic finalization');
  if(linked)store.setChatUrl(task.id,'https://chatgpt.com/c/11111111-2222-4333-8444-555555555555');
  const runId=store.startRun(task.id);
  const get=()=>({
    run:store.db.prepare('SELECT status,completed_at,error FROM runs WHERE id=?').get(runId),
    task:store.db.prepare('SELECT status FROM tasks WHERE id=?').get(task.id),
    completed:store.db.prepare('SELECT COUNT(*) n FROM conversation_completed_runs').get().n,
    events:store.db.prepare('SELECT COUNT(*) n FROM events').get().n
  });
  return {store,task,runId,get};
}

test('W4: task write failure rolls back Run completion, Task and event atomically',t=>{
  const f=fixture(t,{linked:true});
  const before=f.get();
  f.store.db.exec("CREATE TEMP TRIGGER reject_finish_task BEFORE UPDATE OF status ON tasks WHEN NEW.status='ready' BEGIN SELECT RAISE(ABORT,'w4_task_write_denied'); END");
  assert.throws(()=>f.store.finishRun(f.task.id,f.runId),/w4_task_write_denied/);
  assert.deepEqual(f.get(),before);
  f.store.db.exec('DROP TRIGGER reject_finish_task');
  f.store.finishRun(f.task.id,f.runId);
  const after=f.get();
  assert.equal(after.run.status,'succeeded');
  assert.equal(after.task.status,'ready');
  assert.equal(after.completed,1);
  assert.equal(after.events,before.events+2); // run.succeeded + turn_completed
});

test('W4: event write failure after status changes rolls back a failed Run',t=>{
  const f=fixture(t);
  const before=f.get();
  f.store.db.exec("CREATE TEMP TRIGGER reject_finish_event BEFORE INSERT ON events WHEN NEW.kind='run.failed' BEGIN SELECT RAISE(ABORT,'w4_event_write_denied'); END");
  assert.throws(()=>f.store.finishRun(f.task.id,f.runId,'await-response:response_not_observed'),/w4_event_write_denied/);
  assert.deepEqual(f.get(),before);
  f.store.db.exec('DROP TRIGGER reject_finish_event');
  assert.equal(f.store.recoverInterruptedRuns(),1);
  assert.equal(f.store.db.prepare('SELECT status FROM runs WHERE id=?').get(f.runId).status,'interrupted');
  assert.equal(f.store.db.prepare('SELECT status FROM tasks WHERE id=?').get(f.task.id).status,'interrupted');
});

test('W4: a completed Run cannot be finalized again or attached to a foreign Task',t=>{
  const f=fixture(t);
  const other=f.store.createTask('Unrelated');
  const before=f.get();
  assert.throws(()=>f.store.finishRun(other.id,f.runId),/run_finish_state_invalid/);
  assert.deepEqual(f.get(),before);
  f.store.finishRun(f.task.id,f.runId,'prepare:blocked_before_send');
  const finalized=f.get();
  assert.equal(finalized.run.status,'failed');
  assert.throws(()=>f.store.finishRun(f.task.id,f.runId),/run_finish_state_invalid/);
  assert.deepEqual(f.get(),finalized);
});

test('W4: persisted SQLite restart after failed finalization recovers only interrupted Run, never phantom success',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-w4-finalization-'));
  const dbPath=path.join(folder,'test.sqlite');
  let store=new Store(dbPath);
  t.after(()=>{store?.close();fs.rmSync(folder,{recursive:true,force:true});});
  const task=store.createTask('Durable W4 recovery');
  store.setChatUrl(task.id,'https://chatgpt.com/c/11111111-2222-4333-8444-555555555555');
  const {runId}=store.beginProviderRun(task.id,'Synthetic local-only prompt');
  store.db.exec("CREATE TEMP TRIGGER reject_task_completion BEFORE UPDATE OF status ON tasks WHEN NEW.status='ready' BEGIN SELECT RAISE(ABORT,'forced_disk_write_failure'); END");
  assert.throws(()=>store.finishRun(task.id,runId),/forced_disk_write_failure/);
  store.close();
  store=new Store(dbPath);
  assert.equal(store.db.prepare('SELECT status FROM runs WHERE id=?').get(runId).status,'running');
  assert.equal(store.recoverInterruptedRuns(),1);
  assert.equal(store.recoverInterruptedRuns(),0);
  assert.equal(store.db.prepare('SELECT status FROM runs WHERE id=?').get(runId).status,'interrupted');
  assert.equal(store.db.prepare('SELECT status FROM tasks WHERE id=?').get(task.id).status,'interrupted');
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM events WHERE kind='run.succeeded'").get().n,0);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM conversation_completed_runs').get().n,0);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM messages').get().n,1);
});
