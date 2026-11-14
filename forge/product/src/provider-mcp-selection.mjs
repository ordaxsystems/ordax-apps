import {mentionWasRequested} from './provider-mcp-mention.mjs';

export const PROVIDER_MCP_APPS=Object.freeze({
  'ordax-mcp':Object.freeze({
    key:'ordax-mcp',mentionName:'ordax-mcp',displayName:'ordax mcp',
    promptLinkLabel:'$ordax-mcp'
  }),
  'forge-mcp':Object.freeze({
    key:'forge-mcp',mentionName:'forge-mcp',displayName:'forge mcp',
    promptLinkLabel:'$forge-mcp'
  })
});

export function providerMcpAppSpec(app='ordax-mcp') {
  const spec=PROVIDER_MCP_APPS[app];
  if(!spec)throw new Error('provider_mcp_app_invalid');
  return spec;
}

// A literal @ mention is not the connected ChatGPT app. Never dispatch a
// tool-dependent task without the exact selected, visible app in this composer.
export function requireSelectedMcpForPrompt(prompt,selection,{requiresMcp=false,app='ordax-mcp'}={}) {
  if(!requiresMcp&&!mentionWasRequested(prompt,app))return false;
  if(selection?.state!=='selection_visible'||selection?.selectionObserved!==true)
    throw new Error('provider_mcp_selection_required');
  return true;
}
// A normal, nontechnical user request can still require physical project
// effects. Classify the requested WORK, not the presence of a literal app
// mention. Conversational explanations and text-only replies stay available.
// A short continuation in an existing project Task inherits its execution
// scope, rather than silently downgrading a prior filesystem mission to chat.
// This is an admission gate only: it grants no tools and proves no MCP call.
const PROJECT_WORK_CONTINUATION=/^(?:(?:pode\s+)?(?:continuar|continue|prossiga|prosseguir|retome|retomar|avance|avancar|siga|seguir|finalize|finalizar|conclua|concluir)(?:\s+(?:trabalhando|o\s+trabalho|a\s+tarefa|o\s+projeto|no\s+projeto|a\s+implementacao|o\s+desenvolvimento|a\s+execucao|de\s+onde\s+parou|com\s+o\s+projeto|com\s+o\s+trabalho|com\s+a\s+implementacao))?|(?:execute|faca)\s+o\s+proximo\s+passo|keep\s+going|go\s+ahead|continue\s+working|resume\s+work|finish\s+it|carry\s+on)[.!?]*$/u;
export function requiresMcpForProjectPrompt(prompt,{projectContinuation=false}={}) {
  const text=String(prompt??'').normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toLowerCase().trim();
  if(projectContinuation===true&&PROJECT_WORK_CONTINUATION.test(text))return true;
  if(!text || /^(?:como|qual|quais|porque|por que|o que|explique|analise|resuma|descreva)\b/u.test(text))
    return false;
  // Natural project work includes routine edits, Git actions and verification,
  // not only initial site creation. Missing a verb here silently skips the
  // tool-selection preflight; false project completion must remain impossible.
  const mutation=/\b(?:crie|criar|construa|construir|desenvolva|desenvolver|implemente|implementar|corrija|corrigir|edite|editar|altere|alterar|atualize|atualizar|monte|montar|gere|gerar|teste|testar|refatore|refatorar|faca|fazer|adicione|adicionar|acrescente|acrescentar|remova|remover|exclua|excluir|apague|apagar|renomeie|renomear|salve|salvar|execute|executar|rode|rodar|compile|compilar|verifique|verificar|inspecione|inspecionar|instale|instalar|inicie|iniciar|pare|parar|publique|publicar|create|add|remove|delete|rename|save|run|execute|build|test|fix|update|edit|install|start|stop|inspect|check)\b/u.test(text);
  const projectArtifact=/\b(?:site|website|pagina|paginas|html|css|javascript|codigo|arquivos?|pastas?|app|aplicativo|sistema|projeto|layout|frontend|backend|componentes?|repositorio|webapp|readme|git|branch|branches|commits?|build|builds|testes?|tests?|scripts?|dependencias?|dependencies|npm|pnpm|yarn|node|python|terminal|powershell|bash|file|files|folder|folders|repository|project|code|source|config|configuration)\b/u.test(text);
  return mutation && projectArtifact;
}

