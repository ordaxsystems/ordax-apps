import { renderLiveStage } from './ui-stage.mjs';
import { providerComposeAvailability, COMPOSE_STATUS_MESSAGES } from '../src/provider-compose-availability.mjs';
import { taskNavigationStatus } from '../src/task-navigation-status.mjs';
import { SUPERVISOR_ROLES, supervisorRole } from '../src/supervisor-role-presets.mjs';
import { mountOrchestratorUi } from './orchestrator-ui.mjs';
const $ = selector => document.querySelector(selector);
let currentTaskId = null;
let currentTask = null;
let workspace = null;
let directMode = false;

// Reflect the acknowledged Electron view, never inferred ChatGPT DOM state.
async function setDirectModeVisible(visible) {
  await window.ordax.setChatVisible(visible);
  directMode = visible;
  document.documentElement.dataset.ordaxView = visible ? 'provider' : 'app';
  $('#directMode').textContent = visible ? 'Voltar' : 'Modo direto';
}
let observerMode = 'auto';
let allTasks = [];
let scopedTaskIds = null;
let orchestrationUi = null;
let providerRefreshPending = false;
let composeAvailability = { allowed:false, reason:'unverified' };
function syncComposerAvailability() {
  // Editor stays enabled: local draft text is NOT a ChatGPT submission.
  const allowed = composeAvailability.allowed===true && Boolean(currentTaskId) && !submittingTaskId;
  $('#send').disabled = !allowed;
  $('#send').title = allowed ? 'Enviar ao ChatGPT' :
    (COMPOSE_STATUS_MESSAGES[composeAvailability.reason] || COMPOSE_STATUS_MESSAGES.unverified);
  $('#composer').dataset.sendReady = allowed ? 'true' : 'false';
  $('#composerConnection').dataset.state = composeAvailability.reason;
  $('#composerConnectionText').textContent =
    COMPOSE_STATUS_MESSAGES[composeAvailability.reason] || COMPOSE_STATUS_MESSAGES.unverified;
  $('#composerLogin').hidden = composeAvailability.reason==='ready' || composeAvailability.reason==='busy';
}
let navigationEpoch = 0;
let submittingTaskId = null;
const draftCache = new Map();
let draftTimer = null;
let pendingDraft = null;
let historyEpoch = 0;
let historyCursors = [null];
let historyPageIndex = 0;
let historyLoading = false;

function flushDraft() {
  clearTimeout(draftTimer);
  draftTimer = null;
  if (!pendingDraft) return;
  const { taskId, content, revision } = pendingDraft;
  pendingDraft = null;
  void window.ordax.setDraft(taskId, content, revision).then(() => {
    if (currentTaskId === taskId && draftCache.get(taskId)?.revision === revision) {
      $('#draftState').textContent = content ? 'Rascunho local • salvo' : '';
    }
  }).catch(error => {
    if (currentTaskId === taskId && draftCache.get(taskId)?.revision === revision) {
      $('#draftState').textContent = `Rascunho não salvo: ${friendlyError(error)}`;
    }
  });
}

function stageDraft() {
  if (!currentTaskId) return;
  const taskId = currentTaskId;
  const previous = draftCache.get(taskId);
  const revision = Math.max(previous?.revision || 0, Number(currentTask?.draft_revision || 0)) + 1;
  const content = $('#prompt').value;
  draftCache.set(taskId, { content, revision });
  pendingDraft = { taskId, content, revision };
  $('#draftState').textContent = content ? 'Rascunho local • salvando…' : '';
  clearTimeout(draftTimer);
  draftTimer = setTimeout(flushDraft, 300);
}

function showDraft(task) {
  const cached = draftCache.get(task.id);
  const revision = Number(task.draft_revision || 0);
  const entry = cached && cached.revision >= revision ? cached : { content: task.draft || '', revision };
  draftCache.set(task.id, entry);
  $('#prompt').value = entry.content;
  $('#prompt').dispatchEvent(new Event('draft-restored'));
  $('#draftState').textContent = entry.content ? 'Rascunho local • preservado nesta conversa' : '';
}

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function compactDate(value) {
  if (!value) return '';
  try { return new Date(value).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); }
  catch { return ''; }
}

function plural(value, singular, pluralText) {
  return `${value} ${value === 1 ? singular : pluralText}`;
}

function assetHtml(asset) {
  if (asset.kind !== 'image' || !asset.url) return '';
  return `<figure class="asset"><img src="${esc(asset.url)}" alt="${esc(asset.alt || 'Imagem')}" /><figcaption>${esc(asset.alt || '')}</figcaption></figure>`;
}

function messageHtml(message) {
  const role = message.role === 'user' ? 'Você' : 'ChatGPT';
  return `<article class="message ${esc(message.role)}">
    <div class="message-body">
      <div class="message-role">${role}</div>
      ${message.content ? `<div class="message-content">${esc(message.content)}</div>` : ''}
      ${(message.assets || []).map(assetHtml).join('')}
    </div>
  </article>`;
}

function appendLiveRun(runId, userMessage) {
  const box = $('#messages');
  // Temporary messages belong to the same replaceable page as the durable history.
  // Appending to #messages would leave orphan live nodes after renderHistory().
  $('#messageList').insertAdjacentHTML('beforeend', messageHtml({ role:'user', content:userMessage.content, assets:[] }) +
    `<article class="message assistant live" id="live-${esc(runId)}"><div class="message-body"><div class="message-role">ChatGPT</div><div class="message-content live-content">Preparando…</div></div></article>`);
  box.scrollTop = box.scrollHeight;
}

function updateLiveStage(payload) {
  renderLiveStage(payload, { getNode:id=>document.getElementById(id), statusElement:$('#runStatus') });
}

function updateLiveRun(payload) {
  const node = document.getElementById(`live-${payload.runId}`);
  if (!node) return;
  const content = node.querySelector('.live-content');
  if (payload.text) node.dataset.streamStarted = 'true';
  content.textContent = payload.text || (payload.generating ? 'Gerando…' : 'Processando…');
  node.classList.toggle('streaming', Boolean(payload.generating));
  const base = payload.submitAttemptAt || payload.submittedAt || payload.runStartedAt;
  const activity = payload.firstActivityAt && base ? Math.max(0, payload.firstActivityAt - base) : null;
  const ttft = payload.firstDeltaAt && base ? Math.max(0, payload.firstDeltaAt - base) : null;
  const source = payload.source === 'fast' ? 'Fast' : 'Beta';
  $('#runStatus').textContent = ttft != null
    ? `Respondendo • ${source} • primeiro texto em ${ttft} ms`
    : activity != null
      ? `ChatGPT ativo em ${activity} ms • ${source} aguardando texto…`
      : `Respondendo • ${source}`;
  $('#runStatus').classList.remove('hidden');
  $('#messages').scrollTop = $('#messages').scrollHeight;
}

