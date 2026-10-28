import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Store} from '../src/store.mjs';
import {recordProviderSubmissionProvenance} from '../src/provider-submission-provenance.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const main=fs.readFileSync(path.join(here,'../desktop/main.mjs'),'utf8');
const chatUrl='https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';

function fixture(t) {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-graceful-close-'));
  const dbFile=path.join(folder,'run.sqlite');
  let store=new Store(dbFile);
  t.after(()=>{
    try{store?.close();}catch{}
    fs.rmSync(folder,{recursive:true,force:true});
  });
  return {
    get db(){return store.db;},
    get store(){return store;},
    restart() {
      store.close();
      store=new Store(dbFile);
      return store.recoverInterruptedRuns();
    }
  };
}

function stagedRun(store) {
  const task=store.createTask('Physical shutdown contract '+randomUUID());
  const {runId,userMessage}=store.beginProviderRun(task.id,'Real technical request');
  store.setChatUrl(task.id,chatUrl);
  assert.deepEqual(recordProviderSubmissionProvenance({
    store,taskId:task.id,runId,messageId:userMessage.id,
    chatUrl,providerPrompt:'Expanded real technical request',
    submittedAt:Date.now()
  }),{recorded:true,reason:'receipt_recorded'});
  return {taskId:task.id,runId,messageId:userMessage.id};
}

test('normal window-close transition is one durable transaction without message replay',t=>{
  const f=fixture(t),r=stagedRun(f.store);
  const actionId=f.store.beginAction(r.taskId,r.runId,'workspace.write','scratch', {});
  assert.equal(f.store.recoverInterruptedRuns('app_shutdown'),1);
  assert.equal(f.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  assert.deepEqual({...f.db.prepare('SELECT status,error FROM runs WHERE id=?').get(r.runId)},
    {status:'interrupted',error:'app_shutdown'});
  assert.equal(f.db.prepare('SELECT status FROM tasks WHERE id=?').get(r.taskId).status,'interrupted');
  assert.equal(f.db.prepare('SELECT status FROM action_ledger WHERE id=?').get(actionId).status,'indeterminate');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM messages WHERE task_id=?').get(r.taskId).n,1);
  assert.equal(f.db.prepare("SELECT role FROM messages WHERE task_id=?").get(r.taskId).role,'user');
  const receipt=f.db.prepare("SELECT json_extract(payload,'$.run_id') AS run_id FROM events WHERE kind='provider.submission.provenance' AND task_id=?").get(r.taskId);
  assert.equal(receipt.run_id,r.runId);
  assert.throws(()=>f.store.finishRun(r.taskId,r.runId),/run_finish_state_invalid/);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='assistant'").get(r.taskId).n,0);
  assert.equal(f.store.recoverInterruptedRuns('app_shutdown'),0);
  assert.equal(f.restart(),0);
  assert.equal(f.db.prepare('SELECT status FROM runs WHERE id=?').get(r.runId).status,'interrupted');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM events WHERE kind='provider.submission.provenance' AND task_id=?").get(r.taskId).n,1);
});

test('a previously succeeded Run is never downgraded on graceful window close',t=>{
  const f=fixture(t),r=stagedRun(f.store);
  f.store.finishRun(r.taskId,r.runId);
  assert.equal(f.store.recoverInterruptedRuns('app_shutdown'),0);
  assert.equal(f.db.prepare('SELECT status FROM runs WHERE id=?').get(r.runId).status,'succeeded');
  assert.equal(f.db.prepare('SELECT status FROM tasks WHERE id=?').get(r.taskId).status,'ready');
});

test('startup recovery keeps its canonical existing reason; invalid reasons cannot mutate DB',t=>{
  const f=fixture(t),r=stagedRun(f.store);
  assert.throws(()=>f.store.recoverInterruptedRuns('anything_else'),/invalid_interruption_reason/);
  assert.equal(f.db.prepare('SELECT status FROM runs WHERE id=?').get(r.runId).status,'running');
  assert.equal(f.restart(),1);
  assert.deepEqual({...f.db.prepare('SELECT status,error FROM runs WHERE id=?').get(r.runId)},
    {status:'interrupted',error:'process_interrupted'});
});

test('Electron close invokes canonical synchronous recovery before closing the window',()=>{
  const start=main.indexOf("win.on('close', event => {");
  const end=main.indexOf("\n  });",start);
  assert.ok(start>=0&&end>start);
  const handler=main.slice(start,end);
  assert.match(handler,/if \(!liveRun\) return;/);
  assert.match(handler,/store\.recoverInterruptedRuns\('app_shutdown'\)/);
  assert.match(handler,/event\.preventDefault\(\)/);
  assert.doesNotMatch(handler,/sendPrompt|loadURL|requestSubmit|fetch\(/);
  assert.match(main,/app\.on\('will-quit', \(\) => \{[\s\S]*store\.close\(\);/);
});
