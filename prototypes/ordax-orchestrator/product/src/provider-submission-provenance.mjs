import {createHash} from 'node:crypto';
import {canonicalProviderChatUrl} from './conversation-policy.mjs';

// Acknowledged provider submission is a different fact from response completion.
// Store a digest and UTF-8 byte count of the actual (possibly expanded) prompt,
// never a second copy of its text.
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

function canonicalFreshProviderHome(value) {
  try {
    const url=new URL(String(value||''));
    return url.protocol==='https:'&&url.origin==='https://chatgpt.com'&&
      url.pathname==='/'&&!url.search&&!url.hash&&!url.username&&!url.password&&!url.port
      ?url.origin+'/':null;
  } catch {return null;}
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
    provider_prompt_bytes:Buffer.byteLength(providerPrompt,'utf8'),
    ...(safeManifest?{context_manifest:safeManifest}:{}),
    ...(safeAttachment?{context_attachment:safeAttachment}:{}),
    // No message text, credential or duplicate URL is placed into the event.
    response_observed:false,effect_verified:false
  });
  return {recorded:true,reason:'receipt_recorded'};
}

// Persist an intent at the last safe boundary before requestSubmit. Unlike a
// delivery receipt, this proves only that one dispatch was armed. It allows a
// later read-only inspection to recover an answer when ChatGPT accepted the
// prompt but its DOM acknowledgement was lost. The exact prompt must still be
// unique and a complete reply must follow it before any reconciliation.
export function recordProviderSubmissionIntent({
  store,taskId,runId,messageId,providerPrompt,chatUrl,intentAt,
  baselineUserMessageId=null,baselineUserMessagePresent=false,baselinePromptMatches=false,
  newSession=false,previousConversationId=null,previousChatUrl=null,contextCheckpointVersion=null
}={}) {
  const url=canonicalProviderChatUrl(chatUrl);
  const freshHome=canonicalFreshProviderHome(chatUrl);
  const digest=providerPromptDigest(providerPrompt);
  if((newSession?!freshHome:!url) || !digest || !Number.isSafeInteger(intentAt) || intentAt<=0 ||
     (baselineUserMessageId!==null && (typeof baselineUserMessageId!=='string'||!baselineUserMessageId||baselineUserMessageId.length>180)) ||
     typeof baselineUserMessagePresent!=='boolean' ||
     (baselineUserMessageId!==null&&!baselineUserMessagePresent) ||
     typeof baselinePromptMatches!=='boolean' || typeof newSession!=='boolean' ||
     (previousConversationId!==null&&(typeof previousConversationId!=='string'||!previousConversationId||previousConversationId.length>180)) ||
     (contextCheckpointVersion!==null&&(!Number.isSafeInteger(contextCheckpointVersion)||contextCheckpointVersion<0)))
    return {recorded:false,reason:'intent_incomplete'};
  const run=store?.db?.prepare("SELECT id FROM runs WHERE id=? AND task_id=? AND status='running'").get(runId,taskId);
  const latestMessage=store?.db?.prepare(
    "SELECT id FROM messages WHERE task_id=? AND role='user' ORDER BY rowid DESC LIMIT 1"
  ).get(taskId);
  const task=store?.db?.prepare('SELECT chat_url FROM tasks WHERE id=?').get(taskId);
  const conversation=store?.db?.prepare(
    "SELECT id,chat_url FROM task_conversations WHERE task_id=? AND status='active' ORDER BY sequence DESC LIMIT 1"
  ).get(taskId);
  const priorUrl=canonicalProviderChatUrl(previousChatUrl);
  const freshReferencesMatch=newSession&&
    (previousConversationId===null
      ?(!conversation&&!canonicalProviderChatUrl(task?.chat_url)&&previousChatUrl===null)
      :(conversation?.id===previousConversationId&&canonicalProviderChatUrl(conversation.chat_url)===priorUrl&&
        canonicalProviderChatUrl(task?.chat_url)===priorUrl));
  const linkedReferencesMatch=!newSession&&conversation?.id&&canonicalProviderChatUrl(conversation.chat_url)===url&&
    canonicalProviderChatUrl(task?.chat_url)===url;
  if(!run || latestMessage?.id!==messageId || !(newSession?freshReferencesMatch:linkedReferencesMatch))
    return {recorded:false,reason:'intent_reference_missing'};
  const previous=store.db.prepare(
    "SELECT 1 FROM events WHERE task_id=? AND kind='provider.submission.intent' AND json_extract(payload,'$.run_id')=? LIMIT 1"
  ).get(taskId,runId);
  if(previous)return {recorded:false,reason:'intent_already_recorded'};
  store.event(taskId,'provider.submission.intent',{
    run_id:runId,message_id:messageId,conversation_id:newSession?null:conversation.id,
    prompt_sha256:digest,intent_at:intentAt,new_session:newSession,
    previous_conversation_id:newSession?previousConversationId:null,
    previous_chat_url:newSession?priorUrl:null,
    context_checkpoint_version:newSession?contextCheckpointVersion:null,
    baseline_user_message_id:baselineUserMessageId,
    baseline_user_message_present:baselineUserMessagePresent,
    baseline_prompt_matches:baselinePromptMatches
  });
  return {recorded:true,reason:'intent_recorded'};
}

