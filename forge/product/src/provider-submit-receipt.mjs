// Browser-agnostic contract for observing an official provider UI.
// A cleared composer alone is never evidence that the message was sent.
import { normalizeProviderUserMessage, providerUserMessageMatchesPrompt } from './provider-user-message.mjs';

const normalized = value => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

// DOM #submissionState exposes '' when no earlier provider user bubble exists.
// The durable dispatch-intent contract uses null for absence. Preserve actual
// non-empty message IDs byte-for-byte; never invent an ID or accept an
// overlong/whitespace-only identifier as proof of a previous turn.
export function providerBaselineMessageId(value) {
  return typeof value==='string' && value.trim().length>0 && value.length<=180
    ? value : null;
}
export function providerSubmissionConfirmed({ baseline, current, prompt }) {
  if (!baseline || !current) return false;
  const currentUserText=normalizeProviderUserMessage(current.latestUserText,{
    expandControlPresent:Boolean(current.latestUserExpandControlPresent)
  });
  const baselineUserText=normalizeProviderUserMessage(baseline.latestUserText,{
    expandControlPresent:Boolean(baseline.latestUserExpandControlPresent)
  });
  const exactPromptObserved=providerUserMessageMatchesPrompt(currentUserText,prompt);
  // ChatGPT virtualizes long conversations and can evict older bubbles while
  // adding a new one, keeping the DOM count unchanged. Confirm an exact latest
  // prompt when either the count grew or the latest user bubble itself changed
  // from baseline. If the prompt was already latest and identity is unclear,
  // fail closed rather than treating a draft or an old turn as a new send.
  const userBubble = exactPromptObserved && (
    Number(current.userCount || 0) > Number(baseline.userCount || 0) ||
    Boolean(currentUserText && currentUserText !== baselineUserText)
  );
  // URL rotation and an emptied composer are not a receipt for the exact
  // submitted content. The worker expands collapsed long bubbles, then this
  // policy accepts only the exact latest user message.
  return userBubble;
}

export function unresolvedSubmitCode(state) {
  return normalized(state?.composerText) ? 'send_not_observed' : 'send_confirmation_unknown';
}

export async function submitExactlyOnce({ fire, readState, wait, baseline, prompt, maxChecks = 80 }) {
  if (typeof fire !== 'function' || typeof readState !== 'function' || typeof wait !== 'function') {
    throw new TypeError('submission_dependencies_required');
  }
  if (!baseline || !normalized(prompt) || !Number.isInteger(maxChecks) || maxChecks < 1) {
    throw new TypeError('invalid_submission_parameters');
  }
  // One and only one submit interaction. Do not attempt alternative click,
  // form, mouse or Enter submissions after firing.
  await fire();
  let latest = null;
  for (let i = 0; i < maxChecks; i++) {
    await wait();
    latest = await readState();
    if (providerSubmissionConfirmed({baseline,current:latest,prompt})) return latest;
  }
  throw new Error(unresolvedSubmitCode(latest));
}

export async function waitForSubmitControl({ read, wait, maxChecks = 40 }) {
  if (typeof read !== 'function' || typeof wait !== 'function' || !Number.isInteger(maxChecks) || maxChecks < 1) {
    throw new TypeError('invalid_submit_control_dependencies');
  }
  for (let i = 0; i < maxChecks; i++) {
    const control = await read();
    if (control?.button && Number.isFinite(control.x) && Number.isFinite(control.y)) return control;
    await wait();
  }
  // If React has not committed an enabled visible submit control after the
  // input is recognized, no attempt was made. Do not fire a speculative Enter.
  throw new Error('send_control_unavailable');
}
