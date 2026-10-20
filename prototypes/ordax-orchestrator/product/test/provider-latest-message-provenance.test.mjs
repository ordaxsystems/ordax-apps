import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {recordProviderSubmissionProvenance,findProviderSubmissionProvenance} from '../src/provider-submission-provenance.mjs';

const url='https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';
function withStore(check) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-w3-latest-turn-'));
  const store=new Store(path.join(directory,'lab.sqlite'));
  try { return check(store); } finally {
    store.close();
    fs.rmSync(directory,{recursive:true,force:true});
  }
}
function receipt(store,taskId,runId,messageId,text) {
  return recordProviderSubmissionProvenance({
    store,taskId,runId,messageId,providerPrompt:text,chatUrl:url,submittedAt:Date.now()
  });
}

test('W3 never reuses a prior provider receipt for a newer unsubmitted local message',()=>{
  withStore(store=>{
    const task=store.createTask('Tarefa com continuidade');
    const {userMessage,runId}=store.beginProviderRun(task.id,'Pergunta anterior');
    store.setChatUrl(task.id,url);
    assert.equal(receipt(store,task.id,runId,userMessage.id,'Pergunta anterior').recorded,true);
    const newer=store.appendMessage(task.id,'user','Mensagem nova somente local');
    const latest=store.db.prepare(
      "SELECT id FROM messages WHERE task_id=? AND role='user' ORDER BY rowid DESC LIMIT 1"
    ).get(task.id);
    assert.equal(latest.id,newer.id);
    assert.equal(findProviderSubmissionProvenance({
      store,taskId:task.id,chatUrl:url,messageId:newer.id
    }),null);
    assert.ok(findProviderSubmissionProvenance({
      store,taskId:task.id,chatUrl:url,messageId:userMessage.id
    }));
    assert.equal(findProviderSubmissionProvenance({store,taskId:task.id,chatUrl:url}),null);
  });
});

test('W3 receipt recording binds only the newest user message to a running Run',()=>{
  withStore(store=>{
    const task=store.createTask('Tarefa');
    const older=store.appendMessage(task.id,'user','Pergunta antiga');
    const {userMessage,runId}=store.beginProviderRun(task.id,'Pergunta atual');
    store.setChatUrl(task.id,url);
    assert.deepEqual(receipt(store,task.id,runId,older.id,'Pergunta antiga'),{
      recorded:false,reason:'receipt_reference_missing'
    });
    assert.equal(receipt(store,task.id,runId,userMessage.id,'Pergunta atual').recorded,true);
    store.finishRun(task.id,runId,'encerrada');
    assert.equal(receipt(store,task.id,runId,userMessage.id,'Pergunta atual').recorded,false);
  });
});

test('W3 SQL insertion order remains correct when timestamps are identical',()=>{
  withStore(store=>{
    store.now=()=> '2026-10-20T17:28:00.000Z';
    const task=store.createTask('Timestamp igual');
    const original=store.appendMessage(task.id,'user','Primeira');
    const latest=store.appendMessage(task.id,'user','Segunda');
    const row=store.db.prepare(
      "SELECT id FROM messages WHERE task_id=? AND role='user' ORDER BY rowid DESC LIMIT 1"
    ).get(task.id);
    assert.equal(row.id,latest.id);
    assert.notEqual(row.id,original.id);
  });
});

test('W3 canonical inspection uses latest message ID, not task-wide receipt',()=>{
  const main=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
  const start=main.indexOf("ipcMain.handle('ordax:tasks:inspect-linked-thread'");
  const end=main.indexOf("ipcMain.handle('ordax:tasks:resume-capsule'",start);
  const handler=main.slice(start,end);
  assert.match(handler,/SELECT id,content FROM messages WHERE task_id=\? AND role='user'/);
  assert.match(handler,/ORDER BY rowid DESC LIMIT 1/);
  assert.match(handler,/messageId:message\?\.id/);
  assert.doesNotMatch(handler,/sendPrompt\(|requestSubmit\(/);
});
