import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { SupervisorCoordinator } from '../supervisor/coordinator.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordax-lab-real-store-'));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  return path.join(dir, 'orchestrator.sqlite');
}
function coordinator(store, { decide, onSend = () => ({ confirmed:true, runId:'simulated' }) } = {}) {
  return new SupervisorCoordinator({
    store, enabled:true, environment:'internal', actorId:'lab-owner',
    authorizeTask: ({taskId,actorId,environment}) =>
      actorId==='lab-owner' && environment==='internal' && Boolean(store.getTaskExecutionSnapshot(taskId)),
    planner:{ decide: decide || (async({taskId})=>({type:'hold',taskId,reason:'Await user review'})) },
    chat:{ send:onSend }
  });
}

test('real SQLite Store: hold is durable, reviewable and cannot dispatch', async t => {
  const file=fixture(t);
  let store=new Store(file);
  const task=store.createTask('Durable hold');
  const s=coordinator(store);
  const p=await s.plan({taskId:task.id,requestId:'hold-001',objective:'Wait for external dependency'});
  assert.equal(p.status,'held');
  assert.equal(p.approvalId,null);
  assert.equal(store.db.prepare('SELECT status FROM action_ledger WHERE id=?').get(p.actionId).status,'held');
  store.close();

  store=new Store(file);
  try {
    let modelCalls=0,sendCalls=0;
    const restarted=coordinator(store,{decide:async()=>{modelCalls++;throw Error('unexpected_model_call');},
      onSend:async()=>{sendCalls++;return {confirmed:true};}});
    const result=await restarted.plan({taskId:task.id,requestId:'hold-001',objective:'Wait for external dependency'});
    assert.equal(result.status,'held');
    const items=restarted.listRecoverable({taskId:task.id});
    assert.equal(items.length,1);
    assert.equal(items[0].status,'held');
    assert.equal(items[0].requiresReconciliation,false);
    await assert.rejects(restarted.dispatch({taskId:task.id,actionId:p.actionId}),/action_not_approved/);
    assert.equal(modelCalls,0);
    assert.equal(sendCalls,0);
  } finally {store.close();}
});

test('real SQLite Store: complete is distinct from hold after restart', async t => {
  const file=fixture(t);
  const store=new Store(file);
  try {
    const task=store.createTask('Review complete');
    const s=coordinator(store,{decide:async({taskId})=>({type:'complete',taskId,reason:'Plan only is finished'})});
    const result=await s.plan({taskId:task.id,requestId:'complete-001',objective:'Finish review'});
    assert.equal(result.status,'complete');
    assert.equal(s.listRecoverable({taskId:task.id}).length,0);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM approval_ledger').get().n,0);
  } finally {store.close();}
});

test('real SQLite Store: persisted approval survives restart and unknown delivery cannot replay', async t => {
  const file=fixture(t);
  let store=new Store(file);
  const task=store.createTask('Recovery without replay');
  let sends=0;
  const decision=async({taskId})=>({type:'send_message',taskId,
    content:'Validate isolated fixture only.',reason:'One authorized step'});
  const first=coordinator(store,{decide:decision,onSend:async()=>{sends++;throw Error('unknown_response');}});
  const p=await first.plan({taskId:task.id,requestId:'recovery-001',objective:'Simulate intermittent connection'});
  assert.equal(p.status,'pending_approval');
  first.approve({taskId:task.id,actionId:p.actionId,approvalId:p.approvalId,explicitOwnerApproval:true});
  store.close();

  store=new Store(file);
  try {
    const resumed=coordinator(store,{decide:async()=>{throw Error('model_replay_forbidden');},
      onSend:async()=>{sends++;throw Error('unknown_response');}});
    assert.equal(resumed.listRecoverable({taskId:task.id})[0].status,'approved');
    assert.equal((await resumed.dispatch({taskId:task.id,actionId:p.actionId})).status,'indeterminate');
    assert.equal(sends,1);
    const pending=resumed.listRecoverable({taskId:task.id});
    assert.equal(pending[0].status,'indeterminate');
    assert.equal(pending[0].requiresReconciliation,true);
    await assert.rejects(resumed.dispatch({taskId:task.id,actionId:p.actionId}),/action_not_approved/);
    assert.equal(sends,1);
    assert.equal(store.db.prepare("SELECT status FROM action_ledger WHERE id=?").get(p.actionId).status,'indeterminate');
  } finally {store.close();}
});
