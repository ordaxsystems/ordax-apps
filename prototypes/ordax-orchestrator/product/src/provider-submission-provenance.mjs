import {createHash} from 'node:crypto';
import {canonicalProviderChatUrl} from './conversation-policy.mjs';

// Acknowledged provider submission is a different fact from response completion.
// Store only a digest of the actual (possibly context-expanded) provider prompt.
export function providerPromptDigest(prompt) {
  if(typeof prompt!=='string' || !prompt.trim()) return null;
  return createHash('sha256').update(prompt.trim(),'utf8').digest('hex');
}

export function recordProviderSubmissionProvenance({
  store,taskId,runId,messageId,providerPrompt,chatUrl,submittedAt
}={}) {
  const url=canonicalProviderChatUrl(chatUrl);
  const digest=providerPromptDigest(providerPrompt);
  if(!url || !digest || !Number.isSafeInteger(submittedAt) || submittedAt<=0)
    return {recorded:false,reason:'receipt_incomplete'};
  const run=store?.db?.prepare('SELECT id FROM runs WHERE id=? AND task_id=?').get(runId,taskId);
  const message=store?.db?.prepare("SELECT id FROM messages WHERE id=? AND task_id=? AND role='user'").get(messageId,taskId);
  const conversation=store?.db?.prepare(
    "SELECT id FROM task_conversations WHERE task_id=? AND chat_url=? AND status='active' ORDER BY sequence DESC LIMIT 1"
  ).get(taskId,url);
  if(!run || !message || !conversation)
    return {recorded:false,reason:'receipt_reference_missing'};
  // Only append a new immutable receipt if this Run has not already recorded one.
  const previous=store.db.prepare(
    "SELECT 1 FROM events WHERE task_id=? AND kind='provider.submission.provenance' AND json_extract(payload,'$.run_id')=? LIMIT 1"
  ).get(taskId,runId);
  if(previous) return {recorded:false,reason:'receipt_already_recorded'};
  store.event(taskId,'provider.submission.provenance',{
    run_id:runId,message_id:messageId,conversation_id:conversation.id,
    prompt_sha256:digest,submitted_at:submittedAt,
    // No message text, credential or duplicate URL is placed into the event.
    response_observed:false,effect_verified:false
  });
  return {recorded:true,reason:'receipt_recorded'};
}

// W3 must not claim a matched answer without a durable, task-bound provider
// submission receipt. Old records remain readable; they cannot be certified.
export function findProviderSubmissionProvenance({store,taskId,chatUrl}={}) {
  const url=canonicalProviderChatUrl(chatUrl);
  if(!url || !store?.db) return null;
  const rows=store.db.prepare(
    "SELECT payload FROM events WHERE task_id=? AND kind='provider.submission.provenance' ORDER BY seq DESC LIMIT 100"
  ).all(taskId);
  for(const row of rows) {
    let receipt;
    try { receipt=JSON.parse(row.payload); } catch { continue; }
    if(!/^[a-f0-9]{64}$/.test(receipt?.prompt_sha256||'') ||
       !Number.isSafeInteger(receipt?.submitted_at) || receipt.submitted_at<=0)
      continue;
    const conversation=store.db.prepare(
      "SELECT id FROM task_conversations WHERE id=? AND task_id=? AND chat_url=? AND status='active'"
    ).get(receipt.conversation_id,taskId,url);
    if(!conversation) continue;
    const run=store.db.prepare('SELECT id FROM runs WHERE id=? AND task_id=?').get(receipt.run_id,taskId);
    const message=store.db.prepare("SELECT id FROM messages WHERE id=? AND task_id=? AND role='user'")
      .get(receipt.message_id,taskId);
    if(run && message) return {promptSha256:receipt.prompt_sha256,runId:run.id};
  }
  return null;
}
