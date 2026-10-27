import {createHash} from 'node:crypto';
import {canonicalProviderChatUrl} from './conversation-policy.mjs';
import {providerPromptDigest} from './provider-submission-provenance.mjs';
import {assessProviderConversationEvidence} from './provider-conversation-reconciliation.mjs';
import {W3_MAX_ASSISTANT_CHARS} from './provider-recovery-bounds.mjs';

const sha256=value=>createHash('sha256').update(value,'utf8').digest('hex');

// A recovery candidate is available only when the exact submitted prompt is
// unique in the canonical thread and exactly one complete assistant message
// follows it before another user turn. This never sends or mutates anything.
export function selectCompletedProviderReply({
  expectedUrl,observed,expectedPromptSha256,
  submissionEvidenceKind='delivery_receipt',baselineUserMessageId=null,
  baselineUserMessagePresent=false,baselinePromptMatches=false
}={}) {
  const assessment=assessProviderConversationEvidence({expectedUrl,observed,expectedPromptSha256});
  const unavailable=reason=>({recoverable:false,reason,assessment});
  if(assessment.kind!=='response_candidate'||assessment.candidates!==1||assessment.responseCandidate!==true)
    return unavailable(assessment.reason||'provider_reply_not_found');
  if(observed?.truncated===true) return unavailable('provider_observation_truncated');
  if(observed?.generationStopVisible!==false||observed?.responseCompletionObserved!==true)
    return unavailable('provider_reply_completion_unconfirmed');
  const canonical=canonicalProviderChatUrl(expectedUrl);
  if(!canonical||canonicalProviderChatUrl(observed?.url)!==canonical)
    return unavailable('provider_url_mismatch');
  const matches=[];
  for(let index=0;index<observed.messages.length;index++) {
    const message=observed.messages[index];
    if(message?.role==='user'&&providerPromptDigest(message.text)===expectedPromptSha256)matches.push(index);
  }
  if(matches.length!==1)return unavailable(matches.length?'duplicate_message_candidates':'message_not_observed');
  const candidateIndex=matches[0];
  if(submissionEvidenceKind==='dispatch_intent') {
    if(typeof baselineUserMessagePresent!=='boolean')return unavailable('provider_baseline_presence_unknown');
    if(baselineUserMessagePresent&&baselineUserMessageId===null)
      return unavailable('provider_baseline_message_id_missing');
    if(!baselineUserMessagePresent&&(baselineUserMessageId!==null||baselinePromptMatches===true))
      return unavailable('provider_baseline_inconsistent');
  }
  if(baselineUserMessageId!==null) {
    if(typeof baselineUserMessageId!=='string'||!baselineUserMessageId||baselineUserMessageId.length>180)
      return unavailable('provider_baseline_message_invalid');
    const baselineIndex=observed.messages.findIndex(message=>message?.role==='user'&&message.id===baselineUserMessageId);
    if(baselineIndex<0||candidateIndex<=baselineIndex)
      return unavailable('provider_prompt_not_newer_than_baseline');
  } else if(baselinePromptMatches===true) {
    // The exact prompt was already the latest visible turn before dispatch.
    // Without a stable provider message ID, a prior answer could be mistaken
    // for the response to the new attempt.
    return unavailable('provider_prompt_preexisting');
  }
  const after=observed.messages.slice(matches[0]+1);
  const nextUser=after.findIndex(message=>message.role==='user');
  const sameTurn=nextUser<0?after:after.slice(0,nextUser);
  const replies=sameTurn.filter(message=>message.role==='assistant'&&typeof message.text==='string'&&message.text.trim());
  if(replies.length!==1)return unavailable(replies.length?'assistant_response_ambiguous':'assistant_response_missing');
  const text=replies[0].text;
  if(text.length>W3_MAX_ASSISTANT_CHARS||replies[0].textTruncated===true)return unavailable('assistant_response_incomplete');
  return {recoverable:true,text,responseSha256:sha256(text),assessment};
}

