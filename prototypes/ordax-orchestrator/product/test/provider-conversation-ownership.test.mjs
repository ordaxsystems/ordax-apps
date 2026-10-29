import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {bindObservedSubmittedConversation} from '../src/provider-submitted-conversation.mjs';

const chat='https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';
const another='https://chatgpt.com/c/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-thread-owner-'));
  const db=path.join(dir,'store.sqlite');
  let store=new Store(db);
  const a=store.createTask('Source'),b=store.createTask('Independent worker');
  t.after(()=>{try{store.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});});
  return {a,b,get store(){return store;},reopen(){
    store.close();store=new Store(db);return store;
  }};
}
function count(store,taskId){
  return store.db.prepare('SELECT COUNT(*) n FROM task_conversations WHERE task_id=?').get(taskId).n;
}
test('same provider chat cannot bind two Tasks or create a second receipt',t=>{
  const f=fixture(t),first=f.store.setChatUrl(f.a.id,chat);
  assert.equal(first.task_id,f.a.id);
  assert.throws(()=>f.store.setChatUrl(f.b.id,chat),/provider_conversation_owned_by_another_task/);
  assert.equal(f.store.getTask(f.b.id).chat_url,null);
  assert.equal(count(f.store,f.b.id),0);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM events WHERE task_id=? AND kind='provider.conversation.bound'").get(f.b.id).n,0);
  assert.equal(f.store.setChatUrl(f.a.id,chat).id,first.id,'same Task may reuse its own thread');
  assert.equal(count(f.store,f.a.id),1);
});
test('legacy hostname, trailing slash and query variations cannot bypass ownership',t=>{
  const f=fixture(t);
  f.store.setChatUrl(f.a.id,chat+'/?utm_source=other');
  assert.throws(()=>f.store.setChatUrl(f.b.id,chat+'#open'),/provider_conversation_owned_by_another_task/);
  assert.throws(()=>f.store.setChatUrl(f.b.id,chat.replace('chatgpt.com','chat.openai.com')),
    /provider_conversation_owned_by_another_task/);
  assert.equal(count(f.store,f.b.id),0);
});
test('archived historical remote thread remains owned after restart and subsequent rotation',t=>{
  const f=fixture(t);
  f.store.setChatUrl(f.a.id,chat);
  f.store.rotateConversation(f.a.id,'archived_for_continuation');
  f.store.setChatUrl(f.a.id,another);
  f.reopen();
  assert.throws(()=>f.store.setChatUrl(f.b.id,chat),/provider_conversation_owned_by_another_task/);
  assert.equal(f.store.setChatUrl(f.b.id,'https://chatgpt.com/c/different_123').task_id,f.b.id);
  assert.equal(count(f.store,f.a.id),2);
});
test('legacy tasks.chat_url also reserves a remote thread if segments are not backfilled',t=>{
  const f=fixture(t);
  f.store.db.prepare('UPDATE tasks SET chat_url=? WHERE id=?').run(chat,f.a.id);
  assert.throws(()=>f.store.setChatUrl(f.b.id,chat),/provider_conversation_owned_by_another_task/);
  assert.equal(count(f.store,f.b.id),0);
});
test('observed provider submission cannot adopt the remote thread of another Task',t=>{
  const f=fixture(t);
  f.store.setChatUrl(f.a.id,chat);
  const runId=f.store.startRun(f.b.id);
  assert.throws(()=>bindObservedSubmittedConversation({
    store:f.store,taskId:f.b.id,runId,chatUrl:chat,
    submittedAt:1792418400000,plannedNewSession:true,checkpointVersion:null
  }),/provider_conversation_owned_by_another_task/);
  assert.equal(f.store.getTask(f.b.id).chat_url,null);
  assert.equal(count(f.store,f.b.id),0);
  assert.equal(f.store.db.prepare('SELECT status FROM runs WHERE id=?').get(runId).status,'running');
});
