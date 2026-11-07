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
  // A formatted user turn can nest another pre-wrap element inside its single
  // authored-content root. Count only outer roots; independent sibling roots
  // remain ambiguous and must still fail closed.
  const roots=content.filter(entry=>!entry.parentElement?.closest?.('.whitespace-pre-wrap'));
  if (roots.length!==1) return {text:'',complete:false};
  const authored=roots[0];
  const codeNodes=Array.from(authored.querySelectorAll?.('code')||[]);
  if (codeNodes.length) {
    // ChatGPT renders Markdown inline-code delimiters as semantic CODE
    // elements. innerText loses those delimiter bytes, so its SHA-256 cannot
    // identify the original prompt. Reconstruct ONLY a uniquely reversible
    // structure: text nodes plus direct, single-text-node inline CODE children.
    // Ambiguous markup (blocks, nested elements or code containing a backtick)
    // is not evidence of delivery and must remain unreconciled.
    const children=Array.from(authored.childNodes||[]);
    if(!children.length||codeNodes.some(code=>code.parentElement!==authored))
      return {text:'',complete:false};
    let reconstructed='',seen=0;
    for(const child of children) {
      if(child.nodeType===3) {
        reconstructed+=String(child.nodeValue??'');
      }else if(child.nodeType===1&&child.tagName==='CODE'&&
        child.childNodes?.length===1&&child.firstChild?.nodeType===3&&
        typeof child.textContent==='string'&&
        !child.textContent.includes(String.fromCharCode(96))) {
        reconstructed+=String.fromCharCode(96)+child.textContent+String.fromCharCode(96);
        seen++;
      }else return {text:'',complete:false};
    }
    if(seen!==codeNodes.length)return {text:'',complete:false};
    return {text:reconstructed,complete:Boolean(reconstructed.trim())};
  }
  const text=String(authored.innerText??authored.textContent??'');
  return {text,complete:Boolean(text.trim())};
}

const providerMessageQueryBootstrap =
  `const providerMessageSelectors=${JSON.stringify(providerMessageSelectors)};` +
  `const queryProviderMessageNodes=(${queryProviderMessageNodes.toString()});`;

// Separate from health/failure probes: those must NEVER embed user-text code.
const providerHistoricalUserTextBootstrap =
  `const readProviderHistoricalUserText=(${readProviderHistoricalUserText.toString()});`;

module.exports = {
  providerMessageSelectors,
  queryProviderMessageNodes,
  readProviderHistoricalUserText,
  providerMessageQueryBootstrap,
  providerHistoricalUserTextBootstrap
};
