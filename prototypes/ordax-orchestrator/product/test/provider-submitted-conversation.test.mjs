import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.mjs';
import { bindObservedSubmittedConversation } from '../src/provider-submitted-conversation.mjs';
const chat='https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-submitted-conv-'));
  const db=path.join(dir,'state.sqlite');
  let store=new Store(db);
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const task=store.createTask('Canonical first chat');
  const runId=store.startRun(task.id);
  return {task,runId,get store(){return store;},restart(){
    store.close();store=new Store(db);return store;
  }};
}
const bind=(f,changes={})=>bindObservedSubmittedConversation({
  store:f.store,taskId:f.task.id,runId:f.runId,chatUrl:chat,
  submittedAt:1792418400000,plannedNewSession:true,checkpointVersion:null,...changes
});

test('submitted first-chat permalink survives SQLite restart before response',t=>{
  const f=fixture(t);
  assert.equal(f.store.getTaskExecutionSnapshot(f.task.id).chat_url,null);
  const result=bind(f);
  assert.equal(result.bound,true);
  assert.equal(result.responseObserved,false);
  assert.equal(result.effectVerified,false);
  assert.equal(f.store.getTaskExecutionSnapshot(f.task.id).chat_url,chat);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM task_conversations WHERE task_id=?').get(f.task.id).n,1);
  assert.equal(f.store.db.prepare('SELECT status FROM runs WHERE id=?').get(f.runId).status,'running');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE task_id=?').get(f.task.id).n,0);
  const restarted=f.restart();
  assert.equal(restarted.recoverInterruptedRuns(),1);
  assert.equal(restarted.getTaskExecutionSnapshot(f.task.id).chat_url,chat);
  assert.equal(restarted.db.prepare('SELECT status FROM runs WHERE id=?').get(f.runId).status,'interrupted');
  const entries=restarted.db.prepare(
    "SELECT kind,payload FROM events WHERE task_id=? AND kind='provider.conversation.submission_permalink_observed'"
  ).all(f.task.id);
  assert.equal(entries.length,1);
  const evidence=JSON.parse(entries[0].payload);
  assert.equal(evidence.delivery_observed,true);
  assert.equal(evidence.response_observed,false);
  assert.equal(evidence.effect_verified,false);
  assert.ok(!entries[0].payload.includes(chat));
});

test('no URL is persisted without confirmed submit timestamp or canonical URL',t=>{
  const f=fixture(t);
  for(const changes of [
    {submittedAt:null},{submittedAt:0},{submittedAt:'1792418400000'},
    {chatUrl:'https://chatgpt.com/'},{chatUrl:'https://chatgpt.com/share/public'},
    {chatUrl:'https://evil.example/c/123'},{plannedNewSession:false},
    {chatUrl:'https://chatgpt.com/c/safe?token=leaked'}
  ]){
    const result=bind(f,changes);
    // Canonical links with query/fragment remain valid and are stripped below;
    // only the other cases must fail.
    if(changes.chatUrl?.includes('?token=leaked')){
      assert.equal(result.bound,true);
      break;
    }
    assert.equal(result.bound,false);
  }
  assert.equal(f.store.getTaskExecutionSnapshot(f.task.id).chat_url,
    'https://chatgpt.com/c/safe');
  assert.ok(!JSON.stringify(f.store.db.prepare('SELECT chat_url FROM tasks WHERE id=?').get(f.task.id))
    .includes('leaked'));
});

test('duplicate same URL does not create repeated conversation or event',t=>{
  const f=fixture(t);
  assert.equal(bind(f).bound,true);
  assert.equal(bind(f).reason,'already_bound');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM task_conversations WHERE task_id=?').get(f.task.id).n,1);
  assert.equal(f.store.db.prepare(
    "SELECT COUNT(*) AS n FROM events WHERE task_id=? AND kind='provider.conversation.submission_permalink_observed'"
  ).get(f.task.id).n,1);
});

test('finished or foreign Run cannot bind a pending ChatGPT conversation',t=>{
  const f=fixture(t);
  f.store.finishRun(f.task.id,f.runId,'simulated_failure');
  assert.equal(bind(f).reason,'run_not_active');
  const later=f.store.createTask('Another Task');
  const run=f.store.startRun(later.id);
  assert.equal(bind(f,{runId:run}).reason,'run_not_active');
  assert.equal(f.store.getTaskExecutionSnapshot(f.task.id).chat_url,null);
});

test('worker retains permalink only after exactly-one submit receipt',()=>{
  const here=path.dirname(fileURLToPath(import.meta.url));
  const worker=fs.readFileSync(path.resolve(here,'../desktop/embedded-worker.mjs'),'utf8');
  const main=fs.readFileSync(path.resolve(here,'../desktop/main.mjs'),'utf8');
  const segment=worker.split('async sendPrompt({')[1];
  const receiptAt=segment.indexOf('await this.#setComposerAndSend(promptText,{onSubmissionIntent})');
  const durableAt=segment.indexOf('await retainSubmittedConversation()');
  const responseAt=segment.indexOf("this.#setStage('await-response')");
  const responseLoop=segment.slice(responseAt);
  assert.ok(receiptAt>=0&&durableAt>receiptAt&&responseAt>durableAt);
  assert.match(segment,/createProviderDeliveryRecorder\(\{/);
  assert.match(segment,/currentUrl:wc\.getURL\(\)/);
  assert.match(responseLoop,/shouldExpandCollapsedProviderPromptForResponse/);
  assert.match(responseLoop,/responsePromptExpansionAttempted = true/);
  assert.match(responseLoop,/this\.#expandLatestUserMessageForVerification\(\)/);
  assert.match(main,/bindObservedSubmittedConversation/);
  assert.match(main,/submission_run_context_changed/);
  // P280's manual, private-safe diagnostic must survive the P281 cutover.
  assert.match(worker,/async inspectDiagnosticReadOnly\(\)/);
  assert.match(main,/ordax:provider:diagnostic/);
});

