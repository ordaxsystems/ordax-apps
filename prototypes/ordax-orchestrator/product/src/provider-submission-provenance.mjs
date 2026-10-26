import {createHash} from 'node:crypto';
import {canonicalProviderChatUrl} from './conversation-policy.mjs';

// Acknowledged provider submission is a different fact from response completion.
// Store only a digest of the actual (possibly context-expanded) provider prompt.
export function providerPromptDigest(prompt) {
  if(typeof prompt!=='string' || !prompt.trim()) return null;
  return createHash('sha256').update(prompt.trim(),'utf8').digest('hex');
}

function boundedIds(value) {
  return Array.isArray(value)
    ? value.filter(id=>typeof id==='string'&&id.length>0&&id.length<=180).slice(0,64)
    : [];
}

function boundedOmissionReasons(value) {
  const allowed=new Set(['history_window','retrieved_history_budget','memory_budget','recent_history_budget','request_budget','fixed_context_overhead']);
  return Array.isArray(value)?[...new Set(value.filter(reason=>allowed.has(reason)))].slice(0,5):[];
}

function safeContextManifest(value,expectedPromptSha256) {
  if(!value||value.format!=='ordax-continuation-context/v1')return null;
  if(value.promptSha256!==expectedPromptSha256)return null;
  const count=key=>Number.isSafeInteger(value[key])&&value[key]>=0?value[key]:null;
  const contextSha256=typeof value.contextSha256==='string'&&/^[a-f0-9]{64}$/.test(value.contextSha256)
    ?value.contextSha256:null;
  return {
    format:value.format,
    context_included:value.contextIncluded===true,
    context_source_count:count('contextSourceCount'),
    checkpoint_present:value.checkpointPresent===true,
    partial:value.partial===true,
    attachment_useful:value.attachmentUseful===true,
    omission_reasons:boundedOmissionReasons(value.omissionReasons),
    critical_omissions:count('criticalOmissions'),
    checkpoint_version:count('checkpointVersion'),
    max_chars:count('maxChars'),
    request_chars:count('requestChars'),
    context_chars:count('contextChars'),
    prompt_chars:count('promptChars'),
    context_sha256:contextSha256,
    included_memory_count:count('includedMemoryCount'),
    omitted_memory_count:count('omittedMemoryCount'),
    included_message_count:count('includedMessageCount'),
    omitted_message_count:count('omittedMessageCount'),
    included_memory_ids:boundedIds(value.includedMemoryIds),
    omitted_memory_ids:boundedIds(value.omittedMemoryIds),
    included_message_ids:boundedIds(value.includedMessageIds),
    omitted_message_ids:boundedIds(value.omittedMessageIds),
    retrieved_message_ids:boundedIds(value.retrievedMessageIds),
    retrieved_message_count:count('retrievedMessageCount'),
    retrieved_message_omissions:count('retrievedMessageOmissions'),
    history_window_message_count:count('historyWindowMessageCount'),
    history_window_retrieved_count:count('historyWindowRetrievedCount'),
    history_window_omitted_count:count('historyWindowOmittedCount'),
    history_window_omitted_ids:boundedIds(value.historyWindowOmittedIds),
    recent_history_budget_omissions:count('recentHistoryBudgetOmissions'),
    source_ids_truncated:value.sourceIdsTruncated===true
  };
}

function safeContextAttachmentReceipt(value,taskId) {
  if(!value||value.format!=='ordax-task-handoff/v1'||value.taskId!==taskId||value.deliveryState!=='uploaded')return null;
  if(typeof value.filename!=='string'||!/^ordax-handoff-task_[a-z0-9_-]+-c\d+-[a-f0-9]{12}\.txt$/i.test(value.filename)||
     typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256)||
     !Number.isSafeInteger(value.byteLength)||value.byteLength<1||value.byteLength>1_000_000||
     !Number.isSafeInteger(value.checkpointVersion)||value.checkpointVersion<0||
     !Number.isSafeInteger(value.uploadedAt)||value.uploadedAt<=0)
    return null;
  return {
    format:value.format,delivery_state:value.deliveryState,filename:value.filename,
    sha256:value.sha256,byte_length:value.byteLength,
    checkpoint_version:value.checkpointVersion,uploaded_at:value.uploadedAt,
    memory_ids:boundedIds(value.memoryIds),recent_message_ids:boundedIds(value.recentMessageIds),
    historical_message_ids:boundedIds(value.historicalMessageIds)
  };
}

