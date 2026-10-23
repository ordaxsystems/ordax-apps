// A DOM node alone does not prove that ChatGPT is still generating: provider
// pages can retain hidden controls after a turn completes. Keep this probe
// shared by streaming completion and historical inspection so both paths use
// the same visible-control evidence.
export const providerGenerationStopProbeExpression = `(() => {
  const candidates = Array.from(document.querySelectorAll(
    'button[data-testid="stop-button"],button[aria-label*="Stop"],button[aria-label*="Parar"],button[aria-label*="Interromper"]'
  ));
  const accessibleStopLabel = /^(?:stop\\s+(?:generating|generation|streaming|the response)|parar\\s+(?:de\\s+gerar|geração|a resposta)|interromper\\s+geração)$/i;
  const visible = element => {
    if (!element || element.hidden) return false;
    for (let current = element; current && current.nodeType === 1; current = current.parentElement) {
      if (current.hidden || current.inert || current.getAttribute('aria-hidden') === 'true') return false;
      const style = window.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
  };
  return candidates.some(element => {
    const hasCanonicalTestId = element.getAttribute('data-testid') === 'stop-button';
    const label = String(element.getAttribute('aria-label') || '').trim();
    return visible(element) && (hasCanonicalTestId || accessibleStopLabel.test(label));
  });
})()`;
