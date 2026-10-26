// Observe only explicit, visible ChatGPT response-failure controls. This
// snapshot deliberately returns booleans, never provider text or account data.
import providerDomSelectors from './provider-dom-selectors.cjs';

const { providerMessageQueryBootstrap } = providerDomSelectors;

export const providerResponseFailureSignalsExpression = `(() => {
  ${providerMessageQueryBootstrap}
  const visible = element => {
    if (!element || element.hidden) return false;
    for (let current = element; current && current.nodeType === 1; current = current.parentElement) {
      if (current.hidden || current.inert || current.getAttribute('aria-hidden') === 'true') return false;
      const style = window.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' ||
          style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
  };
  const assistantNodes = queryProviderMessageNodes(document,'assistant',providerMessageSelectors).filter(visible);
  const latestAssistant = assistantNodes.at(-1) || null;
  const retryLabel = /^(?:try again|retry|tente novamente|tentar novamente|tente de novo|tentar de novo|tente outra vez)$/i;
  const errorCopy = /(?:something went wrong|there was an error|an error occurred|error generating (?:the )?response|failed to generate (?:the )?response|could not generate (?:the )?response|response (?:was )?interrupted|algo deu errado|ocorreu um erro|houve um erro|erro ao gerar (?:a )?resposta|falha ao gerar (?:a )?resposta|n[aã]o foi poss[ií]vel (?:gerar|concluir|completar) (?:a )?resposta|a resposta foi interrompida|resposta interrompida)/i;
  const textOf = element => String(element?.innerText || element?.textContent || '').trim().slice(0, 1200);
  const labelOf = element => String(element.innerText || element.textContent ||
    element.getAttribute('aria-label') || element.getAttribute('title') || '').trim();
  const retryControls = Array.from(document.querySelectorAll('button,[role="button"]'))
    .filter(element => visible(element) && retryLabel.test(labelOf(element)));
  const retryInLatestAssistant = Boolean(latestAssistant && retryControls.some(control => latestAssistant.contains(control)));
  const retryWithErrorContext = retryControls.some(control => {
    if (latestAssistant?.contains(control)) return true;
    let current = control;
    for (let depth = 0; current && depth < 4; depth++, current = current.parentElement) {
      if (errorCopy.test(textOf(current))) return true;
    }
    return false;
  });
  const alertNodes = Array.from(document.querySelectorAll(
    '[role="alert"],[data-testid*="error"],[data-testid*="Error"],[aria-live="assertive"]'
  ));
  const visibleErrorAlert = alertNodes.some(element => visible(element) && errorCopy.test(textOf(element)));
  const latestText = textOf(latestAssistant);
  const standaloneError = /^(?:(?:hmm|sorry|desculpe)[,.!…\\s]*)?(?:something went wrong|there was an error|an error occurred|error generating (?:the )?response|failed to generate (?:the )?response|could not generate (?:the )?response|response (?:was )?interrupted|algo deu errado|ocorreu um erro|houve um erro|erro ao gerar (?:a )?resposta|falha ao gerar (?:a )?resposta|n[aã]o foi poss[ií]vel (?:gerar|concluir|completar) (?:a )?resposta|a resposta foi interrompida|resposta interrompida)[.!…\\s]*(?:(?:please|por favor)\\s+)?(?:try again|retry|tente novamente|tentar novamente)?[.!…\\s]*$/i.test(latestText) && latestText.length <= 500;
  return { retryInLatestAssistant, retryWithErrorContext, visibleErrorAlert, standaloneError };
})()`;

export function classifyProviderResponseFailure(signals) {
  if (!signals || typeof signals !== 'object') return null;
  if (signals.retryInLatestAssistant === true || signals.retryWithErrorContext === true)
    return 'chatgpt_response_retry_required';
  if (signals.visibleErrorAlert === true || signals.standaloneError === true)
    return 'chatgpt_response_error_observed';
  return null;
}
