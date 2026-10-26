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

const providerMessageQueryBootstrap =
  `const providerMessageSelectors=${JSON.stringify(providerMessageSelectors)};` +
  `const queryProviderMessageNodes=(${queryProviderMessageNodes.toString()});`;

module.exports = {
  providerMessageSelectors,
  queryProviderMessageNodes,
  providerMessageQueryBootstrap
};