function friendlyError(error) {
  const raw = String(error?.message || error || 'Erro desconhecido');
  const lastSegment = raw.split(':').at(-1)?.trim() || '';
  const code = /^[a-z][a-z0-9_]*$/i.test(lastSegment) ? lastSegment : (raw.match(/Error: ([a-z0-9_]+)/i)?.[1] || raw);
  const messages = {
    chatgpt_draft_present: 'Esta conversa já existente tem um rascunho no ChatGPT. Preserve ou apague o texto antes de continuar; ao criar uma nova conversa, o worker prepara um campo vazio.',
    new_chat_composer_unavailable: 'A nova conversa abriu, mas o campo de mensagem do ChatGPT não ficou pronto.',
    new_chat_composer_focus_failed: 'Não foi possível selecionar o editor da nova conversa do ChatGPT.',
    new_chat_composer_clear_failed: 'O ChatGPT recusou a limpeza do rascunho antigo na nova conversa. Nada foi enviado.',
    new_chat_composer_not_empty: 'O campo do ChatGPT não ficou vazio após criar a nova conversa. Nada foi enviado; verifique a página oficial.',
    chatgpt_verification_required: 'O ChatGPT exige uma verificação oficial. Conclua-a no modo direto e tente novamente.',
    chatgpt_login_required: 'Entre na sua conta do ChatGPT neste Lab para continuar.',
    chatgpt_conversation_load_failed: 'A conversa do ChatGPT não carregou. Rascunho e histórico local preservados; nenhum envio ou recarga automática.',
    chatgpt_session_not_observed: 'Não foi possível observar a sessão autenticada. Conclua o login no modo direto antes de enviar.',
    chatgpt_provider_backend_access_restricted: 'O ChatGPT retornou HTTP 403 nas chamadas internas desta página. Nenhum envio foi feito; verifique o acesso pelo serviço oficial.',
    chatgpt_provider_rate_limited_observed: 'O ChatGPT apresentou ao menos uma resposta HTTP 429 nas requisições internas desta página. Não é confirmação da causa da falha. Nenhum reenvio ou nova tentativa automática.',
    task_submission_reconciliation_required: 'Envio anterior com entrega incerta. Verifique a conversa antes de enviar novamente nesta tarefa.',
    chatgpt_authentication_in_progress: 'Conclua o login antes de enviar.',
    composer_not_found: 'O campo de mensagem do ChatGPT ainda não está pronto.',
    send_not_observed: 'O ChatGPT não confirmou o envio. Nada foi reenviado automaticamente.',
    send_confirmation_unknown: 'O campo do ChatGPT foi esvaziado, mas o envio não pôde ser confirmado. Confira a conversa no ChatGPT antes de tentar novamente; não houve reenvio automático.',
    send_control_unavailable: 'Não foi possível localizar um botão de envio utilizável no ChatGPT. Confira o estado da sessão oficial.',
    response_not_observed: 'O envio ocorreu, mas a resposta não pôde ser confirmada. A memória da tarefa foi preservada.',
    google_login_button_not_found: 'O botão de login do Google não ficou disponível.',
    google_login_navigation_not_observed: 'O fluxo do Google não confirmou a navegação.',
    invalid_project_memory_category: 'Escolha uma categoria válida para a memória.',
    project_memory_key_required: 'Dê um nome ou chave para este item de memória.',
    project_memory_content_required: 'Descreva o conteúdo que deve permanecer canônico.',
    project_memory_key_conflict: 'Já existe outro item com essa categoria e chave.',
    project_memory_too_large: 'Este item de memória excede o limite permitido.',
    project_memory_candidate_not_found: 'Esta sugestão não foi encontrada.',
    project_memory_candidate_reviewed: 'Esta sugestão já foi revisada.',
    invalid_project_memory_review: 'Ação de revisão inválida.',
    project_memory_conflict_requires_review: 'A memória aprovada mudou ou exige comparação. Revise os dois valores antes de confirmar.',
    invalid_task_title: 'Informe um nome válido de até 140 caracteres para o projeto.',
    task_draft_too_large: 'O rascunho excede 20 mil caracteres.'
  };
  return messages[code] || raw.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function statusLabel(status) {
  return ({ ready:'Pronta', running:'Executando', error:'Erro', interrupted:'Interrompida', succeeded:'Concluída' })[status] || status;
}

const memoryCategoryLabels = {
  entity:'Entidade', structure:'Estrutura', fact:'Fato', decision:'Decisão',
  constraint:'Restrição', goal:'Objetivo', open_loop:'Pendência', reference:'Referência'
};

function setMemoryEditor(open, item = null) {
  const editor = $('#memoryEditor');
  $('#memoryConflictReview').classList.add('hidden');
  $('#memoryConfirmReplace').checked = false;
  const add = $('#addMemoryItem');
  editor.classList.toggle('hidden', !open);
  add?.setAttribute('aria-expanded', String(Boolean(open)));
  if (!open) {
    editor.reset();
    delete editor.dataset.memoryId;
    delete editor.dataset.candidateId;
    return;
  }
  if (item) {
    if (item.id) editor.dataset.memoryId = item.id;
    else delete editor.dataset.memoryId;
    $('#memoryCategory').value = item.category;
    $('#memoryKey').value = item.key;
    $('#memoryContent').value = item.content;
  } else {
    editor.reset();
    delete editor.dataset.memoryId;
  }
  delete editor.dataset.candidateId;
  $('#memoryKey').focus();
}

function syncMemoryConflictReview() {
  const editor = $('#memoryEditor');
  const box = $('#memoryConflictReview');
  const candidateId = editor.dataset.candidateId;
  const category = $('#memoryCategory').value;
  const key = $('#memoryKey').value.trim().toLocaleLowerCase('pt-BR');
  const proposed = $('#memoryContent').value.trim();
  const canon = candidateId ? (currentTask?.project_memory?.items || []).find(item =>
    item.category === category && item.key.toLocaleLowerCase('pt-BR') === key) : null;
  const conflict = Boolean(canon && canon.content.trim() !== proposed);
  box.classList.toggle('hidden', !conflict);
  $('#memoryConfirmReplace').checked = false;
  if (conflict) {
    $('#memoryCanonicalBefore').textContent = canon.content;
    $('#memoryCanonicalAfter').textContent = proposed;
  }
  return canon && conflict ? canon : null;
}

function renderMemoryCandidates(task) {
  const candidates = task.project_memory?.candidates || [];
  $('#memoryCandidateCount').textContent = String(task.project_memory?.pending_count || candidates.length);
  $('#memoryCandidates').innerHTML = candidates.length ? candidates.map(item =>
    '<article class="memory-candidate" data-candidate-id="' + esc(item.id) + '">' +
      '<div class="memory-item-top"><span class="memory-kind">' + esc(memoryCategoryLabels[item.category] || item.category) + '</span>' +
      '<strong>' + esc(item.key) + '</strong></div>' +
      '<p>' + esc(item.content) + '</p>' +
      (item.conflict ? '<div class="memory-conflict-alert"><strong>⚠ Diverge da memória aprovada</strong><p>Atual: ' + esc(item.canonical_content) + '</p><p>Proposto: ' + esc(item.content) + '</p></div>' : '') +
      '<small>Origem: mensagem da conversa · ' + esc(item.evidence) + '</small>' +
      '<div class="memory-review-actions">' +
        (item.conflict ? '<button class="mini-primary" type="button" data-review="edit">Revisar conflito</button>' : '<button class="mini-primary" type="button" data-review="accept">Aprovar</button>') +
        '<button class="mini-secondary" type="button" data-review="edit">Editar</button>' +
        '<button class="mini-secondary" type="button" data-review="reject">Descartar</button>' +
      '</div></article>'
  ).join('') : '<div class="context-empty">Nenhuma sugestão pendente. Só itens aprovados entram no cânone.</div>';

  document.querySelectorAll('.memory-candidate [data-review]').forEach(button => button.addEventListener('click', async () => {
    const card = button.closest('[data-candidate-id]');
    const item = candidates.find(row => row.id === card?.dataset.candidateId);
    if (!item) return;
    if (button.dataset.review === 'edit') {
      setMemoryEditor(true, { category:item.category, key:item.key, content:item.content });
      $('#memoryEditor').dataset.candidateId = item.id;
      syncMemoryConflictReview();
      $('#memoryContent').focus();
      return;
    }
    const taskId = currentTaskId;
    card.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      const updated = await window.ordax.reviewMemoryCandidate(taskId, item.id, button.dataset.review);
      if (currentTaskId === taskId) {
        renderContext(acceptTaskRefresh(updated));
        await loadTasks();
      }
    } catch (error) {
      $('#providerDetail').textContent = friendlyError(error);
      card.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
  }));
}

function renderTaskList() {
  const query = ($('#taskSearch')?.value || '').trim().toLocaleLowerCase('pt-BR');
  const scoped = scopedTaskIds ? allTasks.filter(task=>scopedTaskIds.has(task.id)) : allTasks.filter(task=>!task.lab_binding);
  const tasks = query ? scoped.filter(task => String(task.title || '').toLocaleLowerCase('pt-BR').includes(query)) : scoped;
  $('#taskCount').textContent = String(scoped.length);
  $('#tasks').innerHTML = tasks.map(task => `
    <button class="task ${task.id === currentTaskId ? 'active' : ''}" data-id="${esc(task.id)}">
      <strong>${esc(task.title)}</strong>
      <span class="task-sub"><span>${esc(statusLabel(task.status))}</span><span>Projeto persistente</span></span>
    </button>`).join('');
  document.querySelectorAll('.task').forEach(button => button.addEventListener('click', () => openTask(button.dataset.id)));
}

async function loadTasks() {
  allTasks = await window.ordax.listTasks();
  renderTaskList();
}

function acceptTaskRefresh(updated) {
  // A memory/title refresh must not silently jump away from an older history page.
  if (historyPageIndex > 0 && currentTask?.id === updated?.id) {
    currentTask = { ...updated, messages:currentTask.messages, message_page:currentTask.message_page };
  } else {
    currentTask = updated;
  }
  return currentTask;
}

function updateHistoryNav() {
  const page = currentTask?.message_page;
  const hasOlder = Boolean(page?.has_more);
  const hasNewer = historyPageIndex > 0;
  $('#messageHistoryNav').classList.toggle('hidden', !hasOlder && !hasNewer);
  $('#olderMessages').disabled = historyLoading || !hasOlder;
  $('#newerMessages').disabled = historyLoading || !hasNewer;
  const total = Number(currentTask?.continuation?.total_messages ?? currentTask?.messages?.length ?? 0);
  $('#historyPageStatus').textContent = historyLoading
    ? 'Carregando histórico…'
    : `Página ${historyPageIndex + 1} • ${currentTask?.messages?.length || 0} de ${total} mensagens`;
}

function renderHistory(task, { reset = false, scrollToLatest = false } = {}) {
  if (reset) {
    historyEpoch++;
    historyCursors = [null];
    historyPageIndex = 0;
    historyLoading = false;
  }
  $('#messageList').innerHTML = (task.messages || []).map(messageHtml).join('');
  updateHistoryNav();
  $('#messages').scrollTop = scrollToLatest ? $('#messages').scrollHeight : 0;
}

async function changeHistoryPage(direction) {
  if (!currentTaskId || historyLoading || !currentTask?.message_page) return;
  const older = direction === 'older';
  const cursor = older ? currentTask.message_page.next_cursor : historyCursors[historyPageIndex - 1];
  if (older && !currentTask.message_page.has_more) return;
  if (!older && historyPageIndex === 0) return;
  const taskId = currentTaskId;
  const requestEpoch = historyEpoch;
  const requestNavigation = navigationEpoch;
  historyLoading = true;
  updateHistoryNav();
  try {
    const page = await window.ordax.loadMessagePage(taskId, cursor);
    if (currentTaskId !== taskId || historyEpoch !== requestEpoch || navigationEpoch !== requestNavigation) return;
    if (older) {
      historyCursors = historyCursors.slice(0, historyPageIndex + 1);
      historyCursors.push(cursor);
      historyPageIndex++;
    } else {
      historyPageIndex--;
    }
    currentTask = { ...currentTask, messages:page.messages,
      continuation:{ ...currentTask.continuation, total_messages:page.total_messages },
      message_page:{ has_more:page.has_more, next_cursor:page.next_cursor, page_size:page.page_size } };
    renderHistory(currentTask, { scrollToLatest:!older && historyPageIndex === 0 });
    renderContext(currentTask);
  } catch (error) {
    if (currentTaskId === taskId && historyEpoch === requestEpoch) {
      $('#providerDetail').textContent = friendlyError(error);
    }
  } finally {
    if (currentTaskId === taskId && navigationEpoch === requestNavigation && historyEpoch === requestEpoch) {
      historyLoading = false;
      updateHistoryNav();
    }
  }
}

function renderContext(task) {
  const continuation = task.continuation || {};
  const conversations = task.conversations || [];
  const assets = task.messages.flatMap(message => (message.assets || []).map(asset => ({ ...asset, message })));
  const checkpointVersion = task.checkpoint_record?.version || continuation.checkpoint_version || 0;

  $('#conversationBadge').textContent = 'Projeto contínuo';

  $('#memorySummary').textContent = task.checkpoint_record?.summary || task.checkpoint ||
    'A memória desta tarefa será formada por checkpoints, mensagens, decisões e artefatos locais conforme o trabalho evoluir.';
  $('#memoryStats').innerHTML = `
    <div class="stat"><strong>${Number(continuation.total_messages || task.messages.length)}</strong><span>mensagens</span></div>
    <div class="stat"><strong>v${checkpointVersion}</strong><span>checkpoint</span></div>
    <div class="stat"><strong>${Number(continuation.structured_memory_count || 0)}</strong><span>memórias</span></div>`;

  renderMemoryCandidates(task);
  const memoryItems = task.project_memory?.items || [];
  $('#structuredMemoryCount').textContent = String(memoryItems.length);
  $('#structuredMemory').innerHTML = memoryItems.length ? memoryItems.map(item => `
    <article class="memory-item" data-memory-id="${esc(item.id)}" title="Editar item">
      <button class="memory-archive" type="button" data-archive-memory="${esc(item.id)}" title="Arquivar memória" aria-label="Arquivar memória">×</button>
      <div class="memory-item-top">
        <span class="memory-kind">${esc(memoryCategoryLabels[item.category] || item.category)}</span>
        <strong>${esc(item.key)}</strong>
      </div>
      <p>${esc(item.content)}</p>
      <small>${item.source_type === 'manual' ? 'Revisado manualmente' : `Fonte: ${esc(item.source_type)}`}</small>
    </article>`).join('') : '<div class="context-empty">Itens canônicos do projeto aparecerão aqui.</div>';
  document.querySelectorAll('.memory-item').forEach(card => card.addEventListener('click', event => {
    if (event.target.closest('[data-archive-memory]')) return;
    const item = memoryItems.find(row => row.id === card.dataset.memoryId);
    if (item) setMemoryEditor(true, item);
  }));
  document.querySelectorAll('[data-archive-memory]').forEach(button => button.addEventListener('click', async event => {
    event.stopPropagation();
    if (!currentTaskId) return;
    button.disabled = true;
    try {
      const updated = await window.ordax.archiveProjectMemory(currentTaskId, button.dataset.archiveMemory);
      renderContext(acceptTaskRefresh(updated));
      await loadTasks();
    } catch (error) {
      $('#providerDetail').textContent = friendlyError(error);
      button.disabled = false;
    }
  }));

  $('#assetCount').textContent = String(assets.length);
  $('#contentAssets').innerHTML = assets.length ? assets.slice().reverse().map(asset => `
    <button class="content-asset" type="button" data-asset-id="${esc(asset.id)}" title="${esc(asset.alt || 'Imagem')}">
      <img src="${esc(asset.url)}" alt="${esc(asset.alt || 'Imagem')}" />
      <span>${esc(asset.alt || 'Imagem')}</span>
    </button>`).join('') : '<div class="context-empty">Imagens e outros artefatos aparecerão aqui.</div>';

  document.querySelectorAll('.content-asset').forEach(button => button.addEventListener('click', () => {
    const image = [...document.querySelectorAll('#messages img')].find(img => img.src.includes(button.dataset.assetId));
    image?.scrollIntoView({ behavior:'smooth', block:'center' });
  }));

  $('#internalConversationCount').textContent = String(conversations.length);
  const ordered = conversations.slice().sort((a,b) => b.sequence - a.sequence);
  $('#conversationTimeline').innerHTML = ordered.length ? ordered.map(conversation => `
    <div class="conversation-item ${conversation.status === 'active' ? 'active' : ''}">
      <span class="conversation-node"></span>
      <div class="conversation-copy">
        <strong>Conversa ${conversation.sequence}${conversation.status === 'active' ? ' • atual' : ''}</strong>
        <span>${conversation.status === 'active' ? 'Contexto ativo' : `Arquivada ${compactDate(conversation.ended_at)}`}${conversation.context_checkpoint_version ? ` • retomou v${conversation.context_checkpoint_version}` : ''}</span>
      </div>
    </div>`).join('') : '<div class="context-empty">A primeira conversa será registrada ao enviar uma mensagem.</div>';
}

async function openTask(id) {
  orchestrationUi?.hide();
  document.body.classList.remove('orchestrator-focus','orchestrator-rail-open','orchestrator-api-settings');
  $('#contextRail').classList.remove('open');
  $('#orchestratorWorkRail').hidden=true;
  if (id !== currentTaskId) flushDraft();
  const epoch = ++navigationEpoch;
  const task = await window.ordax.openTask(id);
  if (epoch !== navigationEpoch || !task) return;
  currentTaskId = id;
  currentTask = task;
  showSupervisorRole(task);
  showDraft(task);
  syncComposerAvailability();
  setMemoryEditor(false);
  $('#empty').classList.add('hidden');
  $('#taskPanel').classList.remove('hidden');
  $('#taskTitle').textContent = task.title;
  $('#renameTaskForm').classList.add('hidden');
  $('#taskTitle').classList.remove('hidden');
  $('#renameTask').classList.remove('hidden');
  const version = task.checkpoint_record?.version || 0;
  const total = task.continuation?.total_messages || task.messages.length;
  $('#taskCheckpoint').textContent = version ? `Memória local v${version} • ${plural(total, 'mensagem', 'mensagens')}` : 'Memória local pronta para começar.';
  $('#taskCheckpoint').title = task.checkpoint || '';
  $('#taskId').textContent = task.id;
  $('#inspectLinkedThread').disabled = !task.chat_url;
  $('#linkedThreadStatus').textContent = '';
  $('#linkedThreadStatus').dataset.kind = '';
  $('#linkedThreadStatus').dataset.reason = '';
  $('#linkedThreadStatus').dataset.state = 'idle';
  $('#linkedThreadStatus').dataset.threadRendered = 'false';
  const navigationStatus = taskNavigationStatus(task);
  if (navigationStatus) {
    const status = $('#linkedThreadStatus');
    status.dataset.kind = navigationStatus.kind;
    status.dataset.reason = navigationStatus.reason;
    status.dataset.state = navigationStatus.state;
    status.dataset.threadRendered = navigationStatus.threadRendered;
    status.textContent = navigationStatus.message;
  }
  $('#workspaceId').textContent = workspace ? `sessão ${workspace.id.slice(-8)}` : '';
  renderHistory(task, { reset:true, scrollToLatest:true });
  renderContext(task);
  // Provisional text is shown only as a collapsed LOCAL recovery artifact.
  // It is never added to confirmed messages or checkpoints.
  const partial=$('#provisionalResponse');
  const observation=task.provisional_response;
  partial.classList.toggle('hidden',!observation);
  partial.open=false;
  $('#provisionalResponseText').textContent=observation?.content || '';

  const recovery = $('#recoveryBanner');
  if (task.status === 'interrupted') {
    const capsule = await window.ordax.resumeCapsule(id);
    const checkpointVersion = capsule?.checkpoint?.version || 0;
    recovery.textContent = `Execução interrompida detectada. A memória v${checkpointVersion} e o histórico local foram preservados.`;
    recovery.classList.remove('hidden');
  } else {
    recovery.classList.add('hidden');
    recovery.textContent = '';
  }
  await loadTasks();
}

function toggleTaskRename(editing) {
  $('#renameTaskForm').classList.toggle('hidden', !editing);
  $('#taskTitle').classList.toggle('hidden', editing);
  $('#renameTask').classList.toggle('hidden', editing);
  if (editing) {
    $('#renameTaskInput').value = currentTask?.title || '';
    $('#renameTaskInput').focus();
    $('#renameTaskInput').select();
  }
}

async function saveTaskRename(event) {
  event.preventDefault();
  if (!currentTaskId) return;
  const taskId = currentTaskId;
  const title = $('#renameTaskInput').value.trim();
  if (!title) return;
  const submit = $('#renameTaskForm').querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const updated = await window.ordax.renameTask(taskId, title);
    if (currentTaskId === taskId) {
      acceptTaskRefresh(updated);
      $('#taskTitle').textContent = updated.title;
      toggleTaskRename(false);
    }
    await loadTasks();
  } catch (error) {
    $('#providerDetail').textContent = friendlyError(error);
  } finally {
    submit.disabled = false;
  }
}

