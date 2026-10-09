import { createHttpHost, validateHost } from './host.mjs';
import { markdownHTML } from './markdown.mjs';
import { composeTextMessage, MESSAGE_LIMIT } from './message.mjs';
import { paintActivity, tickActivityClocks, elapsedLabel, phaseNames } from './activity-view.mjs';
import { DraftController } from './drafts.mjs';
import { createProjectPanel } from './project-panel.mjs';
import { createPluginPanel } from './plugin-panel.mjs';
import { projectDraftKey, bindingEquals } from './project-organization.mjs';
import { createNavigation } from './navigation.mjs';
import { createPreviewPanel } from './preview-panel.mjs';
import { projectMessage } from './project-context.mjs';
import { createAudioPanel } from './audio-panel.mjs';
import { createProjectEntry } from './project-entry.mjs';
import { createStartup } from './startup.mjs';

const host = window.ordaxStudioConversationHost || window.ordaxAssistantHost || createHttpHost();
const nativeWeb = window.ordaxStudioWebHost || window.ordaxAssistantWebHost;
if (nativeWeb) document.body.classList.add('web-bridge');
const $ = id => document.getElementById(id);
let chats = [], connection = { active: null, accounts: [] }, models = [], activeId = null, busy = false, attachments = [];
let webSnapshot = {}, layoutState = { mode: 'split', ratio: 0.6 }, connectionStamp = '', modelStamp = '';
let streamingNode = null, renderScheduled = false, externalBusy = false, pollRunning = false, lastVersion = -1, lastIssue = '', loginOpening = false, browserOpening = false, returnAfterLogin = false;
let recoveringStream = false, navigation;
let projects = [], activeProjectId = null, navigationPending = false, editingProjectId = null;
let contextBlocked = false;
let home = true, supportsWebDelete = false, webDeletionRecovery = false, deleting = false, optionsChatId = null;
let audioPanel;
const drafts = new DraftController(host, error => { $('draftState').textContent = 'Falha ao salvar rascunho'; notify(error.message); });
let initialized = false;
const locked = () => busy || externalBusy || navigationPending || contextBlocked || deleting || Boolean(audioPanel?.active());
const draftKey = () => activeId || projectDraftKey(activeProjectId);
const project = () => projects.find(value => value.id === activeProjectId);
const chat = () => chats.find(c => c.id === activeId);
const account = () => connection.accounts.find(a => a.id === connection.active);
const notify = message => { for (const id of ['notice','webNotice']) { $(id).textContent = message || ''; $(id).hidden = !message; } };
const run = task => Promise.resolve().then(task).catch(error => notify(error.message));

