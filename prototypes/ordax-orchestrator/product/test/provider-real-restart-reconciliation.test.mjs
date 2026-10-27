import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Store} from '../src/store.mjs';
import {recordProviderSubmissionProvenance,recordProviderSubmissionIntent} from '../src/provider-submission-provenance.mjs';
import {inspectProviderLinkedThread,reconcileProviderLinkedReply,recoverFailedProviderSubmission} from '../src/provider-linked-thread-recovery.mjs';

const sha256=value=>createHash('sha256').update(value,'utf8').digest('hex');
const url=id=>'https://chatgpt.com/c/'+id;
const threadA=url('11111111-2222-4333-8444-555555555555');
const threadB=url('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');

function openFixture(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-recover-real-restart-'));
  const filename=path.join(directory,'canonical.sqlite');
  let store=new Store(filename);
  t.after(()=>{
    try {store?.close();} catch {}
    fs.rmSync(directory,{recursive:true,force:true});
  });
  return {
    get store(){return store;},
    restart(){
      store.close();
      store=new Store(filename);
      return store.recoverInterruptedRuns();
    }
  };
}

function stageSubmission(store,{url,providerPrompt,withReceipt=true}){
  const task=store.createTask('Restart reconciliation '+randomUUID());
  const {runId,userMessage}=store.beginProviderRun(task.id,'Local user request.');
  store.setChatUrl(task.id,url);
  if(withReceipt)assert.deepEqual(recordProviderSubmissionProvenance({
    store,taskId:task.id,runId,messageId:userMessage.id,
    providerPrompt,chatUrl:url,submittedAt:Date.now()
  }),{recorded:true,reason:'receipt_recorded'});
  return {task,runId,userMessage,providerPrompt,url};
}

function observation(item,reply){
  return {available:true,domReliable:true,truncated:false,
    responseCompletionObserved:true,generationStopVisible:false,url:item.url,
    messages:[{role:'user',text:item.providerPrompt},{role:'assistant',text:reply}]};
}