async function createTask() {
  if(orchestrationUi?.hasProject()) {
    try {await orchestrationUi.createWork();await loadTasks();}
    catch {$('#orchestrationNotice').textContent='Selecione ou configure um orquestrador para criar o trabalho.';}
    return;
  }
  const task = await window.ordax.createTask(`Nova conversa ${new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })}`);
  await loadTasks();
  await openTask(task.id);
  $('#prompt').focus();
}

async function rotateConversation() {
  if (!currentTaskId) return;
  const button = $('#rotateConversation');
  button.disabled = true;
  button.textContent = 'Preparando…';
  try {
    const task = await window.ordax.rotateConversation(currentTaskId);
    currentTask = task;
    await openTask(currentTaskId);
    $('#recoveryBanner').textContent = 'Nova conversa interna preparada. Sua próxima mensagem abrirá um chat novo e receberá automaticamente a memória local desta tarefa.';
    $('#recoveryBanner').classList.remove('hidden');
    $('#prompt').focus();
  } catch (error) {
    $('#providerDetail').textContent = friendlyError(error);
  } finally {
    button.disabled = false;
    button.textContent = 'Preparar outra sessão interna';
  }
}

async function saveMemoryItem(event) {
  event.preventDefault();
  if (!currentTaskId) return;
  const editor = $('#memoryEditor');
  const category = $('#memoryCategory').value;
  const key = $('#memoryKey').value.trim();
  const content = $('#memoryContent').value.trim();
  if (!key || !content) return;
  const submit = editor.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const taskId = currentTaskId;
    const canon = editor.dataset.candidateId ? (currentTask?.project_memory?.items || []).find(item =>
      item.category === category && item.key.toLocaleLowerCase('pt-BR') === key.toLocaleLowerCase('pt-BR')) : null;
    const conflict = Boolean(canon && canon.content.trim() !== content);
    if (conflict && !$('#memoryConfirmReplace').checked) {
      $('#providerDetail').textContent = 'Confira e confirme a substituição da memória aprovada.';
      return;
    }
    const updated = editor.dataset.candidateId
      ? await window.ordax.reviewMemoryCandidate(taskId, editor.dataset.candidateId, 'accept', {
        category, key, content,
        ...(conflict ? {
          confirm_conflict:true,
          expected_canonical_memory_id:canon.id,
          expected_canonical_content:canon.content
        } : {})
      })
      : await window.ordax.upsertProjectMemory(taskId, { id:editor.dataset.memoryId || undefined, category, key, content });
    if (currentTaskId === taskId) {
      setMemoryEditor(false);
      renderContext(acceptTaskRefresh(updated));
      await loadTasks();
    }
  } catch (error) {
    $('#providerDetail').textContent = friendlyError(error);
  } finally {
    submit.disabled = false;
  }
}