function updateChat(value) {
  const index = chats.findIndex(c => c.id === value.id);
  if (index < 0) chats.unshift(value); else chats[index] = value;
}
function autosize() { $('prompt').style.height = 'auto'; $('prompt').style.height = `${Math.min($('prompt').scrollHeight, 170)}px`; }
function saveDraft() {
  if (!initialized) return;
  drafts.set(draftKey(), { text: $('prompt').value, attachments: [...attachments] });
  $('draftState').textContent = 'Rascunho local';
}
function restoreDraft() { const draft = drafts.get(draftKey()); $('prompt').value = draft?.text || ''; attachments = [...(draft?.attachments || [])]; autosize(); renderAttachments(); }
function consumeDraft(delivery) { if (drafts.consume(delivery) && delivery.draftKey === draftKey()) restoreDraft(); }
function selectLocal(id, projectId = id ? chats.find(value => value.id === id)?.projectId || null : activeProjectId) {
  if (activeId === id && activeProjectId === projectId) return;
  audioPanel?.stopReading(); saveDraft(); activeId = id; activeProjectId = projectId;
  if (id) home = false;
  $('useProjectContext').checked = true;
  restoreDraft();
}
async function navigate(task) {
  if (locked()) return;
  navigationPending = true; updateControls(); renderSidebar();
  try { return await task(); }
  finally { navigationPending = false; updateControls(); renderSidebar(); }
}
function applyOrganizationState(state) {
  home = state.home === true;
  if (state.chats) chats = state.chats;
  if (state.projects) projects = state.projects;
  selectLocal(state.activeId, state.activeProjectId ?? null); lastVersion = state.version ?? -1;
}
async function selectProjectScope(id) {
  return navigate(async () => {
    const binding = projects.find(value => value.id === id)?.binding || null;
    projectPanel.assertContext(binding); saveDraft(); await drafts.flush();
    applyOrganizationState(await host.selectConversationProject(id));
    if (layoutState.studioPreview && layoutState.expanded) await nativeWeb.collapse();
    projectPanel.setContext(binding); projectPanel.showConversation(); navigation.go('project'); notify(''); render(); closeSidebar();
  });
}
function openProjectOptions(id = null) {
  if (!id) { projectEntry.open(); return; }
  editingProjectId = id;
  const value = projects.find(item => item.id === id);
  $('conversationProjectDialogTitle').textContent = value ? 'Opções do projeto' : 'Novo projeto';
  $('conversationProjectName').value = value?.name || '';
  $('conversationProjectInstructions').value = value?.instructions || '';
  $('conversationProjectPreviewUrl').value = value?.previewUrl || '';
  $('conversationProjectBinding').textContent = value?.binding ? `Espaço de trabalho: ${value.binding.project} · ${value.binding.deviceId}` : 'As conversas ficam organizadas neste dispositivo. Para conectar arquivos, abra um projeto no espaço de trabalho e use “Abrir conversas deste projeto”.';
  $('saveConversationProject').textContent = value ? 'Salvar projeto' : 'Criar espaço de conversas';
  $('removeConversationProject').hidden = !value;
  $('removeConversationProject').textContent = 'Remover projeto, manter conversas';
  $('conversationProjectDialogStatus').textContent = '';
  $('conversationProjectDialog').showModal(); $('conversationProjectName').focus();
}
async function openWorkspaceConversations({ name, binding }) {
  return navigate(async () => {
    projectPanel.assertContext(binding); saveDraft(); await drafts.flush();
    let value = projects.find(item => bindingEquals(item.binding, binding));
    if (!value) { value = await host.createProject({ name: name.slice(0, 80), binding }); projects.push(value); }
    applyOrganizationState(await host.selectConversationProject(value.id));
    if (layoutState.studioPreview && layoutState.expanded) await nativeWeb.collapse();
    projectPanel.setContext(binding); projectPanel.showConversation(); navigation.go('project'); render(); closeSidebar();
  });
}
function updateControls() {
  const ready = account()?.connected && account()?.planEnabled && $('model').value;
  const unconfirmed = ['prepared','submitted','uncertain'].includes(chat()?.delivery?.status);
  let length = 0, invalid = '';
  if ($('prompt').value.trim() || attachments.length) { try { length = composeTextMessage(projectMessage({ project: project(), messages: chat()?.messages, message: { text: $('prompt').value, attachments }, enabled: $('useProjectContext').checked })).text.length; } catch (error) { invalid = error.message; } }
  $('messageBudget').hidden = !invalid && length < MESSAGE_LIMIT * 0.8;
  $('messageBudget').textContent = invalid || `${length.toLocaleString('pt-BR')} / ${MESSAGE_LIMIT.toLocaleString('pt-BR')} caracteres, incluindo arquivos`;
  $('messageBudget').classList.toggle('invalid', Boolean(invalid));
  const modeBlocked = connection.mode === 'chatgpt-web' && webSnapshot.chatModeRequired === true && webSnapshot.automatedSendAllowed !== true;
  $('send').disabled = !initialized || locked() || unconfirmed || Boolean(invalid) || modeBlocked || !ready || (!$('prompt').value.trim() && !attachments.length);
  $('send').hidden = busy || externalBusy; $('stop').hidden = !busy && !externalBusy;
  $('prompt').disabled = !initialized || locked(); $('attach').disabled = !initialized || locked(); $('newChat').disabled = !initialized || locked(); $('model').disabled = connection.mode === 'chatgpt-web' || locked() || !models.length;
  $('exportChat').disabled = !chat()?.messages.length;
  $('chatOptions').disabled = !chat() || locked(); $('saveTitle').disabled = locked();
  $('chooseModel').hidden = !nativeWeb; $('webAttach').hidden = !nativeWeb;
  $('chooseModel').disabled = locked() || !ready; $('webAttach').disabled = locked() || !ready;
  $('useChatMode').disabled = locked() || !webSnapshot.ready;
  $('webModelPicker').disabled = locked() || !webSnapshot.ready || webSnapshot.controls?.model !== true;
  $('webEffortPicker').hidden = webSnapshot.controls?.effort !== true;
  $('webEffortPicker').disabled = locked() || !webSnapshot.ready;
  $('deliveryReview').hidden = chat()?.delivery?.status !== 'uncertain';
  $('reviewConfirm').disabled = locked() || !ready;
  $('createConversationProject').disabled = locked() || !initialized || !host.createProject;
  $('conversationProjectOptions').disabled = locked();
  $('saveConversationProject').disabled = locked(); $('removeConversationProject').disabled = locked();
  $('moveConversationProject').disabled = locked() || !host.moveChat;
  $('openHome').disabled = locked() || !initialized || !host.openHome;
  $('homeNewProject').disabled = locked() || !initialized || !host.createProject;
  $('homeWorkspace').disabled = locked() || !initialized;
  $('accountButton').disabled = !initialized || Boolean(audioPanel?.active()); $('openPlugin').disabled = locked();
  audioPanel?.paint();
  navigation?.paint();
  $('showPreview').disabled = !window.ordaxStudioPreviewHost || !project() || locked() || !initialized;
}
function renderSidebar() { navigation?.paint(); previewPanel.paint(); }
async function openConversation(id) {
  return navigate(async () => {
    const value = chats.find(chat => chat.id === id);
    if (!value) throw new Error('Conversa não encontrada.');
    const binding = projects.find(project => project.id === value.projectId)?.binding || null;
    projectPanel.assertContext(binding); saveDraft(); await drafts.flush();
    if (host.selectChat) await host.selectChat(id);
    selectLocal(id, value.projectId || null); projectPanel.setContext(binding);
    projectPanel.showConversation(); navigation.go('conversation'); notify(''); render(); closeSidebar();
    if (layoutState.studioPreview) await nativeWeb.expand();
  });
}
function showConversationView() {
  document.body.classList.remove('mobile-preview');
  $('showConversation').setAttribute('aria-pressed', 'true'); $('showPreview').setAttribute('aria-pressed', 'false');
  previewPanel.geometry();
}
function showProjectPreview() {
  if (!window.ordaxStudioPreviewHost || !project() || locked()) return;
  projectPanel.showConversation(); navigation.go('conversation');
  document.body.classList.add('mobile-preview');
  $('showConversation').setAttribute('aria-pressed', 'false'); $('showPreview').setAttribute('aria-pressed', 'true');
  previewPanel.geometry();
}
function renderConnection() {
  const stamp = JSON.stringify(connection); if (stamp === connectionStamp) return; connectionStamp = stamp;
  const current = account(), connected = Boolean(current?.connected), usable = connected && current.planEnabled;
  $('accountLabel').textContent = current?.label || 'Conecte o ChatGPT';
  $('accountDetail').textContent = usable ? 'Sessão Web · Gerenciar login' : connected ? 'Confira a área Web' : 'Abra a sessão pelo botão GPT Web';
  $('accountAvatar').textContent = current?.label?.[0]?.toUpperCase() || '↗';
  $('connectionBadge').classList.toggle('connected', usable);
  $('connectionBadge').replaceChildren();
  const dot = document.createElement('span'); dot.className = 'dot'; $('connectionBadge').append(dot, usable ? 'Web sincronizado' : 'Aguardando conexão');
  $('welcomeConnect').hidden = usable; $('welcomeBrowser').hidden = usable; document.querySelector('.browser-login-help').hidden = usable;
  $('welcomeNote').textContent = usable ? 'Tudo pronto. O que vamos criar hoje?' : 'Abra a sessão pelo botão GPT Web para começar.';
  $('disconnect').hidden = false;
  $('accounts').replaceChildren();
  for (const a of connection.accounts) {
    const row = document.createElement('div'); row.className = 'account-row';
    const info = document.createElement('div'), label = document.createElement('span'), details = document.createElement('small');
    label.textContent = a.label; details.textContent = `Registro ${a.registration} · ${a.id === connection.active ? 'Ativa' : a.connected ? 'Conectada' : 'Desconectada'}`;
    info.append(label, details);
    const select = a.connected && a.id !== connection.active;
    const button = document.createElement('button'); button.textContent = 'Abrir Web'; button.disabled = busy;
    button.addEventListener('click', () => connect());
    row.append(info, button); $('accounts').append(row);
  }
}
function renderModelPicker() {
  const selected = chat()?.model || $('model').value;
  const stamp = JSON.stringify([models, selected, account()?.connected]); if (stamp === modelStamp) return; modelStamp = stamp;
  $('model').replaceChildren();
  if (!models.length) { const option = document.createElement('option'); option.value = ''; option.textContent = account()?.connected ? 'Nenhum modelo disponível' : 'Conecte sua conta'; $('model').append(option); }
  for (const model of models) { const option = document.createElement('option'); option.value = model.id; option.textContent = model.name; $('model').append(option); }
  if (models.some(m => m.id === selected)) $('model').value = selected;
}
function messageElement(message) {
  const node = document.createElement('article'); node.className = `message ${message.role}${message.status === 'streaming' ? ' streaming' : ''}`;
  node.dataset.messageId = message.id; node._message = message; node._text = message.text; node.dataset.status = message.status;
  const avatar = document.createElement('div'); avatar.className = 'message-avatar'; avatar.setAttribute('aria-hidden', 'true');
  if (message.role === 'assistant') { const img = document.createElement('img'); img.src = new URL('../assets/mark.svg', import.meta.url).href; img.alt = ''; avatar.append(img); } else avatar.textContent = 'EU';
  const body = document.createElement('div'); body.className = 'message-body';
  const heading = document.createElement('div'); heading.className = 'message-heading'; heading.textContent = message.role === 'user' ? 'Você' : 'ChatGPT';
  if (message.model) { const small = document.createElement('small'); small.textContent = models.find(m => m.id === message.model)?.name || message.model; heading.append(small); }
  const content = document.createElement('div'); content.className = 'message-content';
  if (message.role === 'user') content.textContent = message.text; else content.innerHTML = markdownHTML(message.text);
  content.hidden = !message.text && Boolean(message.activity);
  if (!message.text && !message.activity && message.status === 'streaming') { const thinking = document.createElement('span'); thinking.className = 'thinking'; thinking.textContent = 'Aguardando atividade do Web…'; content.append(thinking); }
  const activity = document.createElement('div'); activity.className = 'message-activity';
  paintActivity(activity, message.activity); body.append(heading, activity, content);
  if (message.attachments?.length) {
    const files = document.createElement('div'); files.className = 'message-attachments';
    for (const a of message.attachments) {
      if (a.kind === 'image') { const image = document.createElement('img'); image.src = a.data; image.alt = a.name; files.append(image); }
      else { const tag = document.createElement('span'); tag.className = 'file-tag'; tag.textContent = `▤ ${a.name}`; files.append(tag); }
    }
    body.append(files);
  }
  if (message.status === 'streaming') streamingNode = { node, content, message };
  if (message.role === 'assistant' && message.status !== 'streaming') {
    if (message.status !== 'completed') { const error = document.createElement('div'); error.className = 'message-error'; error.textContent = message.error || 'Resposta interrompida antes da conclusão.'; body.append(error); }
    const actions = document.createElement('div'); actions.className = 'message-actions';
    const copy = document.createElement('button'); copy.textContent = 'Copiar'; copy.disabled = !message.text;
    copy.addEventListener('click', () => run(async () => { await navigator.clipboard.writeText(node._message.text); copy.textContent = 'Copiado'; })); actions.append(copy);
    if (connection.mode !== 'chatgpt-web' && message === chat()?.messages.at(-1)) { const retry = document.createElement('button'); retry.textContent = 'Tentar novamente'; retry.disabled = busy || !account()?.connected; retry.addEventListener('click', () => run(() => send(true))); actions.append(retry); }
    const listen = document.createElement('button'); listen.dataset.listen = message.id; listen.textContent = 'Ouvir'; listen.disabled = !message.text; listen.addEventListener('click', () => run(() => audioPanel.listen(node._message))); actions.append(listen);
    body.append(actions);
  }
  node.append(avatar, body); return node;
}
function renderMessages() {
  document.body.classList.toggle('studio-home', home);
  streamingNode = null;
  const current = chat(), populated = Boolean(current?.messages.length), activity = current?.activity;
  $('welcome').hidden = populated || activity?.endedAt === null; $('messages').hidden = !populated;
  $('conversationTitle').textContent = current?.title || (home ? 'Início' : project()?.name || 'Nova conversa sem projeto');
  $('welcome').querySelector('h1').textContent = home ? 'O que vamos criar hoje?' : project() ? `Vamos trabalhar em ${project().name}?` : 'Comece uma nova conversa';
  $('welcome').querySelector('.welcome-description').textContent = home ? 'Comece uma conversa ou retome uma ideia.' : 'Seu contexto acompanha esta conversa. Comece pela próxima ideia.';
  $('projectContextHint').hidden = Boolean(current?.messages.length) || !project()?.instructions?.trim();
  $('projectContextText').textContent = project()?.instructions || '';
  const existing = new Map([...$('messages').children].map(node => [node.dataset.messageId, node]));
  let position = 0;
  for (const message of current?.messages || []) {
    let node = existing.get(message.id); existing.delete(message.id);
    if (!node || node.dataset.status !== message.status) {
      const open = node?.querySelector('.message-activity details')?.open;
      const replacement = messageElement(message);
      if (open && replacement.querySelector('details')) replacement.querySelector('details').open = true;
      if (node) node.replaceWith(replacement); node = replacement;
    } else {
      node._message = message;
      node.querySelector('.message-content').hidden = !message.text && Boolean(message.activity);
      if (node._text !== message.text) {
        const content = node.querySelector('.message-content');
        if (message.role === 'user') content.textContent = message.text; else content.innerHTML = markdownHTML(message.text);
        node._text = message.text;
      }
      paintActivity(node.querySelector('.message-activity'), message.activity);
    }
    if ($('messages').children[position] !== node) $('messages').insertBefore(node, $('messages').children[position] || null);
    position++;
  }
  for (const node of existing.values()) node.remove();
  const represented = current?.messages.some(m => m.activity?.turnId === activity?.turnId);
  paintActivity($('pendingActivity'), !represented ? activity : null);
  renderRunStatus(); updateJump();
}
function render() { renderSidebar(); renderConnection(); renderModelPicker(); renderMessages(); updateControls(); }
function scrollBottom() { $('conversation').scrollTop = $('conversation').scrollHeight; updateJump(); }
function updateJump() { $('jumpLatest').hidden = !$('messages').children.length || $('conversation').scrollHeight - $('conversation').scrollTop - $('conversation').clientHeight < 150; }
function renderRunStatus() {
  const activity = chat()?.activity, active = activity?.endedAt === null && activity?.current;
  $('runStatus').hidden = !active;
  if (active) { const label = phaseNames[activity.current.kind] || 'Trabalhando'; if ($('runLabel').textContent !== label) $('runLabel').textContent = label; $('runElapsed').textContent = elapsedLabel(activity.startedAt); }
}
function renderSession() {
  const mode = webSnapshot.conversationMode || 'unknown';
  $('chatSafety').hidden = !nativeWeb || (home && !layoutState.expanded);
  $('chatSafety').dataset.mode = mode;
  $('chatModeStatus').textContent = !webSnapshot.ready ? 'Conecte sua sessão ChatGPT' : mode === 'chat' ? 'Chat confirmado' : mode === 'work' ? 'Work · usa a cota compartilhada com Codex' : mode === 'codex' ? 'Codex · usa a cota compartilhada com Work' : 'Modo não identificado · envio experimental bloqueado';
  $('quotaPolicy').textContent = mode === 'chat' ? 'Chat segue os limites próprios da sua conta. A conversa do Studio é experimental; confirme o modo se alterá-lo no Web.' : 'O Studio só automatiza envios em Chat. Confira o seletor antes de enviar diretamente no Web; Work/Codex usam sua cota compartilhada.';
  $('useChatMode').hidden = mode === 'chat';
  $('useChatMode').textContent = /\/c\//.test(webSnapshot.url || '') ? 'Nova em Chat' : 'Selecionar Chat';
  $('webModelPicker').textContent = webSnapshot.model || 'Modelo no ChatGPT';
  $('webEffortPicker').textContent = webSnapshot.effort || 'Raciocínio';
  const transport = webSnapshot.transport?.state;
  const label = transport === 'error' ? 'Falha ao carregar · use Recarregar' : transport === 'loading' ? 'Carregando ChatGPT…' : webSnapshot.ready ? (webSnapshot.busy ? (phaseNames[chat()?.activity?.current?.kind] || 'Trabalhando') + ' · sincronização ativa' : 'Conectado · mesma conversa') : 'Faça login na área Web';
  $('webStatus').textContent = label; $('sessionState').textContent = label;
  $('fallbackStatus').textContent = label;
  $('sessionModel').textContent = webSnapshot.ready ? webSnapshot.model || 'Modelo selecionado no Web' : 'Disponível após conectar';
  $('sessionLastSync').textContent = webSnapshot.observedAt ? new Date(webSnapshot.observedAt).toLocaleTimeString('pt-BR') : 'Aguardando a página';
  $('sessionRefresh').disabled = locked();
}
async function loadModels() {
  models = [];
  if (account()?.connected && account()?.planEnabled) { try { models = await host.models(); } catch (error) { notify(error.message); } }
}
async function loadState() {
  validateHost(host);
  const state = await host.state();
  if (!Array.isArray(state?.chats) || !Array.isArray(state?.connection?.accounts)) throw new Error('O host não forneceu uma sessão compatível do Studio.');
  await drafts.init();
  chats = state.chats; connection = state.connection; supportsWebDelete = state.capabilities?.deleteOnWeb === true; webDeletionRecovery = state.capabilities?.deletionRecoveryRequired === true;
  home = state.home === true;
  projects = state.projects || []; activeProjectId = state.activeProjectId ?? chats.find(value => value.id === state.activeId)?.projectId ?? null;
  webSnapshot = state.web || {}; renderSession();
  if (Object.hasOwn(state, 'activeId')) activeId = state.activeId; else activeId = null;
  externalBusy = Boolean(state.web?.busy); lastVersion = state.version ?? -1;
  projectPanel.setContext(project()?.binding || null); await loadModels();
  restoreDraft(); navigation.go(!activeId && activeProjectId ? 'project' : 'conversation', { focus: false }); render(); initialized = true; updateControls();
}
async function newChat() {
  return navigate(async () => {
    saveDraft(); await drafts.flush();
    const sourceKey = draftKey(), carry = !activeId ? { text: $('prompt').value, attachments: [...attachments] } : null;
    const value = await host.createChat(activeProjectId); updateChat(value); selectLocal(value.id);
    home = false; navigation.go('conversation'); $('useProjectContext').checked = true;
    if (carry) { drafts.set(value.id, carry); drafts.set(sourceKey, { text: '', attachments: [] }); restoreDraft(); await drafts.flush(); }
    projectPanel.showConversation(); notify(''); render(); closeSidebar(); $('prompt').focus();
    if (layoutState.studioPreview) await nativeWeb.expand();
    if (carry && (carry.text.trim() || carry.attachments.length)) notify('Rascunho preservado em Studio · beta. Abra essa opção para revisar antes de enviar.');
  });
}
function closeSidebar() { $('sidebar').classList.remove('open'); $('sidebarBackdrop').hidden = true; document.querySelector('.main').inert = false; document.querySelector('.studio-bottom-navigation').inert = false; $('menuButton').setAttribute('aria-expanded', 'false'); }
function connect() {
  if (loginOpening) return;
  navigation.go('conversation');
  loginOpening = true; returnAfterLogin = !account()?.connected;
  $('accountDialog').close(); notify('Abrindo a área de login do ChatGPT…');
  $('welcomeConnect').disabled = true; $('connectAccount').disabled = true;
  run(async () => {
    try {
      const result = await host.connect();
      if (!result.embedded) throw new Error('Este host não oferece a ponte ChatGPT Web.');
      notify('Conclua o login na área Web ampliada. Ao conectar, a conversa volta ao app.');
    } finally { loginOpening = false; $('welcomeConnect').disabled = false; $('connectAccount').disabled = false; }
  });
}
async function openBrowser(login = false) {
  if (browserOpening) return;
  if (!nativeWeb) throw new Error('Abrir no navegador requer os controles Web do Studio fornecidos pelo host.');
  browserOpening = true;
  const buttons = ['welcomeBrowser', 'connectBrowser', 'webBrowser'].map($);
  buttons.forEach(button => { button.disabled = true; });
  try {
    if (login) await nativeWeb.openBrowserLogin(); else await nativeWeb.openBrowser();
    $('accountDialog').close();
    notify('ChatGPT aberto no navegador padrão. O login desse navegador é separado da sessão interna do app.');
  } finally { browserOpening = false; buttons.forEach(button => { button.disabled = false; }); }
}
function renderAttachments() {
  $('attachmentList').replaceChildren();
  attachments.forEach((attachment, index) => {
    const chip = document.createElement('div'); chip.className = 'attachment-chip';
    if (attachment.kind === 'image') { const image = document.createElement('img'); image.src = attachment.data; image.alt = ''; chip.append(image); }
    const name = document.createElement('span'); name.textContent = attachment.name; const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remover ${attachment.name}`);
    remove.disabled = locked(); remove.addEventListener('click', () => { attachments.splice(index, 1); saveDraft(); renderAttachments(); }); chip.append(name, remove); $('attachmentList').append(chip);
  }); updateControls();
}
async function addFiles(files) {
  if (locked()) return;
  for (const file of files) {
    if (attachments.length >= 4) { notify('Use no máximo quatro anexos por mensagem.'); break; }
    if (['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      if (connection.mode === 'chatgpt-web') { notify('Use Arquivos no Web para anexar imagens na sessão ChatGPT.'); await nativeWeb?.attachmentPicker(); continue; }
      if (file.size > 2 * 1024 * 1024) { notify(`${file.name}: use uma imagem de até 2 MB.`); continue; }
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
      attachments.push({ name: file.name.slice(0, 240), kind: 'image', data });
    } else {
      if (!/\.(txt|md|csv|json|js|ts|py|html|css|xml|ya?ml|log)$/i.test(file.name) || file.size > 300000) { notify(`${file.name}: use um arquivo de texto ou código de até 300 KB. Outros formatos: Arquivos no Web.`); continue; }
      const text = await file.text(); if (text.includes('\0')) { notify(`${file.name}: arquivo binário não suportado.`); continue; }
      const attachment = { name: file.name.slice(0, 240), kind: 'text', text };
      try { composeTextMessage({ text: $('prompt').value, attachments: [...attachments, attachment] }); attachments.push(attachment); }
      catch (error) { notify(`${file.name}: ${error.message}`); }
    }
  }
  renderAttachments(); saveDraft(); $('fileInput').value = '';
}
function queueStreamingRender() {
  if (renderScheduled) return; renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    if (!streamingNode) return;
    const follow = $('conversation').scrollHeight - $('conversation').scrollTop - $('conversation').clientHeight < 120;
    streamingNode.content.innerHTML = markdownHTML(streamingNode.message.text);
    if (follow) scrollBottom();
  });
}
async function send(retry = false) {
  if (locked()) return;
  if (!account()?.connected || !account()?.planEnabled) { $('accountDialog').showModal(); return; }
  const model = $('model').value; if (!model) { notify('Selecione um modelo disponível na sua conta.'); return; }
  if (!retry && !$('prompt').value.trim() && !attachments.length) return;
  const message = projectMessage({ project: project(), messages: chat()?.messages, message: { text: $('prompt').value, attachments: [...attachments] }, enabled: $('useProjectContext').checked });
  if (!retry) composeTextMessage(message);
  if (['prepared','submitted','uncertain'].includes(chat()?.delivery?.status)) { notify('Confira o envio sem confirmação na área Web antes de continuar.'); return; }
  let started = false, terminal = false;
  busy = true; notify(''); renderSidebar(); updateControls();
  try {
    attachments = message.attachments; home = false;
    if (!chat()) { const sourceKey = draftKey(); const value = await host.createChat(activeProjectId); updateChat(value); drafts.set(sourceKey, { text: '', attachments: [] }); activeId = value.id; saveDraft(); renderSidebar(); }
    const current = chat();
    saveDraft(); await drafts.flush();
    const draft = drafts.get(current.id);
    for await (const event of host.respond({ chatId: current.id, model, message, retry, ...(host.saveDraft ? { draftKey: current.id, draftRevision: draft.revision } : {}) })) {
      if (event.type === 'chat-meta') {
        const previous = chats.find(c => c.id === event.chat.id);
        updateChat({ ...previous, ...event.chat, messages: previous?.messages || [] });
      } else if (event.type === 'message') {
        const target = chats.find(c => c.id === event.chatId);
        if (target) { const index = target.messages.findIndex(m => m.id === event.message.id); if (index < 0) target.messages.push(event.message); else target.messages[index] = event.message; }
      } else if (event.type === 'start') {
        started = true; if (event.chat) updateChat(event.chat); consumeDraft(chat()?.delivery); $('prompt').value = ''; attachments = []; autosize(); renderAttachments(); renderMessages(); renderSidebar(); scrollBottom();
      } else if (event.type === 'sync') {
        const follow = $('conversation').scrollHeight - $('conversation').scrollTop - $('conversation').clientHeight < 120;
        if (event.chat) updateChat(event.chat); renderMessages(); if (follow) scrollBottom();
      } else if (event.type === 'activity') {
        const target = chats.find(c => c.id === event.chatId);
        if (target) { target.activity = event.activity; const answer = target.messages.find(m => m.id === event.messageId); if (answer) answer.activity = event.activity; }
        renderMessages();
      } else if (event.type === 'progress') {
        $('runLabel').textContent = event.message;
      } else if (event.type === 'delta') {
        const last = chat().messages.at(-1); last.text += event.delta; queueStreamingRender();
      } else if (event.type === 'done' || event.type === 'error') {
        terminal = true; if (event.type === 'done') notify(''); if (event.chat) updateChat(event.chat); renderMessages(); if (event.message) notify(event.message); if ($('jumpLatest').hidden) scrollBottom();
      }
    }
    if (!terminal) throw new Error('A conexão com a interface foi interrompida. Conferindo a mesma resposta no Web…');
  } catch (error) {
    notify(error.message);
    if (!terminal && connection.mode === 'chatgpt-web') recoveringStream = true;
    else if (started) { const last = chat()?.messages.at(-1); if (last?.status === 'streaming') { last.status = 'interrupted'; last.error = error.message; } renderMessages(); }
  } finally { busy = false; lastVersion = -1; await pollWeb(); renderSidebar(); renderMessages(); updateControls(); if (!locked()) $('prompt').focus(); }
}
function exportConversation() {
  const current = chat(); if (!current) return;
  const text = `# ${current.title}\n\n` + current.messages.map(m => `## ${m.role === 'user' ? 'Você' : 'ChatGPT'}${m.status !== 'completed' ? ` (${m.status})` : ''}\n\n${m.text}\n${(m.attachments || []).map(a => `\nAnexo: ${a.name}`).join('')}`).join('\n\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `ordax-${current.id.slice(0, 8)}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('newChat').addEventListener('click', () => run(newChat));
$('openHome').addEventListener('click', () => run(() => navigate(async () => {
  projectPanel.assertContext(null); saveDraft(); await drafts.flush(); applyOrganizationState(await host.openHome()); navigation.go('conversation'); projectPanel.setContext(null); projectPanel.showConversation(); if (layoutState.studioPreview && layoutState.expanded) await nativeWeb.collapse(); render(); closeSidebar();
})));
document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); $('openHome').click(); });
$('homeNewProject').addEventListener('click', () => projectEntry.open('create'));
$('homeWorkspace').addEventListener('click', () => projectEntry.open('open'));
$('useProjectContext').addEventListener('change', updateControls);
const projectTask = fn => run(async () => { try { await fn(); } catch (error) { $('conversationProjectDialogStatus').textContent = error.message; throw error; } });
$('createConversationProject').addEventListener('click', () => openProjectOptions());
$('conversationProjectOptions').addEventListener('click', () => openProjectOptions(activeProjectId));
$('saveConversationProject').addEventListener('click', () => projectTask(() => navigate(async () => {
  const name = $('conversationProjectName').value.trim();
  const previewUrl = $('conversationProjectPreviewUrl').value.trim() || null;
  const instructions = $('conversationProjectInstructions').value;
  if (editingProjectId) {
    const value = await host.renameProject(editingProjectId, name, previewUrl, instructions);
    projects = projects.map(item => item.id === value.id ? value : item);
  } else throw new Error('Use Criar projeto para criar o projeto e sua pasta no computador conectado.');
  lastVersion = -1; $('conversationProjectDialog').close(); closeSidebar(); notify(''); render();
})));
$('conversationProjectName').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('saveConversationProject').click(); } });
$('removeConversationProject').addEventListener('click', () => projectTask(async () => {
  if ($('removeConversationProject').textContent !== 'Confirmar remoção do projeto') { $('removeConversationProject').textContent = 'Confirmar remoção do projeto'; $('conversationProjectDialogStatus').textContent = 'As conversas e seus rascunhos serão mantidos em Sem projeto. Nenhuma conversa será excluída no ChatGPT.'; return; }
  await navigate(async () => {
    projectPanel.assertContext(null); saveDraft(); await drafts.flush();
    await host.removeProject(editingProjectId);
    projects = projects.filter(item => item.id !== editingProjectId);
    for (const item of chats) if (item.projectId === editingProjectId) item.projectId = null;
    if (activeProjectId === editingProjectId) { activeProjectId = null; if (!activeId) restoreDraft(); }
    projectPanel.setContext(null); lastVersion = -1; $('conversationProjectDialog').close(); notify('Projeto removido. As conversas foram mantidas em Sem projeto.'); render();
  });
}));
$('menuButton').addEventListener('click', () => {
  const open = $('sidebar').classList.toggle('open'); $('menuButton').setAttribute('aria-expanded', String(open)); $('sidebarBackdrop').hidden = !open;
  document.querySelector('.main').inert = open; document.querySelector('.studio-bottom-navigation').inert = open;
  if (open) $('sidebar').querySelector('button:not(:disabled)')?.focus();
});
$('conversation').addEventListener('click', closeSidebar);
$('conversation').addEventListener('scroll', updateJump, { passive: true }); $('jumpLatest').addEventListener('click', scrollBottom);
$('messages').addEventListener('click', e => {
  const link = e.target.closest('a[href]');
  if (link && nativeWeb) { e.preventDefault(); run(() => nativeWeb.openLink(link.href)); }
  const copy = e.target.closest('[data-copy-code]');
  if (copy) run(async () => { await navigator.clipboard.writeText(copy.closest('.code-block').querySelector('code').textContent); copy.textContent = 'Copiado'; });
  const proposal = e.target.closest('[data-project-code]');
  if (proposal) run(() => projectPanel.propose(proposal.closest('.code-block').querySelector('code').textContent));
});
$('accountButton').addEventListener('click', () => { renderConnection(); $('accountDialog').showModal(); });
$('welcomeConnect').addEventListener('click', () => connect()); $('connectAccount').addEventListener('click', () => connect());
$('welcomeBrowser').addEventListener('click', () => run(() => openBrowser(true))); $('connectBrowser').addEventListener('click', () => run(() => openBrowser(true)));
$('disconnect').addEventListener('click', () => connect());
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => $(button.dataset.close).close());
for (const dialog of document.querySelectorAll('dialog:not(#projectDialog)')) dialog.addEventListener('click', e => { if (e.target === dialog) { const rect = dialog.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) dialog.close(); } });
for (const suggestion of document.querySelectorAll('[data-prompt]')) suggestion.addEventListener('click', () => { $('prompt').value = suggestion.dataset.prompt; saveDraft(); autosize(); updateControls(); $('prompt').focus(); });
$('prompt').addEventListener('input', () => { saveDraft(); autosize(); updateControls(); });
$('prompt').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); run(() => send()); } });
$('composer').addEventListener('submit', e => { e.preventDefault(); run(() => send()); });
$('stop').addEventListener('click', () => run(() => host.stop(activeId)));
$('attach').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', () => run(() => addFiles($('fileInput').files)));
$('composer').addEventListener('dragover', e => e.preventDefault());
$('composer').addEventListener('drop', e => { e.preventDefault(); run(() => addFiles(e.dataTransfer.files)); });
$('prompt').addEventListener('paste', e => { if (e.clipboardData.files.length) { e.preventDefault(); run(() => addFiles(e.clipboardData.files)); } });
$('model').addEventListener('change', updateControls);
$('chooseModel').addEventListener('click', () => run(() => nativeWeb?.modelPicker()));
$('webModelPicker').addEventListener('click', () => run(() => nativeWeb?.modelPicker()));
$('webEffortPicker').addEventListener('click', () => run(() => nativeWeb?.effortPicker()));
$('useChatMode').addEventListener('click', () => run(() => /\/c\//.test(webSnapshot.url || '') ? newChat() : nativeWeb?.chatMode()));
$('webAttach').addEventListener('click', () => run(() => nativeWeb?.attachmentPicker()));
$('reviewOpen').addEventListener('click', () => run(() => nativeWeb?.expand()));
$('reviewConfirm').addEventListener('click', () => run(async () => { updateChat(await host.reviewDelivery(activeId)); notify('Revisão registrada. Escreva a próxima mensagem quando estiver pronto.'); render(); }));
$('exportChat').addEventListener('click', exportConversation);
function showChatOptions(id = activeId) {
  const value = chats.find(c => c.id === id); if (locked() || !value) return; optionsChatId = id; $('deleteScope').value = 'local'; $('deleteScope').querySelector('[value=web]').disabled = !supportsWebDelete || !value.webId; $('deleteHelp').textContent = webDeletionRecovery ? 'O registro de exclusões precisa ser recuperado. A exclusão no ChatGPT está bloqueada; somente o histórico deste dispositivo pode ser removido.' : 'A exclusão local preserva a conversa na conta ChatGPT.'; $('deleteStatus').textContent = ''; $('deleteChat').dataset.confirm = ''; $('deleteChat').textContent = 'Excluir conversa';
  $('chatProjectDestination').replaceChildren(new Option('Sem projeto', ''));
  for (const value of projects) $('chatProjectDestination').append(new Option(value.name, value.id));
  $('deleteOpenWeb').disabled = !nativeWeb || !value.webId;
  $('rename').value = value.title; $('chatProjectDestination').value = value.projectId || ''; $('optionsDialog').showModal();
}
$('chatOptions').addEventListener('click', () => showChatOptions());
$('deleteScope').addEventListener('change', () => { $('deleteChat').dataset.confirm = ''; $('deleteChat').textContent = 'Excluir conversa'; $('deleteHelp').textContent = $('deleteScope').value === 'web' ? 'A conversa também será excluída da conta ChatGPT. Esta ação não pode ser desfeita.' : 'A exclusão local preserva a conversa na conta ChatGPT.'; });
$('deleteOpenWeb').addEventListener('click', () => { $('optionsDialog').close(); run(() => navigate(async () => { saveDraft(); await drafts.flush(); if (optionsChatId !== activeId) { await host.selectChat(optionsChatId); selectLocal(optionsChatId); render(); } await nativeWeb?.expand(); })); });
$('moveConversationProject').addEventListener('click', () => run(() => navigate(async () => {
  const id = $('chatProjectDestination').value || null;
  const binding = projects.find(value => value.id === id)?.binding || null;
  const isActive = optionsChatId === activeId; if (isActive) projectPanel.assertContext(binding); saveDraft(); await drafts.flush();
  const value = await host.moveChat(optionsChatId, id); updateChat(value); if (isActive) { activeProjectId = id; projectPanel.setContext(binding); } lastVersion = -1; $('optionsDialog').close(); render();
})));
$('saveTitle').addEventListener('click', () => run(() => navigate(async () => { updateChat(await host.renameChat(optionsChatId, $('rename').value)); $('optionsDialog').close(); render(); })));
$('deleteChat').addEventListener('click', () => run(async () => {
  if (locked() || !chats.some(c => c.id === optionsChatId)) return;
  const id = optionsChatId, scope = $('deleteScope').value, receipt = id + ':' + scope;
  if ($('deleteChat').dataset.confirm !== receipt) { $('deleteChat').dataset.confirm = receipt; $('deleteChat').textContent = scope === 'web' ? 'Confirmar exclusão no Studio e ChatGPT' : 'Confirmar exclusão neste dispositivo'; return; }
  deleting = true; updateControls(); renderSidebar(); $('deleteChat').disabled = true; $('deleteScope').disabled = true;
  try {
    saveDraft(); await drafts.flush(); await host.deleteChat(id, scope);
    drafts.delete(id); chats = chats.filter(c => c.id !== id);
    if (activeId === id) { audioPanel.stopReading(); activeId = null; $('prompt').value = ''; attachments = []; restoreDraft(); }
    else if (scope === 'web') selectLocal(null);
    $('optionsDialog').close(); lastVersion = -1; render();
  } catch (error) { $('deleteStatus').textContent = error.message; notify(error.message); }
  finally { deleting = false; $('deleteChat').disabled = false; $('deleteScope').disabled = false; updateControls(); renderSidebar(); }
}));

document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); run(newChat); } });
async function toggleWeb() {
  if (!nativeWeb) return;
  if (navigation.current() !== 'conversation') { projectPanel.showConversation(); navigation.go('conversation'); await nativeWeb.expand(); return; }
  if (layoutState.studioPreview) { if (layoutState.expanded) await nativeWeb.collapse(); else await nativeWeb.expand(); }
  else await nativeWeb.setPresentation({ mode: layoutState.mode === 'conversation' ? 'split' : 'conversation', ratio: layoutState.ratio });
}
$('webToggle').addEventListener('click', () => run(toggleWeb));
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); run(toggleWeb); } });
$('integrationInfo').addEventListener('click', () => { renderSession(); $('integrationDialog').showModal(); });
$('exportDiagnostics').addEventListener('click', () => run(async () => {
  const value = await host.diagnostics();
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'ordax-assistant-diagnostico.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}));
$('sessionLogin').addEventListener('click', () => { $('integrationDialog').close(); connect(); });
$('sessionRefresh').addEventListener('click', () => run(() => nativeWeb?.reload()));
$('splitRatio').addEventListener('input', () => { $('splitValue').textContent = $('splitRatio').value + '%'; });
$('splitRatio').addEventListener('change', () => run(() => nativeWeb?.setPresentation({ mode: layoutState.mode === 'conversation' ? 'conversation' : 'split', ratio: Number($('splitRatio').value) / 100 })));
async function pollWeb() {
  if (!initialized || pollRunning) return; pollRunning = true;
  try {
    const state = await host.state(lastVersion);
    if (state.connection.mode !== 'chatgpt-web') return;
    connection = state.connection;
    webSnapshot = state.web || {};
    if (!busy && !navigationPending && !deleting) {
      const follow = $('conversation').scrollHeight - $('conversation').scrollTop - $('conversation').clientHeight < 120;
      const changed = lastVersion !== state.version || activeId !== state.activeId;
      if (state.chats) chats = state.chats;
      if (state.projects) projects = state.projects;
      for (const value of chats) if (value.delivery?.userId) consumeDraft(value.delivery);
      const scopeChanged = activeProjectId !== (state.activeProjectId ?? null);
      if (scopeChanged) {
        const binding = projects.find(value => value.id === state.activeProjectId)?.binding || null;
        try { projectPanel.assertContext(binding); projectPanel.setContext(binding); contextBlocked = false; }
        catch (error) { contextBlocked = true; updateControls(); renderSidebar(); throw error; }
      }
      if (state.home !== undefined) home = state.home === true;
      selectLocal(state.activeId, state.activeProjectId ?? null); externalBusy = Boolean(state.web?.busy); lastVersion = state.version;
      if (changed) { renderSidebar(); renderMessages(); if (follow) scrollBottom(); }
    }
    models = await host.models(); renderConnection(); renderModelPicker(); updateControls();
    if (returnAfterLogin && state.web?.ready) { returnAfterLogin = false; await nativeWeb?.collapse(); notify('ChatGPT conectado. Você já pode conversar.'); }
    if (state.web?.issue && state.web.issue !== lastIssue) notify(state.web.issue);
    lastIssue = state.web?.issue || '';
    if (recoveringStream && state.web?.ready && !state.web?.busy) {
      recoveringStream = false;
      if (!lastIssue && chat()?.delivery?.status === 'completed') notify('Sincronização recuperada. A resposta foi concluída no Web.');
    }
    renderRunStatus(); renderSession(); pluginPanel.render();
  } catch (error) { notify(error.message); } finally { pollRunning = false; }
}
const previewPanel = createPreviewPanel({ nativePreview: window.ordaxStudioPreviewHost, nativeWeb, project, configure: openProjectOptions, openProjects: () => navigation.go('projects'), notify });
navigation = createNavigation({
  state: () => ({ chats, projects, activeId, projectId: activeProjectId, disabled: locked() || !initialized, previewAvailable: Boolean(window.ordaxStudioPreviewHost) }),
  openChat: id => run(() => openConversation(id)), openProject: id => run(() => selectProjectScope(id)),
  newChat: () => run(newChat), options: showChatOptions,
  changed: () => { showConversationView(); closeSidebar(); previewPanel.geometry(); },
});
for (const button of document.querySelectorAll('button[data-studio-page]')) button.addEventListener('click', () => {
  if (locked() || !initialized) return;
  try { projectPanel.assertContext(project()?.binding || null); projectPanel.showConversation(); navigation.go(button.dataset.studioPage); }
  catch (error) { notify(error.message); }
});
$('contextSelect').addEventListener('click', () => navigation.go('projects'));
$('projectsBack').addEventListener('click', () => navigation.go('projects'));
$('projectResources').addEventListener('click', () => $('openProject').click());
$('projectPreview').addEventListener('click', showProjectPreview);
$('showPreview').addEventListener('click', showProjectPreview);
$('showConversation').addEventListener('click', showConversationView);
$('sidebarBackdrop').addEventListener('click', closeSidebar);
$('studioTools').addEventListener('click', event => { if (event.target.closest('button')) $('studioTools').open = false; });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && $('sidebar').classList.contains('open')) { closeSidebar(); $('menuButton').focus(); } });
document.addEventListener('keydown', event => {
  if (event.key !== 'Tab' || !$('sidebar').classList.contains('open') || document.querySelector('dialog[open]')) return;
  const items = [...$('sidebar').querySelectorAll('a[href],button:not(:disabled)')].filter(item => item.getClientRects().length);
  const first = items[0], last = items.at(-1);
  if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
});
window.addEventListener('resize', () => { if (getComputedStyle($('menuButton')).display === 'none') closeSidebar(); });
const webTimer = setInterval(pollWeb, 900);
if (nativeWeb) {
  let layoutAudioRevision = -1;
  nativeWeb.onPrepareClose?.(async () => { if (!projectPanel.canClose()) throw new Error('Edição pendente.'); saveDraft(); await drafts.flush(); });
  const applyLayout = ({ expanded, mode = 'split', ratio = 0.6, pluginSetup = false, studioPreview = false, audioSession, audioRevision }) => {
    if (Number.isSafeInteger(audioRevision)) {
      if (audioRevision < layoutAudioRevision) return;
      layoutAudioRevision = audioRevision;
    }
    layoutState = { mode, ratio, expanded, studioPreview }; document.body.classList.toggle('web-expanded', expanded); document.body.classList.toggle('conversation-only', mode === 'conversation');
    document.body.style.setProperty('--assistant-width', mode === 'conversation' ? '100vw' : `${ratio * 100}vw`);
    $('webClose').hidden = !expanded; $('webFocus').hidden = expanded;
    $('webToggle').hidden = studioPreview && expanded;
    $('webReturnChat').hidden = !pluginSetup;
    $('webTag').textContent = pluginSetup ? 'CADASTRO DO PLUGIN' : 'MESMA CONVERSA';
    document.querySelector('.conversation-heading .eyebrow').textContent = studioPreview ? expanded ? 'CHATGPT WEB' : 'STUDIO · BETA' : 'ORDAX STUDIO';
    const label = studioPreview ? expanded ? 'Abrir conversa experimental do Studio' : 'Abrir ChatGPT Web na conversa' : mode === 'conversation' ? 'Mostrar área Web' : 'Ocultar área Web';
    $('webToggle').textContent = studioPreview ? expanded ? 'Studio · beta' : 'GPT Web' : '▥';
    $('webToggle').classList.toggle('composer-web-control', studioPreview);
    $('webToggle').title = label; $('webToggle').setAttribute('aria-label', label); $('webToggle').setAttribute('aria-pressed', String(studioPreview ? expanded : mode === 'conversation'));
    previewPanel.layout({ expanded, mode, ratio, pluginSetup, studioPreview });
    if (audioSession !== undefined) audioPanel?.sync(audioSession, audioRevision);
    renderSession();
    $('splitRatio').value = ratio * 100; $('splitValue').textContent = Math.round(ratio * 100) + '%';
  };
  nativeWeb.onLayout(applyLayout); run(async () => applyLayout(await nativeWeb.getLayout()));
  nativeWeb.onStatus(({ state, detail }) => { webSnapshot.transport = { state, detail }; renderSession(); if (state === 'error') notify(detail); });
  $('webReload').addEventListener('click', () => run(() => nativeWeb.reload()));
  $('webFocus').addEventListener('click', () => run(() => nativeWeb.expand()));
  $('webClose').addEventListener('click', () => run(() => nativeWeb.collapse()));
  $('webReturnChat').addEventListener('click', () => run(() => nativeWeb.pluginReturn()));
  $('webBrowser').addEventListener('click', () => run(() => openBrowser()));
}
audioPanel = createAudioPanel({ host, nativeWeb, snapshot: () => webSnapshot, current: () => activeId, ensureChat: async () => { if (!chat()) await newChat(); }, draft: async () => { saveDraft(); await drafts.flush(); return drafts.get(draftKey()); }, saveText: async text => { $('prompt').value = text; autosize(); saveDraft(); await drafts.flush(); updateControls(); return drafts.get(draftKey()); }, notify, locked, changed: () => { updateControls(); renderSidebar(); } });
const activityTimer = setInterval(() => { tickActivityClocks(); renderRunStatus(); }, 1000);
const projectPanel = createProjectPanel({ host, notify, onProjectConversations: openWorkspaceConversations, attach: async attachment => {
  if (locked()) throw new Error('Aguarde a resposta antes de adicionar contexto.');
  composeTextMessage({ text: $('prompt').value, attachments: [...attachments, attachment] });
  attachments.push(attachment); saveDraft(); await drafts.flush(); renderAttachments();
} });
const pluginPanel = createPluginPanel({ nativeWeb, notify, snapshot: () => webSnapshot, showConversation: () => { projectPanel.showConversation(); navigation.go('conversation'); }, preparePrompt: text => {
  if (locked()) throw new Error('Aguarde a resposta antes de preparar o teste.');
  if ($('prompt').value.trim() || attachments.length) throw new Error('Guarde ou envie seu rascunho antes de preparar o teste de conexão.');
  $('prompt').value = text; saveDraft(); autosize(); updateControls(); $('prompt').focus();
} });
const projectEntry = createProjectEntry({ host, enter: openWorkspaceConversations, notify, assertCanEnter: () => {
  if (locked()) throw new Error('Aguarde a operação da conversa antes de abrir outro projeto.');
  projectPanel.assertContext(null);
} });
window.addEventListener('beforeunload', () => { clearInterval(activityTimer); clearInterval(webTimer); audioPanel.dispose(); });
const startup = createStartup({ load: loadState, changed: ({ state, message }) => {
  $('hostAvailability').hidden = state === 'ready';
  $('hostAvailability').dataset.state = state;
  $('hostAvailabilityTitle').textContent = state === 'loading' ? 'Conectando ao Studio…' : 'Studio sem conexão com o host';
  $('hostAvailabilityMessage').textContent = message || 'Conferindo a sessão e os rascunhos antes de abrir suas conversas.';
  $('hostRetry').disabled = state !== 'unavailable';
  for (const id of ['welcomeConnect','connectAccount','accountButton','welcomeBrowser','connectBrowser','openProject','openActivity','openContext','homeWorkspace','chatOptions','exportDiagnostics']) $(id).disabled = state !== 'ready';
  updateControls();
} });
$('hostRetry').addEventListener('click', () => startup.start());
startup.start();
