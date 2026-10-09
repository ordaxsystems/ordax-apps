'use strict';

// Runs in the ChatGPT renderer. No cookies, tokens, private endpoints or hidden state.
// Selectors are independent from the reference implementation; drift blocks sending.
function conversationControls() {
  const visible = node => Boolean(node && !node.closest('[hidden],[inert],[aria-hidden="true"],[data-turn-key],[data-testid^="conversation-turn-"],.markdown,[data-message-author-role],[data-conversation-role],[data-user-message-bubble],[data-markdown-text-style],[data-chatgpt-agent-turn-start],[contenteditable="true"]') && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden' && node.getClientRects().length);
  const label = node => (node.innerText || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  const name = node => /^(?:Chat|Work|Codex)$/i.test(label(node)) ? label(node).toLowerCase() : null;
  const selected = node => ['aria-selected','aria-pressed','aria-checked'].some(attr => node.getAttribute(attr) === 'true');
  const roots = [...document.querySelectorAll('header,[role="banner"],form,[role="tablist"],[role="radiogroup"],[role="menu"]')].filter(visible);
  const controls = new Set(), options = new Set();
  for (const root of roots) {
    const nodes = [...root.querySelectorAll('button,[role="tab"],[role="radio"],[role="menuitemradio"],[role="combobox"]')].filter(visible).filter(name);
    const paired = nodes.some(node => name(node) === 'chat') && nodes.some(node => name(node) === 'work');
    for (const node of nodes) {
      const popup = ['menu','listbox','true'].includes(node.getAttribute('aria-haspopup')) || node.getAttribute('role') === 'combobox';
      if (paired) { options.add(node); if (selected(node)) controls.add(node); }
      if (popup && (root.matches('header,[role="banner"],form') || node.closest('header,[role="banner"],form'))) controls.add(node);
    }
  }
  // Never infer Chat from the model, URL, plan, missing Work, or message text.
  const modes = new Set([...controls].map(name));
  const mode = modes.size === 1 ? [...modes][0] : 'unknown';
  const efforts = [...new Set(roots.filter(root => root.matches('header,[role="banner"],form')).flatMap(root => [...root.querySelectorAll('button,[role="combobox"]')]))].filter(visible).filter(node => (node.hasAttribute('aria-haspopup') || node.getAttribute('role') === 'combobox') && /^(instant|instantâneo|thinking|pensar|standard|padrão|extended|estendido|heavy|intenso|light|leve|medium|médio|high|alto|reasoning effort|esforço de raciocínio)$/i.test(label(node)));
  return { mode, chatOptions: [...options].filter(node => name(node) === 'chat'), modeControls: [...controls], effortControls: efforts, effort: efforts.length === 1 ? label(efforts[0]).slice(0,100) : '' };
}

function selectChatMode() {
  const page = inspectPage(), controls = conversationControls();
  if (!page.ready || page.busy || page.draft || page.identityError) throw new Error('Aguarde um compositor vazio e conectado antes de selecionar Chat.');
  if (page.conversationId || page.turns.length || location.pathname !== '/') throw new Error('Inicie uma nova conversa para usar Chat. O Studio não converte tarefas Work existentes.');
  if (controls.mode === 'chat') return { selected: true };
  if (controls.mode !== 'work') throw new Error('Modo não identificado com segurança. Selecione Chat diretamente no ChatGPT.');
  if (controls.chatOptions.length === 1 && !controls.chatOptions[0].disabled && controls.chatOptions[0].getAttribute('aria-disabled') !== 'true') { controls.chatOptions[0].click(); return { requested: true }; }
  if (controls.mode === 'work' && controls.modeControls.length === 1 && controls.modeControls[0].hasAttribute('aria-haspopup') && !controls.modeControls[0].disabled && controls.modeControls[0].getAttribute('aria-expanded') !== 'true') { controls.modeControls[0].click(); return { opened: true }; }
  throw new Error('Modo Chat não identificado. Confira o seletor no ChatGPT; os envios do Studio estão bloqueados.');
}

function openEffortPicker() {
  if (!inspectPage().ready) throw new Error('Conecte a sessão interna do ChatGPT.');
  const controls = conversationControls().effortControls;
  if (controls.length !== 1 || controls[0].disabled || controls[0].getAttribute('aria-disabled') === 'true') throw new Error('Esta conta não expõe um seletor de raciocínio reconhecido. Use as opções disponíveis no ChatGPT.');
  if (controls[0].getAttribute('aria-expanded') !== 'true') controls[0].click();
  return { opened: true };
}

function inspectPage() {
  const visible = node => Boolean(node && !node.closest('[hidden], [inert], [aria-hidden="true"]') && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden' && node.getClientRects().length);
  const all = (selector, root = document) => [...root.querySelectorAll(selector)].filter(visible);
  const editor = all('#prompt-textarea, #mobile-composer-prompt, [data-testid="prompt-textarea"], [contenteditable="true"][data-lexical-editor="true"], form[data-chatgpt-composer] [data-composer-markdown][contenteditable="true"]');
  const stop = all('[data-testid="stop-button"], form[data-chatgpt-composer] button[aria-label="Stop"], button[aria-label="Stop generating"], button[aria-label="Parar geração"]');
  const login = all('[data-testid="login-button"], header a[href*="/auth/login"], nav a[href*="/auth/login"], button[data-testid="signup-button"]').length > 0 || all('header button, header a, nav button, nav a').some(n => /^(Entrar|Log in|Sign in|Iniciar sessão)$/i.test((n.innerText || '').trim()));
  const textOf = node => (node?.innerText || '').trim();
  function markdown(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll('button, svg, [hidden], [aria-hidden="true"], .sr-only, [role="tooltip"], [data-testid^="cot-"]').forEach(n => n.remove());
    function read(node) {
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeType !== 1) return '';
      if (node.tagName === 'PRE') { const language = /(?:^|\s)language-([a-z0-9+-]+)/i.exec(node.querySelector('code')?.className || '')?.[1] || ''; return '\n\n```' + language + '\n' + node.textContent.trim() + '\n```\n\n'; }
      if (node.tagName === 'TABLE') {
        const rows = [...node.querySelectorAll('tr')].map(row => [...row.querySelectorAll('th,td')].map(cell => [...cell.childNodes].map(read).join('').replace(/\n/g, ' ').replace(/\|/g, '\\|').trim()));
        if (!rows.length) return '';
        return '\n\n| ' + rows[0].join(' | ') + ' |\n| ' + rows[0].map(() => '---').join(' | ') + ' |\n' + rows.slice(1).map(row => '| ' + row.join(' | ') + ' |').join('\n') + '\n\n';
      }
      if (node.tagName === 'BLOCKQUOTE') return '\n\n> ' + [...node.childNodes].map(read).join('').trim().replace(/\n/g, '\n> ') + '\n\n';
      const body = [...node.childNodes].map(read).join('');
      if (node.tagName === 'BR') return '\n';
      if (/^H[1-6]$/.test(node.tagName)) return '\n\n' + '#'.repeat(Number(node.tagName[1])) + ' ' + body + '\n\n';
      if (node.tagName === 'LI') return '\n- ' + body.trim();
      if (node.tagName === 'CODE') return '`' + body + '`';
      if (['STRONG', 'B'].includes(node.tagName)) return '**' + body + '**';
      if (node.tagName === 'A' && /^https?:\/\//.test(node.getAttribute('href') || '')) return '[' + body + '](' + node.getAttribute('href') + ')';
      return ['P', 'DIV', 'UL', 'OL', 'BLOCKQUOTE', 'TABLE', 'TR'].includes(node.tagName) ? '\n' + body + '\n' : body;
    }
    return read(clone).replace(/\n{3,}/g, '\n\n').trim().slice(0, 200000);
  }
  const turns = [], seen = new Set(), owners = new Map();
  let identityError = '';
  function add(id, role, root, owner) {
    if (!id || id.length > 1024) { identityError = 'A página não expõe uma identidade estável para a mensagem.'; return; }
    if (seen.has(id)) { identityError = 'Identidades de mensagens duplicadas na página.'; return; }
    seen.add(id);
    const answerRoots = all('.markdown, [data-markdown-text-style="assistant-message"], [class*="_DilResponseRoot"]', root).filter(n => !n.closest('[data-testid^="cot-"], [data-user-message-bubble], [data-message-author-role="user"]') && !n.parentElement?.closest('.markdown, [data-markdown-text-style="assistant-message"], [class*="_DilResponseRoot"]'));
    const text = (role === 'assistant' ? answerRoots.map(markdown).join('\n\n') : textOf(root)).slice(0, 200000);
    const lastAnswer = answerRoots.at(-1);
    const completedControl = role === 'assistant' && lastAnswer && all('[data-testid="copy-turn-action-button"], .turn-action-controls button', owner).some(n => !lastAnswer.contains(n) && (n.getAttribute('data-testid') === 'copy-turn-action-button' || /^(copy|copiar)(?: (?:response|answer|resposta))?$/i.test(n.getAttribute('aria-label') || textOf(n))) && Boolean(lastAnswer.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING));
    turns.push({ id, role, text, completedControl: Boolean(completedControl) });
    owners.set(id, owner);
  }
  const groups = all('[data-turn-key]').filter(n => !n.parentElement?.closest('[data-turn-key]'));
  for (const group of groups) {
    const key = group.getAttribute('data-turn-key');
    const user = all('[data-user-message-bubble]', group);
    if (user.length > 1) identityError = 'A mensagem de usuário está ambígua.';
    else if (user.length === 1) add('group:user:' + key, 'user', user[0], group);
    const assistant = all('[data-conversation-role="assistant"], [data-chatgpt-agent-turn-start]', group).filter(n => !n.parentElement?.closest('[data-conversation-role="assistant"], [data-chatgpt-agent-turn-start]'));
    if (assistant.length) add('group:assistant:' + key, 'assistant', group, group);
  }
  const legacy = all('[data-testid^="conversation-turn-"]').filter(n => !n.closest('[data-turn-key]') && !n.parentElement?.closest('[data-testid^="conversation-turn-"]'));
  for (const turn of legacy) {
    const role = turn.getAttribute('data-turn') || turn.getAttribute('data-message-author-role') || turn.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role');
    if (!['user', 'assistant'].includes(role)) continue;
    const id = turn.getAttribute('data-turn-id') || turn.closest('[data-turn-id-container]')?.getAttribute('data-turn-id-container');
    add(id ? 'turn:' + role + ':' + id : '', role, turn.querySelector('[data-message-author-role]') || turn, turn);
  }
  const wrappers = [...document.querySelectorAll('[data-turn-id-container]')].map(n => n.getAttribute('data-turn-id-container')).filter(Boolean);
  const modelControl = all('[data-testid="model-switcher-dropdown-button"], [data-model-picker-view-toggle="true"]')[0];
  const alerts = all('[role="alert"]').map(textOf).filter(text => /error|erro|failed|falhou|failure|unable|não foi possível|something went wrong|limit|limite|try again|tente novamente|network|connection|conexão/i.test(text));
  const latest = turns.at(-1), owner = latest?.role === 'assistant' ? owners.get(latest.id) : null;
  const statusSelector = '[data-streaming-response-status], [data-testid="thinking-indicator"], [data-testid="cot-header"], [data-testid="cot-summary"], [data-testid="tool-call-status"], [data-testid="search-status"], [role="status"]';
  const statuses = all(statusSelector, document.querySelector('main') || document).filter(n => {
    if (n.closest('.markdown, [data-markdown-text-style="assistant-message"], form, [data-user-message-bubble]')) return false;
    const turn = n.closest('[data-turn-key], [data-testid^="conversation-turn-"]');
    return !turn || (owner && owner.contains(n));
  });
  const headers = owner ? all('button, [role="button"]', owner).filter(n => !n.closest('.markdown, [data-markdown-text-style="assistant-message"]')) : [];
  const labels = [...statuses, ...headers].map(textOf).map(text => text.replace(/\s+/g, ' ').trim()).filter(text => text && text.length <= 240);
  const activityPattern = /^(pensando|raciocinando|thinking|reasoning|pensou por|thought for|pesquisando|buscando|consultando|searching|browsing|looking up|lendo|analisando|reading|analyzing|analysing|reviewing|executando|usando|running|using|calling|trabalhando|gerando|working|generating|preparando|preparing)(?:\b|…)/i;
  const signals = [...new Set(labels.filter(label => activityPattern.test(label)))].slice(-8).map(label => ({ label, source: 'web' }));
  for (const node of statuses.filter(node => node.getAttribute('data-testid') === 'tool-call-status')) {
    const label = textOf(node).replace(/\s+/g, ' ').trim();
    if (label && label.length <= 240 && !signals.some(signal => signal.label === label)) signals.push({ label, source: 'web', kind: 'tool' });
  }
  const composer = editor.length === 1 ? editor[0].closest('form') : null;
  const ordaxSelected = Boolean(composer && all('button, [role="button"], [data-plugin-name], [data-connector-name]', composer).some(node => /^@?ORDAX (?:Studio|for ChatGPT)(?:\s*[×✕])?$/i.test(node.getAttribute('data-plugin-name') || node.getAttribute('data-connector-name') || textOf(node))));
  const audioButtons = all('button').map(node => node.getAttribute('aria-label') || node.getAttribute('title') || textOf(node));
  const audio = {
    dictation: audioButtons.some(label => /^(dictate|dictation|dictate text|ditar|ditado|ditar texto|microphone|microfone)$/i.test(label)),
    voice: audioButtons.some(label => /^(start voice mode|start voice chat|use voice mode|voice mode|iniciar modo de voz|iniciar conversa por voz|usar modo de voz|modo de voz)$/i.test(label)),
  };
  const conversation = conversationControls();
  return {
    conversationMode: conversation.mode, effort: conversation.effort,
    controls: { model: Boolean(modelControl), effort: conversation.effortControls.length === 1 },
    audio, url: location.href, conversationId: /^\/c\/([^/?]+)/.exec(location.pathname)?.[1] || null,
    title: document.title.replace(/\s*[-–|]\s*ChatGPT\s*$/i, '').slice(0, 100),
    ready: location.hostname === 'chatgpt.com' && editor.length === 1 && !login,
    draft: editor.length === 1 ? (editor[0].value ?? editor[0].innerText ?? '').trim() : '',
    busy: stop.length > 0, loginRequired: login || location.hostname !== 'chatgpt.com',
    model: textOf(modelControl).slice(0, 100) || 'Modelo selecionado no Web',
    turns, identityError, ordaxSelected, baseline: [...new Set([...turns.map(t => t.id), ...wrappers.map(x => 'container:' + x)])].sort(),
    alert: alerts.join(' · ').slice(0, 600), signals, progress: signals.at(-1)?.label || '',
  };
}

function prepareMessage(text, expected) {
  const page = inspectPage();
  if (page.conversationMode !== 'chat') throw new Error('Envio bloqueado: confirme o modo Chat. Work usa a cota compartilhada com Codex.');
  if (!page.ready || page.busy || page.identityError) throw new Error(page.identityError || 'O ChatGPT Web ainda não está pronto.');
  if (page.url !== expected.url || JSON.stringify(page.baseline) !== JSON.stringify(expected.baseline)) throw new Error('A conversa mudou antes do envio. Nenhuma mensagem foi enviada.');
  if (page.draft) throw new Error('Há um rascunho à direita. Envie ou limpe esse rascunho antes de escrever à esquerda.');
  const editors = [...document.querySelectorAll('#prompt-textarea, #mobile-composer-prompt, [data-testid="prompt-textarea"], [contenteditable="true"][data-lexical-editor="true"], form[data-chatgpt-composer] [data-composer-markdown][contenteditable="true"]')].filter(n => n.getClientRects().length && !n.closest('[hidden], [aria-hidden="true"]'));
  if (editors.length !== 1) throw new Error('Editor do ChatGPT não identificado com segurança.');
  const editor = editors[0]; editor.focus();
  if (editor.tagName === 'TEXTAREA') {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor, text);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (!document.execCommand('insertText', false, text)) throw new Error('O editor recusou o texto. Envie a mensagem pela área Web.');
  const draft = inspectPage().draft;
  // Chromium innerText may add paragraph breaks to inserted multiline text.
  // Preserve spaces/indentation and snapshot that representation; later changes
  // are still checked exactly before a click, rather than normalizing at submit.
  const paragraphs = value => value.replace(/\r\n?/g, '\n').replace(/\n{2,}/g, '\n').trim();
  if (paragraphs(draft) !== paragraphs(text)) throw new Error('O editor alterou o conteúdo. Confira o rascunho no Web.');
  return { prepared: true, draft };
}

function submitMessage(text, expected, preparedDraft = text.trim()) {
  const page = inspectPage();
  if (page.conversationMode !== 'chat') throw new Error('O modo mudou ou não pôde ser confirmado. Nenhuma mensagem foi enviada pelo Studio.');
  if (!page.ready || page.busy || page.identityError || page.url !== expected.url || JSON.stringify(page.baseline) !== JSON.stringify(expected.baseline)) throw new Error('A conversa mudou durante a preparação. O envio foi bloqueado.');
  if (page.draft !== preparedDraft) throw new Error('O rascunho foi alterado. O envio foi bloqueado.');
  const editor = [...document.querySelectorAll('#prompt-textarea, #mobile-composer-prompt, [data-testid="prompt-textarea"], [contenteditable="true"][data-lexical-editor="true"], form[data-chatgpt-composer] [data-composer-markdown][contenteditable="true"]')].find(n => n.getClientRects().length && !n.closest('[hidden], [aria-hidden="true"]'));
  const scope = editor?.closest('form');
  if (!scope) throw new Error('Formulário de envio não identificado.');
  const buttons = [...scope.querySelectorAll('[data-testid="send-button"], button[type="submit"]')].filter(n => n.getClientRects().length && !n.closest('[hidden], [aria-hidden="true"]'));
  if (buttons.length !== 1) throw new Error('Botão de envio não identificado com segurança.');
  if (buttons[0].disabled || buttons[0].getAttribute('aria-disabled') === 'true') return { sent: false };
  buttons[0].click(); return { sent: true };
}

function stopMessage() {
  const buttons = [...document.querySelectorAll('[data-testid="stop-button"], form[data-chatgpt-composer] button[aria-label="Stop"], button[aria-label="Stop generating"], button[aria-label="Parar geração"]')].filter(n => n.getClientRects().length && !n.closest('[hidden], [aria-hidden="true"]'));
  if (buttons.length !== 1) return { stopped: false };
  buttons[0].click(); return { stopped: true };
}

function openModelPicker() {
  if (!inspectPage().ready) throw new Error('Conecte a sessão interna do ChatGPT.');
  const buttons = [...document.querySelectorAll('[data-testid="model-switcher-dropdown-button"], [data-model-picker-view-toggle="true"]')].filter(n => n.getClientRects().length && !n.closest('[hidden], [inert], [aria-hidden="true"]') && !n.disabled);
  if (buttons.length !== 1) throw new Error('O seletor de modelos mudou. Escolha o modelo diretamente no Web ampliado.');
  if (buttons[0].getAttribute('aria-expanded') !== 'true') buttons[0].click();
  return { opened: true };
}

function openAttachmentPicker() {
  if (!inspectPage().ready) throw new Error('Conecte a sessão interna do ChatGPT.');
  const selectors = '[data-testid="composer-plus-btn"], [data-testid="attach-button"], button[aria-label="Add files and more"], button[aria-label="Adicionar arquivos e mais"], button[aria-label="Add photos & files"], button[aria-label="Adicionar fotos e arquivos"]';
  const buttons = [...document.querySelectorAll(selectors)].filter(n => n.getClientRects().length && !n.closest('[hidden], [inert], [aria-hidden="true"]') && !n.disabled);
  if (buttons.length !== 1) throw new Error('O menu de anexos mudou. Anexe o arquivo diretamente no Web ampliado.');
  if (buttons[0].getAttribute('aria-expanded') !== 'true') buttons[0].click();
  return { opened: true };
}

function audioControl(mode) {
  const page = inspectPage();
  if (page.conversationMode !== 'chat') throw new Error('Confirme o modo Chat antes de iniciar áudio pelo Studio.');
  if (!page.ready || page.busy || page.identityError) throw new Error('Aguarde o compositor do ChatGPT ficar disponível.');
  const labels = mode === 'dictation' ? /^(dictate|dictation|dictate text|ditar|ditado|ditar texto|microphone|microfone)$/i : /^(start voice mode|start voice chat|use voice mode|voice mode|iniciar modo de voz|iniciar conversa por voz|usar modo de voz|modo de voz)$/i;
  const buttons = [...document.querySelectorAll('button')].filter(node => node.getClientRects().length && !node.closest('[hidden],[inert],[aria-hidden="true"]') && !node.disabled && labels.test(node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent.trim()));
  if (buttons.length !== 1) throw new Error('Este controle de áudio não está disponível ou mudou. Use o áudio diretamente no ChatGPT Web.');
  buttons[0].click(); return { opened: true, mode };
}

function consumeAudioDraft(expected) {
  const page = inspectPage();
  if (!page.ready || page.busy || page.identityError || page.url !== expected.url || page.draft !== expected.text) throw new Error('O ditado mudou. O texto do Web foi preservado.');
  const editors = [...document.querySelectorAll('#prompt-textarea,#mobile-composer-prompt,[data-testid="prompt-textarea"]')].filter(node => node.getClientRects().length && !node.closest('[hidden],[inert],[aria-hidden="true"]'));
  if (editors.length !== 1) throw new Error('Editor do ditado não identificado.');
  const editor = editors[0]; editor.focus();
  if (editor.tagName === 'TEXTAREA') { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(editor,''); editor.dispatchEvent(new Event('input',{bubbles:true})); }
  else { const selection = getSelection(), range = document.createRange(); range.selectNodeContents(editor); selection.removeAllRanges(); selection.addRange(range); if (!document.execCommand('delete')) throw new Error('O texto permanece no Web; confira antes de enviar.'); }
  if (inspectPage().draft) throw new Error('O texto permanece no Web; confira antes de enviar.');
  return { consumed: true };
}

function scriptFor(action, ...args) {
  const functions = { inspect: inspectPage, chatMode: selectChatMode, effortPicker: openEffortPicker, prepare: prepareMessage, submit: submitMessage, stop: stopMessage, modelPicker: openModelPicker, attachmentPicker: openAttachmentPicker, audio: audioControl, consumeAudio: consumeAudioDraft };
  if (!functions[action]) throw new TypeError('Unknown page action');
  return `(() => { const conversationControls = ${conversationControls.toString()}; const inspectPage = ${inspectPage.toString()}; return (${functions[action].toString()})(...${JSON.stringify(args)}); })()`;
}
module.exports = { scriptFor };