async function refreshProvider() {
  if (providerRefreshPending) return;
  providerRefreshPending = true;
  try {
    const status = await window.ordax.providerStatus();
    composeAvailability = providerComposeAvailability(status);
    syncComposerAvailability();
    const verification = status.verification_required;
    const authenticating = status.auth_state === 'authenticating';
    const anonymous = status.auth_state === 'anonymous';
    const sessionObserved = status.auth_state === 'session_present';
    const backendDenied = status.provider_access_problem === 'backend_http_403_observed';
    const backendRateLimited = status.provider_access_problem === 'backend_http_429_observed';
    $('#providerText').textContent = verification ? 'ChatGPT • verificação necessária' : backendDenied ? 'ChatGPT • acesso recusado (403)' : backendRateLimited ? 'ChatGPT • limitação observada (429)' : status.active ? 'ChatGPT • gerando' : authenticating ? 'ChatGPT • autenticação' : sessionObserved && status.composer_ready ? 'ChatGPT • sessão detectada' : status.ready && status.composer_ready ? 'ChatGPT • tela disponível' : 'ChatGPT • aguardando';
    $('#providerDetail').textContent = verification ? 'Conclua a verificação no modo direto' : backendDenied ? 'Requisições internas foram recusadas pelo ChatGPT (HTTP 403). O login informado não está sendo negado pelo Lab; confirme o acesso pelo serviço oficial. Nenhuma mensagem será reenviada.' : backendRateLimited ? 'Foi observado HTTP 429 em pelo menos uma requisição interna do ChatGPT. Isso não demonstra a causa da falha de conversa nem invalida o login. Não faremos novas tentativas automáticas.' : authenticating ? 'Conclua o login na própria página' : anonymous ? 'Faça login nesta sessão isolada do Lab' : sessionObserved ? 'Indicadores de sessão detectados; identidade não verificada' : 'Estado da sessão não observado; não é seguro enviar';
    $('#providerDot').className = `dot ${verification || backendDenied || backendRateLimited ? 'error' : sessionObserved && status.composer_ready ? 'ok' : ''}`;
    if (status.page_state === 'conversation_load_failed') {
      $('#providerText').textContent = 'ChatGPT • conversa indisponível';
      $('#providerDetail').textContent = 'A página oficial não carregou a conversa. As tarefas e mensagens já salvas continuam disponíveis no OrdaX. Não houve recarga ou reenvio automático.';
      $('#providerDot').className = 'dot error';
    } else if (status.history_unavailable === true && !backendDenied && !backendRateLimited) {
      $('#providerDetail').textContent = 'O histórico lateral do ChatGPT está indisponível. O histórico local do OrdaX continua acessível. Não será feita recarga automática.';
    }
    observerMode = status.observer_mode || observerMode;
    if ($('#observerMode').value !== observerMode) $('#observerMode').value = observerMode;
    $('#observerHint').textContent = observerMode === 'beta' ? 'Beta observa a interface.' : observerMode === 'fast' ? `Fast${status.fast_observer_ready ? ' • rede observada' : ' • Beta de segurança'}` : `Automático${status.fast_observer_ready ? ' • Fast + Beta' : ' • Beta ativo'}`;
    // Session heuristics must never hide the login view automatically.
    // The operator returns from direct mode explicitly after signing in.
  } catch (error) {
    composeAvailability = { allowed:false, reason:'unverified' };
    syncComposerAvailability();
    $('#providerText').textContent = 'ChatGPT • erro';
    $('#providerDetail').textContent = friendlyError(error);
    $('#providerDot').className = 'dot error';
  } finally {
    providerRefreshPending = false;
  }
}

