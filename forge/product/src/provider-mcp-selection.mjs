
import {mentionWasRequested} from './provider-mcp-mention.mjs';

// A literal @ mention is not the connected ChatGPT app. Never dispatch a
// tool-dependent task without a selected, visible, scoped app in this composer.
export function requireSelectedMcpForPrompt(prompt, selection, {requiresMcp=false}={}) {
  if (!requiresMcp && !mentionWasRequested(prompt)) return false;
  if (selection?.state !== 'selection_visible' || selection?.selectionObserved !== true)
    throw new Error('provider_mcp_selection_required');
  return true;
}
// A normal, nontechnical user request can still require physical project
// effects. Classify the requested WORK, not the presence of a literal app
// mention. Conversational explanations and text-only replies stay available.
export function requiresMcpForProjectPrompt(prompt) {
  const text=String(prompt??'').normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toLowerCase().trim();
  if(!text || /^(?:como|qual|quais|porque|por que|o que|explique|analise|resuma|descreva)\b/u.test(text))
    return false;
  const mutation=/\b(?:crie|criar|construa|construir|desenvolva|desenvolver|implemente|implementar|corrija|corrigir|edite|editar|altere|alterar|atualize|atualizar|monte|montar|gere|gerar|teste|testar|refatore|refatorar|faca|fazer)\b/u.test(text);
  const projectArtifact=/\b(?:site|website|pagina|paginas|html|css|javascript|codigo|arquivos?|pastas?|app|aplicativo|sistema|projeto|layout|frontend|backend|componentes?|repositorio|webapp)\b/u.test(text);
  return mutation && projectArtifact;
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
