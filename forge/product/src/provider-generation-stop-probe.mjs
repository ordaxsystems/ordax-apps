// Absence of a Stop control is not evidence that generation ended: ChatGPT's
// Web UI can render the assistant bubble before adding that control. Completion
// requires a positive marker attached to the latest assistant turn.
function providerVisibleElement(element) {
  if (!element || element.hidden) return false;
  for (let current = element; current && current.nodeType === 1; current = current.parentElement) {
    if (current.hidden || current.inert || current.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
}

function providerStopControlVisible(document, isVisible) {
  const candidates = Array.from(document.querySelectorAll(
    'button[data-testid="stop-button"],button[aria-label*="Stop"],button[aria-label*="Parar"],button[aria-label*="Interromper"]'
  ));
  const accessibleStopLabel = /^(?:stop\s+(?:generating|generation|streaming|the response)|parar\s+(?:de\s+gerar|geração|a resposta)|interromper\s+geração)$/i;
  return candidates.some(element => {
    const hasCanonicalTestId = element.getAttribute('data-testid') === 'stop-button';
    const label = String(element.getAttribute('aria-label') || '').trim();
    return isVisible(element) && (hasCanonicalTestId || accessibleStopLabel.test(label));
  });
}

// ChatGPT Web now exposes its finished-turn feedback toolbar rather than
// a persistent "Regenerate response" button. Attribute it strictly to the
// latest assistant turn; a prior turn's toolbar is never completion evidence.
// Multiple distinct first-party actions must be visible together.
function providerFinishedAssistantToolbar(latestAssistant, isVisible) {
  if (!latestAssistant || typeof latestAssistant.closest !== 'function') return false;
  const turn = latestAssistant.closest(
    '[data-testid="conversation-turn"],[data-testid^="conversation-turn-"],[data-turn-id]'
  ) || latestAssistant.closest('[data-message-author-role="assistant"],[data-message-role="assistant"]');
  if (!turn || typeof turn.querySelectorAll !== 'function') return false;
  const actions = new Set();
  for (const control of turn.querySelectorAll('button,[role="button"]')) {
    if (!isVisible(control)) continue;
    const testId = String(control.getAttribute('data-testid') || '').trim().toLowerCase();
    const label = String(control.getAttribute('aria-label') ||
      control.getAttribute('title') || '').trim().toLowerCase();
    if (testId === 'copy-turn-action-button' ||
      /^(?:copiar(?: resposta| mensagem)?|copy(?: response| message)?)$/.test(label))
      actions.add('copy');
    if (testId === 'good-response-turn-action-button' ||
      /^(?:boa resposta|good response|gostei|thumbs up)$/.test(label))
      actions.add('good');
    if (testId === 'bad-response-turn-action-button' ||
      /^(?:resposta ruim|bad response|n[aã]o gostei|thumbs down)$/.test(label))
      actions.add('bad');
  }
  return actions.has('copy') && actions.has('good') && actions.has('bad');
}

export function providerHasObservedCompletion({
  generationStopVisible,
  explicitCompletionMarker,
  completionControlLabels = [],
  finishedAssistantToolbar = false
} = {}) {
  if (generationStopVisible === true) return false;
  if (explicitCompletionMarker === true || finishedAssistantToolbar === true) return true;
  const completionLabel = /^(?:gerar resposta novamente|regenerar resposta|regenerate response)$/i;
  return Array.isArray(completionControlLabels) &&
    completionControlLabels.some(label => completionLabel.test(String(label || '').trim()));
}

const pageProbeBootstrap = `const providerVisibleElement=(${providerVisibleElement.toString()});` +
  `const providerStopControlVisible=(${providerStopControlVisible.toString()});` +
  `const providerFinishedAssistantToolbar=(${providerFinishedAssistantToolbar.toString()});`;

export const providerGenerationStopProbeExpression = `(() => {
  ${pageProbeBootstrap}
  return providerStopControlVisible(document, providerVisibleElement);
})()`;

export const providerResponseControlStateExpression = `(() => {
  ${pageProbeBootstrap}
  const generationStopVisible=providerStopControlVisible(document, providerVisibleElement);
  const assistantNodes=Array.from(document.querySelectorAll(
    '[data-message-role="assistant"],[data-message-author-role="assistant"],[data-message-author="assistant"],[data-chatgpt-selection-message-id],[data-markdown-text-style="assistant-message"]'
  ));
  const latestAssistant=assistantNodes.at(-1)||null;
  const explicitCompletionMarker=Boolean(latestAssistant && (
    latestAssistant.hasAttribute('data-message-complete') || latestAssistant.querySelector('[data-message-complete]')
  ));
  const finishedAssistantToolbar=providerFinishedAssistantToolbar(latestAssistant,providerVisibleElement);
  let completionControlLabels=[];
  for(let current=latestAssistant,depth=0;current&&depth<8;current=current.parentElement,depth++) {
    const labels=Array.from(current.querySelectorAll('button')).filter(providerVisibleElement).map(button=>
      String(button.getAttribute('aria-label')||button.innerText||button.textContent||'').trim()
    );
    if(labels.some(label=>/^(?:gerar resposta novamente|regenerar resposta|regenerate response)$/i.test(label))) {
      completionControlLabels=labels;
      break;
    }
  }
  const responseCompletionObserved=(${providerHasObservedCompletion.toString()})({
    generationStopVisible,explicitCompletionMarker,completionControlLabels,finishedAssistantToolbar
  });
  return {generationStopVisible,responseCompletionObserved};
})()`;
