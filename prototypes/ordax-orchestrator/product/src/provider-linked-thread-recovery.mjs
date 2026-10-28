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

// Auto-reconcile only a lost-ack or app-restart interruption backed by durable
// submission evidence while the same linked GPT chat is already open. This
// never navigates or sends. Ambiguity, stale view or partial answer stays
// unresolved; a verified reply is committed idempotently.
export async function recoverFailedProviderSubmission({store,worker,taskId,runId}={}) {
  const id=String(taskId||'');
  const run=store?.db?.prepare('SELECT id,status,error,metrics FROM runs WHERE id=? AND task_id=?').get(runId,id);
  const task=store?.db?.prepare('SELECT status,chat_url FROM tasks WHERE id=?').get(id);
  if(!run||!task||!['failed','interrupted'].includes(run.status)||!['error','interrupted'].includes(task.status))
    return {reconciled:false,reason:'provider_recovery_state_invalid'};
  let metrics=null;
  try {metrics=JSON.parse(run.metrics||'{}');} catch {}
  const failure=String(run.error||'').split(':').at(-1);
  const latestMessage=store.db.prepare("SELECT id FROM messages WHERE task_id=? AND role='user' ORDER BY rowid DESC LIMIT 1").get(id);
  const intent=findProviderSubmissionIntent({store,taskId:id,runId:String(runId||''),messageId:latestMessage?.id});
  const uncertainLostAck=failure==='send_confirmation_unknown'&&metrics?.failed_stage==='submit'&&
    metrics?.provider_delivery_state==='uncertain'&&
    Number.isSafeInteger(metrics?.submit_attempt_at)&&metrics.submit_attempt_at>0;
  const interruptedWithDurableSubmissionEvidence=run.status==='interrupted'&&task.status==='interrupted'&&
    ['app_shutdown','process_interrupted'].includes(run.error)&&
    Boolean(intent||findProviderSubmissionProvenance({
      store,taskId:id,chatUrl:task.chat_url,messageId:latestMessage?.id
    }));
  if(!uncertainLostAck&&!interruptedWithDurableSubmissionEvidence)
    return {reconciled:false,reason:'provider_recovery_not_applicable'};
  if(intent?.new_session===true)
    return recoverFreshProviderSubmission({store,worker,taskId:id,runId:String(runId),intent});
  const first=await inspectProviderLinkedThread({store,worker,taskId:id,allowNavigation:false});
  if(!first.recoveryPreview?.responseSha256)
    return {reconciled:false,reason:!first.threadRendered
      ?first.inspectionReason||first.recoveryReason||'provider_reply_not_recoverable'
      :first.recoveryReason||first.inspectionReason||'provider_reply_not_recoverable'};
  return reconcileProviderLinkedReply({
    store,worker,taskId:id,responseSha256:first.recoveryPreview.responseSha256,allowNavigation:false
  });
}

const PROVIDER_RECOVERY_BACKOFF_MS=Object.freeze([15_000,30_000,60_000,120_000,300_000,600_000]);
export const PROVIDER_RECOVERY_MAX_OBSERVATIONS=24;

