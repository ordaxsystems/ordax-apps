import {canonicalProviderChatUrl} from './conversation-policy.mjs';
import {findProviderSubmissionProvenance} from './provider-submission-provenance.mjs';
import {assessProviderConversationEvidence} from './provider-conversation-reconciliation.mjs';
import {selectCompletedProviderReply} from './provider-reply-recovery.mjs';
import {safeHistoricalThreadFailure} from './provider-observation-policy.mjs';

export async function inspectProviderLinkedThread({store,worker,taskId}={}) {
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
  const observed=await worker.inspectConversationReadOnly(expectedUrl)
    .catch(()=>({available:false,reason:'provider_inspection_unavailable'}));
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
  if(threadRendered) {
    const run=store.db.prepare('SELECT status FROM runs WHERE id=? AND task_id=?').get(provenance.runId,task);
    if(run&&['failed','interrupted'].includes(run.status)) {
      const selected=selectCompletedProviderReply({
        expectedUrl,observed,expectedPromptSha256:provenance.promptSha256
      });
      if(selected.recoverable) recoveryPreview={text:selected.text,responseSha256:selected.responseSha256};
    }
  }
  const possibleAnswer=assessment.kind==='response_candidate'&&
    assessment.candidates===1&&assessment.responseCandidate===true;
  const inspectionReason=threadRendered?'thread_rendered':possibleAnswer&&observed?.generationStopVisible===true
    ?'provider_response_generation_active':possibleAnswer&&!generationNotActive
      ?'provider_generation_state_unobserved':safeHistoricalThreadFailure(observed?.reason);
  return {
    kind:assessment.kind,reason:assessment.reason,threadRendered,
    inspectionReason,responseCandidate:assessment.responseCandidate===true,
    requiresReconciliation:assessment.requiresReconciliation===true,
    ...(recoveryPreview?{recoveryPreview}: {})
  };
}

export async function reconcileProviderLinkedReply({store,worker,taskId,responseSha256}={}) {
  if(!/^[a-f0-9]{64}$/.test(responseSha256||''))throw new Error('invalid_provider_reply_digest');
  const inspection=await inspectProviderLinkedThread({store,worker,taskId});
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
