import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Store} from '../src/store.mjs';
import {recordProviderSubmissionProvenance,providerPromptDigest} from '../src/provider-submission-provenance.mjs';
import {inspectProviderLinkedThread,reconcileProviderLinkedReply} from '../src/provider-linked-thread-recovery.mjs';

const url='https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';
async function fixture(fn,{interrupted=false}={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-linked-reply-recovery-'));
  const store=new Store(path.join(root,'lab.sqlite'));
  try {
    const task=store.createTask('Missão longa');
    const {userMessage,runId}=store.beginProviderRun(task.id,'Pedido local compacto');
    const conversation=store.setChatUrl(task.id,url);
    const providerPrompt='[CONTEXTO ORDAX]\nPedido ampliado: continue o capítulo sem repetir o anterior.';
    const promptSha256=providerPromptDigest(providerPrompt);
    assert.deepEqual(recordProviderSubmissionProvenance({
      store,taskId:task.id,runId,messageId:userMessage.id,providerPrompt,chatUrl:url,submittedAt:Date.now()
    }),{recorded:true,reason:'receipt_recorded'});
    if(interrupted)store.recoverInterruptedRuns();
    else store.finishRun(task.id,runId,'provider_response_not_observed');
    const answer='Capítulo recuperado com continuidade e desfecho verificável.';
    let observation={available:true,url,domReliable:true,truncated:false,generationStopVisible:false,
      responseCompletionObserved:true,messages:[{role:'user',text:providerPrompt},{role:'assistant',text:answer}]};
    let sends=0;
    const worker={inspectConversationReadOnly:async()=>observation,sendPrompt:async()=>{sends++;}};
    return await fn({root,store,task,userMessage,runId,conversation,providerPrompt,promptSha256,answer,worker,
      setObservation:value=>{observation=value;},sends:()=>sends});
  } finally {
    store.close();
    fs.rmSync(root,{recursive:true,force:true});
  }
}

test('a complete unique provider reply is previewed but not written before explicit confirmation',async()=>{
  await fixture(async({store,task,worker,answer})=>{
    const result=await inspectProviderLinkedThread({store,worker,taskId:task.id});
    assert.equal(result.threadRendered,true);
    assert.equal(result.recoveryPreview.text,answer);
    assert.match(result.recoveryPreview.responseSha256,/^[a-f0-9]{64}$/);
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='assistant'").get(task.id).n,0);
    assert.equal(store.db.prepare("SELECT status FROM tasks WHERE id=?").get(task.id).status,'error');
  });
});

test('explicit recovery rechecks provider evidence, commits reply/checkpoint once, and never resends',async()=>{
  await fixture(async({store,task,worker,answer,sends})=>{
    const preview=await inspectProviderLinkedThread({store,worker,taskId:task.id});
    const committed=await reconcileProviderLinkedReply({store,worker,taskId:task.id,
      responseSha256:preview.recoveryPreview.responseSha256});
    assert.deepEqual(committed,{reconciled:true,reason:'reconciled'});
    assert.equal(store.db.prepare("SELECT content FROM messages WHERE task_id=? AND role='assistant'").get(task.id).content,answer);
    assert.equal(store.db.prepare("SELECT status FROM runs WHERE task_id=?").get(task.id).status,'succeeded');
    assert.equal(store.db.prepare("SELECT status FROM tasks WHERE id=?").get(task.id).status,'ready');
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM checkpoints WHERE task_id=?").get(task.id).n,1);
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM events WHERE task_id=? AND kind='provider.response.reconciled'").get(task.id).n,1);
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM conversation_completed_runs WHERE task_id=?").get(task.id).n,1);
    assert.deepEqual(await reconcileProviderLinkedReply({store,worker,taskId:task.id,
      responseSha256:preview.recoveryPreview.responseSha256}),{reconciled:false,reason:'already_reconciled'});
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='assistant'").get(task.id).n,1);
    assert.equal(sends(),0);
  });
});

test('an interrupted Run can be reconciled only after its durable submission receipt is matched',async()=>{
  await fixture(async({store,task,worker,answer})=>{
    const result=await inspectProviderLinkedThread({store,worker,taskId:task.id});
    const reconciled=await reconcileProviderLinkedReply({store,worker,taskId:task.id,
      responseSha256:result.recoveryPreview.responseSha256});
    assert.equal(reconciled.reconciled,true);
    assert.equal(store.db.prepare("SELECT content FROM messages WHERE task_id=? AND role='assistant'").get(task.id).content,answer);
  },{interrupted:true});
});

test('ambiguous, partial, streaming, and changed replies are never imported',async()=>{
  await fixture(async({store,task,worker,answer,setObservation,providerPrompt,promptSha256})=>{
    const base=await worker.inspectConversationReadOnly(url);
    setObservation({...base,messages:[...base.messages,{role:'assistant',text:'Segunda resposta'}]});
    const ambiguous=await inspectProviderLinkedThread({store,worker,taskId:task.id});
    assert.equal(ambiguous.recoveryPreview,undefined);
    setObservation({...base,generationStopVisible:true});
    const streaming=await inspectProviderLinkedThread({store,worker,taskId:task.id});
    assert.equal(streaming.recoveryPreview,undefined);
    setObservation({...base,truncated:true});
    const partial=await inspectProviderLinkedThread({store,worker,taskId:task.id});
    assert.equal(partial.recoveryPreview,undefined);
    setObservation({...base,messages:[{role:'user',text:providerPrompt},{role:'assistant',text:answer+' alterada'}]});
    const changed=await reconcileProviderLinkedReply({store,worker,taskId:task.id,
      responseSha256:createHash('sha256').update(answer,'utf8').digest('hex')});
    assert.deepEqual(changed,{reconciled:false,reason:'provider_reply_candidate_changed'});
    assert.equal(store.db.prepare("SELECT status FROM runs WHERE task_id=?").get(task.id).status,'failed');
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='assistant'").get(task.id).n,0);
    assert.ok(promptSha256);
  });
});

test('receipt mismatch and stale task references fail closed with no partial ledger writes',async()=>{
  await fixture(async({store,task,worker,answer,runId,userMessage,conversation,promptSha256})=>{
    const responseSha256=createHash('sha256').update(answer,'utf8').digest('hex');
    assert.throws(()=>store.reconcileObservedProviderReply(task.id,{
      runId,userMessageId:userMessage.id,conversationId:conversation.id,chatUrl:url,
      promptSha256:'0'.repeat(64),responseSha256,text:answer
    }),/provider_reply_submission_receipt_invalid/);
    assert.equal(store.db.prepare("SELECT status FROM runs WHERE id=?").get(runId).status,'failed');
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='assistant'").get(task.id).n,0);
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM checkpoints WHERE task_id=?").get(task.id).n,0);
    assert.ok(promptSha256);
  });
});


test('async inspection refuses a preview when a newer local user turn appears while GPT is observed',async()=>{
  await fixture(async({store,task,worker})=>{
    const observed=await worker.inspectConversationReadOnly(url);
    let reads=0,sends=0;
    const racingWorker={
      inspectConversationReadOnly:async()=>{
        reads++;
        store.appendMessage(task.id,'user','Novo turno local antes da conclusão da inspeção.');
        return observed;
      },
      sendPrompt:async()=>{sends++;}
    };
    const result=await inspectProviderLinkedThread({store,worker:racingWorker,taskId:task.id});
    assert.equal(result.kind,'unavailable');
    assert.equal(result.reason,'provider_inspection_state_changed');
    assert.equal(result.threadRendered,false);
    assert.equal(result.recoveryPreview,undefined);
    assert.equal(reads,1);
    assert.equal(sends,0);
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='assistant'").get(task.id).n,0);
  });
});

test('async inspection refuses a preview when the task rotates its active GPT conversation',async()=>{
  await fixture(async({store,task,worker})=>{
    const observed=await worker.inspectConversationReadOnly(url);
    const racingWorker={inspectConversationReadOnly:async()=>{
      store.setChatUrl(task.id,'https://chatgpt.com/c/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
      return observed;
    }};
    const result=await inspectProviderLinkedThread({store,worker:racingWorker,taskId:task.id});
    assert.equal(result.kind,'unavailable');
    assert.equal(result.inspectionReason,'provider_inspection_state_changed');
    assert.equal(result.recoveryPreview,undefined);
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM checkpoints WHERE task_id=?").get(task.id).n,0);
  });
});

test('async inspection refuses a preview when a newer Run starts while observing the previous response',async()=>{
  await fixture(async({store,task,worker})=>{
    const observed=await worker.inspectConversationReadOnly(url);
    const racingWorker={inspectConversationReadOnly:async()=>{
      store.startRun(task.id);
      return observed;
    }};
    const result=await inspectProviderLinkedThread({store,worker:racingWorker,taskId:task.id});
    assert.equal(result.kind,'unavailable');
    assert.equal(result.reason,'provider_inspection_state_changed');
    assert.equal(result.recoveryPreview,undefined);
  });
});

test('88k technical W3 reply requires explicit preview and one transactional import',async()=>{
  await fixture(async({store,task,worker,providerPrompt,setObservation,sends})=>{
    const answer='0123456789'.repeat(8800);
    setObservation({available:true,url,domReliable:true,truncated:false,
      generationStopVisible:false,responseCompletionObserved:true,
      messages:[{role:'user',text:providerPrompt},{role:'assistant',text:answer}]});
    const preview=await inspectProviderLinkedThread({store,worker,taskId:task.id});
    assert.equal(preview.threadRendered,true);
    assert.equal(preview.recoveryPreview.text.length,answer.length);
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='assistant'").get(task.id).n,0);
    const done=await reconcileProviderLinkedReply({store,worker,taskId:task.id,
      responseSha256:preview.recoveryPreview.responseSha256});
    assert.equal(done.reconciled,true);
    assert.equal(store.db.prepare("SELECT content FROM messages WHERE task_id=? AND role='assistant'").get(task.id).content,answer);
    assert.equal((await reconcileProviderLinkedReply({store,worker,taskId:task.id,
      responseSha256:preview.recoveryPreview.responseSha256})).reason,'already_reconciled');
    assert.equal(sends(),0);
  },{interrupted:true});
});

test('100001-character reply cannot be previewed or committed, even with an exact receipt',async()=>{
  await fixture(async({store,task,worker,providerPrompt,setObservation,runId})=>{
    setObservation({available:true,url,domReliable:true,truncated:false,
      generationStopVisible:false,responseCompletionObserved:true,
      messages:[{role:'user',text:providerPrompt},{role:'assistant',text:'x'.repeat(100001)}]});
    const preview=await inspectProviderLinkedThread({store,worker,taskId:task.id});
    assert.equal(preview.threadRendered,false);
    assert.equal(preview.recoveryPreview,undefined);
    assert.equal(store.db.prepare('SELECT status FROM runs WHERE id=?').get(runId).status,'interrupted');
  },{interrupted:true});
});

test('W3 preserves allowlisted historical read-only inspection errors without reply import',async()=>{
  await fixture(async({store,task,worker,runId,sends})=>{
    worker.inspectConversationReadOnly=async()=>{throw new Error('provider_readonly_dom_evaluation_timeout');};
    const result=await inspectProviderLinkedThread({store,worker,taskId:task.id});
    assert.equal(result.kind,'unavailable');
    assert.equal(result.inspectionReason,'provider_readonly_dom_evaluation_timeout');
    assert.equal(result.threadRendered,false);
    assert.equal(result.recoveryPreview,undefined);
    assert.equal(store.db.prepare("SELECT status FROM runs WHERE id=?").get(runId).status,'interrupted');
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='assistant'").get(task.id).n,0);
    assert.equal(sends(),0);
  },{interrupted:true});
});

test('W3 redacts unknown provider failure details in its operator-facing status',async()=>{
  await fixture(async({store,task,worker,sends})=>{
    worker.inspectConversationReadOnly=async()=>{throw new Error('untrusted_provider_context_secret=abc123');};
    const result=await inspectProviderLinkedThread({store,worker,taskId:task.id});
    assert.equal(result.inspectionReason,'provider_inspection_unavailable');
    assert.equal(result.recoveryPreview,undefined);
    assert.doesNotMatch(JSON.stringify(result),/abc123/);
    assert.equal(sends(),0);
  },{interrupted:true});
});
