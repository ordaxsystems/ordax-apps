
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
// Observe only a semantic app mention *inside the active ChatGPT editor*.
// The selected app is a non-editable ProseMirror mention, not an aria-pressed
// toggle. Text in the prompt, a menu item, or a historical message is not
// evidence of app selection and cannot authorize a provider send.
export function inspectProviderMcpComposerSelection(composer) {
  if(!composer)return {composerPresent:false};
  if(typeof composer.querySelectorAll!=='function')return {composerPresent:true};
  const mentions=Array.from(composer.querySelectorAll('[app-mention-name]'));
  let named=false,valid=0;
  for(const node of mentions) {
    if(node.getAttribute('app-mention-name')!=='ordax-mcp')continue;
    named=true;
    const appPath=node.getAttribute('app-mention-path');
    const label=String(node.getAttribute('app-mention-display-name')||'').trim().toLowerCase();
    const rendered=node.getClientRects?.()?.length>0;
    const style=typeof getComputedStyle==='function'?getComputedStyle(node):null;
    if(node.getAttribute('contenteditable')!=='false'||
       node.getAttribute('data-appearance')!=='inline-mention'||
       node.getAttribute('data-prompt-link-label')!=='$ordax-mcp'||
       !appPath?.startsWith('app://asdk_app_')||
       node.getAttribute('data-prompt-link-href')!==appPath||
       label!=='ordax mcp'||!rendered||
       (style&&(style.display==='none'||style.visibility==='hidden')))continue;
    valid++;
  }
  return {composerPresent:true,exactNamedControl:named,exactSelectedControl:valid===1};
}
// A preselected app token on an empty GPT home chat is reusable: it is not
// a user-authored draft. Literal @ text is never enough without the semantic
// selection observed from the actual editor.
export function isStandaloneMcpSelection(draft,selection) {
  if(selection?.state!=='selection_visible'||selection?.selectionObserved!==true)return false;
  const text=String(draft||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
  return /^@?ordax[ -]mcp$/i.test(text);
}

// Only the visible provider-owned "add context" control may open the app menu.
// The click itself is a native Chromium pointer action, never a DOM click.
export function inspectProviderMcpAddContextTrigger(doc,composer) {
  const form=composer?.closest?.('form');
  if(!form||typeof form.querySelectorAll!=='function')
    return {selectable:false};
  const candidates=Array.from(form.querySelectorAll('button[data-composer-navigation-target="add-context"]'));
  if(candidates.length!==1)return {selectable:false};
  const node=candidates[0],r=node.getBoundingClientRect?.();
  if(!r||r.width<=0||r.height<=0||node.disabled)return {selectable:false};
  const x=r.left+r.width/2,y=r.top+r.height/2,hit=doc?.elementFromPoint?.(x,y);
  return {selectable:Boolean(hit&&(hit===node||node.contains?.(hit))),
    open:node.getAttribute('aria-expanded')==='true',x,y};
}

// ChatGPT renders installed apps as navigation buttons, not ARIA menuitems.
// Match exactly one official app ID + name in the OPEN provider menu. The
// actual app ID is read from the provider DOM, never fabricated or hardcoded.
export function inspectProviderMcpPickerOption(doc) {
  if(!doc || typeof doc.querySelectorAll!=='function')return {optionCount:0,selectable:false};
  const menu=doc.querySelector?.('button[data-composer-navigation-target="add-context"][aria-expanded="true"]');
  if(!menu||menu.getClientRects?.().length===0)return {optionCount:0,selectable:false};
  const visible=node=>{
    const r=node?.getBoundingClientRect?.();
    if(!r||r.width<=0||r.height<=0)return false;
    const style=typeof getComputedStyle==='function'?getComputedStyle(node):null;
    return !style||(style.display!=='none'&&style.visibility!=='hidden');
  };
  const matches=Array.from(doc.querySelectorAll(
    'button[data-list-navigation-item="true"][data-plugin-impression-id^="asdk_app_"]'
  )).filter(node=>{
    if(!visible(node))return false;
    const label=String(node.textContent||'').replace(/\s+/g,' ').trim();
    return /^(ordax[ -]mcp){1,2}$/i.test(label);
  });
  if(matches.length!==1)return {optionCount:matches.length,selectable:false};
  const node=matches[0];
  // App choices can be below the viewport in the provider's scrollable menu.
  node.scrollIntoView?.({block:'center',inline:'nearest'});
  const r=node.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
  const w=doc.defaultView?.innerWidth??Infinity,h=doc.defaultView?.innerHeight??Infinity;
  const hit=x>=0&&y>=0&&x<w&&y<h?doc.elementFromPoint?.(x,y):null;
  return {optionCount:1,selectable:Boolean(hit&&(hit===node||node.contains?.(hit))),x,y};
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
