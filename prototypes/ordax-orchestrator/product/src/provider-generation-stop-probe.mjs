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

export function providerHasObservedCompletion({
  generationStopVisible,
  explicitCompletionMarker,
  completionControlLabels = []
} = {}) {
  if (generationStopVisible === true) return false;
  if (explicitCompletionMarker === true) return true;
  const completionLabel = /^(?:gerar resposta novamente|regenerar resposta|regenerate response)$/i;
  return Array.isArray(completionControlLabels) &&
    completionControlLabels.some(label => completionLabel.test(String(label || '').trim()));
}

const pageProbeBootstrap = `const providerVisibleElement=(${providerVisibleElement.toString()});` +
  `const providerStopControlVisible=(${providerStopControlVisible.toString()});`;

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
    generationStopVisible,explicitCompletionMarker,completionControlLabels
  });
  return {generationStopVisible,responseCompletionObserved};
})()`;