function setContextOpen(open) {
  const rail = $('#contextRail');
  const toggle = $('#toggleContext');
  const next = Boolean(open);
  rail.classList.toggle('open', next);
  toggle?.setAttribute('aria-expanded', String(next));
}

$('#newTask').addEventListener('click', createTask);
$('#olderMessages').addEventListener('click', () => changeHistoryPage('older'));
$('#newerMessages').addEventListener('click', () => changeHistoryPage('newer'));
$('#renameTask').addEventListener('click', () => toggleTaskRename(true));
$('#cancelTaskRename').addEventListener('click', () => toggleTaskRename(false));
$('#renameTaskForm').addEventListener('submit', saveTaskRename);
document.querySelector('[data-create-task]')?.addEventListener('click', createTask);
$('#taskSearch').addEventListener('input', renderTaskList);
$('#rotateConversation').addEventListener('click', rotateConversation);
$('#addMemoryItem').addEventListener('click', () => setMemoryEditor($('#memoryEditor').classList.contains('hidden')));
$('#cancelMemoryItem').addEventListener('click', () => setMemoryEditor(false));
$('#memoryEditor').addEventListener('submit', saveMemoryItem);
for (const id of ['memoryCategory','memoryKey','memoryContent']) {
  $('#'+id).addEventListener(id === 'memoryCategory' ? 'change' : 'input', () => {
    if ($('#memoryEditor').dataset.candidateId) syncMemoryConflictReview();
  });
}
$('#scanMemoryCandidates').addEventListener('click', async () => {
  if (!currentTaskId) return;
  const taskId = currentTaskId;
  const button = $('#scanMemoryCandidates');
  button.disabled = true;
  try {
    const task = await window.ordax.scanMemoryCandidates(taskId);
    if (currentTaskId === taskId) { renderContext(acceptTaskRefresh(task)); await loadTasks(); }
  } catch (error) {
    $('#providerDetail').textContent = friendlyError(error);
  } finally {
    button.disabled = false;
  }
});
$('#toggleContext').addEventListener('click', () => setContextOpen(!$('#contextRail').classList.contains('open')));
$('#closeContext').addEventListener('click', () => setContextOpen(false));
window.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (!$('#renameTaskForm').classList.contains('hidden')) { toggleTaskRename(false); return; }
  if (!$('#memoryEditor').classList.contains('hidden')) { setMemoryEditor(false); return; }
  if ($('#contextRail').classList.contains('open')) setContextOpen(false);
});
window.matchMedia('(min-width:1181px)').addEventListener('change', event => {
  if (event.matches) setContextOpen(false);
});

