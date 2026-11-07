import { canonicalProviderChatUrl } from './conversation-policy.mjs';

// Operator-invoked diagnostic. The output is deliberately incapable of
// carrying HTML, prompt/response text, chat identifiers, cookies, or tokens.
// It does NOT attest to authenticated identity, provider availability,
// delivery of a specific message, or a successful completed response.
const BOOL_KEYS = Object.freeze([
  'composerPresent','sendControlPresent','stopControlPresent',
  'assistantContentPresent','userContentPresent'
]);
const COUNT_KEYS = Object.freeze(['assistantNodes','userNodes']);

export function toSafeProviderDiagnostic({url, observation, observedAt = new Date().toISOString()} = {}) {
  const canonical = canonicalProviderChatUrl(url);
  let pageType = 'other';
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' &&
        ['chatgpt.com','chat.openai.com'].includes(parsed.hostname) &&
        !parsed.username && !parsed.password && !parsed.port) {
      pageType = canonical ? 'conversation' : 'provider_other';
    } else if (['auth.openai.com','accounts.google.com'].includes(parsed.hostname) &&
               parsed.protocol === 'https:') {
      pageType = 'authentication';
    }
  } catch { /* no URL is ever exported */ }
  const flags = Object.create(null);
  const counts = Object.create(null);
  for (const key of BOOL_KEYS) flags[key] = observation?.[key] === true;
  for (const key of COUNT_KEYS) {
    const number = observation?.[key];
    counts[key] = Number.isSafeInteger(number) && number >= 0 && number <= 10000
      ? number : null;
  }
  return {
    schema:'ordax.lab.provider-dom-diagnostic.v1',
    source:'manual_read_only',
    observedAt:typeof observedAt === 'string' && Number.isFinite(Date.parse(observedAt))
      ? new Date(observedAt).toISOString() : null,
    pageType,
    linkedConversation:canonical !== null,
    flags:{...flags},
    counts:{...counts},
    // Keep this explicitly unknown. UI heuristics cannot prove login or completion.
    authenticated:'not_verified',
    delivery:'not_evaluated',
    responseCompletion:'not_evaluated',
    effects:'not_evaluated'
  };
}
