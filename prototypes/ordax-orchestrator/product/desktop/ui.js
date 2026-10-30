import { renderLiveStage } from './ui-stage.mjs';
import { providerComposeAvailability, canStartFreshProviderChat, COMPOSE_STATUS_MESSAGES } from '../src/provider-compose-availability.mjs';
import { resolveProviderLoginAction } from '../src/provider-login-action.mjs';
import { taskListStatusLabel, taskNavigationStatus } from '../src/task-navigation-status.mjs';
import { SUPERVISOR_ROLES, supervisorRole } from '../src/supervisor-role-presets.mjs';
import { mountOrchestratorUi } from './orchestrator-ui.mjs';
const $ = selector => document.querySelector(selector);
let currentTaskId = null;
let currentTask = null;
let pendingReplyRecovery=null;
let workspace = null;
let workspaceNavigationWrite=Promise.resolve();
let activeRightPane='provider';
let hostChatGPTPlan={connected:false,authorized:false,secureStorageAvailable:false,email:null};
let providerBoundsRaf=0;
const rightPaneDefinitions=[['provider','providerPaneTab','providerPanel'],['preview','previewPaneTab','previewPanel'],['context','contextPaneTab','contextPanel']];
// Initialize this control before any startup await can restore a Task and call
// showSupervisorRole().
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
function queueProviderBounds() {
  if(providerBoundsRaf)cancelAnimationFrame(providerBoundsRaf);
  providerBoundsRaf=requestAnimationFrame(()=>{
    providerBoundsRaf=0;
    const viewport=$('#providerViewport');
    if(!viewport)return;
    const rect=viewport.getBoundingClientRect();
    const bounds=rect.width>0&&rect.height>0
      ?{x:rect.left,y:rect.top,width:rect.width,height:rect.height}
      :{x:0,y:0,width:0,height:0};
    window.ordax.setProviderBounds(bounds).catch(()=>{});
  });
}
async function selectRightPane(name) {
  if(!rightPaneDefinitions.some(([pane])=>pane===name))throw new Error('right_pane_invalid');
  activeRightPane=name;
  for(const [pane,tabId,panelId] of rightPaneDefinitions) {
    const selected=pane===name;
    const tab=$('#'+tabId),panel=$('#'+panelId);
    tab.classList.toggle('active',selected);
    tab.setAttribute('aria-selected',String(selected));
    panel.hidden=!selected;
  }
  const visible=name==='provider'&&window.ordaxHost?.hostMode!==true;
  await window.ordax.setChatVisible(visible);
  document.documentElement.dataset.ordaxView='app';
  document.documentElement.dataset.ordaxRightPane=name;
  if(window.matchMedia('(max-width:1024px)').matches)$('#contextRail').classList.add('open');
  queueProviderBounds();
}
function persistWorkspaceNavigation({view,taskId=null,projectId,orchestratorId}={}) {
  if(typeof window.ordax.setWorkspaceNavigation!=='function')return Promise.reject(new Error('workspace_navigation_unavailable'));
  const navigation={
    view,taskId:taskId||null,
    projectId:projectId===undefined?(orchestrationUi?.getProjectId?.()||null):projectId,
    orchestratorId:orchestratorId===undefined?(orchestrationUi?.getOrchestratorId?.()||null):orchestratorId
  };
  const write=workspaceNavigationWrite.catch(()=>{}).then(()=>window.ordax.setWorkspaceNavigation(navigation));
  workspaceNavigationWrite=write;
  return write;
}
// Provider WebContentsView and the OrdaX workspace remain side by side.
async function showProviderPane(visible) {
  return selectRightPane(visible?'provider':'context');
}
const providerViewportObserver=typeof ResizeObserver==='function'?new ResizeObserver(queueProviderBounds):null;
providerViewportObserver?.observe($('#providerViewport'));
window.addEventListener('resize',queueProviderBounds,{passive:true});
function applyHostProviderLimit() {
  if (window.ordaxHost?.hostMode !== true) return false;
  $('#providerText').textContent = hostChatGPTPlan.authorized?'ChatGPT Plan conectado':
    hostChatGPTPlan.connected?'ChatGPT conectado; consentimento pendente':'ChatGPT não conectado ao OrdaX';
  $('#providerDetail').textContent = hostChatGPTPlan.authorized
    ?'O chat coordenador pode usar seu plano ChatGPT. As conversas de trabalho ainda não enviam mensagens por este Host.'
    :hostChatGPTPlan.connected?'A conta está vinculada, mas o uso do plano não foi autorizado. Conecte novamente e aceite esse escopo.'
    :'Abra Conectar IA e escolha Continuar com ChatGPT para autorizar o plano no navegador.';
  const sessionNote=$('.session-persistence-note');
  if(sessionNote)sessionNote.textContent='A conta ChatGPT Plan é conectada pelo fluxo oficial do navegador; isso não vincula conversas existentes do ChatGPT Web.';
  const observerRow=$('.observer-row');
  if(observerRow)observerRow.classList.add('hidden');
  $('#login').hidden = true;
  $('#providerDot').className = hostChatGPTPlan.authorized?'dot ok':hostChatGPTPlan.connected?'dot':'dot error';
  return true;
}
function syncProviderLoginAction(status) {
  const action=resolveProviderLoginAction(status,{hostMode:window.ordaxHost?.hostMode===true});
  const button=$('#login');
  button.hidden=action.hidden;
  button.textContent=action.label;
  button.setAttribute('aria-label',action.label);
  button.title=action.label;
  button.dataset.action=action.mode;
  return action;
}
let observerMode = 'auto';
let allTasks = [];
let scopedTaskIds = null;
let orchestrationUi = null;
let providerRefreshPending = false;
let composeAvailability = { allowed:false, reason:'unverified' };
let lastProviderStatus = null;
function syncComposerAvailability() {
  // Editor stays enabled: local draft text is NOT a ChatGPT submission.
  const allowed = composeAvailability.allowed===true && Boolean(currentTaskId) && !submittingTaskId;
  const hostMode=window.ordaxHost?.hostMode===true;
  $('#send').disabled = !allowed;
  $('#send').title = allowed ? 'Enviar ao ChatGPT' :
    (COMPOSE_STATUS_MESSAGES[composeAvailability.reason] || COMPOSE_STATUS_MESSAGES.unverified);
  $('#composer').dataset.sendReady = allowed ? 'true' : 'false';
  $('#composerConnection').dataset.state = composeAvailability.reason;
  $('#composerConnectionText').textContent =
    COMPOSE_STATUS_MESSAGES[composeAvailability.reason] || COMPOSE_STATUS_MESSAGES.unverified;
  $('#composerLogin').hidden = hostMode || composeAvailability.reason==='ready' || composeAvailability.reason==='busy' ||
    (composeAvailability.reason==='conversation_unavailable'&&lastProviderStatus?.auth_state==='session_present');
  const canStartFresh=canStartFreshProviderChat({task:currentTask,status:lastProviderStatus,
    availability:composeAvailability,activeRun:Boolean(submittingTaskId),hostMode});
  $('#recoverProviderConversation').hidden=hostMode||!canStartFresh||composeAvailability.reason!=='conversation_unavailable';
  $('#rotateConversation').disabled=!canStartFresh;
}
let navigationEpoch = 0;
let submittingTaskId = null;
if(window.ordaxHost?.hostMode===true) {
  composeAvailability=providerComposeAvailability(null,{hostMode:true});
  applyHostProviderLimit();
}
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
  if (!pendingDraft) return Promise.resolve();
  const { taskId, content, revision } = pendingDraft;
  pendingDraft = null;
  return window.ordax.setDraft(taskId, content, revision).then(() => {
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
    chatgpt_verification_required: 'O ChatGPT exige uma verificação oficial. Conclua-a no painel do ChatGPT e tente novamente.',
    chatgpt_login_required: 'Entre na sua conta do ChatGPT neste Lab para continuar.',
    chatgpt_conversation_load_failed: 'A conversa do ChatGPT não carregou. Rascunho e histórico local preservados; nenhum envio ou recarga automática.',
    chatgpt_session_not_observed: 'Não foi possível observar a sessão autenticada. Conclua o login no painel do ChatGPT antes de enviar.',
    chatgpt_provider_backend_access_restricted: 'O ChatGPT retornou HTTP 403 nas chamadas internas desta página. Nenhum envio foi feito; verifique o acesso pelo serviço oficial.',
    chatgpt_provider_rate_limited_observed: 'O ChatGPT apresentou ao menos uma resposta HTTP 429 nas requisições internas desta página. Não é confirmação da causa da falha. Nenhum reenvio ou nova tentativa automática.',
    task_submission_reconciliation_required: 'Envio anterior com entrega incerta. Verifique a conversa antes de enviar novamente nesta tarefa.',
    continuation_context_unavailable_request_exceeds_budget: 'O pedido ocupa o espaço necessário para levar a memória a uma nova conversa. Nada foi enviado; reduza o pedido ou divida o trabalho para preservar a continuidade.',
    continuation_context_critical_memory_omitted: 'Parte da memória crítica do projeto não cabe na nova conversa. Nada foi enviado; revise ou consolide os objetivos, restrições, decisões e pendências antes de continuar.',
    task_handoff_snapshot_exceeds_limit: 'O pacote de continuidade ultrapassa o limite seguro. Nada foi enviado; reduza o material de referência sem apagar a memória canônica.',
    task_handoff_omission_not_covered: 'O pacote não cobre todas as fontes omitidas do contexto curto. Nada foi enviado; revise o registro da tarefa.',
    provider_context_file_input_unavailable: 'O ChatGPT não disponibilizou um campo confiável para anexar o pacote de continuidade. Nada foi enviado.',
    provider_context_file_input_ambiguous: 'O ChatGPT apresentou mais de um campo possível para anexar o arquivo. O OrdaX interrompeu o envio por segurança.',
    provider_context_attachment_integrity_failed: 'A integridade do pacote mudou antes do upload. Nada foi enviado.',
    provider_context_attachment_upload_unconfirmed: 'O ChatGPT não confirmou visualmente o upload do pacote. Verifique o painel antes de continuar; nenhum reenvio automático foi feito.',
    provider_context_attachment_upload_failed: 'O ChatGPT indicou falha ao carregar o pacote. Verifique o painel e remova qualquer anexo pendente antes de tentar novamente.',
    provider_context_attachment_requires_new_conversation: 'O pacote de continuidade só pode ser anexado ao iniciar uma conversa GPT nova para a mesma tarefa.',
    orchestrator_provider_not_submitted: 'A mensagem não chegou ao ChatGPT. Corrija a sessão e envie novamente; nenhum reenvio automático foi feito.',
    provider_health_observation_timeout: 'Não foi possível confirmar o estado da sessão do ChatGPT. Nenhuma mensagem foi enviada; tente novamente quando a sessão estiver disponível.',
    provider_send_unconfirmed: 'Não foi possível confirmar a entrega ao ChatGPT. Confira a conversa antes de tentar novamente; não houve reenvio automático.',
    chatgpt_authentication_in_progress: 'Conclua o login antes de enviar.',
    composer_not_found: 'O campo de mensagem do ChatGPT ainda não está pronto.',
    send_not_observed: 'O ChatGPT não confirmou o envio. Nada foi reenviado automaticamente.',
    send_confirmation_unknown: 'O campo do ChatGPT foi esvaziado, mas o envio não pôde ser confirmado. Confira a conversa no ChatGPT antes de tentar novamente; não houve reenvio automático.',
    send_control_unavailable: 'Não foi possível localizar um botão de envio utilizável no ChatGPT. Confira o estado da sessão oficial.',
    response_not_observed: 'O envio ocorreu, mas a resposta não pôde ser confirmada. A memória da tarefa foi preservada.',
    chatgpt_response_retry_required: 'O envio foi confirmado, mas o ChatGPT exibiu “Tente novamente”. A resposta não foi concluída. Confira o painel e o histórico; o OrdaX não reenviará a mensagem automaticamente.',
    chatgpt_response_error_observed: 'O envio foi confirmado, mas o ChatGPT exibiu um erro de resposta. Confira o painel e o histórico; o OrdaX não reenviará a mensagem automaticamente.',
    chatgpt_response_in_progress: 'O ChatGPT ainda está gerando uma resposta. O rascunho permanece local e nenhum novo envio será feito.',
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
      '<small>Origem: ' + (item.source_role === 'assistant' ? 'proposta do GPT, ainda não confirmada' : 'mensagem do usuário') + ' · ' + esc(item.evidence) + '</small>' +
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
      <span class="task-sub"><span>${esc(taskListStatusLabel(task))}</span><span>Projeto persistente</span></span>
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

function renderTaskNavigationStatus(task) {
  const status=$('#linkedThreadStatus');
  status.textContent='';
  status.dataset.kind='';
  status.dataset.reason='';
  status.dataset.state='idle';
  status.dataset.threadRendered='false';
  const navigationStatus=taskNavigationStatus(task);
  if(!navigationStatus)return;
  status.dataset.kind=navigationStatus.kind;
  status.dataset.reason=navigationStatus.reason;
  status.dataset.state=navigationStatus.state;
  status.dataset.threadRendered=navigationStatus.threadRendered;
  status.textContent=navigationStatus.message;
}

function clearLinkedReplyRecovery() {
  pendingReplyRecovery=null;
  const panel=$('#linkedReplyRecovery');
  if(panel){panel.classList.add('hidden');panel.open=false;}
  const text=$('#linkedReplyRecoveryText');
  if(text)text.textContent='';
}

async function openTask(id) {
  clearLinkedReplyRecovery();
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
  renderTaskNavigationStatus(task);
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
  recovery.classList.remove('recovered');
  if (task.status === 'interrupted') {
    const capsule = await window.ordax.resumeCapsule(id);
    const checkpointVersion = capsule?.checkpoint?.version || 0;
    recovery.textContent = `Execução interrompida detectada. A memória v${checkpointVersion} e o histórico local foram preservados.`;
    recovery.classList.remove('hidden');
  } else if (task.status === 'error' && task.latest_run?.status === 'failed') {
    const run=task.latest_run;
    if(run.context_attachment_state==='uploading'&&!run.submit_attempt_observed) {
      recovery.textContent='O upload do pacote de continuidade não foi confirmado. Verifique o painel do ChatGPT e remova qualquer anexo pendente antes de decidir se pode reenviar.';
    } else if(run.context_attachment_state==='confirmed'&&!run.submit_attempt_observed) {
      recovery.textContent='O pacote foi carregado no ChatGPT, mas o pedido não teve tentativa de envio. Confira a conversa e remova o anexo pendente antes de enviar novamente.';
    } else if(run.provider_delivery_state==='submitted') {
      recovery.textContent=`O envio ao GPT foi confirmado, mas a resposta da última execução falhou. ${friendlyError(run.error)} Confira a conversa antes de continuar; o OrdaX não repetirá a mensagem.`;
    } else if(run.provider_delivery_state==='uncertain' || run.submit_attempt_observed) {
      recovery.textContent='A entrega da última mensagem não pôde ser confirmada. Verifique o ChatGPT antes de tentar novamente; o OrdaX preservou a tarefa e não repetirá o envio.';
    } else {
      recovery.textContent=`A última execução falhou antes de confirmar o envio. ${friendlyError(run.error)} O histórico e o rascunho local foram preservados.`;
    }
    recovery.classList.remove('hidden');
  } else {
    recovery.classList.add('hidden');
    recovery.textContent = '';
  }
  await loadTasks();
  if(epoch!==navigationEpoch||currentTaskId!==id)return;
  try {await persistWorkspaceNavigation({view:'task',taskId:id});}
  catch {$('#orchestrationNotice').textContent='A conversa abriu, mas a seleção não pôde ser salva para o próximo início.';}
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

async function rotateConversation(button=$('#rotateConversation')) {
  if (!currentTaskId) return;
  if(!canStartFreshProviderChat({task:currentTask,status:lastProviderStatus,
    availability:composeAvailability,activeRun:Boolean(submittingTaskId),hostMode:window.ordaxHost?.hostMode===true})) {
    $('#providerDetail').textContent='A nova conversa só pode ser aberta com sessão observada e sem envio ou execução incertos.';
    return;
  }
  button.disabled = true;
  const originalLabel=button.textContent;
  button.textContent = 'Abrindo…';
  let rotated=false;
  try {
    await flushDraft();
    const task = await window.ordax.rotateConversation(currentTaskId);
    rotated=true;
    currentTask = task;
    await openTask(currentTaskId);
    await window.ordax.home();
    await refreshProvider();
    $('#recoveryBanner').textContent = 'Conversa GPT nova aberta. A próxima mensagem continuará esta tarefa com o checkpoint e a memória local do OrdaX; nenhum envio foi feito nesta etapa.';
    $('#recoveryBanner').classList.remove('hidden');
    $('#prompt').focus();
  } catch (error) {
    if(rotated) {
      $('#recoveryBanner').textContent='A conversa GPT anterior foi arquivada. A tarefa, o rascunho e a memória local foram preservados, mas o OrdaX não confirmou a nova conversa. Verifique o painel do ChatGPT antes de enviar.';
      $('#recoveryBanner').classList.remove('hidden');
    }
    $('#providerDetail').textContent = friendlyError(error);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
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
    lastProviderStatus=status;
    syncProviderLoginAction(status);
    hostChatGPTPlan={connected:status.chatgpt_plan_connected===true,
      authorized:status.chatgpt_plan_authorized===true,
      secureStorageAvailable:status.chatgpt_plan_secure_storage===true,
      email:status.chatgpt_plan_email||hostChatGPTPlan.email};
    syncChatGPTPlanPanel();
    composeAvailability = providerComposeAvailability(status,{hostMode:window.ordaxHost?.hostMode===true});
    syncComposerAvailability();
    const verification = status.verification_required;
    const authenticating = status.auth_state === 'authenticating';
    const anonymous = status.auth_state === 'anonymous';
    const sessionObserved = status.auth_state === 'session_present';
    const backendDenied = status.provider_access_problem === 'backend_http_403_observed';
    const backendRateLimited = status.provider_access_problem === 'backend_http_429_observed';
    const responseFailure=status.provider_response_failure;
    const responseGenerating=status.response_generation_active===true;
    const responseFailed=responseFailure==='chatgpt_response_retry_required'||responseFailure==='chatgpt_response_error_observed';
    const providerBusy=status.active===true||responseGenerating;
    $('#providerText').textContent = responseFailure==='chatgpt_response_retry_required' ? 'ChatGPT • tente novamente' : responseFailure==='chatgpt_response_error_observed' ? 'ChatGPT • erro na resposta' : verification ? 'ChatGPT • verificação necessária' : backendDenied ? 'ChatGPT • acesso recusado (403)' : backendRateLimited ? 'ChatGPT • limitação observada (429)' : providerBusy ? 'ChatGPT • gerando' : authenticating ? 'ChatGPT • autenticação' : sessionObserved && status.composer_ready ? 'ChatGPT • sessão detectada' : status.ready && status.composer_ready ? 'ChatGPT • tela disponível' : 'ChatGPT • aguardando';
    $('#providerDetail').textContent = responseFailure==='chatgpt_response_retry_required' ? 'O ChatGPT mostrou “Tente novamente”. O envio original foi confirmado, mas a resposta falhou. Inspecione a conversa; o OrdaX não repetirá a mensagem.' : responseFailure==='chatgpt_response_error_observed' ? 'O ChatGPT mostrou um erro explícito. O envio original foi confirmado, mas não há resposta concluída. Inspecione a conversa antes de continuar.' : responseGenerating ? 'O ChatGPT ainda está gerando uma resposta. Novos envios e navegação estão bloqueados.' : verification ? 'A página oficial exige uma verificação do navegador. Conclua ou recarregue no painel do ChatGPT; o OrdaX manterá os envios bloqueados até observar o composer.' : backendDenied ? 'Requisições internas foram recusadas pelo ChatGPT (HTTP 403). O login informado não está sendo negado pelo Lab; confirme o acesso pelo serviço oficial. Nenhuma mensagem será reenviada.' : backendRateLimited ? 'Foi observado HTTP 429 em pelo menos uma requisição interna do ChatGPT. Isso não demonstra a causa da falha de conversa nem invalida o login. Não faremos novas tentativas automáticas.' : authenticating ? 'Conclua o login na própria página' : anonymous ? 'Faça login nesta sessão isolada do Lab' : sessionObserved ? 'Indicadores de sessão detectados; identidade não verificada' : 'Estado da sessão não observado; não é seguro enviar';
    $('#providerDot').className = `dot ${verification || backendDenied || backendRateLimited || responseFailed ? 'error' : sessionObserved && status.composer_ready ? 'ok' : ''}`;
    $('#providerBack').disabled=status.can_go_back!==true||providerBusy;
    $('#providerForward').disabled=status.can_go_forward!==true||providerBusy;
    $('#providerReload').disabled=providerBusy;
    $('#providerHome').disabled=providerBusy;
    $('#providerViewportPlaceholder').hidden=status.connected===true&&status.ready===true;
    $('#providerAddressText').textContent=authenticating?'ChatGPT · autenticação':sessionObserved?'ChatGPT · sessão observada':'ChatGPT · sessão isolada do OrdaX';
    if (status.page_state === 'conversation_load_failed') {
      $('#providerText').textContent = 'ChatGPT • conversa indisponível';
      $('#providerDetail').textContent = 'A página oficial não carregou a conversa. As tarefas e mensagens já salvas continuam disponíveis no OrdaX. Não houve recarga ou reenvio automático.';
      $('#providerDot').className = 'dot error';
    } else if (status.history_unavailable === true && !backendDenied && !backendRateLimited) {
      $('#providerDetail').textContent = 'O histórico lateral do ChatGPT está indisponível. O histórico local do OrdaX continua acessível. Não será feita recarga automática.';
    }
    applyHostProviderLimit();
    observerMode = status.observer_mode || observerMode;
    if ($('#observerMode').value !== observerMode) $('#observerMode').value = observerMode;
    $('#observerHint').textContent = observerMode === 'beta' ? 'Beta observa a interface.' : observerMode === 'fast' ? `Fast${status.fast_observer_ready ? ' • rede observada' : ' • Beta de segurança'}` : `Automático${status.fast_observer_ready ? ' • Fast + Beta' : ' • Beta ativo'}`;
  } catch (error) {
    lastProviderStatus=null;
    syncProviderLoginAction(null);
    composeAvailability = providerComposeAvailability(null,{hostMode:window.ordaxHost?.hostMode===true});
    syncComposerAvailability();
    $('#providerText').textContent = 'ChatGPT • erro';
    $('#providerDetail').textContent = friendlyError(error);
    $('#providerDot').className = 'dot error';
    applyHostProviderLimit();
  } finally {
    providerRefreshPending = false;
  }
}

function setContextOpen(open) {
  const rail=$('#contextRail');
  const toggle=$('#toggleContext');
  const next=Boolean(open);
  if(next)void selectRightPane('context');
  else rail.classList.remove('open');
  toggle?.setAttribute('aria-expanded',String(next));
}

$('#newTask').addEventListener('click', createTask);
$('#olderMessages').addEventListener('click', () => changeHistoryPage('older'));
$('#newerMessages').addEventListener('click', () => changeHistoryPage('newer'));
$('#renameTask').addEventListener('click', () => toggleTaskRename(true));
$('#cancelTaskRename').addEventListener('click', () => toggleTaskRename(false));
$('#renameTaskForm').addEventListener('submit', saveTaskRename);
document.querySelector('[data-create-task]')?.addEventListener('click', createTask);
$('#taskSearch').addEventListener('input', renderTaskList);
$('#rotateConversation').addEventListener('click',()=>void rotateConversation());
$('#recoverProviderConversation').addEventListener('click',()=>void rotateConversation($('#recoverProviderConversation')));
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
$('#toggleContext').addEventListener('click',()=>setContextOpen(!$('#contextRail').classList.contains('open')));
$('#closeContext').addEventListener('click',()=>void selectRightPane('provider'));
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
  if (applyHostProviderLimit()) {
    $('#orchestrationNotice').textContent = 'O transporte suportado do ChatGPT Web não está disponível nesta página. Nenhuma mensagem foi enviada.';
    return;
  }
  const button = $('#login');
  button.disabled = true;
  button.textContent = 'Abrindo…';
  try {
    const action=resolveProviderLoginAction(await window.ordax.providerStatus(),{hostMode:false});
    await showProviderPane(true);
    if(action.mode==='login') {
      // Display the official login page only when the provider reports an
      // anonymous session. Never click a third-party identity provider.
      await window.ordax.login();
    }
  } catch (error) {
    $('#providerDetail').textContent = friendlyError(error);
  } finally {
    button.disabled = false;
    button.textContent = 'Entrar no ChatGPT';
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
  clearLinkedReplyRecovery();
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
      provider_session_not_observed:'Sessão não comprovada para abrir outra conversa. Faça login no painel do ChatGPT.',
      provider_verification_required:'Verificação do ChatGPT pendente. Inspeção suspensa, sem reenvio.',
      provider_conversation_load_failed:'O ChatGPT exibiu erro ao carregar esta conversa. Histórico local preservado; não será feita nova navegação nem reenvio.',
      provider_health_unavailable:'Não foi possível observar a sessão. Inspeção suspensa, sem reenvio.',
      provider_submission_provenance_missing:'Esta tarefa não tem recibo verificável de envio para a última mensagem. A inspeção remota não foi iniciada; histórico local preservado, W3 pendente.',
      thread_dom_not_ready:'A estrutura da conversa vinculada ainda não ficou disponível para inspeção segura. Abra a conversa no ChatGPT, confirme que ela carregou e tente verificar novamente. Nenhuma mensagem foi reenviada.',
      thread_navigation_changed:'A conversa aberta mudou durante a inspeção. Volte à conversa vinculada e tente verificar novamente. Nenhuma mensagem foi reenviada.',
      navigation_or_draft_blocked:'A navegação foi bloqueada para proteger um rascunho ou uma conversa em andamento. Preserve o rascunho e verifique a conversa vinculada depois.',
      provider_url_mismatch:'O ChatGPT não permaneceu na conversa vinculada. Abra a conversa correta antes de verificar novamente. Nenhuma mensagem foi reenviada.',
      provider_readonly_debugger_unavailable:'A inspeção somente leitura do ChatGPT não pôde ser iniciada. Nenhuma mensagem foi reenviada; tente novamente quando o painel do ChatGPT estiver disponível.',
      provider_readonly_dom_evaluation_timeout:'O ChatGPT demorou para responder à inspeção somente leitura. Nenhuma mensagem foi reenviada; aguarde a conversa carregar e tente novamente.',
      provider_readonly_dom_evaluation_rejected:'O ChatGPT recusou a inspeção somente leitura da conversa. Nenhuma mensagem foi reenviada.',
      provider_view_unavailable:'A visualização do ChatGPT não está disponível para inspeção. Nenhuma mensagem foi reenviada.',
      provider_conversation_observation_timeout:'A inspeção da conversa excedeu o limite de tempo. Nenhuma mensagem foi reenviada; tente novamente quando a conversa estiver carregada.',
      provider_health_observation_timeout:'A verificação do estado do ChatGPT excedeu o limite de tempo. Nenhuma mensagem foi reenviada.',
      chatgpt_draft_present:'Há um rascunho no ChatGPT. Ele foi preservado e a inspeção não tentou navegar nem reenviar.',
      observation_failed:'A inspeção somente leitura falhou. Nenhuma mensagem foi reenviada; tente novamente quando o ChatGPT estiver disponível.',
      provider_response_generation_active:'A resposta ainda pode estar sendo gerada. W3 não certificado; nenhum reenvio.',
      provider_generation_state_unobserved:'Não foi possível comprovar o estado de geração da resposta. W3 não certificado; nenhum reenvio.',
      missing_canonical_reference:'A inspeção não tem uma referência canônica suficiente para atribuir a conversa à tarefa. Histórico local preservado; nenhum reenvio.',
      dom_not_reliable:'A página do ChatGPT não forneceu uma leitura confiável da conversa. Isso não comprova falha de entrega; nenhum reenvio foi feito.',
      observation_unbounded:'A conversa excedeu o limite seguro de leitura. A resposta não foi importada nem reenviada.',
      message_observation_incomplete:'A mensagem da tarefa apareceu incompleta na página do ChatGPT. Entrega e resposta continuam incertas; nenhum reenvio foi feito.',
      duplicate_message_candidates:'A mensagem da tarefa aparece mais de uma vez na conversa. O OrdaX não consegue atribuir a resposta com segurança; nada foi importado ou reenviado.',
      message_not_visible_in_partial_dom:'A mensagem exata não apareceu no trecho visível da conversa, que estava parcial. Isso não prova que ela não foi entregue; nenhum reenvio foi feito.',
      message_not_observed:'A mensagem exata da tarefa não apareceu na leitura da conversa. Isso não prova falha de entrega; histórico local preservado e nenhum reenvio.',
      partial_dom_match_not_attributable:'A conversa estava parcial e não permitiu atribuir a resposta à tarefa. Nenhum reenvio ou importação foi feito.',
      dom_match_not_attributable:'A leitura não permitiu atribuir uma resposta completa à mensagem da tarefa. Entrega permanece incerta; nenhum reenvio foi feito.',
      provider_inspection_state_changed:'A tarefa, a conversa ou o Run mudou durante a inspeção. Verifique novamente antes de recuperar a resposta. Nenhuma mensagem foi reenviada.'
    };
    const inspectionReason=String(result?.inspectionReason || '');
    $('#linkedThreadStatus').textContent=attributable
      ? 'Conversa e resposta da tarefa observadas. Não comprova efeitos externos.'
      : blockedReasons[inspectionReason] ||
        (result?.kind==='message_candidate'
          ? 'Mensagem da tarefa localizada, mas resposta ainda não comprovada. Nenhum reenvio.'
          : 'Não foi possível comprovar a conversa e a resposta da tarefa. Nenhum reenvio.');
    if(attributable&&typeof result?.recoveryPreview?.text==='string'&&
       /^[a-f0-9]{64}$/.test(result.recoveryPreview.responseSha256||'')) {
      pendingReplyRecovery={taskId,responseSha256:result.recoveryPreview.responseSha256};
      $('#linkedReplyRecoveryText').textContent=result.recoveryPreview.text;
      $('#linkedReplyRecovery').classList.remove('hidden');
      $('#linkedReplyRecovery').open=true;
      $('#linkedThreadStatus').textContent='A resposta completa foi localizada após a falha local. Confira o texto abaixo; nada foi importado ainda.';
    }
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

$('#confirmLinkedReplyRecovery').addEventListener('click',async()=>{
  const pending=pendingReplyRecovery;
  if(!pending||pending.taskId!==currentTaskId)return;
  const button=$('#confirmLinkedReplyRecovery');
  button.disabled=true;
  $('#linkedThreadStatus').dataset.state='pending';
  $('#linkedThreadStatus').textContent='Revalidando a conversa do ChatGPT antes de gravar…';
  try {
    const result=await window.ordax.reconcileLinkedReply(pending.taskId,pending.responseSha256);
    if(currentTaskId!==pending.taskId)return;
    if(result?.reconciled===true||result?.reason==='already_reconciled') {
      clearLinkedReplyRecovery();
      const task=await window.ordax.getTask(pending.taskId);
      if(currentTaskId!==pending.taskId||!task)return;
      currentTask=task;
      const version=task.checkpoint_record?.version||0;
      const total=task.continuation?.total_messages||task.messages.length;
      $('#taskCheckpoint').textContent=version?`Memória local v${version} • ${plural(total,'mensagem','mensagens')}`:'Memória local pronta para começar.';
      $('#taskCheckpoint').title=task.checkpoint||'';
      renderHistory(task,{reset:true,scrollToLatest:true});
      renderContext(task);
      renderTaskNavigationStatus(task);
      $('#recoveryBanner').classList.add('hidden');
      $('#recoveryBanner').textContent='';
      $('#linkedThreadStatus').dataset.state='complete';
      $('#linkedThreadStatus').textContent=result?.reconciled
        ?'Resposta revalidada e importada uma única vez no histórico local.'
        :'Essa resposta já estava reconciliada no histórico local.';
      await loadTasks();
    } else {
      $('#linkedThreadStatus').dataset.state='complete';
      $('#linkedThreadStatus').textContent=result?.reason==='provider_reply_candidate_changed'
        ?'A resposta mudou desde a pré-visualização. Verifique a conversa novamente antes de importar.'
        :'A resposta já não pode ser reconciliada com segurança. O histórico local foi preservado.';
      clearLinkedReplyRecovery();
    }
  } catch(error) {
    if(currentTaskId===pending.taskId) {
      $('#linkedThreadStatus').dataset.state='error';
      $('#linkedThreadStatus').textContent='Não foi possível reconciliar a resposta: '+friendlyError(error);
    }
  } finally {
    if(currentTaskId===pending.taskId)button.disabled=false;
  }
});

document.querySelectorAll('.right-pane-tab').forEach(tab=>tab.addEventListener('click',()=>{
  void selectRightPane(tab.dataset.pane).catch(error=>{$('#providerDetail').textContent=friendlyError(error);});
}));
$('#providerPaneLogin').addEventListener('click',()=>$('#login').click());
$('#providerClose').addEventListener('click',()=>void selectRightPane('context'));
const providerAction=async(button,action)=>{
  if(button.disabled)return;
  button.disabled=true;
  try {await action();}
  catch(error){$('#providerDetail').textContent=friendlyError(error);}
  finally {await refreshProvider();}
};
$('#providerBack').addEventListener('click',()=>void providerAction($('#providerBack'),()=>window.ordax.providerNavigate('back')));
$('#providerForward').addEventListener('click',()=>void providerAction($('#providerForward'),()=>window.ordax.providerNavigate('forward')));
$('#providerReload').addEventListener('click',()=>void providerAction($('#providerReload'),()=>window.ordax.reload()));
$('#providerHome').addEventListener('click',()=>void providerAction($('#providerHome'),()=>window.ordax.home()));

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
window.ordax.onTaskProviderNavigation(payload=>{
  if(!payload||payload.taskId!==currentTaskId||!currentTask)return;
  currentTask={...currentTask,provider_navigation:payload.provider_navigation,
    ...(payload.provider_navigation_reason?{provider_navigation_reason:payload.provider_navigation_reason}:{})};
  renderTaskNavigationStatus(currentTask);
});
window.ordax.onTaskReconciled(async payload=>{
  const taskId=payload?.taskId;
  if(typeof taskId!=='string'||!taskId)return;
  try {
    await loadTasks();
    if(currentTaskId!==taskId)return;
    const updated=await window.ordax.getTask(taskId);
    if(currentTaskId!==taskId||!updated)return;
    currentTask=acceptTaskRefresh(updated);
    renderHistory(currentTask,{scrollToLatest:historyPageIndex===0});
    renderContext(currentTask);
    const recovery=$('#recoveryBanner');
    recovery.textContent='A resposta tardia do ChatGPT foi conferida e vinculada à execução original. Ela foi salva uma única vez; nenhum reenvio foi feito.';
    recovery.classList.add('recovered');
    recovery.classList.remove('hidden');
  } catch {}
});

await selectRightPane('provider');
syncComposerAvailability(); // no send until session observed
workspace = await window.ordax.workspace();
orchestrationUi=mountOrchestratorUi({api:window.ordax,onSelectRightPane:selectRightPane,
  onNavigationChange:async navigation=>{
    try {return await persistWorkspaceNavigation(navigation);}
    catch {$('#orchestrationNotice').textContent='A navegação atual não foi salva para o próximo início.';return false;}
  },
  canStartMission:()=>composeAvailability.allowed===true&&!submittingTaskId,
  onStartMission:async({taskId,mission})=>{
    await loadTasks();await openTask(taskId);
    if(currentTaskId!==taskId)return false;
    return submitTaskMessage(mission);
  },
  onScopeChange:async ids=>{
    scopedTaskIds=ids;
    if(currentTaskId && (ids?!ids.has(currentTaskId):allTasks.find(t=>t.id===currentTaskId)?.lab_binding)) {
      flushDraft();currentTaskId=null;currentTask=null;navigationEpoch++;
      $('#taskPanel').classList.add('hidden');$('#empty').classList.remove('hidden');
      syncComposerAvailability();
    }
    try {await loadTasks();}
    catch {
      renderTaskList();
      $('#orchestrationNotice').textContent='A lista de conversas não pôde ser atualizada. Confira a conexão antes de continuar.';
    }
  },
  onOpenWork:async id=>{await loadTasks();await openTask(id);},
  onShowCoordinator:async()=>{
    document.body.classList.add('orchestrator-focus');
    $('#orchestratorWorkRail').hidden=false;
    flushDraft();await selectRightPane('provider');
    currentTaskId=null;currentTask=null;navigationEpoch++;syncComposerAvailability();
    $('#taskPanel').classList.add('hidden');$('#empty').classList.add('hidden');
  }
});
const savedNavigation=workspace?.metadata?.navigation;
await orchestrationUi.start({restoreNavigation:savedNavigation});
await loadTasks();
if(savedNavigation?.schema==='ordax.workspace-navigation.v1'&&savedNavigation.view==='task'&&typeof savedNavigation.taskId==='string') {
  const task=allTasks.find(item=>item.id===savedNavigation.taskId);
  const inScope=task&&(scopedTaskIds?scopedTaskIds.has(task.id):!task.lab_binding);
  if(inScope)await openTask(task.id);
  else if(orchestrationUi.hasOrchestrator?.())await orchestrationUi.showCoordinator();
  else await persistWorkspaceNavigation({view:'home',taskId:null});
}
refreshProvider();
setInterval(refreshProvider, 1500);

function syncChatGPTPlanPanel() {
  const panel=document.getElementById('chatgptPlanSettings');
  if(window.ordaxHost?.hostMode!==true) {
    if(panel)panel.hidden=true;
    return;
  }
  if(panel)panel.hidden=false;
  const state=document.getElementById('chatgptPlanState');
  const connect=document.getElementById('chatgptPlanConnect');
  const disconnect=document.getElementById('chatgptPlanDisconnect');
  if(!state||!connect||!disconnect)return;
  state.textContent=hostChatGPTPlan.authorized
    ?`ChatGPT Plan autorizado${hostChatGPTPlan.email?` para ${hostChatGPTPlan.email}`:''}. A autorização fica no cofre seguro do Windows e é retomada ao reabrir enquanto continuar válida.`
    :hostChatGPTPlan.connected
      ?'Conta conectada, mas o uso do plano ChatGPT não foi autorizado. Reconecte e conceda a permissão de inferência.'
      :hostChatGPTPlan.secureStorageAvailable===false
        ?'O cofre seguro de credenciais deste dispositivo não está disponível. O app não salvará tokens em texto puro.'
        :'Nenhuma conta ChatGPT conectada.';
  connect.textContent=hostChatGPTPlan.connected?'Reconectar / autorizar ChatGPT':'Continuar com ChatGPT';
  connect.disabled=hostChatGPTPlan.secureStorageAvailable===false;
  disconnect.hidden=!hostChatGPTPlan.connected;
}
document.getElementById('chatgptPlanConnect').addEventListener('click',async event=>{
  const button=event.currentTarget;
  button.disabled=true;
  document.getElementById('chatgptPlanState').textContent='Abrindo o login oficial do ChatGPT nesta aba…';
  try {await window.ordax.chatgptPlanLogin();}
  catch(error) {
    document.getElementById('chatgptPlanState').textContent=error?.code==='chatgpt_secure_storage_unavailable'
      ?'O cofre seguro do Windows não está disponível; o login foi bloqueado para proteger os tokens.'
      :'Não foi possível iniciar o login oficial. Confira se o Host local ainda está ativo e tente novamente.';
    button.disabled=false;
  }
});
document.getElementById('chatgptPlanDisconnect').addEventListener('click',async event=>{
  if(!window.confirm('Desconectar a conta ChatGPT deste perfil do OrdaX?'))return;
  const button=event.currentTarget;button.disabled=true;
  try {
    await window.ordax.chatgptPlanDisconnect();
    hostChatGPTPlan={connected:false,authorized:false,secureStorageAvailable:true,email:null};
    syncChatGPTPlanPanel();applyHostProviderLimit();
    await orchestrationUi?.refreshStatus?.();
  } catch {document.getElementById('chatgptPlanState').textContent='Não foi possível remover os tokens do cofre seguro.';}
  finally {button.disabled=false;}
});
const chatgptCallback=new URLSearchParams(location.search).get('chatgpt');
if(chatgptCallback) {
  const callbackMessages={connected:'ChatGPT Plan autorizado. Ative o chat do coordenador para começar a conversar.',
    consent:'Conta conectada; a permissão de uso do plano ChatGPT ainda precisa ser concedida.',
    denied:'O login foi cancelado; nenhuma credencial foi substituída.',
    error:'O login não foi concluído. Verifique a conexão e tente novamente.'};
  document.getElementById('orchestrationNotice').textContent=callbackMessages[chatgptCallback]||'';
  history.replaceState(null,'',location.pathname+location.hash);
}

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

const labKeyForm=document.getElementById('labSupervisorKeyForm');
const labKeyInput=document.getElementById('labSupervisorKeyInput');
const labKeySave=document.getElementById('labSupervisorKeySave');
const labKeyRemove=document.getElementById('labSupervisorKeyRemove');
const labKeyState=document.getElementById('labSupervisorKeyState');
let labStatus=await window.ordax.supervisorStatus().catch(()=>({enabled:false,configured:false,secureStorageAvailable:false}));
const canConfigureLabKey=()=>labStatus.secureStorageAvailable===true;
function showSupervisorStatus() {
  document.getElementById('brandMode').textContent=labStatus.environment==='node_host'
    ? 'Orchestrator • Host Node de desenvolvimento'
    : 'Orchestrator Lab • aplicativo desktop';
  document.getElementById('labVersion').textContent=labStatus.environment==='node_host'
    ? 'OrdaX Orchestrator • Host Node (desenvolvimento)'
    : labStatus.version?'OrdaX Orchestrator Lab v'+labStatus.version:'Versão do Lab indisponível';
  labState.textContent=labStatus.enabled
    ? 'Supervisor habilitado no ambiente Dev: cada mensagem proposta exige aprovação.'
    : 'Supervisor desativado. A configuração da chave não inicia comandos nem faz chamadas à API.';
  labPlanButton.disabled=!labStatus.enabled;
  const available=canConfigureLabKey();
  labKeySave.disabled=!available;
  labKeySave.textContent='Salvar chave no cofre do Windows';
  labKeyRemove.disabled=!labStatus.keySaved;
  labKeyRemove.textContent='Remover chave';
  labKeyState.textContent=!available
    ? 'Cofre seguro do Windows indisponível: a chave não será armazenada.'
    : labStatus.keySaved
      ? 'Chave Groq salva no cofre seguro do Windows e recuperada ao reabrir o app; conexão ainda não testada.'
      : labStatus.credentialSource==='environment'
        ? 'Chave definida pelo ambiente; não é exibida nem persistida pelo app. Nenhuma conexão foi testada.'
        : 'Nenhuma chave cadastrada. Salvar não ativa o supervisor.';
}
showSupervisorStatus();
async function refreshOrchestrationProviderStatus(){
  try{await orchestrationUi?.refreshStatus?.();}
  catch{
    const connection=document.getElementById('orchestrationConnection');
    if(connection)connection.textContent='A chave foi alterada, mas o estado do chat por API não atualizou. Recarregue a página para sincronizar.';
  }
}
labKeyForm.addEventListener('submit',async event=>{
  event.preventDefault();
  labKeySave.disabled=true;
  try{
    await window.ordax.supervisorSaveKey(labKeyInput.value.trim());
    labKeyInput.value='';
    try{
      labStatus=await window.ordax.supervisorStatus();
      showSupervisorStatus();
    }catch{
      labKeyState.textContent='Chave salva, mas o estado local não atualizou. Recarregue a página para sincronizar.';
    }
    await refreshOrchestrationProviderStatus();
  }catch(error){
    labKeyInput.value='';
    labKeyState.textContent=error?.message?.includes('supervisor_key_invalid_format')
      ? 'Formato inválido. Use uma chave Groq iniciada por gsk_.'
      : 'O cofre seguro do Windows não aceitou a chave; ela não foi salva.';
  }finally{labKeySave.disabled=!canConfigureLabKey();}
});
labKeyRemove.addEventListener('click',async()=>{
  labKeyRemove.disabled=true;
  labKeyInput.value='';
  try{
    await window.ordax.supervisorRemoveKey();
    try{
      labStatus=await window.ordax.supervisorStatus();
      showSupervisorStatus();
    }catch{
      labKeyState.textContent='Remoção concluída, mas o estado local não atualizou. Recarregue a página para sincronizar.';
    }
    await refreshOrchestrationProviderStatus();
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