test('an acknowledged GPT submission survives a physical Store restart, then read-only recovery commits once',async t=>{
  const f=openFixture(t);
  const nonceA=randomUUID(),nonceB=randomUUID();
  const a=stageSubmission(f.store,{url:threadA,providerPrompt:'GPT A '+nonceA});
  const b=stageSubmission(f.store,{url:threadB,providerPrompt:'GPT B '+nonceB});
  assert.equal(f.restart(),2);
  assert.equal(f.store.recoverInterruptedRuns(),0);
  let reads=0,sends=0;
  const current={ [threadA]:observation(a,'Resposta A '+nonceA),
    [threadB]:observation(b,'Resposta B '+nonceB) };
  const worker={
    inspectConversationReadOnly:async target=>{reads++;return current[target];},
    sendPrompt:async()=>{sends++;throw Error('never_send_on_recovery');}
  };

  const previewA=await inspectProviderLinkedThread({store:f.store,worker,taskId:a.task.id});
  assert.equal(previewA.recoveryPreview.text,'Resposta A '+nonceA);
  assert.doesNotMatch(JSON.stringify(previewA),new RegExp(nonceB));
  assert.equal(f.store.db.prepare("SELECT status FROM runs WHERE id=?").get(a.runId).status,'interrupted');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='assistant'").get(a.task.id).n,0);

  const commitA=await reconcileProviderLinkedReply({store:f.store,worker,taskId:a.task.id,
    responseSha256:previewA.recoveryPreview.responseSha256});
  assert.equal(commitA.reconciled,true);
  assert.equal(f.store.db.prepare("SELECT status FROM runs WHERE id=?").get(a.runId).status,'succeeded');
  assert.equal(f.store.db.prepare("SELECT status FROM runs WHERE id=?").get(b.runId).status,'interrupted');
  assert.deepEqual(await reconcileProviderLinkedReply({store:f.store,worker,taskId:a.task.id,
    responseSha256:previewA.recoveryPreview.responseSha256}),{reconciled:false,reason:'already_reconciled'});
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='assistant'").get(a.task.id).n,1);

  const wrongDigest=await reconcileProviderLinkedReply({store:f.store,worker,taskId:b.task.id,
    responseSha256:sha256('Resposta A '+nonceA)});
  assert.deepEqual(wrongDigest,{reconciled:false,reason:'provider_reply_candidate_changed'});
  assert.equal(f.store.db.prepare("SELECT status FROM runs WHERE id=?").get(b.runId).status,'interrupted');
  const previewB=await inspectProviderLinkedThread({store:f.store,worker,taskId:b.task.id});
  assert.equal(previewB.recoveryPreview.text,'Resposta B '+nonceB);
  assert.equal((await reconcileProviderLinkedReply({store:f.store,worker,taskId:b.task.id,
    responseSha256:previewB.recoveryPreview.responseSha256})).reconciled,true);
  assert.equal(sends,0);
  assert.ok(reads>=4);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('a provider response without an acknowledged submission receipt must not be inspected or imported after restart',async t=>{
  const f=openFixture(t);
  const task=stageSubmission(f.store,{url:threadA,providerPrompt:'not acknowledged',withReceipt:false});
  assert.equal(f.restart(),1);
  let readCount=0,sendCount=0;
  const worker={
    inspectConversationReadOnly:async()=>{readCount++;return observation(task,'Provider response');},
    sendPrompt:async()=>{sendCount++;}
  };
  const inspection=await inspectProviderLinkedThread({store:f.store,worker,taskId:task.task.id});
  assert.equal(inspection.reason,'provider_submission_provenance_missing');
  assert.equal(inspection.recoveryPreview,undefined);
  assert.equal(readCount,0);
  assert.equal(sendCount,0);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='assistant'").get(task.task.id).n,0);
});

test('lost send acknowledgement auto-recovers one complete reply from a durable dispatch intent without resending',async t=>{
  const f=openFixture(t);
  const task=stageSubmission(f.store,{url:threadA,providerPrompt:'lost acknowledgement '+randomUUID(),withReceipt:false});
  const baselineId='gpt-user-before-dispatch';
  assert.deepEqual(recordProviderSubmissionIntent({
    store:f.store,taskId:task.task.id,runId:task.runId,messageId:task.userMessage.id,
    providerPrompt:task.providerPrompt,chatUrl:task.url,intentAt:Date.now(),
    baselineUserMessageId:baselineId,baselineUserMessagePresent:true,baselinePromptMatches:false
  }),{recorded:true,reason:'intent_recorded'});
  f.store.recordRunMetrics(task.task.id,task.runId,'beta',{
    failedStage:'submit',providerDeliveryState:'uncertain',submitAttemptAt:Date.now()
  });
  f.store.finishRun(task.task.id,task.runId,'submit:send_confirmation_unknown');
  assert.equal(f.restart(),0);
  let reads=0,sends=0;
  const worker={
    inspectConversationReadOnly:async(target,{allowNavigation}={})=>{
      reads++;
      assert.equal(target,threadA);
      assert.equal(allowNavigation,false);
      return {available:true,domReliable:true,truncated:false,
        responseCompletionObserved:true,generationStopVisible:false,url:threadA,
        messages:[
          {role:'user',id:baselineId,text:'older prompt'},
          {role:'assistant',id:'old-answer',text:'older answer'},
          {role:'user',id:'gpt-user-dispatched',text:task.providerPrompt},
          {role:'assistant',id:'gpt-answer-dispatched',text:'Answer accepted by GPT'}
        ]};
    },
    sendPrompt:async()=>{sends++;throw new Error('must_never_resend');}
  };
  const recovered=await recoverFailedProviderSubmission({
    store:f.store,worker,taskId:task.task.id,runId:task.runId
  });
  assert.deepEqual(recovered,{reconciled:true,reason:'reconciled'});
  assert.equal(reads,2,'the provider evidence is inspected and revalidated before commit');
  assert.equal(sends,0);
  assert.equal(f.store.db.prepare("SELECT content FROM messages WHERE task_id=? AND role='assistant'").get(task.task.id).content,
    'Answer accepted by GPT');
  assert.equal(f.store.db.prepare("SELECT status FROM runs WHERE id=?").get(task.runId).status,'succeeded');
  assert.equal(f.store.db.prepare("SELECT status FROM tasks WHERE id=?").get(task.task.id).status,'ready');
  assert.equal(f.store.db.prepare("SELECT json_extract(payload,'$.submission_evidence') evidence FROM events WHERE task_id=? AND kind='provider.response.reconciled'").get(task.task.id).evidence,
    'dispatch_intent');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='assistant'").get(task.task.id).n,1);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM checkpoints WHERE task_id=?").get(task.task.id).n,1);
});