$('#composerLogin').addEventListener('click', () => $('#login').click());
$('#login').addEventListener('click', async () => {
  const button = $('#login');
  button.disabled = true;
  button.textContent = 'Abrindo…';
  try {
    await setDirectModeVisible(true);
    // Display the provider's official login page, allowing the person to
    // choose their login method. Never click a third-party identity provider.
    await window.ordax.login();
  } catch (error) {
    $('#providerDetail').textContent = friendlyError(error);
  } finally {
    button.disabled = false;
    button.textContent = 'Entrar';
    await refreshProvider();
  }
});

$('#observerMode').addEventListener('change', async event => {
  const select = event.currentTarget;
  select.disabled = true;
  try { observerMode = await window.ordax.setObserverMode(select.value); await refreshProvider(); }
  catch (error) { $('#providerDetail').textContent = friendlyError(error); select.value = observerMode; }
  finally { select.disabled = false; }
});

// This inspects the already-linked provider thread from the OrdaX App.
// It never opens the direct-mode fallback, types a prompt or replays a Run.
$('#inspectLinkedThread').addEventListener('click', async () => {
  const taskId=currentTaskId;
  if (!taskId || !currentTask?.chat_url) return;
  const button=$('#inspectLinkedThread');
  button.disabled=true;
  $('#linkedThreadStatus').dataset.state = 'pending';
  $('#linkedThreadStatus').dataset.kind = '';
  $('#linkedThreadStatus').dataset.reason = '';
  $('#linkedThreadStatus').dataset.threadRendered = 'false';
  $('#linkedThreadStatus').textContent='Verificando a conversa vinculada (sem envio)…';
  try {
    const result=await window.ordax.inspectLinkedThread(taskId);
    if (currentTaskId !== taskId) return;
    $('#linkedThreadStatus').dataset.kind = String(result?.kind || 'unavailable');
    $('#linkedThreadStatus').dataset.reason = String(result?.inspectionReason || result?.reason || 'unknown');
    // Machine-readable result: never certify W3 from localized UI copy.
    const attributable = result?.threadRendered === true &&
      result?.kind === 'response_candidate' && result?.inspectionReason === 'thread_rendered';
    $('#linkedThreadStatus').dataset.threadRendered = attributable ? 'true' : 'false';
    $('#linkedThreadStatus').dataset.state = 'complete';
    const blockedReasons={
      provider_rate_limited_observed:'O ChatGPT apresentou HTTP 429. Inspeção suspensa, sem nova navegação nem reenvio.',
      provider_access_restricted_observed:'O ChatGPT apresentou restrição de acesso (HTTP 403 observado). Inspeção suspensa, sem nova navegação nem reenvio.',
      provider_login_required:'Entre no ChatGPT pela página oficial antes de verificar a conversa. Rascunho preservado.',
      provider_authentication_in_progress:'Conclua a autenticação no ChatGPT antes da inspeção. Nenhum reenvio.',
      provider_session_not_observed:'Sessão não comprovada para abrir outra conversa. Faça login pelo modo direto.',
      provider_verification_required:'Verificação do ChatGPT pendente. Inspeção suspensa, sem reenvio.',
      provider_conversation_load_failed:'O ChatGPT exibiu erro ao carregar esta conversa. Histórico local preservado; não será feita nova navegação nem reenvio.',
      provider_health_unavailable:'Não foi possível observar a sessão. Inspeção suspensa, sem reenvio.',
      provider_submission_provenance_missing:'Esta tarefa não tem recibo verificável de envio para a última mensagem. A inspeção remota não foi iniciada; histórico local preservado, W3 pendente.',
      provider_response_generation_active:'A resposta ainda pode estar sendo gerada. W3 não certificado; nenhum reenvio.',
      provider_generation_state_unobserved:'Não foi possível comprovar o estado de geração da resposta. W3 não certificado; nenhum reenvio.'
    };
    const inspectionReason=String(result?.inspectionReason || '');
    $('#linkedThreadStatus').textContent=attributable
      ? 'Conversa e resposta da tarefa observadas. Não comprova efeitos externos.'
      : blockedReasons[inspectionReason] ||
        (result?.kind==='message_candidate'
          ? 'Mensagem da tarefa localizada, mas resposta ainda não comprovada. Nenhum reenvio.'
          : 'Não foi possível comprovar a conversa e a resposta da tarefa. Nenhum reenvio.');
  } catch (error) {
    if (currentTaskId === taskId) {
      $('#linkedThreadStatus').dataset.kind = 'unavailable';
      $('#linkedThreadStatus').dataset.reason = 'provider_inspection_unavailable';
      $('#linkedThreadStatus').dataset.threadRendered = 'false';
      $('#linkedThreadStatus').dataset.state = 'error';
      $('#linkedThreadStatus').textContent='Inspeção indisponível: '+friendlyError(error);
    }
  } finally {
    if (currentTaskId === taskId) button.disabled=false;
  }
});

$('#directMode').addEventListener('click', async () => {
  const nextVisible = !directMode;
  try {
    await setDirectModeVisible(nextVisible);
    if (nextVisible && currentTaskId) await openTask(currentTaskId);
  } catch (error) {
    $('#providerDetail').textContent = friendlyError(error);
  }
});

async function submitTaskMessage(contentOverride = null) {
  if (!currentTaskId) return false;
  const input = $('#prompt');
  if (typeof contentOverride === 'string') {
    input.value = contentOverride;
    input.dispatchEvent(new Event('input', { bubbles:true }));
  }
  const content = input.value.trim();
  if (!content || submittingTaskId) return false;
  // Enter/requestSubmit cannot bypass the disabled submit button.
  if (!composeAvailability.allowed) {
    syncComposerAvailability();
    stageDraft();
    return false;
  }
  const taskId = currentTaskId;
  flushDraft();
  const draftRevision = Math.max(draftCache.get(taskId)?.revision || 0, Number(currentTask?.draft_revision || 0)) + 1;
  submittingTaskId = taskId;
  syncComposerAvailability();
  // Preserve text until backend accepts the send: logout must not consume drafts.
  $('#runStatus').textContent = currentTask?.chat_url ? 'Enviando…' : currentTask?.continuation?.total_messages ? 'Abrindo nova conversa com memória…' : 'Enviando…';
  $('#runStatus').classList.remove('hidden');
  $('#send').disabled = true;
  let sent = false;
  try {
    const { task } = await window.ordax.send({ taskId, content, draftRevision });
    draftCache.set(taskId, { content:'', revision:draftRevision });
    if (currentTaskId === taskId) {
      input.value = '';
      input.style.height = '';
      $('#draftState').textContent = '';
      currentTask = task;
      renderHistory(task, { reset:true, scrollToLatest:true });
      renderContext(task);
      $('#recoveryBanner').classList.add('hidden');
      const version = task.checkpoint_record?.version || 0;
      $('#taskCheckpoint').textContent = `Memória local v${version} • ${plural(task.continuation?.total_messages || task.messages.length, 'mensagem', 'mensagens')}`;
    }
    await loadTasks();
    sent = true;
  } catch (error) {
    const message = friendlyError(error);
    if (currentTaskId === taskId) {
      await openTask(taskId).catch(() => null);
      if (currentTaskId === taskId) {
        $('#messageList').insertAdjacentHTML('beforeend', `<article class="message error"><div class="message-body"><div class="message-role">Erro</div><div class="message-content">${esc(message)}</div></div></article>`);
        $('#messages').scrollTop = $('#messages').scrollHeight;
      }
    }
  } finally {
    $('#runStatus').classList.add('hidden');
    $('#runStatus').textContent = '';
    submittingTaskId = null;
    syncComposerAvailability();
    if (currentTaskId === taskId) input.focus();
    refreshProvider();
  }
  return sent;
}

