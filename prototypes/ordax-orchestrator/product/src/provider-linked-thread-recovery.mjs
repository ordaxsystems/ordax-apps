import {canonicalProviderChatUrl} from './conversation-policy.mjs';
import {findProviderSubmissionProvenance,findProviderSubmissionIntent} from './provider-submission-provenance.mjs';
import {assessProviderConversationEvidence} from './provider-conversation-reconciliation.mjs';
import {selectCompletedProviderReply} from './provider-reply-recovery.mjs';
import {safeHistoricalThreadFailure} from './provider-observation-policy.mjs';

export async function inspectProviderLinkedThread({store,worker,taskId,allowNavigation=true}={}) {
  const task=String(taskId||'');
  const row=store.db.prepare('SELECT chat_url,workspace_session_id FROM tasks WHERE id=?').get(task);
  const session=store.getWorkspaceSession();
  if(!row||row.workspace_session_id!==session?.id)throw new Error('task_access_denied');
  const expectedUrl=canonicalProviderChatUrl(row.chat_url);
  if(!expectedUrl)return {
    kind:'unavailable',reason:'canonical_chat_url_missing',threadRendered:false,
    responseCandidate:false,requiresReconciliation:true
  };
  // Only the newest local user turn may be reconciled. The receipt records the
  // expanded provider prompt's digest separately from the local user text.
  const message=store.db.prepare(`SELECT id,content FROM messages WHERE task_id=? AND role='user'
    ORDER BY rowid DESC LIMIT 1`).get(task);
  const provenance=findProviderSubmissionProvenance({
    store,taskId:task,chatUrl:expectedUrl,messageId:message?.id
  });
  if(!provenance)return {
    kind:'unavailable',reason:'provider_submission_provenance_missing',
    inspectionReason:'provider_submission_provenance_missing',threadRendered:false,
    responseCandidate:false,requiresReconciliation:true
  };
  const runBefore=store.db.prepare('SELECT id,status FROM runs WHERE id=? AND task_id=?')
    .get(provenance.runId,task);
  const observed=await worker.inspectConversationReadOnly(expectedUrl,{allowNavigation})
    .catch(error=>({available:false,reason:safeHistoricalThreadFailure(error?.message)}));
  // DOM inspection may yield while the UI switches tasks, rotates provider
  // conversations or starts a newer Run. Never show a stale recovery preview:
  // the final SQLite transaction validates again, but the PREVIEW must also
  // be bound to the exact snapshot that authorized the remote observation.
  const currentTask=store.db.prepare('SELECT chat_url,workspace_session_id FROM tasks WHERE id=?').get(task);
  const currentMessage=store.db.prepare("SELECT id FROM messages WHERE task_id=? AND role='user' ORDER BY rowid DESC LIMIT 1").get(task);
  const currentConversation=store.db.prepare("SELECT id FROM task_conversations WHERE task_id=? AND chat_url=? AND status='active' ORDER BY sequence DESC LIMIT 1")
    .get(task,expectedUrl);
  const currentRun=store.db.prepare('SELECT id,status FROM runs WHERE id=? AND task_id=?')
    .get(provenance.runId,task);
  const latestRun=store.db.prepare('SELECT id FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 1').get(task);
  if(currentTask?.workspace_session_id!==session.id||
      store.getWorkspaceSession()?.id!==session.id||
      canonicalProviderChatUrl(currentTask?.chat_url)!==expectedUrl||
      currentMessage?.id!==message?.id||
      currentConversation?.id!==provenance.conversationId||
      latestRun?.id!==provenance.runId||
      !runBefore||currentRun?.status!==runBefore.status) {
    return {kind:'unavailable',reason:'provider_inspection_state_changed',
      inspectionReason:'provider_inspection_state_changed',
      threadRendered:false,responseCandidate:false,requiresReconciliation:true};
  }
  const assessment=assessProviderConversationEvidence({
    expectedUrl,observed,expectedMessage:message?.content,
    expectedPromptSha256:provenance.promptSha256
  });
  const generationNotActive=observed?.generationStopVisible===false&&
    observed?.responseCompletionObserved===true;
  const threadRendered=assessment.kind==='response_candidate'&&assessment.candidates===1&&
    assessment.responseCandidate===true&&observed?.truncated!==true&&generationNotActive;
  let recoveryPreview=null;
  let recoveryReason='provider_reply_not_recoverable';
  if(threadRendered) {
    const run=store.db.prepare('SELECT status FROM runs WHERE id=? AND task_id=?').get(provenance.runId,task);
    if(run&&['failed','interrupted'].includes(run.status)) {
      const selected=selectCompletedProviderReply({
        expectedUrl,observed,expectedPromptSha256:provenance.promptSha256,
        submissionEvidenceKind:provenance.evidenceKind,
        baselineUserMessageId:provenance.baselineUserMessageId,
        baselineUserMessagePresent:provenance.baselineUserMessagePresent,
        baselinePromptMatches:provenance.baselinePromptMatches
      });
      if(selected.recoverable) {
        recoveryPreview={text:selected.text,responseSha256:selected.responseSha256};
        recoveryReason='reply_attributable_and_complete';
      } else recoveryReason=selected.reason||recoveryReason;
    }
  }
  const possibleAnswer=assessment.kind==='response_candidate'&&
    assessment.candidates===1&&assessment.responseCandidate===true;
  const inspectionReason=threadRendered?'thread_rendered':possibleAnswer&&observed?.generationStopVisible===true
    ?'provider_response_generation_active':possibleAnswer&&!generationNotActive
      ?'provider_generation_state_unobserved'
      // A successful DOM read can still be inconclusive. Preserve the
      // reconciliation policy's closed-set reason instead of collapsing a
      // missing/ambiguous exact prompt match into a transport failure.
      :safeHistoricalThreadFailure(observed?.reason || assessment.reason);
  return {
    kind:assessment.kind,reason:assessment.reason,threadRendered,
    inspectionReason,recoveryReason,responseCandidate:assessment.responseCandidate===true,
    requiresReconciliation:assessment.requiresReconciliation===true,
    ...(recoveryPreview?{recoveryPreview}: {})
  };
}