// Revisit only an uncertain or interrupted Run backed by submission evidence
// whose exact linked GPT conversation is already visible. The attempt ledger is durable and bounded; inspection never
// navigates, sends, or retries a provider action. This lets a late GPT reply be
// reconciled by the existing Store transaction without adding another worker.
export async function recoverVisibleLinkedProviderSubmission({store,worker,now=Date.now()}={}) {
  if(!store?.db||typeof worker?.inspectConversationReadOnly!=='function')
    throw new Error('provider_recovery_ports_required');
  if(!Number.isSafeInteger(now)||now<0)throw new Error('provider_recovery_clock_invalid');
  let currentUrl=null;
  try {currentUrl=canonicalProviderChatUrl(worker.status?.()?.url);} catch {}
  if(!currentUrl)return {state:'idle',reason:'provider_thread_not_visible'};

  const linked=store.db.prepare('SELECT id FROM tasks WHERE chat_url=? LIMIT 2').all(currentUrl);
  if(linked.length===0)return {state:'idle',reason:'provider_thread_not_linked'};
  if(linked.length!==1)return {state:'ambiguous',reason:'provider_thread_linked_to_multiple_tasks'};
  const taskId=linked[0].id;
  const run=store.db.prepare(`SELECT id,status,error,metrics FROM runs
    WHERE task_id=? ORDER BY rowid DESC LIMIT 1`).get(taskId);
  const task=store.db.prepare('SELECT status,chat_url FROM tasks WHERE id=?').get(taskId);
  if(!run||!task||!['failed','interrupted'].includes(run.status)||
      !['error','interrupted'].includes(task.status))
    return {state:'idle',reason:'provider_recovery_not_applicable'};
  let metrics=null;
  try {metrics=JSON.parse(run.metrics||'{}');} catch {}
  const failure=String(run.error||'').split(':').at(-1);
  const uncertainLostAck=failure==='send_confirmation_unknown'&&metrics?.failed_stage==='submit'&&
    metrics?.provider_delivery_state==='uncertain'&&
    Number.isSafeInteger(metrics?.submit_attempt_at)&&metrics.submit_attempt_at>0;
  const latestMessage=store.db.prepare("SELECT id FROM messages WHERE task_id=? AND role='user' ORDER BY rowid DESC LIMIT 1").get(taskId);
  const intent=findProviderSubmissionIntent({store,taskId,runId:run.id,messageId:latestMessage?.id});
  const interruptedWithDurableSubmissionEvidence=run.status==='interrupted'&&task.status==='interrupted'&&
    ['app_shutdown','process_interrupted'].includes(run.error)&&
    Boolean(intent||findProviderSubmissionProvenance({
      store,taskId,chatUrl:task.chat_url||currentUrl,messageId:latestMessage?.id
    }));
  if(!uncertainLostAck&&!interruptedWithDurableSubmissionEvidence)
    return {state:'idle',reason:'provider_recovery_not_applicable'};

  const previous=store.db.prepare(`SELECT payload FROM events WHERE task_id=?
    AND json_extract(payload,'$.run_id')=? AND kind='provider.response.recovery_attempt'
    ORDER BY seq DESC LIMIT 1`).get(taskId,run.id);
  let attemptState=null;
  try {attemptState=previous?JSON.parse(previous.payload):null;} catch {}
  const previousAttempt=Number.isSafeInteger(attemptState?.attempt)&&attemptState.attempt>0
    ?attemptState.attempt:0;
  if(previousAttempt>=PROVIDER_RECOVERY_MAX_OBSERVATIONS)
    return {state:'exhausted',reason:'provider_recovery_observation_limit',taskId,runId:run.id};
  const nextAt=Number.isSafeInteger(attemptState?.next_attempt_at)?attemptState.next_attempt_at:null;
  if(nextAt!==null&&now<nextAt)
    return {state:'waiting',reason:'provider_recovery_backoff',taskId,runId:run.id,nextAttemptAt:nextAt};

  const attempt=previousAttempt+1;
  const delay=PROVIDER_RECOVERY_BACKOFF_MS[Math.min(attempt-1,PROVIDER_RECOVERY_BACKOFF_MS.length-1)];
  const recovery=await recoverFailedProviderSubmission({store,worker,taskId,runId:run.id})
    .catch(error=>({reconciled:false,reason:safeHistoricalThreadFailure(error?.message)}));
  const reconciled=recovery?.reconciled===true||recovery?.reason==='already_reconciled';
  const exhausted=!reconciled&&attempt>=PROVIDER_RECOVERY_MAX_OBSERVATIONS;
  const reason=typeof recovery?.reason==='string'&&/^[a-z0-9_]{1,80}$/.test(recovery.reason)
    ?recovery.reason:'provider_inspection_unavailable';
  let eventSeq=null;
  try {
    eventSeq=store.event(taskId,'provider.response.recovery_attempt',{
      run_id:run.id,attempt,observed_at:now,
      next_attempt_at:reconciled||exhausted?null:now+delay,
      state:reconciled?'reconciled':exhausted?'exhausted':'pending',reason
    });
  } catch(error) {
    // Reconciliation itself already committed its canonical response event.
    // A failed diagnostic-attempt event must not hide the imported Run from UI.
    if(!reconciled)throw error;
  }
  return reconciled
    ?{state:'recovered',reason:'reconciled',taskId,runId:run.id,eventSeq}
    :exhausted
      ?{state:'exhausted',reason:'provider_recovery_observation_limit',taskId,runId:run.id,eventSeq}
      :{state:'pending',reason,taskId,runId:run.id,attempt,nextAttemptAt:now+delay,eventSeq};
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