test('dispatch intent without a stable pre-dispatch baseline fails closed and never imports a historical duplicate',async t=>{
  const f=openFixture(t);
  const task=stageSubmission(f.store,{url:threadA,providerPrompt:'potential old prompt '+randomUUID(),withReceipt:false});
  assert.deepEqual(recordProviderSubmissionIntent({
    store:f.store,taskId:task.task.id,runId:task.runId,messageId:task.userMessage.id,
    providerPrompt:task.providerPrompt,chatUrl:task.url,intentAt:Date.now(),
    baselineUserMessageId:null,baselineUserMessagePresent:true,baselinePromptMatches:false
  }),{recorded:true,reason:'intent_recorded'});
  f.store.recordRunMetrics(task.task.id,task.runId,'beta',{
    failedStage:'submit',providerDeliveryState:'uncertain',submitAttemptAt:Date.now()
  });
  f.store.finishRun(task.task.id,task.runId,'submit:send_confirmation_unknown');
  let reads=0,sends=0;
  const worker={inspectConversationReadOnly:async()=>{
    reads++;
    return {available:true,domReliable:true,truncated:false,
      responseCompletionObserved:true,generationStopVisible:false,url:threadA,
      messages:[{role:'user',id:'old-turn-without-readable-id',text:task.providerPrompt},
        {role:'assistant',id:'old-answer',text:'A resposta é antiga'}]};
  },sendPrompt:async()=>{sends++;}};
  const result=await recoverFailedProviderSubmission({store:f.store,worker,taskId:task.task.id,runId:task.runId});
  assert.equal(result.reconciled,false);
  assert.equal(result.reason,'provider_baseline_message_id_missing');
  assert.equal(reads,1);
  assert.equal(sends,0);
  assert.equal(f.store.db.prepare("SELECT status FROM runs WHERE id=?").get(task.runId).status,'failed');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='assistant'").get(task.task.id).n,0);
});

