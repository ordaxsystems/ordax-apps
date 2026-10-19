import { canonicalProviderChatUrl } from './conversation-policy.mjs';

// Bind a conversation already observed AFTER the provider's UI submission
// receipt, but BEFORE waiting for the assistant's response. This is NOT proof
// of response, effect, user identity, or successful Task completion.
export function bindObservedSubmittedConversation({
  store,taskId,runId,chatUrl,submittedAt,plannedNewSession,checkpointVersion=null
}) {
  if (plannedNewSession !== true) return {bound:false,reason:'not_new_conversation'};
  if (!Number.isSafeInteger(submittedAt) || submittedAt <= 0)
    return {bound:false,reason:'submission_not_observed'};
  const canonical=canonicalProviderChatUrl(chatUrl);
  if (!canonical) return {bound:false,reason:'canonical_chat_url_missing'};
  const run=store.db.prepare('SELECT status,task_id FROM runs WHERE id=?').get(runId);
  if (!run || run.task_id !== taskId || run.status !== 'running')
    return {bound:false,reason:'run_not_active'};
  const task=store.getTaskExecutionSnapshot(taskId);
  const owner=store.db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId);
  if (!task || !owner || owner.status === 'archived')
    return {bound:false,reason:'task_unavailable'};
  if (canonicalProviderChatUrl(task.chat_url) === canonical)
    return {bound:false,reason:'already_bound'};
  const record=store.setChatUrl(taskId,canonical,checkpointVersion);
  if (!record?.id) throw new Error('submitted_conversation_binding_failed');
  store.event(taskId,'provider.conversation.submission_permalink_observed',{
    run_id:runId,conversation_id:record.id,
    // URL is already canonical in the existing Store SSOT. Do not duplicate it.
    delivery_observed:true,response_observed:false,effect_verified:false
  });
  return {bound:true,conversationId:record.id,responseObserved:false,effectVerified:false};
}
