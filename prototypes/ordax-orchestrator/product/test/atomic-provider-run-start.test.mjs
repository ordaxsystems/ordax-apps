import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {listTaskUncertainTransportRuns} from '../src/provider-uncertain-run-policy.mjs';

function fixture(t) {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-atomic-send-'));
  const file=path.join(folder,'test.sqlite');
  let store=new Store(file);
  t.after(()=>{store?.close();fs.rmSync(folder,{recursive:true,force:true})});
  const task=store.createTask('Atomic provider send');
  store.setDraft(task.id,'Rascunho deve sobreviver a falhas',1);
  const counts=()=>{
    const n=sql=>store.db.prepare(sql).get().n;
    const selected=store.db.prepare('SELECT draft,draft_revision,status FROM tasks WHERE id=?').get(task.id);
    return {messages:n('SELECT COUNT(*) n FROM messages'),runs:n('SELECT COUNT(*) n FROM runs'),
      events:n('SELECT COUNT(*) n FROM events'),candidates:n('SELECT COUNT(*) n FROM project_memory_candidates'),
      draft:selected.draft,revision:selected.draft_revision,taskStatus:selected.status};
  };
  return {task,file,counts,get store(){return store;},
    reopen(){store.close();store=new Store(file);return store}};
}

test('atomic message + draft clearance + Run starts as one crash-consistent unit',t=>{
  const f=fixture(t);
  const before=f.counts();
  const {userMessage,runId}=f.store.beginProviderRun(f.task.id,'Mensagem sem envio externo',
    {draftRevision:2,observerMode:'auto'});
  assert.match(userMessage.id,/^msg_/);
  assert.match(runId,/^run_/);
  const after=f.counts();
  assert.equal(after.messages,before.messages+1);
  assert.equal(after.runs,before.runs+1);
  assert.equal(after.draft,'');
  assert.equal(after.revision,2);
  assert.equal(after.taskStatus,'running');
  assert.equal(f.store.db.prepare('SELECT status FROM runs WHERE id=?').get(runId).status,'running');
  assert.equal(f.store.db.prepare('SELECT content FROM messages WHERE id=?').get(userMessage.id).content,'Mensagem sem envio externo');
});

test('failure while inserting a Run rolls back prior user message, draft-clear and events',t=>{
  const f=fixture(t);
  const before=f.counts();
  f.store.db.exec("CREATE TEMP TRIGGER deny_run_insert BEFORE INSERT ON runs BEGIN SELECT RAISE(ABORT,'atomic_run_insert_refused'); END");
  assert.throws(()=>f.store.beginProviderRun(f.task.id,'Nunca fica órfã',{draftRevision:2}),/atomic_run_insert_refused/);
  assert.deepEqual(f.counts(),before);
  f.store.db.exec('DROP TRIGGER deny_run_insert');
  // Recovery and next legitimate operation remain viable without duplicates.
  assert.equal(f.store.beginProviderRun(f.task.id,'Agora pode',{draftRevision:2}).userMessage.content,'Agora pode');
  assert.equal(f.counts().messages,before.messages+1);
});

test('failure after Run creation but before event completion rolls entire transaction back',t=>{
  const f=fixture(t);
  const before=f.counts();
  f.store.db.exec("CREATE TEMP TRIGGER deny_run_event BEFORE INSERT ON events WHEN NEW.kind='run.started' BEGIN SELECT RAISE(ABORT,'atomic_run_event_refused'); END");
  assert.throws(()=>f.store.beginProviderRun(f.task.id,'Nenhuma gravação parcial',
    {draftRevision:2}),/atomic_run_event_refused/);
  assert.deepEqual(f.counts(),before);
});

test('invalid or conflicting draft revision fails closed and does not consume a draft',t=>{
  const f=fixture(t);
  const before=f.counts();
  for(const revision of [0,-1,1,1.5,Number.NaN,'bad']){
    assert.throws(()=>f.store.beginProviderRun(f.task.id,'Sem envio',{draftRevision:revision}),
      /invalid_task_draft_revision|task_draft_revision_conflict/);
    assert.deepEqual(f.counts(),before);
  }
  assert.throws(()=>f.store.beginProviderRun(f.task.id,'',{draftRevision:2}),/content_required/);
  assert.deepEqual(f.counts(),before);
});

test('a second atomic send is blocked while the previous Run remains active',t=>{
  const f=fixture(t);
  f.store.beginProviderRun(f.task.id,'primeiro',{draftRevision:2});
  const before=f.counts();
  assert.throws(()=>f.store.beginProviderRun(f.task.id,'segundo',{draftRevision:3}),
    /task_run_already_active/);
  assert.deepEqual(f.counts(),before);
});

test('after real SQLite reopen, a committed active Run becomes interrupted, never auto-replayed',t=>{
  const f=fixture(t);
  const {runId}=f.store.beginProviderRun(f.task.id,'ORDAX_ATOMIC_LOCAL_ONLY',
    {draftRevision:2});
  const before=f.counts();
  const reopened=f.reopen();
  assert.equal(reopened.recoverInterruptedRuns(),1);
  assert.equal(reopened.recoverInterruptedRuns(),0);
  const after=f.counts();
  assert.equal(after.messages,before.messages);
  assert.equal(after.runs,before.runs);
  assert.equal(after.draft,before.draft);
  assert.equal(reopened.db.prepare('SELECT status FROM runs WHERE id=?').get(runId).status,'interrupted');
  assert.equal(listTaskUncertainTransportRuns(reopened,f.task.id).length,1);
  assert.equal(reopened.db.prepare('SELECT COUNT(*) n FROM messages WHERE task_id=?').get(f.task.id).n,1);
});