// Self-contained because this function is stringified into the provider DOM.
export function inspectProviderMcpComposerSelection(composer,spec=null) {
  const expected=spec&&typeof spec==='object'?spec:{
    mentionName:'ordax-mcp',displayName:'ordax mcp',promptLinkLabel:'$ordax-mcp'
  };
  if(!composer)return {composerPresent:false};
  if(typeof composer.querySelectorAll!=='function')return {composerPresent:true};
  const mentions=Array.from(composer.querySelectorAll('[app-mention-name]'));
  let named=false,valid=0;
  for(const node of mentions){
    if(node.getAttribute('app-mention-name')!==expected.mentionName)continue;
    named=true;
    const appPath=node.getAttribute('app-mention-path');
    const label=String(node.getAttribute('app-mention-display-name')||'').trim().toLowerCase();
    const rendered=node.getClientRects?.()?.length>0;
    const style=typeof getComputedStyle==='function'?getComputedStyle(node):null;
    if(node.getAttribute('contenteditable')!=='false'||
       node.getAttribute('data-appearance')!=='inline-mention'||
       node.getAttribute('data-prompt-link-label')!==expected.promptLinkLabel||
       !appPath?.startsWith('app://asdk_app_')||
       node.getAttribute('data-prompt-link-href')!==appPath||
       label!==expected.displayName||!rendered||
       (style&&(style.display==='none'||style.visibility==='hidden')))continue;
    valid++;
  }
  return {composerPresent:true,exactNamedControl:named,exactSelectedControl:valid===1};
}

export function isStandaloneMcpSelection(draft,selection,spec=null) {
  if(selection?.state!=='selection_visible'||selection?.selectionObserved!==true)return false;
  const expected=spec&&typeof spec==='object'?spec:{
    mentionName:'ordax-mcp',displayName:'ordax mcp'
  };
  const text=String(draft||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
  const withoutAt=text.startsWith('@')?text.slice(1):text;
  return withoutAt===expected.mentionName||withoutAt===expected.displayName;
}

// Only the visible provider-owned "add context" control may open the app menu.
// The click itself is a native Chromium pointer action, never a DOM click.
export function inspectProviderMcpAddContextTrigger(doc,composer) {
  const form=composer?.closest?.('form');
  if(!form||typeof form.querySelectorAll!=='function')return {selectable:false};
  const candidates=Array.from(form.querySelectorAll('button[data-composer-navigation-target="add-context"]'));
  if(candidates.length!==1)return {selectable:false};
  const node=candidates[0],r=node.getBoundingClientRect?.();
  if(!r||r.width<=0||r.height<=0||node.disabled)return {selectable:false};
  const x=r.left+r.width/2,y=r.top+r.height/2,hit=doc?.elementFromPoint?.(x,y);
  return {selectable:Boolean(hit&&(hit===node||node.contains?.(hit))),
    open:node.getAttribute('aria-expanded')==='true',x,y};
}

// Match exactly one requested installed app in the OPEN provider menu. The
// provider-owned app ID is observed from the DOM and never fabricated.
export function inspectProviderMcpPickerOption(doc,spec=null) {
  const expected=spec&&typeof spec==='object'?spec:{displayName:'ordax mcp'};
  if(!doc||typeof doc.querySelectorAll!=='function')return {optionCount:0,selectable:false};
  const menu=doc.querySelector?.('button[data-composer-navigation-target="add-context"][aria-expanded="true"]');
  if(!menu||menu.getClientRects?.().length===0)return {optionCount:0,selectable:false};
  const visible=node=>{
    const r=node?.getBoundingClientRect?.();
    if(!r||r.width<=0||r.height<=0)return false;
    const style=typeof getComputedStyle==='function'?getComputedStyle(node):null;
    return !style||(style.display!=='none'&&style.visibility!=='hidden');
  };
  const wanted=String(expected.displayName||'').replace(/\s+/g,' ').trim().toLowerCase();
  const matches=Array.from(doc.querySelectorAll(
    'button[data-list-navigation-item="true"][data-plugin-impression-id^="asdk_app_"]'
  )).filter(node=>{
    if(!visible(node))return false;
    const label=String(node.textContent||'').replace(/\s+/g,' ').trim().toLowerCase();
    return label===wanted||label===wanted+wanted||label===wanted+' '+wanted;
  });
  if(matches.length!==1)return {optionCount:matches.length,selectable:false};
  const node=matches[0];
  node.scrollIntoView?.({block:'center',inline:'nearest'});
  const r=node.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
  const w=doc.defaultView?.innerWidth??Infinity,h=doc.defaultView?.innerHeight??Infinity;
  const hit=x>=0&&y>=0&&x<w&&y<h?doc.elementFromPoint?.(x,y):null;
  return {optionCount:1,selectable:Boolean(hit&&(hit===node||node.contains?.(hit))),x,y};
}

// A visual app marker is not an MCP tool receipt, grant or permission.
export function classifyProviderMcpSelection(raw) {
  if(!raw||raw.composerPresent!==true)return Object.freeze({
    state:'unavailable',selectionObserved:false,invocationVerified:false
  });
  if(raw.exactSelectedControl===true) return Object.freeze({
    state:'selection_visible',selectionObserved:true,invocationVerified:false,
    integration:['forge','ordax'].includes(raw.selectedIntegration)?raw.selectedIntegration:null
  });
  if(raw.exactNamedControl===true) return Object.freeze({
    state:'name_visible_unverified',selectionObserved:false,invocationVerified:false,
    integration:['forge','ordax'].includes(raw.namedIntegration)?raw.namedIntegration:null
  });
  return Object.freeze({
    state:'not_observed',selectionObserved:false,invocationVerified:false
  });
}
