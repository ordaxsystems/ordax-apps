import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Store} from '../src/store.mjs';
import {recordProviderSubmissionProvenance,recordProviderSubmissionIntent} from '../src/provider-submission-provenance.mjs';
import {providerBaselineMessageId} from '../src/provider-submit-receipt.mjs';
import {inspectProviderLinkedThread,reconcileProviderLinkedReply,recoverFailedProviderSubmission,recoverVisibleLinkedProviderSubmission} from '../src/provider-linked-thread-recovery.mjs';

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
    status:()=>({url:task.url}),
    inspectConversationReadOnly:async()=>{readCount++;return observation(task,'Provider response');},
    sendPrompt:async()=>{sendCount++;}
  };
  const background=await recoverVisibleLinkedProviderSubmission({store:f.store,worker,now:Date.now()});
  assert.deepEqual(background,{state:'idle',reason:'provider_recovery_not_applicable'});
  assert.equal(readCount,0,'an interrupted Run without a receipt or dispatch intent is not inspected');
  const inspection=await inspectProviderLinkedThread({store:f.store,worker,taskId:task.task.id});
  assert.equal(inspection.reason,'provider_submission_provenance_missing');
  assert.equal(inspection.recoveryPreview,undefined);
  assert.equal(readCount,0);
  assert.equal(sendCount,0);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='assistant'").get(task.task.id).n,0);
});