$('#composer').addEventListener('submit', event => {
  event.preventDefault();
  return submitTaskMessage();
});

$('#prompt').addEventListener('input', event => {
  const input = event.currentTarget;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
  stageDraft();
});
$('#prompt').addEventListener('draft-restored', () => {
  const input = $('#prompt');
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
});
window.addEventListener('pagehide', flushDraft);
$('#prompt').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('#composer').requestSubmit(); }
});

window.ordax.onRunStarted(payload => {
  if (payload.taskId !== currentTaskId) return;
  appendLiveRun(payload.runId, payload.userMessage);
});
window.ordax.onTaskStage(payload => {
  if (payload.taskId !== currentTaskId) return;
  updateLiveStage(payload);
});
window.ordax.onTaskStream(payload => {
  if (payload.taskId !== currentTaskId) return;
  updateLiveRun(payload);
});

await setDirectModeVisible(false);
syncComposerAvailability(); // no send until session observed
workspace = await window.ordax.workspace();
orchestrationUi=mountOrchestratorUi({api:window.ordax,
  canStartMission:()=>composeAvailability.allowed===true&&!submittingTaskId,
  onStartMission:async({taskId,mission})=>{
    await loadTasks();await openTask(taskId);
    if(currentTaskId!==taskId)return false;
    return submitTaskMessage(mission);
  },
  onScopeChange:ids=>{
    scopedTaskIds=ids;renderTaskList();
    void loadTasks().catch(()=>{});
    if(currentTaskId && (ids?!ids.has(currentTaskId):allTasks.find(t=>t.id===currentTaskId)?.lab_binding)) {
      flushDraft();currentTaskId=null;currentTask=null;navigationEpoch++;
      $('#taskPanel').classList.add('hidden');$('#empty').classList.remove('hidden');
      syncComposerAvailability();
    }
  },
  onOpenWork:async id=>{await loadTasks();await openTask(id);},
  onShowCoordinator:async()=>{
    document.body.classList.add('orchestrator-focus');
    $('#orchestratorWorkRail').hidden=false;
    flushDraft();await setDirectModeVisible(false);
    currentTaskId=null;currentTask=null;navigationEpoch++;syncComposerAvailability();
    $('#taskPanel').classList.add('hidden');$('#empty').classList.add('hidden');
  }
});
await orchestrationUi.start();
await loadTasks();
refreshProvider();
setInterval(refreshProvider, 1500);

// LAB-ONLY supervisor UX. Browser content never supplies execution authority.
let labProposal = null;
const labPanel = document.getElementById("labSupervisorPanel");
const labState = document.getElementById("labSupervisorState");
const labMessage = document.getElementById("labSupervisorProposal");
const labPlanButton = document.getElementById("labSupervisorPlan");
const labRecoverButton = document.getElementById("labSupervisorRecover");
const labInspectButton = document.getElementById("labSupervisorInspect");
const labApproveButton = document.getElementById("labSupervisorApprove");
const labSendButton = document.getElementById("labSupervisorSend");

// A role is a local Task preference; changing it does NOT call a model or
// change the embedded ChatGPT conversation. Keep the existing Task/Store.
const labRoleSelect=document.getElementById('labSupervisorRole');
const labRoleDescription=document.getElementById('labRoleDescription');
const labObjective=document.getElementById('labSupervisorObjective');
labRoleSelect.replaceChildren(...SUPERVISOR_ROLES.map(role=>{
  const option=document.createElement('option');
  option.value=role.id; option.textContent=role.name;
  return option;
}));
function showSupervisorRole(task) {
  const role=supervisorRole(task?.supervisor_role);
  labRoleSelect.disabled=!task;
  labRoleSelect.value=role.id;
  labRoleDescription.textContent=task
    ? role.description+' Papel salvo somente nesta tarefa; nenhuma IA iniciada.'
    : 'Selecione uma tarefa antes de escolher seu papel.';
  // This is a *preview objective*, not a provider message or persisted Run.
  labObjective.value=task?role.draft:'';
}
labRoleSelect.addEventListener('change',async()=>{
  const taskId=currentTaskId;
  if(!taskId){showSupervisorRole(null);return;}
  const role=labRoleSelect.value;
  labRoleSelect.disabled=true;
  try{
    const saved=await window.ordax.setTaskSupervisorRole(taskId,role);
    if(currentTaskId===taskId){
      currentTask=saved;
      showSupervisorRole(saved);
      await loadTasks();
    }
  }catch{
    if(currentTaskId===taskId){
      showSupervisorRole(currentTask);
      labRoleDescription.textContent='Não foi possível salvar o papel da tarefa.';
    }
  }finally{
    if(currentTaskId===taskId)labRoleSelect.disabled=false;
  }
});
const labKeyForm=document.getElementById('labSupervisorKeyForm');
const labKeyInput=document.getElementById('labSupervisorKeyInput');
const labKeySave=document.getElementById('labSupervisorKeySave');
const labKeyRemove=document.getElementById('labSupervisorKeyRemove');
const labKeyState=document.getElementById('labSupervisorKeyState');
let labStatus=await window.ordax.supervisorStatus().catch(()=>({enabled:false,configured:false,secureStorageAvailable:false}));
function showSupervisorStatus() {
  document.getElementById('labVersion').textContent=labStatus.version
    ? 'OrdaX Orchestrator Lab v'+labStatus.version : 'Versão do Lab indisponível';
  labState.textContent=labStatus.enabled
    ? 'Supervisor habilitado no ambiente Dev: cada mensagem proposta exige aprovação.'
    : 'Supervisor desativado. A configuração da chave não inicia comandos nem faz chamadas à API.';
  labPlanButton.disabled=!labStatus.enabled;
  const available=labStatus.secureStorageAvailable===true;
  labKeySave.disabled=!available;
  labKeyRemove.disabled=!labStatus.keySaved;
  labKeyState.textContent=!available
    ? 'Proteção local do Windows indisponível: a chave não será armazenada.'
    : labStatus.keySaved
      ? 'Chave Groq salva e protegida localmente; conexão ainda não testada.'
      : labStatus.configured
        ? 'Chave definida pelo ambiente; não é exibida aqui. Nenhuma conexão foi testada.'
        : 'Nenhuma chave cadastrada. Salvar não ativa o supervisor.';
}
showSupervisorStatus();
labKeyForm.addEventListener('submit',async event=>{
  event.preventDefault();
  labKeySave.disabled=true;
  try{
    await window.ordax.supervisorSaveKey(labKeyInput.value.trim());
    labKeyInput.value='';
    labStatus=await window.ordax.supervisorStatus();
    showSupervisorStatus();
  }catch(error){
    labKeyInput.value='';
    labKeyState.textContent=error?.message?.includes('supervisor_key_invalid_format')
      ? 'Formato inválido. Use uma chave Groq iniciada por gsk_.'
      : 'Não foi possível proteger a chave neste dispositivo.';
  }finally{labKeySave.disabled=labStatus.secureStorageAvailable!==true;}
});
labKeyRemove.addEventListener('click',async()=>{
  labKeyRemove.disabled=true;
  labKeyInput.value='';
  try{
    await window.ordax.supervisorRemoveKey();
    labStatus=await window.ordax.supervisorStatus();
    showSupervisorStatus();
  }catch{labKeyState.textContent='Não foi possível remover a chave armazenada.';}
  finally{labKeyRemove.disabled=!labStatus.keySaved;}
});