export function findProviderSubmissionIntent({store,taskId,runId,messageId}={}) {
  if(!store?.db||typeof taskId!=='string'||!taskId||typeof runId!=='string'||!runId||
     typeof messageId!=='string'||!messageId)return null;
  const row=store.db.prepare(`SELECT payload FROM events WHERE task_id=? AND kind='provider.submission.intent'
    AND json_extract(payload,'$.run_id')=? AND json_extract(payload,'$.message_id')=? ORDER BY seq DESC LIMIT 1`)
    .get(taskId,runId,messageId);
  let intent;
  try {intent=row?JSON.parse(row.payload):null;} catch {return null;}
  if(!intent||typeof intent.new_session!=='boolean'||
     !/^[a-f0-9]{64}$/.test(intent.prompt_sha256||'')||
     !Number.isSafeInteger(intent.intent_at)||intent.intent_at<=0||
     (intent.baseline_user_message_id!==null&&
       (typeof intent.baseline_user_message_id!=='string'||!intent.baseline_user_message_id||intent.baseline_user_message_id.length>180))||
     typeof intent.baseline_user_message_present!=='boolean'||
     (intent.baseline_user_message_id!==null&&!intent.baseline_user_message_present)||
     typeof intent.baseline_prompt_matches!=='boolean')return null;
  if(intent.new_session===true) {
    const priorUrl=canonicalProviderChatUrl(intent.previous_chat_url);
    if(intent.conversation_id!==null||
       (intent.previous_conversation_id!==null&&
         (typeof intent.previous_conversation_id!=='string'||!intent.previous_conversation_id||intent.previous_conversation_id.length>180))||
       (intent.previous_conversation_id===null?intent.previous_chat_url!==null:!priorUrl)||
       intent.baseline_user_message_id!==null||intent.baseline_user_message_present!==false||
       intent.baseline_prompt_matches!==false||
       (intent.context_checkpoint_version!==null&&
         (!Number.isSafeInteger(intent.context_checkpoint_version)||intent.context_checkpoint_version<0)))return null;
  } else if(typeof intent.conversation_id!=='string'||!intent.conversation_id||
      intent.baseline_user_message_present===true&&intent.baseline_user_message_id===null) return null;
  const run=store.db.prepare('SELECT status FROM runs WHERE id=? AND task_id=?').get(runId,taskId);
  const message=store.db.prepare("SELECT id FROM messages WHERE id=? AND task_id=? AND role='user'").get(messageId,taskId);
  return run&&['failed','interrupted'].includes(run.status)&&message?{
    ...intent,evidenceKind:'dispatch_intent'
  }:null;
}

// W3 must not claim a matched answer without a durable, task-bound provider
// receipt or dispatch intent. An intent is accepted only for a failed Run and
// remains weaker than an acknowledged delivery receipt.
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
      conversationId:receipt.conversation_id,submittedAt:receipt.submitted_at,
      evidenceKind:'delivery_receipt',baselineUserMessageId:null,baselinePromptMatches:false
    };
  }
  const intents=store.db.prepare(
    "SELECT payload FROM events WHERE task_id=? AND kind='provider.submission.intent' " +
    "AND json_extract(payload,'$.message_id')=? ORDER BY seq DESC LIMIT 20"
  ).all(taskId,messageId);
  for(const row of intents) {
    let intent;
    try {intent=JSON.parse(row.payload);} catch {continue;}
    if(!/^[a-f0-9]{64}$/.test(intent?.prompt_sha256||'')||
       !Number.isSafeInteger(intent?.intent_at)||intent.intent_at<=0||
       intent.new_session===true||
       (intent.baseline_user_message_id!==null&&
        (typeof intent.baseline_user_message_id!=='string'||!intent.baseline_user_message_id||intent.baseline_user_message_id.length>180))||
       typeof intent.baseline_user_message_present!=='boolean'||
       (intent.baseline_user_message_id!==null&&!intent.baseline_user_message_present)||
       typeof intent.baseline_prompt_matches!=='boolean')continue;
    const conversation=store.db.prepare(
      "SELECT id FROM task_conversations WHERE id=? AND task_id=? AND chat_url=? AND status='active'"
    ).get(intent.conversation_id,taskId,url);
    if(!conversation)continue;
    const run=store.db.prepare("SELECT id,status FROM runs WHERE id=? AND task_id=?").get(intent.run_id,taskId);
    const message=store.db.prepare("SELECT id FROM messages WHERE id=? AND task_id=? AND role='user'")
      .get(messageId,taskId);
    if(run&&['failed','interrupted'].includes(run.status)&&message) return {
      promptSha256:intent.prompt_sha256,runId:run.id,
      conversationId:intent.conversation_id,submittedAt:intent.intent_at,
      evidenceKind:'dispatch_intent',
      baselineUserMessageId:intent.baseline_user_message_id,
      baselineUserMessagePresent:intent.baseline_user_message_present,
      baselinePromptMatches:intent.baseline_prompt_matches
    };
  }
  return null;
}