export function recordProviderSubmissionProvenance({
  store,taskId,runId,messageId,providerPrompt,chatUrl,submittedAt,contextManifest=null,contextAttachmentReceipt=null
}={}) {
  const url=canonicalProviderChatUrl(chatUrl);
  const digest=providerPromptDigest(providerPrompt);
  if(!url || !digest || !Number.isSafeInteger(submittedAt) || submittedAt<=0)
    return {recorded:false,reason:'receipt_incomplete'};
  const safeManifest=safeContextManifest(contextManifest,digest);
  if(contextManifest&&!safeManifest)
    return {recorded:false,reason:'context_manifest_mismatch'};
  const safeAttachment=safeContextAttachmentReceipt(contextAttachmentReceipt,taskId);
  if(contextAttachmentReceipt&&!safeAttachment)
    return {recorded:false,reason:'context_attachment_receipt_mismatch'};
  const run=store?.db?.prepare("SELECT id FROM runs WHERE id=? AND task_id=? AND status='running'").get(runId,taskId);
  const message=store?.db?.prepare(
    "SELECT id FROM messages WHERE task_id=? AND role='user' ORDER BY rowid DESC LIMIT 1"
  ).get(taskId);
  const conversation=store?.db?.prepare(
    "SELECT id FROM task_conversations WHERE task_id=? AND chat_url=? AND status='active' ORDER BY sequence DESC LIMIT 1"
  ).get(taskId,url);
  if(!run || message?.id!==messageId || !conversation)
    return {recorded:false,reason:'receipt_reference_missing'};
  // Only append a new immutable receipt if this Run has not already recorded one.
  const previous=store.db.prepare(
    "SELECT 1 FROM events WHERE task_id=? AND kind='provider.submission.provenance' AND json_extract(payload,'$.run_id')=? LIMIT 1"
  ).get(taskId,runId);
  if(previous) return {recorded:false,reason:'receipt_already_recorded'};
  store.event(taskId,'provider.submission.provenance',{
    run_id:runId,message_id:messageId,conversation_id:conversation.id,
    prompt_sha256:digest,submitted_at:submittedAt,
    ...(safeManifest?{context_manifest:safeManifest}:{}),
    ...(safeAttachment?{context_attachment:safeAttachment}:{}),
    // No message text, credential or duplicate URL is placed into the event.
    response_observed:false,effect_verified:false
  });
  return {recorded:true,reason:'receipt_recorded'};
}

// W3 must not claim a matched answer without a durable, task-bound provider
// submission receipt. Old records remain readable; they cannot be certified.
export function findProviderSubmissionProvenance({store,taskId,chatUrl,messageId}={}) {
  const url=canonicalProviderChatUrl(chatUrl);
  // Never fall back to an older submitted turn when the newest local user
  // message has no acknowledged provider submission receipt.
  if(!url || !store?.db || typeof messageId!=='string' || !messageId) return null;
  const rows=store.db.prepare(
    "SELECT payload FROM events WHERE task_id=? AND kind='provider.submission.provenance' " +
    "AND json_extract(payload,'$.message_id')=? ORDER BY seq DESC LIMIT 100"
  ).all(taskId,messageId);
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
    if(run && message) return {
      promptSha256:receipt.prompt_sha256,runId:run.id,
      conversationId:receipt.conversation_id,submittedAt:receipt.submitted_at
    };
  }
  return null;
}
