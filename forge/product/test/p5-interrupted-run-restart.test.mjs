import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { listLocalSupervisorRecoverable } from '../supervisor/coordinator.mjs';
import { inspectSupervisorChatReadOnly } from '../supervisor/read-only-reconcile.mjs';

const linkedUrl='https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';
const authorizedText='ORDAX_E2E_SIMULATED_PROMPT_NO_NETWORK';
function fixture(t,{bindUrl=false}={}) {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-lab-p5-restart-'));
  const file=path.join(folder,'test.sqlite');
  let store=new Store(file);
  t.after(()=>{store?.close();fs.rmSync(folder,{recursive:true,force:true});});
  const task=store.createTask('Interrupted provider transport');
  if(bindUrl) store.setChatUrl(task.id,linkedUrl);
  const message=store.appendMessage(task.id,'user',authorizedText);
  const runId=store.startRun(task.id);
  const actionId='action_11111111-2222-4333-8444-555555555555';
  const scope={actorId:'lab-owner',tenantId:null,environment:'internal',objective:'One approved message'};
  const result={decision:{type:'send_message',taskId:task.id,content:authorizedText,reason:'Owner-approved fixture'}};
  store.db.prepare(
    'INSERT INTO action_ledger(id,task_id,run_id,action_type,resource_key,status,payload,result,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
  ).run(actionId,task.id,runId,'supervisor.plan','internal:lab:p5','dispatching',
    JSON.stringify(scope),JSON.stringify(result),store.now(),store.now());
  return {
    task,runId,actionId,message,file,
    get store(){return store;},
    restart(){store.close();store=new Store(file);return store;}
  };
}

test('actual SQLite restart retains interrupted Run and uncertain supervisor action, no replay',t=>{
  const f=fixture(t);
  const before=f.store.db.prepare('SELECT COUNT(*) AS count FROM messages WHERE task_id=?')
    .get(f.task.id).count;
  const reopened=f.restart();
  assert.equal(reopened.recoverInterruptedRuns(),1);
  assert.equal(reopened.recoverInterruptedRuns(),0);
  const run=reopened.db.prepare('SELECT status,error FROM runs WHERE id=?').get(f.runId);
  assert.equal(run.status,'interrupted');
  assert.equal(run.error,'process_interrupted');
  assert.equal(reopened.db.prepare('SELECT status FROM tasks WHERE id=?').get(f.task.id).status,'interrupted');
  assert.equal(reopened.db.prepare('SELECT status FROM action_ledger WHERE id=?').get(f.actionId).status,'indeterminate');
  const pending=listLocalSupervisorRecoverable({store:reopened,taskId:f.task.id});
  assert.equal(pending.length,1);
  assert.equal(pending[0].status,'indeterminate');
  assert.equal(pending[0].requiresReconciliation,true);
  assert.equal(reopened.db.prepare('SELECT COUNT(*) AS count FROM messages WHERE task_id=?')
    .get(f.task.id).count,before);
  assert.equal(reopened.db.prepare('SELECT COUNT(*) AS count FROM checkpoints WHERE task_id=?')
    .get(f.task.id).count,0);
});

test('initial chat without verified permalink remains uncertain after crash; browser not touched',async t=>{
  const f=fixture(t);
  const reopened=f.restart();reopened.recoverInterruptedRuns();
  let calls=0;
  const result=await inspectSupervisorChatReadOnly({
    store:reopened,taskId:f.task.id,actionId:f.actionId,
    worker:{inspectConversationReadOnly:async()=>{calls++;throw Error('should never call');}}
  });
  assert.equal(result.kind,'unavailable');
  assert.equal(result.reason,'canonical_chat_url_missing');
  assert.equal(result.requiresReconciliation,true);
  assert.equal(calls,0);
  assert.equal(reopened.db.prepare('SELECT status FROM action_ledger WHERE id=?')
    .get(f.actionId).status,'indeterminate');
});

test('linked conversation may show a response candidate but cannot resolve uncertain action',async t=>{
  const f=fixture(t,{bindUrl:true});
  const reopened=f.restart();reopened.recoverInterruptedRuns();
  const before=reopened.db.prepare('SELECT * FROM action_ledger WHERE id=?').get(f.actionId);
  let reads=0;
  const result=await inspectSupervisorChatReadOnly({
    store:reopened,taskId:f.task.id,actionId:f.actionId,
    worker:{inspectConversationReadOnly:async url=>{
      reads++;assert.equal(url,linkedUrl);
      return {available:true,url,domReliable:true,truncated:false,messages:[
        {role:'user',text:authorizedText},
        {role:'assistant',text:'Synthetic response, not a real ChatGPT reply'}
      ]};
    }}
  });
  assert.equal(reads,1);
  assert.equal(result.kind,'response_candidate');
  assert.equal(result.requiresReconciliation,true);
  assert.deepEqual(reopened.db.prepare('SELECT * FROM action_ledger WHERE id=?').get(f.actionId),before);
  assert.equal(reopened.db.prepare('SELECT status FROM runs WHERE id=?').get(f.runId).status,'interrupted');
});
