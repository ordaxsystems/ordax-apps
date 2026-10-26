import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const file=fileURLToPath(new URL('../scripts/live-ui-gpt-interrupted-recovery-readonly.cjs',import.meta.url));
const script=fs.readFileSync(file,'utf8');

test('physical GPT recovery gate compiles and refuses missing explicit staged task scope',()=>{
  const syntax=spawnSync(process.execPath,['--check',file],{encoding:'utf8',timeout:5000});
  assert.equal(syntax.status,0,syntax.stderr);
  const rejected=spawnSync(process.execPath,[file],{
    encoding:'utf8',timeout:5000,
    env:{...process.env,ORDAX_LAB_E2E_TASK_ID:'',ORDAX_LAB_E2E_RECOVERY_READONLY:''}
  });
  assert.notEqual(rejected.status,0);
  assert.match(rejected.stderr,/lab_recovery_explicit_task_approval_required/);
  assert.doesNotMatch(rejected.stderr,/cookie|access.token|private.key/i);
});

test('physical recovery inspector requires a receipt and never imports, resends or prints the reply',()=>{
  assert.match(script,/ORDAX_LAB_E2E_RECOVERY_READONLY/);
  assert.match(script,/ORDAX_LAB_E2E_TASK_ID/);
  assert.match(script,/waitForLabAppMode\(evaluate\)/);
  assert.match(script,/readInterruptedRecoverySnapshot\(db,expectedTaskId\)/);
  assert.match(script,/gpt-interrupted-recovery-preflight\.cjs/);
  assert.match(script,/#inspectLinkedThread'\)\.click\(\)/);
  assert.match(script,/assert\.deepEqual\(after,before,'lab_recovery_mutated_canonical_ledger'\)/);
  assert.doesNotMatch(script,/#confirmLinkedReplyRecovery'\)\.click\(\)/);
  assert.doesNotMatch(script,/\.sendPrompt\(|\.requestSubmit\(|\.reconcileLinkedReply\(/);
  assert.doesNotMatch(script,/console\.log\(.*previewChars/);
  assert.match(script,/providerMessagesSent:0,repliesImported:0/);
});

import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../src/store.mjs';
import {recordProviderSubmissionProvenance} from '../src/provider-submission-provenance.mjs';

const {readInterruptedRecoverySnapshot}=createRequire(import.meta.url)(
  '../scripts/gpt-interrupted-recovery-preflight.cjs'
);
const chatA='https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';
const chatB='https://chatgpt.com/c/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function fixture(t,{withReceipt=true}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-recovery-preflight-'));
  const filename=path.join(dir,'canonical.sqlite');
  const store=new Store(filename);
  const task=store.createTask('Isolated recovery preflight '+randomUUID());
  const {runId,userMessage}=store.beginProviderRun(task.id,'local user request');
  store.setChatUrl(task.id,chatA);
  if(withReceipt)assert.deepEqual(recordProviderSubmissionProvenance({
    store,taskId:task.id,runId,messageId:userMessage.id,
    providerPrompt:'context expanded prompt '+randomUUID(),
    chatUrl:chatA,submittedAt:Date.now()
  }),{recorded:true,reason:'receipt_recorded'});
  assert.equal(store.recoverInterruptedRuns(),1);
  const db=new DatabaseSync(filename,{readOnly:true});
  t.after(()=>{
    db.close();
    store.close();
    fs.rmSync(dir,{recursive:true,force:true});
  });
  return {db,store,taskId:task.id,runId,userMessageId:userMessage.id};
}

test('physical certifier preflight accepts a real interrupted SQLite Run and exact receipt',t=>{
  const f=fixture(t);
  const before={
    integrity:f.db.prepare('PRAGMA quick_check').get().quick_check,
    messages:f.db.prepare('SELECT COUNT(*) n FROM messages').get().n,
    receipts:f.db.prepare("SELECT COUNT(*) n FROM events WHERE kind='provider.submission.provenance'").get().n
  };
  assert.equal(before.integrity,'ok');
  const snap=readInterruptedRecoverySnapshot(f.db,f.taskId);
  assert.equal(snap.runStatus,'interrupted');
  assert.equal(snap.taskStatus,'interrupted');
  assert.equal(snap.runId,f.runId);
  assert.equal(snap.lastUserId,f.userMessageId);
  assert.equal(snap.taskAssistants,0);
  assert.equal(snap.totalMessages,1);
  assert.equal(snap.allRuns,1);
  assert.equal(snap.taskCheckpoints,0);
  assert.equal(snap.allActions,0);
  assert.equal(snap.reconciled,0);
  assert.deepEqual(readInterruptedRecoverySnapshot(f.db,f.taskId),snap);
  assert.deepEqual({
    integrity:f.db.prepare('PRAGMA quick_check').get().quick_check,
    messages:f.db.prepare('SELECT COUNT(*) n FROM messages').get().n,
    receipts:f.db.prepare("SELECT COUNT(*) n FROM events WHERE kind='provider.submission.provenance'").get().n
  },before);
});

test('interrupted run without a durable provider receipt is refused before CDP',t=>{
  const f=fixture(t,{withReceipt:false});
  assert.throws(()=>readInterruptedRecoverySnapshot(f.db,f.taskId),
    /lab_recovery_verified_receipt_required/);
});

test('receipt from preceding Run never authorizes a newer interrupted Run',t=>{
  const f=fixture(t);
  const next=f.store.beginProviderRun(f.taskId,'newer request');
  assert.notEqual(next.runId,f.runId);
  assert.equal(f.store.recoverInterruptedRuns(),1);
  assert.throws(()=>readInterruptedRecoverySnapshot(f.db,f.taskId),
    /lab_recovery_verified_receipt_required/);
});

test('old active-conversation receipt cannot authorize rotated thread',t=>{
  const f=fixture(t);
  f.store.rotateConversation(f.taskId);
  f.store.setChatUrl(f.taskId,chatB);
  assert.throws(()=>readInterruptedRecoverySnapshot(f.db,f.taskId),
    /lab_recovery_verified_receipt_required/);
});

test('latest completed Run is never certified as interrupted',t=>{
  const f=fixture(t);
  f.store.db.prepare("UPDATE runs SET status='succeeded' WHERE id=?").run(f.runId);
  assert.throws(()=>readInterruptedRecoverySnapshot(f.db,f.taskId),
    /lab_recovery_failed_run_required/);
});

test('bad receipt timestamps and prompt digests are rejected in SQLite',t=>{
  const f=fixture(t);
  const sql="UPDATE events SET payload=json_set(payload,'$.submitted_at',0) WHERE task_id=? AND kind='provider.submission.provenance'";
  f.store.db.prepare(sql).run(f.taskId);
  assert.throws(()=>readInterruptedRecoverySnapshot(f.db,f.taskId),
    /lab_recovery_verified_receipt_required/);
  f.store.db.prepare("UPDATE events SET payload=json_set(json_set(payload,'$.submitted_at',123456),'$.prompt_sha256','not_sha256') WHERE task_id=? AND kind='provider.submission.provenance'").run(f.taskId);
  assert.throws(()=>readInterruptedRecoverySnapshot(f.db,f.taskId),
    /lab_recovery_verified_receipt_required/);
});

test('invalid task identifiers are refused before querying SQLite',t=>{
  const f=fixture(t);
  for(const id of ['',f.runId,'../'+f.taskId,'task_invalid']){
    assert.throws(()=>readInterruptedRecoverySnapshot(f.db,id),
      /lab_recovery_explicit_task_approval_required/);
  }
});