labRecoverButton.disabled = false; // Durable read-only recovery never requires Groq.
labRecoverButton.addEventListener("click", async () => {
  if (!currentTaskId) {labMessage.textContent="Selecione uma tarefa primeiro.";return;}
  const taskId=currentTaskId;
  labRecoverButton.disabled=true;
  labProposal=null;
  labApproveButton.hidden=true;
  labSendButton.hidden=true;
  labInspectButton.hidden=true;
  try {
    const plans=await window.ordax.supervisorRecoverable({taskId});
    if(currentTaskId!==taskId){labMessage.textContent="Tarefa mudou; recuperação interrompida.";return;}
    if(!plans.length){labMessage.textContent="Nenhum plano pendente para esta tarefa.";return;}
    const plan=plans[0];
    labProposal=plan;
    labMessage.textContent=["Plano recuperado: "+plan.status,plan.decision?.reason||"",plan.decision?.content||"",plan.requiresReconciliation?"Entrega incerta: verificar manualmente. Nunca reenviar automaticamente.":""].filter(Boolean).join("\n\n");
    labApproveButton.hidden=!(plan.status==="pending_approval" && plan.approvalStatus==="pending" && plan.approvalId);
    labSendButton.hidden=!(plan.status==="approved" && plan.approvalStatus==="approved");
    labInspectButton.hidden=!plan.requiresReconciliation || !["dispatching","indeterminate"].includes(plan.status);
  } catch(error){labMessage.textContent=error?.message||"Falha ao recuperar plano";}
  finally{labRecoverButton.disabled=false;}
});
labInspectButton.addEventListener("click", async () => {
  if (!labProposal || currentTaskId !== labProposal.taskId ||
      !labProposal.requiresReconciliation) {
    labMessage.textContent="Selecione um plano incerto da tarefa atual."; return;
  }
  labInspectButton.disabled=true;
  const taskId=labProposal.taskId, actionId=labProposal.actionId;
  labMessage.textContent="Verificando somente a conversa já vinculada. Nenhuma mensagem será reenviada.";
  try {
    const result=await window.ordax.supervisorInspect({taskId,actionId});
    if (currentTaskId!==taskId) {
      labMessage.textContent="Tarefa alterada durante a inspeção; resultado descartado.";
      return;
    }
    const explanations={
      response_candidate:"Uma resposta candidata aparece após a mensagem na conversa.",
      message_candidate:"Uma mensagem candidata aparece, sem resposta subsequente observada.",
      ambiguous:"Há mensagens iguais; não é possível atribuir este envio.",
      unresolved:"A mensagem não foi localizada na amostra observada.",
      unavailable:"A inspeção não pôde fornecer evidência confiável."
    };
    labMessage.textContent=[
      "Resultado: "+(explanations[result.kind]||"Inconclusivo"),
      "Motivo técnico: "+(result.reason||"não informado"),
      "Ação preservada: "+(result.persistedStatus||"incerta"),
      "Nenhum efeito local comprovado. NÃO reenviar automaticamente."
    ].join("\n\n");
  } catch(error) {
    labMessage.textContent=error?.message||"Inspeção não concluída.";
  } finally { labInspectButton.disabled=false; }
});
labPlanButton.addEventListener("click", async () => {
  const taskId = currentTaskId;
  const objective = document.getElementById("labSupervisorObjective").value.trim();
  if (!taskId || !objective) {labMessage.textContent="Selecione uma tarefa e informe um objetivo.";return;}
  labPlanButton.disabled = true;
  labInspectButton.hidden = true;
  labApproveButton.hidden = true;
  labSendButton.hidden = true;
  labProposal = null;
  labMessage.textContent = "Consultando supervisor...";
  try {
    const plan = await window.ordax.supervisorPlan({ taskId,requestId:crypto.randomUUID(),objective });
    labProposal = {...plan,taskId};
    const decision = plan.decision;
    labMessage.textContent = decision
      ? [decision.reason,decision.content || "", "Estado: "+plan.status].filter(Boolean).join("\n\n")
      : "Plano pendente de reconciliação; não reenviar automaticamente."; 
    labApproveButton.hidden = !(plan.status==="pending_approval" && plan.approvalId);
  } catch (error) {labMessage.textContent = error?.message || "Falha de planejamento";}
  finally {labPlanButton.disabled = !labStatus.enabled;}
});
labApproveButton.addEventListener("click", async () => {
  if (!labProposal || currentTaskId !== labProposal.taskId) {labMessage.textContent="Tarefa mudou; reprograme o passo.";return;}
  labApproveButton.disabled = true;
  try {
    const result=await window.ordax.supervisorApprove({taskId:labProposal.taskId,actionId:labProposal.actionId,approvalId:labProposal.approvalId});
    if(result.approved){labApproveButton.hidden=true;labSendButton.hidden=false;}
  } catch(error){labMessage.textContent = error?.message || "Falha de aprovação";}
  finally{labApproveButton.disabled=false;}
});
labSendButton.addEventListener("click",async()=>{
  if (!labProposal || currentTaskId !== labProposal.taskId) {labMessage.textContent="Tarefa mudou; envio bloqueado.";return;}
  labSendButton.disabled = true;
  labSendButton.hidden = true;
  try {
    const result=await window.ordax.supervisorDispatch({taskId:labProposal.taskId,actionId:labProposal.actionId});
    labMessage.textContent = "Estado do envio: "+result.status+(result.status==="indeterminate" ? " — não reenviar automaticamente.":"");
    if(result.status==="succeeded") {await openTask(labProposal.taskId);await loadTasks();}
  } catch(error){labMessage.textContent = error?.message || "Falha de envio";}
  finally {labProposal=null;labSendButton.disabled=false;}
});

const diagnosticButton = document.getElementById('providerDiagnostic');
const diagnosticOutput = document.getElementById('providerDiagnosticResult');
diagnosticButton.addEventListener('click', async () => {
  diagnosticButton.disabled = true;
  diagnosticOutput.textContent = 'Lendo somente indicadores da página atual, sem envio ou navegação…';
  try {
    const result = await window.ordax.providerDiagnostic();
    diagnosticOutput.textContent = JSON.stringify(result, null, 2);
  } catch {
    diagnosticOutput.textContent = 'Diagnóstico indisponível. Nenhum envio foi realizado.';
  } finally {
    diagnosticButton.disabled = false;
  }
});

