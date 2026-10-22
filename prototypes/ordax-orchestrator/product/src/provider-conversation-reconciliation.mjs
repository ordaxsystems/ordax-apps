import { canonicalProviderChatUrl } from './conversation-policy.mjs';
import { providerPromptDigest } from './provider-submission-provenance.mjs';

// A DOM observation is only a candidate, never attributable proof of delivery.
// Absence in a bounded, potentially virtualized page is NOT proof of non-delivery.
export function assessProviderConversationEvidence({expectedUrl, observed, expectedMessage,expectedPromptSha256}) {
  const canonical = canonicalProviderChatUrl(expectedUrl);
  const hasDigest=typeof expectedPromptSha256==='string' && /^[a-f0-9]{64}$/.test(expectedPromptSha256);
  if (!canonical || (!hasDigest && (!expectedMessage || typeof expectedMessage !== 'string'))) {
    return {kind:'unavailable',reason:'missing_canonical_reference',requiresReconciliation:true};
  }
  if (!observed || observed.available !== true ||
      canonicalProviderChatUrl(observed.url) !== canonical) {
    return {kind:'unavailable',reason:'provider_view_unavailable',requiresReconciliation:true};
  }
  if (!observed.domReliable || !Array.isArray(observed.messages)) {
    return {kind:'unavailable',reason:'dom_not_reliable',requiresReconciliation:true};
  }
  const messages = observed.messages;
  if (messages.length > 50) {
    return {kind:'unavailable',reason:'observation_unbounded',requiresReconciliation:true};
  }
  const matches = [];
  for (let i=0;i<messages.length;i++) {
    const item=messages[i];
    if (!item || typeof item.text !== 'string' ||
        !['user','assistant'].includes(item.role) ||
        item.text.length > 12000 || item.textTruncated === true) {
      return {kind:'unavailable',reason:'message_observation_incomplete',requiresReconciliation:true};
    }
    if (item.role === 'user' && (hasDigest
      ? providerPromptDigest(item.text)===expectedPromptSha256
      : item.text.trim()===expectedMessage.trim())) matches.push(i);
  }
  if (matches.length > 1) {
    return {kind:'ambiguous',reason:'duplicate_message_candidates',
      candidates:matches.length,requiresReconciliation:true};
  }
  if (!matches.length) {
    return {kind:'unresolved',reason:observed.truncated ? 'message_not_visible_in_partial_dom' : 'message_not_observed',
      requiresReconciliation:true};
  }
  const after=messages.slice(matches[0]+1);
  // Do not attribute a response belonging to a later, different user turn.
  const nextUserIndex=after.findIndex(item=>item.role==='user');
  const sameTurn=nextUserIndex<0 ? after : after.slice(0,nextUserIndex);
  const responseCandidate=sameTurn.some(item => item.role==='assistant' && item.text.trim().length>0);
  return {
    kind:responseCandidate ? 'response_candidate' : 'message_candidate',
    reason:observed.truncated ? 'partial_dom_match_not_attributable' : 'dom_match_not_attributable',
    candidates:1,responseCandidate,
    requiresReconciliation:true
  };
}