test('an uncertain first send links its fresh GPT conversation only after two matching complete observations',async t=>{
  const f=openFixture(t);
  const task=f.store.createTask('First send recovery '+randomUUID());
  const providerPrompt='Create a first deliverable '+randomUUID();
  const {runId,userMessage}=f.store.beginProviderRun(task.id,'Create a first deliverable.');
  assert.deepEqual(recordProviderSubmissionIntent({
    store:f.store,taskId:task.id,runId,messageId:userMessage.id,
    providerPrompt,chatUrl:'https://chatgpt.com/',intentAt:Date.now(),
    baselineUserMessageId:null,baselineUserMessagePresent:false,baselinePromptMatches:false,
    newSession:true,previousConversationId:null,previousChatUrl:null
  }),{recorded:true,reason:'intent_recorded'});
  f.store.recordRunMetrics(task.id,runId,'beta',{
    failedStage:'submit',providerDeliveryState:'uncertain',submitAttemptAt:Date.now()
  });
  f.store.finishRun(task.id,runId,'submit:send_confirmation_unknown');
  let reads=0,sends=0,currentUrl=threadA;
  const worker={status:()=>({url:currentUrl}),inspectConversationReadOnly:async(target,{allowNavigation}={})=>{
    reads++;
    assert.equal(target,threadA);
    assert.equal(allowNavigation,false);
    return observation({providerPrompt,url:threadA},'First send response');
  },sendPrompt:async()=>{sends++;}};
  const recovered=await recoverFailedProviderSubmission({store:f.store,worker,taskId:task.id,runId});
  assert.deepEqual(recovered,{reconciled:true,reason:'reconciled'});
  assert.equal(reads,2);
  assert.equal(sends,0);
  assert.equal(f.store.db.prepare('SELECT chat_url FROM tasks WHERE id=?').get(task.id).chat_url,threadA);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM task_conversations WHERE task_id=? AND status='active'").get(task.id).n,1);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM events WHERE task_id=? AND kind='provider.conversation.bound'").get(task.id).n,1);
  assert.equal(f.store.db.prepare("SELECT status FROM runs WHERE id=?").get(runId).status,'succeeded');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='assistant'").get(task.id).n,1);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('a new-session intent never binds the old GPT conversation as if it were fresh',async t=>{
  const f=openFixture(t);
  const task=stageSubmission(f.store,{url:threadA,providerPrompt:'new segment '+randomUUID(),withReceipt:false});
  const previous=f.store.db.prepare("SELECT id FROM task_conversations WHERE task_id=? AND status='active'").get(task.task.id);
  assert.deepEqual(recordProviderSubmissionIntent({
    store:f.store,taskId:task.task.id,runId:task.runId,messageId:task.userMessage.id,
    providerPrompt:task.providerPrompt,chatUrl:'https://chatgpt.com/',intentAt:Date.now(),
    baselineUserMessageId:null,baselineUserMessagePresent:false,baselinePromptMatches:false,
    newSession:true,previousConversationId:previous.id,previousChatUrl:threadA,contextCheckpointVersion:0
  }),{recorded:true,reason:'intent_recorded'});
  f.store.recordRunMetrics(task.task.id,task.runId,'beta',{
    failedStage:'submit',providerDeliveryState:'uncertain',submitAttemptAt:Date.now()
  });
  f.store.finishRun(task.task.id,task.runId,'submit:send_confirmation_unknown');
  let reads=0,sends=0;
  const worker={status:()=>({url:threadA}),inspectConversationReadOnly:async()=>{reads++;return observation(task,'Old conversation answer');},sendPrompt:async()=>{sends++;}};
  const result=await recoverFailedProviderSubmission({store:f.store,worker,taskId:task.task.id,runId:task.runId});
  assert.deepEqual(result,{reconciled:false,reason:'provider_new_conversation_url_unobserved'});
  assert.equal(reads,0);
  assert.equal(sends,0);
  assert.equal(f.store.db.prepare('SELECT chat_url FROM tasks WHERE id=?').get(task.task.id).chat_url,threadA);
  assert.equal(f.store.db.prepare("SELECT status FROM runs WHERE id=?").get(task.runId).status,'failed');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='assistant'").get(task.task.id).n,0);
});

test('post-preview response replacement remains untrusted, with original interrupted run preserved',async t=>{
  const f=openFixture(t);
  const task=stageSubmission(f.store,{url:threadA,providerPrompt:'unique '+randomUUID()});
  assert.equal(f.restart(),1);
  let current=observation(task,'First observed answer');
  const worker={inspectConversationReadOnly:async()=>current};
  const preview=await inspectProviderLinkedThread({store:f.store,worker,taskId:task.task.id});
  assert.equal(preview.recoveryPreview.text,'First observed answer');
  current=observation(task,'Changed answer after preview');
  assert.deepEqual(await reconcileProviderLinkedReply({store:f.store,worker,taskId:task.task.id,
    responseSha256:preview.recoveryPreview.responseSha256}),
    {reconciled:false,reason:'provider_reply_candidate_changed'});
  assert.equal(f.store.db.prepare("SELECT status FROM runs WHERE id=?").get(task.runId).status,'interrupted');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM checkpoints WHERE task_id=?").get(task.task.id).n,0);
});