export async function reconcileProviderLinkedReply({store,worker,taskId,responseSha256,allowNavigation=true}={}) {
  if(!/^[a-f0-9]{64}$/.test(responseSha256||''))throw new Error('invalid_provider_reply_digest');
  const inspection=await inspectProviderLinkedThread({store,worker,taskId,allowNavigation});
  if(!inspection.threadRendered||!inspection.recoveryPreview) {
    const message=store.db.prepare("SELECT id FROM messages WHERE task_id=? AND role='user' ORDER BY rowid DESC LIMIT 1").get(String(taskId));
    const row=store.db.prepare('SELECT chat_url FROM tasks WHERE id=?').get(String(taskId));
    const provenance=findProviderSubmissionProvenance({store,taskId:String(taskId),chatUrl:row?.chat_url,messageId:message?.id});
    const run=provenance&&store.db.prepare('SELECT status FROM runs WHERE id=? AND task_id=?').get(provenance.runId,String(taskId));
    const previous=run?.status==='succeeded'&&store.db.prepare(`SELECT 1 FROM events WHERE task_id=?
      AND kind='provider.response.reconciled' AND json_extract(payload,'$.run_id')=?
      AND json_extract(payload,'$.response_sha256')=? LIMIT 1`).get(String(taskId),provenance.runId,responseSha256);
    if(previous)return {reconciled:false,reason:'already_reconciled'};
    return {reconciled:false,reason:inspection.inspectionReason||'provider_reply_not_recoverable'};
  }
  if(inspection.recoveryPreview.responseSha256!==responseSha256)
    return {reconciled:false,reason:'provider_reply_candidate_changed'};
  const task=String(taskId);
  const row=store.db.prepare('SELECT chat_url FROM tasks WHERE id=?').get(task);
  const message=store.db.prepare(`SELECT id FROM messages WHERE task_id=? AND role='user'
    ORDER BY rowid DESC LIMIT 1`).get(task);
  const provenance=findProviderSubmissionProvenance({
    store,taskId:task,chatUrl:row?.chat_url,messageId:message?.id
  });
  if(!provenance)return {reconciled:false,reason:'provider_submission_provenance_missing'};
  const commit=store.reconcileObservedProviderReply(task,{
    runId:provenance.runId,userMessageId:message.id,conversationId:provenance.conversationId,
    chatUrl:row.chat_url,promptSha256:provenance.promptSha256,
    responseSha256,text:inspection.recoveryPreview.text
  });
  return {reconciled:commit.reconciled,reason:commit.reason||'reconciled'};
}

// Auto-reconcile only the narrow lost-ack case while the same linked GPT chat
// is already open. This never navigates or sends. Any ambiguity, stale view,
// partial answer or missing dispatch intent leaves the original failure for
// the user to inspect; the verified reply is then committed idempotently.
export async function recoverFailedProviderSubmission({store,worker,taskId,runId}={}) {
  const id=String(taskId||'');
  const run=store?.db?.prepare('SELECT id,status,error,metrics FROM runs WHERE id=? AND task_id=?').get(runId,id);
  const task=store?.db?.prepare('SELECT status,chat_url FROM tasks WHERE id=?').get(id);
  if(!run||!task||!['failed','interrupted'].includes(run.status)||!['error','interrupted'].includes(task.status))
    return {reconciled:false,reason:'provider_recovery_state_invalid'};
  let metrics=null;
  try {metrics=JSON.parse(run.metrics||'{}');} catch {}
  const failure=String(run.error||'').split(':').at(-1);
  if(failure!=='send_confirmation_unknown'||metrics?.failed_stage!=='submit'||
     metrics?.provider_delivery_state!=='uncertain'||
     !Number.isSafeInteger(metrics?.submit_attempt_at)||metrics.submit_attempt_at<=0)
    return {reconciled:false,reason:'provider_recovery_not_applicable'};
  const latestMessage=store.db.prepare("SELECT id FROM messages WHERE task_id=? AND role='user' ORDER BY rowid DESC LIMIT 1").get(id);
  const intent=findProviderSubmissionIntent({store,taskId:id,runId:String(runId||''),messageId:latestMessage?.id});
  if(intent?.new_session===true)
    return recoverFreshProviderSubmission({store,worker,taskId:id,runId:String(runId),intent});
  const first=await inspectProviderLinkedThread({store,worker,taskId:id,allowNavigation:false});
  if(!first.recoveryPreview?.responseSha256)
    return {reconciled:false,reason:first.recoveryReason||first.inspectionReason||'provider_reply_not_recoverable'};
  return reconcileProviderLinkedReply({
    store,worker,taskId:id,responseSha256:first.recoveryPreview.responseSha256,allowNavigation:false
  });
}

