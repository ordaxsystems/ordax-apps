// Shared discovery rules for the supported ChatGPT Web DOM. Prefer stable
// semantic attributes and use the current message-role hooks only when the
// semantic attributes are absent on the page.
const providerMessageSelectors = Object.freeze({
  user: Object.freeze({
    semantic: '[data-message-role="user"],[data-message-author-role="user"],[data-message-author="user"],[data-user-message-bubble="true"]',
    fallback: '[class~="bg-user-message"]'
  }),
  assistant: Object.freeze({
    semantic: '[data-message-role="assistant"],[data-message-author-role="assistant"],[data-message-author="assistant"],[data-chatgpt-selection-message-id]',
    fallback: '[data-markdown-text-style="assistant-message"]'
  })
});

function queryProviderMessageNodes(root, role, selectors) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  const definition = selectors?.[role];
  if (!definition) return [];
  const semantic = Array.from(root.querySelectorAll(definition.semantic));
  if (semantic.length) return semantic;
  return Array.from(root.querySelectorAll(definition.fallback));
}

// W3 must hash ONLY the author-written text, never UI controls embedded in
// the ChatGPT user bubble (copy button, collapsible controls or badges).
// A missing/ambiguous content node is UNKNOWN, not license to trim chrome.
function readProviderHistoricalUserText(node) {
  if (!node) return {text:'',complete:false};
  const bubble=node.matches?.('[data-user-message-bubble],[class~="bg-user-message"]')
    ? node : node.querySelector?.('[data-user-message-bubble],[class~="bg-user-message"]');
  if (!bubble || typeof bubble.querySelectorAll!=='function')
    return {text:'',complete:false};
  const content=Array.from(bubble.querySelectorAll('.whitespace-pre-wrap'));
  if (content.length!==1) return {text:'',complete:false};
  const text=String(content[0].innerText ?? content[0].textContent ?? '');
  return {text,complete:Boolean(text.trim())};
}

const providerMessageQueryBootstrap =
  `const providerMessageSelectors=${JSON.stringify(providerMessageSelectors)};` +
  `const queryProviderMessageNodes=(${queryProviderMessageNodes.toString()});` +
  `const readProviderHistoricalUserText=(${readProviderHistoricalUserText.toString()});`;

module.exports = {
  providerMessageSelectors,
  queryProviderMessageNodes,
  readProviderHistoricalUserText,
  providerMessageQueryBootstrap
};
