import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Store} from '../src/store.mjs';

function start(t){
 const store=new Store(':memory:');
 t.after(()=>store.close());
 const task=store.createTask('Atomic observed completion');
 const {runId}=store.beginProviderRun(task.id,'Synthetic request only');
 store.saveRunProvisionalOutput(task.id,runId,'unverified partial');
 const count=name=>store.db.prepare('SELECT COUNT(*) n FROM '+name).get().n;
 return {store,task,runId,count};
}
const confirmed=(store,task,runId,attachAssets=()=>[])=>store.commitObservedProviderReply(task.id,runId,{
 text:'Synthetic confirmed answer',observedAt:'2026-10-20T21:00:00.000Z',
 chatUrl:null,observerMode:'beta',runMetrics:{observer_used:'beta'},attachAssets
});
test('successful provider completion atomically publishes message, checkpoint and final Run',t=>{
 const f=start(t);
 const outcome=confirmed(f.store,f.task,f.runId);
 assert.equal(outcome.assistant.role,'assistant');
 assert.equal(outcome.assistant.content,'Synthetic confirmed answer');
 assert.deepEqual(outcome.assets,[]);
 assert.equal(f.count('messages'),2);
 assert.equal(f.count('checkpoints'),1);
 assert.equal(f.count('run_provisional_outputs'),0);
 assert.equal(f.store.db.prepare('SELECT status FROM runs WHERE id=?').get(f.runId).status,'succeeded');
 assert.equal(f.store.getTask(f.task.id).status,'ready');
 assert.equal(f.store.latestCheckpoint(f.task.id).payload.run_id,f.runId);
 assert.equal(f.count('conversation_completed_runs'),0);
 assert.throws(()=>confirmed(f.store,f.task,f.runId),/run_finish_state_invalid/);
 assert.equal(f.count('messages'),2);
});
test('checkpoint DB failure cannot leave a phantom confirmed answer or remove the provisional',t=>{
 const f=start(t);
 const before={messages:f.count('messages'),events:f.count('events'),checkpoints:f.count('checkpoints')};
 f.store.db.exec("CREATE TEMP TRIGGER deny_checkpoint BEFORE INSERT ON checkpoints BEGIN SELECT RAISE(ABORT,'checkpoint_write_failed'); END");
 assert.throws(()=>confirmed(f.store,f.task,f.runId),/checkpoint_write_failed/);
 assert.equal(f.count('messages'),before.messages);
 assert.equal(f.count('events'),before.events);
 assert.equal(f.count('checkpoints'),before.checkpoints);
 assert.equal(f.count('run_provisional_outputs'),1);
 assert.equal(f.store.getTask(f.task.id).provisional_response.content,'unverified partial');
 assert.equal(f.store.db.prepare('SELECT status FROM runs WHERE id=?').get(f.runId).status,'running');
 f.store.db.exec('DROP TRIGGER deny_checkpoint');
 f.store.finishRun(f.task.id,f.runId,'confirmed_response_persistence_failed');
 assert.equal(f.store.db.prepare('SELECT status FROM runs WHERE id=?').get(f.runId).status,'failed');
 assert.equal(f.store.getTask(f.task.id).provisional_response.content,'unverified partial');
 assert.equal(f.count('messages'),1);
});
test('run.succeeded event failure rolls back assistant, assets, checkpoint, and Run',t=>{
 const f=start(t);
 f.store.db.exec("CREATE TEMP TRIGGER deny_success_event BEFORE INSERT ON events WHEN NEW.kind='run.succeeded' BEGIN SELECT RAISE(ABORT,'event_write_failed'); END");
 assert.throws(()=>confirmed(f.store,f.task,f.runId,messageId=>{
   f.store.addAsset(f.task.id,messageId,{
     id:'asset_transactional',mimeType:'image/png',
     localPath:'C:/isolated/not-created.png'
   });
   return [{id:'asset_transactional'}];
 }),/event_write_failed/);
 assert.equal(f.count('messages'),1);
 assert.equal(f.count('message_assets'),0);
 assert.equal(f.count('checkpoints'),0);
 assert.equal(f.count('run_provisional_outputs'),1);
 assert.equal(f.store.db.prepare('SELECT status FROM runs WHERE id=?').get(f.runId).status,'running');
 assert.equal(f.store.getTask(f.task.id).provisional_response.observed_kind,'unverified');
});
test('asset callback throws after assistant append, so no response or checkpoint is committed',t=>{
 const f=start(t);
 assert.throws(()=>confirmed(f.store,f.task,f.runId,()=>{throw Error('asset_write_failed')}),/asset_write_failed/);
 assert.equal(f.count('messages'),1);
 assert.equal(f.count('checkpoints'),0);
 assert.equal(f.count('run_provisional_outputs'),1);
 assert.equal(f.store.db.prepare('SELECT status FROM runs WHERE id=?').get(f.runId).status,'running');
});
test('foreign task or already-finalized Run never invokes asset side effects',t=>{
 const f=start(t);
 const foreign=f.store.createTask('Foreign');
 let invoked=0;
 assert.throws(()=>f.store.commitObservedProviderReply(foreign.id,f.runId,{
   text:'forbidden',observedAt:'now',attachAssets:()=>{invoked++;return []}
 }),/run_finish_state_invalid/);
 assert.equal(invoked,0);
 f.store.finishRun(f.task.id,f.runId,'already_failed');
 assert.throws(()=>confirmed(f.store,f.task,f.runId,()=>{invoked++;return []}),/run_finish_state_invalid/);
 assert.equal(invoked,0);
 assert.equal(f.count('messages'),1);
});
test('main routes observed provider completion exclusively through the Store atomic method',()=>{
 const main=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
 const run=main.slice(main.indexOf('async function runTask('),main.indexOf('function layoutViews()'));
 assert.match(run,/store\.commitObservedProviderReply\(taskId, runId/);
 assert.doesNotMatch(run,/store\.appendMessage\(taskId, 'assistant'/);
 assert.doesNotMatch(run,/store\.checkpoint\(taskId,/);
 assert.match(run,/for \(const assetPath of writtenPaths\)/);
 assert.match(run,/provisional\.flush\(\)/);
});