async function recoverFreshProviderSubmission({store,worker,taskId,runId,intent}={}) {
  const snapshot=()=>{
    const task=store.db.prepare('SELECT workspace_session_id,status,chat_url FROM tasks WHERE id=?').get(taskId);
    const run=store.db.prepare('SELECT status FROM runs WHERE id=? AND task_id=?').get(runId,taskId);
    const latestRun=store.db.prepare('SELECT id FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 1').get(taskId);
    const latestMessage=store.db.prepare("SELECT id FROM messages WHERE task_id=? AND role='user' ORDER BY rowid DESC LIMIT 1").get(taskId);
    const active=store.db.prepare("SELECT id,chat_url FROM task_conversations WHERE task_id=? AND status='active' ORDER BY sequence DESC LIMIT 1").get(taskId);
    return {task,run,latestRun,latestMessage,active,sessionId:store.getWorkspaceSession()?.id};
  };
  const matchesIntentState=state=>{
    if(state.task?.workspace_session_id!==state.sessionId||state.sessionId!==store.getWorkspaceSession()?.id||
       !['error','interrupted'].includes(state.task?.status)||
       !['failed','interrupted'].includes(state.run?.status)||state.latestRun?.id!==runId||
       state.latestMessage?.id!==intent.message_id)return false;
    const expectedPrevious=canonicalProviderChatUrl(intent.previous_chat_url);
    if(intent.previous_conversation_id===null)
      return !expectedPrevious&&!canonicalProviderChatUrl(state.task.chat_url)&&!state.active;
    return Boolean(expectedPrevious&&state.active?.id===intent.previous_conversation_id&&
      canonicalProviderChatUrl(state.active.chat_url)===expectedPrevious&&
      canonicalProviderChatUrl(state.task.chat_url)===expectedPrevious);
  };
  const status=()=>{try{return worker.status();}catch{return null;}};
  const initial=status();
  const expectedUrl=canonicalProviderChatUrl(initial?.url);
  if(!matchesIntentState(snapshot()))return {reconciled:false,reason:'provider_new_session_state_changed'};
  const previousUrl=canonicalProviderChatUrl(intent.previous_chat_url);
  if(!expectedUrl||expectedUrl===previousUrl)
    return {reconciled:false,reason:'provider_new_conversation_url_unobserved'};

  const inspect=async()=>worker.inspectConversationReadOnly(expectedUrl,{allowNavigation:false})
    .catch(error=>({available:false,reason:safeHistoricalThreadFailure(error?.message)}));
  const first=await inspect();
  if(status()?.url!==initial?.url||!matchesIntentState(snapshot()))
    return {reconciled:false,reason:'provider_new_session_state_changed'};
  const select=observed=>selectCompletedProviderReply({
    expectedUrl,observed,expectedPromptSha256:intent.prompt_sha256,
    submissionEvidenceKind:'dispatch_intent',baselineUserMessageId:intent.baseline_user_message_id,
    baselineUserMessagePresent:intent.baseline_user_message_present,
    baselinePromptMatches:intent.baseline_prompt_matches
  });
  const firstCandidate=select(first);
  if(!firstCandidate.recoverable)
    return {reconciled:false,reason:firstCandidate.reason||safeHistoricalThreadFailure(first?.reason)};
  const second=await inspect();
  if(status()?.url!==initial?.url||!matchesIntentState(snapshot()))
    return {reconciled:false,reason:'provider_new_session_state_changed'};
  const secondCandidate=select(second);
  if(!secondCandidate.recoverable)
    return {reconciled:false,reason:secondCandidate.reason||safeHistoricalThreadFailure(second?.reason)};
  if(secondCandidate.responseSha256!==firstCandidate.responseSha256)
    return {reconciled:false,reason:'provider_reply_candidate_changed'};
  const commit=store.reconcileObservedProviderReply(taskId,{
    runId,userMessageId:intent.message_id,conversationId:null,chatUrl:expectedUrl,
    promptSha256:intent.prompt_sha256,responseSha256:secondCandidate.responseSha256,
    text:secondCandidate.text
  });
  return {reconciled:commit.reconciled,reason:commit.reason||'reconciled'};
}

