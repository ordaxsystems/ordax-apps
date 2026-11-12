
import {mentionWasRequested} from './provider-mcp-mention.mjs';

// A literal @ mention is not the connected ChatGPT app. Never dispatch a
// tool-dependent task without a selected, visible, scoped app in this composer.
export function requireSelectedMcpForPrompt(prompt, selection) {
  if (!mentionWasRequested(prompt)) return false;
  if (selection?.state !== 'selection_visible' || selection?.selectionObserved !== true)
    throw new Error('provider_mcp_selection_required');
  return true;
}
// A visual app marker is not an MCP tool receipt, grant or permission.
// ChatGPT app selection is scoped to a message and must be observed again.
export function classifyProviderMcpSelection(raw) {
  if(!raw || raw.composerPresent!==true) return Object.freeze({
    state:'unavailable',selectionObserved:false,invocationVerified:false
  });
  if(raw.exactSelectedControl===true) return Object.freeze({
    state:'selection_visible',selectionObserved:true,invocationVerified:false
  });
  if(raw.exactNamedControl===true) return Object.freeze({
    state:'name_visible_unverified',selectionObserved:false,invocationVerified:false
  });
  return Object.freeze({
    state:'not_observed',selectionObserved:false,invocationVerified:false
  });
}
