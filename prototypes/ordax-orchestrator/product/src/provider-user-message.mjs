// ChatGPT can append an expand button and an ellipsis to a long user bubble.
// Ignore that suffix only when the corresponding UI control was observed.
function normalizeText(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeProviderUserMessage(value, { expandControlPresent = false } = {}) {
  let text = String(value ?? '').replace(/\u00a0/g, ' ');
  if (expandControlPresent) {
    const control=text.match(/\s*(Mostrar mais|Show more|Mostrar menos|Show less)\s*$/iu);
    if(control) {
      text=text.slice(0,control.index);
      // A collapsed bubble appends an ellipsis before its expansion control.
      // An expanded bubble can legitimately end with an ellipsis in user text.
      if(/mais|more/i.test(control[1]))text=text.replace(/\s*…\s*$/u,'');
    } else text=text.replace(/\s*…\s*$/u,'');
  }
  return normalizeText(text);
}

export function providerUserMessageMatchesPrompt(observed, prompt, options = {}) {
  const expected = normalizeText(prompt);
  return Boolean(expected) && normalizeProviderUserMessage(observed, options) === expected;
}

// This is a signal to expand a provider bubble for exact verification, never a
// send receipt by itself. Requiring a substantial prefix prevents an unrelated
// short bubble from causing arbitrary UI clicks.
export function providerUserMessageIsCollapsedPromptPrefix(observed,prompt,{expandControlPresent=false}={}) {
  if(!expandControlPresent)return false;
  const expected=normalizeText(prompt);
  const actual=normalizeProviderUserMessage(observed,{expandControlPresent});
  return actual.length>=128&&actual.length<expected.length&&expected.startsWith(actual);
}

export function shouldExpandCollapsedProviderPromptForResponse({
  observed,prompt,expandControlPresent=false,alreadyAttempted=false
}={}) {
  return alreadyAttempted!==true&&providerUserMessageIsCollapsedPromptPrefix(observed,prompt,{expandControlPresent});
}