test('app restart can reconcile a late GPT reply from durable dispatch evidence without replaying the send',async t=>{
  const f=openFixture(t);
  const task=stageSubmission(f.store,{url:threadA,providerPrompt:'reply after app restart '+randomUUID(),withReceipt:false});
  const baselineId='gpt-baseline-before-app-restart';
  assert.deepEqual(recordProviderSubmissionIntent({
    store:f.store,taskId:task.task.id,runId:task.runId,messageId:task.userMessage.id,
    providerPrompt:task.providerPrompt,chatUrl:threadA,intentAt:Date.now(),
    baselineUserMessageId:baselineId,baselineUserMessagePresent:true,baselinePromptMatches:false
  }),{recorded:true,reason:'intent_recorded'});
  assert.equal(f.restart(),1);
  assert.equal(f.store.db.prepare("SELECT error FROM runs WHERE id=?").get(task.runId).error,'process_interrupted');
  let reads=0,sends=0;
  const worker={status:()=>({url:threadA}),inspectConversationReadOnly:async(target,{allowNavigation}={})=>{
    reads++;
    assert.equal(target,threadA);
    assert.equal(allowNavigation,false);
    return {available:true,domReliable:true,truncated:false,
      responseCompletionObserved:true,generationStopVisible:false,url:threadA,
      messages:[
        {role:'user',id:baselineId,text:'previous task turn'},
        {role:'assistant',id:'baseline-answer',text:'previous answer'},
        {role:'user',id:'gpt-user-after-restart',text:task.providerPrompt},
        {role:'assistant',id:'gpt-answer-after-restart',text:'Resposta concluída depois de reiniciar o OrdaX.'}
      ]};
  },sendPrompt:async()=>{sends++;throw Error('restart_recovery_must_never_resend');}};
  const recovered=await recoverVisibleLinkedProviderSubmission({store:f.store,worker,now:200_000});
  assert.equal(recovered.state,'recovered');
  assert.equal(recovered.runId,task.runId);
  assert.equal(reads,2,'the existing conversation is re-read before import');
  assert.equal(sends,0);
  assert.equal(f.store.db.prepare("SELECT content FROM messages WHERE task_id=? AND role='assistant'").get(task.task.id).content,
    'Resposta concluída depois de reiniciar o OrdaX.');
  assert.equal(f.store.db.prepare("SELECT status FROM runs WHERE id=?").get(task.runId).status,'succeeded');
  assert.equal(f.store.db.prepare("SELECT status FROM tasks WHERE id=?").get(task.task.id).status,'ready');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM events WHERE task_id=? AND kind='provider.response.reconciled'").get(task.task.id).n,1);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
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

test('background recovery observes a late GPT reply with durable backoff across Store restart and never resends',async t=>{
  const f=openFixture(t);
  const task=stageSubmission(f.store,{url:threadA,providerPrompt:'late reply '+randomUUID()});
  f.store.recordRunMetrics(task.task.id,task.runId,'beta',{
    failedStage:'submit',providerDeliveryState:'uncertain',submitAttemptAt:10_000
  });
  f.store.finishRun(task.task.id,task.runId,'submit:send_confirmation_unknown');
  let reads=0,sends=0;
  let current={...observation(task,'A resposta chegou depois do timeout.'),
    generationStopVisible:true,responseCompletionObserved:false};
  const worker={status:()=>({url:threadA}),inspectConversationReadOnly:async(target,options={})=>{
    reads++;
    assert.equal(target,threadA);
    assert.equal(options.allowNavigation,false,'background recovery must not navigate');
    return current;
  },sendPrompt:async()=>{sends++;throw Error('recovery_must_never_send');}};

  const first=await recoverVisibleLinkedProviderSubmission({store:f.store,worker,now:100_000});
  assert.equal(first.state,'pending');
  assert.equal(first.reason,'provider_response_generation_active');
  assert.equal(first.taskId,task.task.id);
  assert.equal(first.runId,task.runId);
  assert.equal(first.attempt,1);
  assert.equal(first.nextAttemptAt,115_000);
  assert.ok(Number.isSafeInteger(first.eventSeq));
  const eventPlan=f.store.db.prepare(`EXPLAIN QUERY PLAN SELECT payload FROM events WHERE task_id=?
    AND json_extract(payload,'$.run_id')=? AND kind='provider.response.recovery_attempt'
    ORDER BY seq DESC LIMIT 1`).all(task.task.id,task.runId);
  assert.match(eventPlan.map(row=>row.detail).join(' '),/idx_events_provider_recovery_attempt/);
  assert.equal(reads,1);
  assert.equal(sends,0);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='assistant'").get(task.task.id).n,0);

  assert.equal(f.restart(),0);
  const beforeDue=await recoverVisibleLinkedProviderSubmission({store:f.store,worker,now:114_999});
  assert.equal(beforeDue.state,'waiting');
  assert.equal(reads,1,'a restart must preserve the backoff and avoid a duplicate read');
  current=observation(task,'A resposta chegou depois do timeout.');
  const recovered=await recoverVisibleLinkedProviderSubmission({store:f.store,worker,now:115_000});
  assert.equal(recovered.state,'recovered');
  assert.equal(recovered.reason,'reconciled');
  assert.equal(reads,3,'recovery reads and revalidates the completed transcript');
  assert.equal(sends,0);
  assert.equal(f.store.db.prepare("SELECT content FROM messages WHERE task_id=? AND role='assistant'").get(task.task.id).content,
    'A resposta chegou depois do timeout.');
  assert.equal(f.store.db.prepare("SELECT status FROM runs WHERE id=?").get(task.runId).status,'succeeded');
  assert.equal(f.store.db.prepare("SELECT status FROM tasks WHERE id=?").get(task.task.id).status,'ready');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM events WHERE task_id=? AND kind='provider.response.recovery_attempt'").get(task.task.id).n,2);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM events WHERE task_id=? AND kind='provider.response.reconciled'").get(task.task.id).n,1);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('background recovery refuses an unlinked or shared visible GPT thread without inspecting or sending',async t=>{
  const f=openFixture(t);
  const task=stageSubmission(f.store,{url:threadA,providerPrompt:'uncertain shared link '+randomUUID()});
  f.store.recordRunMetrics(task.task.id,task.runId,'beta',{
    failedStage:'submit',providerDeliveryState:'uncertain',submitAttemptAt:10_000
  });
  f.store.finishRun(task.task.id,task.runId,'submit:send_confirmation_unknown');
  const second=f.store.createTask('A second task sharing a provider URL');
  // New writes must reject duplicate ownership. Historical/corrupt snapshots
  // may still contain shared links, so inject that state through SQLite only
  // to prove recovery refuses to inspect or send on ambiguous provenance.
  assert.throws(() => f.store.setChatUrl(second.id,threadA),
    /provider_conversation_owned_by_another_task/);
  f.store.db.prepare('UPDATE tasks SET chat_url=? WHERE id=?').run(threadA,second.id);
  let reads=0,sends=0;
  const worker={status:()=>({url:threadA}),inspectConversationReadOnly:async()=>{
    reads++;return observation(task,'Ambiguous answer');
  },sendPrompt:async()=>{sends++;}};
  assert.deepEqual(await recoverVisibleLinkedProviderSubmission({store:f.store,worker,now:100_000}),
    {state:'ambiguous',reason:'provider_thread_linked_to_multiple_tasks'});
  worker.status=()=>({url:threadB});
  assert.deepEqual(await recoverVisibleLinkedProviderSubmission({store:f.store,worker,now:100_000}),
    {state:'idle',reason:'provider_thread_not_linked'});
  assert.equal(reads,0);
  assert.equal(sends,0);
  assert.equal(f.store.db.prepare("SELECT status FROM runs WHERE id=?").get(task.runId).status,'failed');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='assistant'").get(task.task.id).n,0);
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


test('background supervisor recovers an unlinked first GPT conversation only from its unique durable new-session intent',async t=>{
  const f=openFixture(t);
  const task=f.store.createTask('First-send background recovery '+randomUUID());
  const prompt='First GPT message after lost acknowledgement '+randomUUID();
  const {runId,userMessage}=f.store.beginProviderRun(task.id,'First local message');
  assert.deepEqual(recordProviderSubmissionIntent({
    store:f.store,taskId:task.id,runId,messageId:userMessage.id,providerPrompt:prompt,
    chatUrl:'https://chatgpt.com/',intentAt:Date.now(),newSession:true,
    previousConversationId:null,previousChatUrl:null,
    baselineUserMessageId:null,baselineUserMessagePresent:false,baselinePromptMatches:false
  }),{recorded:true,reason:'intent_recorded'});
  f.store.recordRunMetrics(task.id,runId,'beta',{
    failedStage:'submit',providerDeliveryState:'uncertain',submitAttemptAt:Date.now()
  });
  f.store.finishRun(task.id,runId,'submit:send_confirmation_unknown');
  let reads=0,sends=0;
  const worker={status:()=>({url:threadA}),
    inspectConversationReadOnly:async(target,{allowNavigation}={})=>{
      reads++;
      assert.equal(target,threadA);
      assert.equal(allowNavigation,false);
      return observation({url:threadA,providerPrompt:prompt},'Recovered first answer');
    },
    sendPrompt:async()=>{sends++;throw Error('first_send_recovery_never_replays');}
  };
  assert.equal(f.store.db.prepare('SELECT chat_url FROM tasks WHERE id=?').get(task.id).chat_url,null);
  const result=await recoverVisibleLinkedProviderSubmission({store:f.store,worker,now:100_000});
  assert.equal(result.state,'recovered');
  assert.equal(result.taskId,task.id);
  assert.equal(result.runId,runId);
  assert.equal(reads,2);
  assert.equal(sends,0);
  assert.equal(f.store.db.prepare('SELECT chat_url FROM tasks WHERE id=?').get(task.id).chat_url,threadA);
  assert.equal(f.store.db.prepare("SELECT content FROM messages WHERE task_id=? AND role='assistant'").get(task.id).content,'Recovered first answer');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM events WHERE task_id=? AND kind='provider.response.reconciled'").get(task.id).n,1);
  assert.equal((await recoverVisibleLinkedProviderSubmission({store:f.store,worker,now:115_000})).state,'idle');
  assert.equal(reads,2,'completed first send is never recovered twice');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('background supervisor refuses multiple pending unlinked first-send intents without any provider read',async t=>{
  const f=openFixture(t);
  const records=[];
  for(let n=0;n<2;n++) {
    const task=f.store.createTask('Ambiguous fresh GPT task '+randomUUID());
    const {runId,userMessage}=f.store.beginProviderRun(task.id,'Local request '+n);
    assert.equal(recordProviderSubmissionIntent({
      store:f.store,taskId:task.id,runId,messageId:userMessage.id,
      providerPrompt:'External prompt '+n+' '+randomUUID(),
      chatUrl:'https://chatgpt.com/',intentAt:Date.now(),newSession:true,
      previousConversationId:null,previousChatUrl:null,
      baselineUserMessageId:null,baselineUserMessagePresent:false,baselinePromptMatches:false
    }).recorded,true);
    f.store.recordRunMetrics(task.id,runId,'beta',{
      failedStage:'submit',providerDeliveryState:'uncertain',submitAttemptAt:Date.now()
    });
    f.store.finishRun(task.id,runId,'submit:send_confirmation_unknown');
    records.push({task,runId});
  }
  let reads=0,sends=0;
  const worker={status:()=>({url:threadA}),
    inspectConversationReadOnly:async()=>{reads++;throw Error('ambiguous_must_not_inspect');},
    sendPrompt:async()=>{sends++;}
  };
  assert.deepEqual(await recoverVisibleLinkedProviderSubmission({store:f.store,worker,now:100_000}),
    {state:'ambiguous',reason:'provider_new_session_multiple_candidates'});
  assert.equal(reads,0);
  assert.equal(sends,0);
  for(const {task,runId} of records) {
    assert.equal(f.store.db.prepare('SELECT status FROM runs WHERE id=?').get(runId).status,'failed');
    assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='assistant'").get(task.id).n,0);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM events WHERE task_id=? AND kind='provider.response.recovery_attempt'").get(task.id).n,0);
  }
});

test('unlinked fresh conversation with an unrelated prompt remains unbound and obeys the recovery backoff',async t=>{
  const f=openFixture(t);
  const task=f.store.createTask('Unrelated GPT answer '+randomUUID());
  const {runId,userMessage}=f.store.beginProviderRun(task.id,'Local request');
  assert.equal(recordProviderSubmissionIntent({
    store:f.store,taskId:task.id,runId,messageId:userMessage.id,
    providerPrompt:'Expected first prompt '+randomUUID(),
    chatUrl:'https://chatgpt.com/',intentAt:Date.now(),newSession:true,
    previousConversationId:null,previousChatUrl:null,
    baselineUserMessageId:null,baselineUserMessagePresent:false,baselinePromptMatches:false
  }).recorded,true);
  f.store.recordRunMetrics(task.id,runId,'beta',{
    failedStage:'submit',providerDeliveryState:'uncertain',submitAttemptAt:Date.now()
  });
  f.store.finishRun(task.id,runId,'submit:send_confirmation_unknown');
  let reads=0,sends=0;
  const worker={status:()=>({url:threadA}),
    inspectConversationReadOnly:async(target,options)=>{
      reads++;
      assert.equal(options.allowNavigation,false);
      return observation({url:threadA,providerPrompt:'Wrong prompt'},'Unrelated reply');
    },sendPrompt:async()=>{sends++;}
  };
  const first=await recoverVisibleLinkedProviderSubmission({store:f.store,worker,now:100_000});
  assert.equal(first.state,'pending');
  assert.equal(first.attempt,1);
  assert.equal(first.nextAttemptAt,115_000);
  const second=await recoverVisibleLinkedProviderSubmission({store:f.store,worker,now:114_999});
  assert.equal(second.state,'waiting');
  assert.equal(reads,1);
  assert.equal(sends,0);
  assert.equal(f.store.db.prepare('SELECT chat_url FROM tasks WHERE id=?').get(task.id).chat_url,null);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='assistant'").get(task.id).n,0);
});

test('first new GPT conversation persists a real dispatch intent when DOM baseline message ID is empty',async t=>{
  const f=openFixture(t);
  const task=f.store.createTask('First GPT submission empty DOM baseline '+randomUUID());
  const providerPrompt='Distinct provider prompt '+randomUUID();
  const {runId,userMessage}=f.store.beginProviderRun(task.id,'Local request');
  // Electron DOM #submissionState() returns '' when no previous user message
  // exists. This used to fail validation and prevent the first GPT submission.
  const baseline={latestUserMessageId:'',userCount:0,latestUserText:''};
  const intent=recordProviderSubmissionIntent({
    store:f.store,taskId:task.id,runId,messageId:userMessage.id,
    providerPrompt,chatUrl:'https://chatgpt.com/',intentAt:Date.now(),
    baselineUserMessageId:providerBaselineMessageId(baseline.latestUserMessageId),
    baselineUserMessagePresent:baseline.userCount>0,
    baselinePromptMatches:false,newSession:true,
    previousConversationId:null,previousChatUrl:null
  });
  assert.deepEqual(intent,{recorded:true,reason:'intent_recorded'});
  const payload=JSON.parse(f.store.db.prepare(
    "SELECT payload FROM events WHERE task_id=? AND kind='provider.submission.intent'").get(task.id).payload);
  assert.equal(payload.baseline_user_message_id,null);
  assert.equal(payload.baseline_user_message_present,false);
  assert.equal(payload.new_session,true);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM events WHERE task_id=? AND kind='provider.submission.intent'").get(task.id).n,1);
  assert.equal(f.store.db.prepare('SELECT chat_url FROM tasks WHERE id=?').get(task.id).chat_url,null);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');

  // Preserve the recovery gates after the legitimate durable intent exists.
  f.store.recordRunMetrics(task.id,runId,'beta',{
    failedStage:'submit',providerDeliveryState:'uncertain',submitAttemptAt:Date.now()
  });
  f.store.finishRun(task.id,runId,'submit:send_confirmation_unknown');
  let reads=0,sends=0;
  const worker={status:()=>({url:threadA}),
    inspectConversationReadOnly:async(target,{allowNavigation}={})=>{
      assert.equal(target,threadA);assert.equal(allowNavigation,false);
      reads++;return observation({url:threadA,providerPrompt},'First real answer could be recovered');
    },
    sendPrompt:async()=>{sends++;throw Error('no_replay');}
  };
  const result=await recoverVisibleLinkedProviderSubmission({store:f.store,worker,now:100000});
  assert.equal(result.state,'recovered');
  assert.equal(reads,2);
  assert.equal(sends,0);
  assert.equal(f.store.db.prepare('SELECT chat_url FROM tasks WHERE id=?').get(task.id).chat_url,threadA);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='assistant'").get(task.id).n,1);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('background recovery ignores a linked GPT thread belonging to another workspace session without writing its events',async t=>{
  const f=openFixture(t);
  const item=stageSubmission(f.store,{url:threadA,providerPrompt:'different workspace '+randomUUID()});
  f.store.db.prepare("UPDATE runs SET status='interrupted',error='process_interrupted' WHERE id=?").run(item.runId);
  const foreignSession='session_'+randomUUID(),now=new Date().toISOString();
  f.store.db.prepare('INSERT INTO workspace_sessions(id,status,metadata,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run(foreignSession,'active','{}',now,now);
  f.store.db.prepare('UPDATE tasks SET status=?,workspace_session_id=? WHERE id=?')
    .run('interrupted',foreignSession,item.task.id);
  let reads=0,sends=0;
  const worker={
    status:()=>({url:threadA}),
    inspectConversationReadOnly:async()=>{reads++;throw Error('must_not_read_foreign_workspace');},
    sendPrompt:async()=>{sends++;throw Error('must_not_resend');}
  };
  assert.deepEqual(await recoverVisibleLinkedProviderSubmission({store:f.store,worker}),{
    state:'idle',reason:'provider_thread_not_linked'
  });
  assert.equal(reads,0);
  assert.equal(sends,0);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM events WHERE task_id=? AND kind='provider.response.recovery_attempt'")
    .get(item.task.id).n,0);
  assert.equal(f.store.db.prepare('SELECT status FROM runs WHERE id=?').get(item.runId).status,'interrupted');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('background recovery discards an in-flight inspection if the Task moves to another workspace',async t=>{
  const f=openFixture(t);
  const item=stageSubmission(f.store,{url:threadA,providerPrompt:'workspace changes mid-observation '+randomUUID()});
  f.store.db.prepare("UPDATE runs SET status='interrupted',error='process_interrupted' WHERE id=?").run(item.runId);
  f.store.db.prepare("UPDATE tasks SET status='interrupted' WHERE id=?").run(item.task.id);
  const foreignSession='session_'+randomUUID(),now=new Date().toISOString();
  f.store.db.prepare('INSERT INTO workspace_sessions(id,status,metadata,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run(foreignSession,'active','{}',now,now);
  let reads=0,sends=0;
  const worker={
    status:()=>({url:threadA}),
    inspectConversationReadOnly:async()=>{
      reads++;
      f.store.db.prepare('UPDATE tasks SET workspace_session_id=? WHERE id=?')
        .run(foreignSession,item.task.id);
      return {available:false,reason:'synthetic_unavailable'};
    },
    sendPrompt:async()=>{sends++;throw Error('must_not_resend');}
  };
  assert.deepEqual(await recoverVisibleLinkedProviderSubmission({store:f.store,worker}),{
    state:'idle',reason:'provider_recovery_state_changed'
  });
  assert.equal(reads,1);
  assert.equal(sends,0);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM events WHERE task_id=? AND kind='provider.response.recovery_attempt'")
    .get(item.task.id).n,0);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
