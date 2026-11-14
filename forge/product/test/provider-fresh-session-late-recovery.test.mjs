import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {
  recordProviderSubmissionIntent,
  recordProviderSubmissionProvenance
} from '../src/provider-submission-provenance.mjs';
import {
  inspectProviderLinkedThread,
  recoverFailedProviderSubmission
} from '../src/provider-linked-thread-recovery.mjs';

const chatUrl='https://chatgpt.com/c/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function setup(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-fresh-late-recovery-'));
  const store=new Store(path.join(root,'forge.sqlite'));
  t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  const task=store.createTask('Autonomous recovery');
  const {userMessage,runId}=store.beginProviderRun(task.id,'Continue autonomous local recovery.');
  const providerPrompt='@ordax-mcp\n\n[Forge context]\nContinue autonomous local recovery and inspect real state.';
  const intentAt=Date.now();
  assert.deepEqual(recordProviderSubmissionIntent({
    store,taskId:task.id,runId,messageId:userMessage.id,providerPrompt,
    chatUrl:'https://chatgpt.com/',intentAt,
    baselineUserMessageId:null,baselineUserMessagePresent:false,baselinePromptMatches:false,
    newSession:true,previousConversationId:null,previousChatUrl:null,contextCheckpointVersion:0
  }),{recorded:true,reason:'intent_recorded'});
  store.setChatUrl(task.id,chatUrl);
  assert.deepEqual(recordProviderSubmissionProvenance({
    store,taskId:task.id,runId,messageId:userMessage.id,providerPrompt,
    chatUrl,submittedAt:intentAt+1
  }),{recorded:true,reason:'receipt_recorded'});
  store.finishRun(task.id,runId,'await-response:response_not_observed');
  store.db.prepare('UPDATE runs SET metrics=? WHERE id=?').run(JSON.stringify({
    failed_stage:'await-response',provider_delivery_state:'submitted',
    submit_confirmation_observed:true,submit_attempt_at:intentAt
  }),runId);
  const answer='Melhoria local concluída e validada sem qualquer reenvio da missão.';
  const observation={
    available:true,url:chatUrl,domReliable:true,truncated:false,
    generationStopVisible:false,responseCompletionObserved:true,
    // ChatGPT re-rendered the selected app and Markdown, so these bytes are
    // intentionally different from the submitted providerPrompt.
    messages:[
      {role:'user',text:'Ordax mcp\nForge context re-rendered by provider.'},
      {role:'assistant',text:answer,textTruncated:false}
    ]
  };
  const worker={
    status:()=>({url:chatUrl}),
    inspectConversationReadOnly:async()=>observation
  };
  return {store,task,runId,answer,worker};
}

test('fresh-session delivery receipt can recover one complete late reply after provider re-rendering',async t=>{
  const f=setup(t);
  const preview=await inspectProviderLinkedThread({
    store:f.store,worker:f.worker,taskId:f.task.id,allowNavigation:false
  });
  assert.equal(preview.threadRendered,true);
  assert.equal(preview.kind,'response_candidate');
  assert.equal(preview.reason,'fresh_session_delivery_receipt');
  assert.equal(preview.recoveryPreview.text,f.answer);

  const recovered=await recoverFailedProviderSubmission({
    store:f.store,worker:f.worker,taskId:f.task.id,runId:f.runId
  });
  assert.equal(recovered.reconciled,true);
  assert.equal(f.store.db.prepare('SELECT status FROM runs WHERE id=?').get(f.runId).status,'succeeded');
  assert.equal(f.store.db.prepare("SELECT content FROM messages WHERE task_id=? AND role='assistant'")
    .get(f.task.id).content,f.answer);
});

test('fresh-session fallback stays fail-closed when the rendered thread has more than one user turn',async t=>{
  const f=setup(t);
  f.worker.inspectConversationReadOnly=async()=>({
    available:true,url:chatUrl,domReliable:true,truncated:false,
    generationStopVisible:false,responseCompletionObserved:true,
    messages:[
      {role:'user',text:'first rerendered turn'},
      {role:'assistant',text:f.answer},
      {role:'user',text:'later unrelated turn'}
    ]
  });
  const result=await inspectProviderLinkedThread({
    store:f.store,worker:f.worker,taskId:f.task.id,allowNavigation:false
  });
  assert.equal(result.threadRendered,false);
  assert.equal(result.recoveryPreview,undefined);
  assert.equal(f.store.db.prepare('SELECT status FROM runs WHERE id=?').get(f.runId).status,'failed');
});
