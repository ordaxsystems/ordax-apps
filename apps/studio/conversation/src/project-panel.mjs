import { changePreview } from './changes.mjs';
import { workspaceTools, workspaceText, workspaceResultBelongs } from './workspace-results.mjs';
import { bindingEquals } from './project-organization.mjs';
import { operationLabels as labels, operationPending as pending, operationBlocking, visibleOperations, operationReceipt } from './runtime-activity.mjs';
import { deviceAvailable, deviceLabel, deviceStatus } from './runtime-targets.mjs';

const resultData = op => op?.result?.data || op?.result || {};

export function createProjectPanel({ host, attach, notify, onProjectConversations }) {
  const $ = id => document.getElementById(id);
  let state = { targets: [], operations: [] }, refreshPromise = null, submitting = 0, file = null, entries = [], proposal = null, reviewed = null, stamp = '', handled = new Set();
  let continuityProposal = null, contextResult = null, continuityBase = null;
  let desiredBinding = null;
  const dirty = () => file && $('projectEditor').value !== file.content;
  const continuityDirty = () => Boolean($('studioSummary').value.trim() || $('studioNextAction').value.trim());
  const selected = () => ({ deviceId: $('runtimeDevice').value, project: $('runtimeProject').value });
  const currentBinding = () => selected().deviceId && selected().project ? selected() : null;
  function assertContext(binding) {
    if (bindingEquals(binding, currentBinding())) return;
    $('activityScope').value = 'project';
    if (dirty() || continuityDirty()) throw new Error('Revise ou descarte as alterações do espaço de trabalho antes de trocar de projeto.');
    if (submitting || state.operations.some(op => pending(op) || op.status === 'uncertain')) throw new Error('Confira a operação do Runtime antes de trocar de projeto.');
  }
  function setContext(binding) {
    assertContext(binding); desiredBinding = binding;
    if (bindingEquals(binding, currentBinding())) return;
    file = null; entries = []; reviewed = null; proposal = null; clearProjectTools();
    $('projectEditor').value = ''; $('projectReviewArea').hidden = true; $('projectPath').value = '.';
    $('runtimeProject').replaceChildren(new Option('Selecione um projeto', ''));
    if (binding) {
      if (![...$('runtimeDevice').options].some(option => option.value === binding.deviceId)) $('runtimeDevice').append(new Option('Dispositivo vinculado', binding.deviceId));
      $('runtimeDevice').value = binding.deviceId;
      $('runtimeProject').append(new Option(binding.project, binding.project)); $('runtimeProject').value = binding.project;
      message(state.connected ? 'Projeto vinculado. Consulte o contexto ou os arquivos deste projeto.' : 'Projeto vinculado. Conecte o Runtime para consultar o dispositivo autorizado.');
    } else { $('runtimeDevice').value = ''; message('Selecione um projeto autorizado para abrir o espaço de trabalho.'); }
    renderEntries(); renderOperations(); controls();
  }
  const message = text => { $('projectNotice').textContent = text; };
  const task = fn => Promise.resolve().then(fn).catch(error => message(error.message));
  const workspaceVisible = () => !$('projectDialog').hidden;
  function showWorkspace(visible) {
    $('projectDialog').hidden = !visible;
    $('conversation').hidden = visible;
    document.querySelector('.composer-area').hidden = visible;
    $('openProject').setAttribute('aria-pressed', String(visible));
    if (!visible) $('prompt').focus();
  }
  function tab(id) {
    $('projectDialog').dataset.activeTab = id;
    $('projectTitle').textContent = id === 'studioActivity' ? 'Atividade do projeto' : id === 'studioContinuity' ? 'Contexto e continuidade' : 'Espaço de trabalho';
    for (const button of document.querySelectorAll('[data-studio-tab]')) {
      const active = button.dataset.studioTab === id;
      button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
      $(button.dataset.studioTab).hidden = !active;
    }
  }
  function clearProjectTools() {
    continuityProposal = null; contextResult = null; continuityBase = null; $('studioContinuityReviewArea').hidden = true;
    $('studioContextSource').textContent = 'Nenhum contexto recuperado. Consulte o Runtime autorizado para este projeto.';
    $('studioSummary').value = ''; $('studioNextAction').value = '';
    for (const tool of Object.values(workspaceTools)) $(tool.target).textContent = 'Consulte o projeto selecionado para atualizar.';
  }
  function controls() {
    const active = submitting || state.operations.some(pending), blocked = active || state.recoveryRequired || state.operations.some(op => op.status === 'uncertain');
    const ready = deviceAvailable(state, selected().deviceId) && selected().project;
    $('workspaceProjectConversations').disabled = blocked || !ready || !onProjectConversations;
    for (const id of ['studioGitStatus','studioGitDiff','studioSearchRun','studioBriefing','studioContinuityRead','studioPreviewStatus','studioContinuityReview']) $(id).disabled = blocked || !ready;
    $('studioContinuityReview').disabled ||= !continuityBase;
    $('studioContinuityApply').disabled = blocked || !ready || !continuityProposal;
    $('studioContextAttach').disabled = !contextResult || blocked;
    $('runtimeConnect').disabled = active || state.recoveryRequired || Boolean(dirty()) || continuityDirty() || !state.configured;
    $('runtimeConnect').textContent = state.connected ? 'Reconectar Runtime' : 'Conectar Runtime';
    $('runtimeDevice').disabled = blocked || !state.connected || dirty() || continuityDirty(); $('runtimeProject').disabled = blocked || !state.connected || dirty() || continuityDirty();
    $('studioSummary').disabled = blocked; $('studioNextAction').disabled = blocked;
    $('projectList').disabled = blocked || !ready || dirty(); $('projectPath').disabled = blocked || !ready || dirty();
    $('projectEditor').disabled = blocked || !file;
    $('projectAttach').disabled = !file || dirty() || blocked; $('projectDiscard').disabled = !dirty() || active;
    $('projectReview').disabled = !dirty() || blocked; $('projectApply').disabled = reviewed?.kind !== 'write' || blocked || !ready;
    $('terminalReview').disabled = blocked || !ready; $('terminalRun').disabled = blocked || !ready || !reviewed || reviewed.kind !== 'terminal';
    for (const button of $('projectFiles').querySelectorAll('button')) button.disabled = blocked || dirty() || !ready;
    $('runtimeState').textContent = state.recoveryRequired ? 'Registro local requer recuperação' : state.connected ? state.catalogAvailable === false ? 'Consulta de disponibilidade interrompida' : 'Plataforma conectada' : state.configured ? 'Conexão disponível' : 'Conexão não configurada';
    $('runtimeDeviceStatus').textContent = deviceStatus(state, selected().deviceId);
    for (const option of $('runtimeDevice').options) {
      const target = state.targets?.find(item => item.deviceId === option.value);
      if (target) option.textContent = deviceLabel(target);
    }
    $('runtimeHelp').hidden = Boolean(state.configured);
    $('projectFileInfo').textContent = file ? `${file.path} · ${dirty() ? 'Alteração ainda não aplicada' : 'Versão lida do Runtime'}` : 'Selecione um arquivo de texto para abrir.';
  }
  function renderOperations() {
    const count = state.operations.filter(operationBlocking).length;
    $('openActivity').textContent = count ? `Atividade (${count})` : 'Atividade';
    $('projectActivitySummary').textContent = state.recoveryRequired ? 'O registro local precisa ser recuperado. Novos envios estão bloqueados.' : count ? `${count} operação aguardando conclusão ou conferência. Consulte Atividade.` : 'Nenhuma operação em andamento.';
    const shown = visibleOperations(state.operations, selected(), $('activityScope').value === 'all');
    const next = JSON.stringify([selected(), $('activityScope').value, shown.map(op => [op.id, op.status, op.error, op.finishedAt])]);
    if (next === stamp) return; stamp = next; $('projectOperations').replaceChildren();
    $('activityEmpty').hidden = shown.length > 0;
    $('activityProjectName').textContent = selected().project ? `Projeto: ${selected().project}` : 'Selecione um projeto na lateral para ver seu histórico, ou escolha Todos os projetos.';
    for (const op of shown) {
      const item = document.createElement('details'); item.className = 'project-operation';
      const summary = document.createElement('summary'); summary.textContent = `${labels[op.status] || op.status} · ${op.label}`; item.append(summary);
      const receipt = document.createElement('small'); receipt.textContent = op.requestId ? `Registro Runtime: ${op.requestId}` : `Registro local: ${op.id}`; item.append(receipt);
      const scope = document.createElement('p'); scope.textContent = `Projeto: ${op.project || 'Catálogo do dispositivo'} · Dispositivo: ${op.deviceId}`; item.append(scope);
      const date = new Date(op.createdAt), when = document.createElement('small'); when.textContent = Number.isNaN(date.getTime()) ? 'Horário não disponível' : `Início: ${date.toLocaleString()}`; item.append(when);
      const copy = document.createElement('button'); copy.textContent = 'Copiar recibo'; copy.addEventListener('click', () => task(async () => { await navigator.clipboard.writeText(operationReceipt(op)); copy.textContent = 'Recibo copiado'; })); item.append(copy);
      if (op.error) { const error = document.createElement('p'); error.textContent = op.error; item.append(error); }
      if (op.result) { const output = document.createElement('pre'); output.textContent = JSON.stringify(op.result, null, 2); item.append(output); }
      if (op.status === 'uncertain') {
        const help = document.createElement('p'); help.textContent = 'Confira o dispositivo e o registro do Runtime antes de liberar outra operação. O app não repetirá este envio.';
        const button = document.createElement('button'); button.textContent = 'Conferi o Runtime · liberar operações';
        button.addEventListener('click', () => task(async () => { state = await host.runtimeReview(op.id); renderOperations(); controls(); })); item.append(help, button);
      }
      $('projectOperations').append(item);
    }
  }
  function renderEntries() {
    $('projectFiles').replaceChildren();
    const query = $('projectFilter').value.trim().toLowerCase();
    for (const entry of entries.filter(e => e.path.toLowerCase().includes(query))) {
      const button = document.createElement('button'); button.className = 'project-file'; button.textContent = `${entry.kind === 'directory' ? '▸' : '▤'} ${entry.path}`; button.title = entry.path;
      button.addEventListener('click', () => task(() => {
        if (dirty()) return message('Revise ou descarte a edição antes de trocar de arquivo.');
        if (entry.kind === 'directory') { $('projectPath').value = entry.path; return submit({ kind: 'directory', path: entry.path }); }
        return submit({ kind: 'read', path: entry.path });
      })); $('projectFiles').append(button);
    }
    controls();
  }
  function handleResults() {
    for (const op of state.operations) {
      if (handled.has(op.id) || pending(op)) continue; handled.add(op.id);
      if (op.status !== 'succeeded') continue;
      const data = resultData(op);
      if (op.deviceId !== selected().deviceId) continue;
      if (op.kind === 'projects') {
        $('runtimeProject').replaceChildren(new Option('Selecione um projeto', ''));
        for (const project of data.projects || []) if (typeof project.slug === 'string') $('runtimeProject').append(new Option(project.name || project.slug, project.slug));
        const wanted = desiredBinding?.deviceId === selected().deviceId ? desiredBinding.project : data.default_project;
        if ([...$('runtimeProject').options].some(o => o.value === wanted)) $('runtimeProject').value = wanted;

      }
      if (op.project !== selected().project) continue;
      if (workspaceTools[op.kind] && workspaceResultBelongs(op, selected())) {
        const tool = workspaceTools[op.kind], text = workspaceText(op.kind, op.result);
        $(tool.target).textContent = text;
        if (['briefing','continuity','continuitySave'].includes(op.kind)) {
          contextResult = { ...selected(), name: tool.title, text };
          $('studioContextSource').textContent = `Fonte: Runtime · Projeto ${op.project} · Recibo ${op.requestId} · ${new Date(op.finishedAt || op.createdAt).toLocaleString()}. Use o resultado no rascunho e revise antes de enviar ao ChatGPT.`;
        }
        if (['continuity','continuitySave'].includes(op.kind) && Object.hasOwn(data, 'state')) {
          const saved = data.state;
          if (saved == null || (typeof saved === 'object' && !Array.isArray(saved))) continuityBase = { completed: saved?.completed ?? [], blockers: saved?.blockers ?? [], changedPaths: saved?.changed_paths ?? [] };
        }
        if (op.kind === 'continuitySave') { $('studioSummary').value = ''; $('studioNextAction').value = ''; }
        message(`${tool.title} atualizado.`);
      }
      if (op.kind === 'directory') { entries = (Array.isArray(data.entries) ? data.entries : []).map(e => ({ ...e, path: e.relative_path || e.path })).filter(e => typeof e.path === 'string' && ['file','directory'].includes(e.kind)); renderEntries(); message(data.truncated ? 'A lista foi limitada. Abra uma subpasta para continuar.' : `${entries.length} itens encontrados.`); }
      if (op.kind === 'read') {
        if (typeof data.content !== 'string' || !/^[a-f0-9]{64}$/.test(data.sha256 || '') || (data.end_line !== undefined && data.end_line < data.line_count)) { message('O Runtime retornou somente parte do arquivo. Escolha um arquivo menor para editar.'); continue; }
        file = { ...selected(), path: data.relative_path || data.path || op.path, content: data.content, sha256: data.sha256 };
        $('projectEditor').value = proposal ?? file.content; proposal = null; reviewed = null; $('projectReviewArea').hidden = true; message('Arquivo aberto. Edite e revise a alteração antes de aplicar.');
      }
      if (op.kind === 'write') {
        if (file?.path === op.path) { message('Alteração aplicada pelo Runtime. Lendo a nova versão…'); file = null; $('projectEditor').value = ''; task(() => submit({ kind: 'read', path: op.path })); }
      }
    }
  }
  async function refresh({ fresh = false } = {}) {
    if (!host.runtimeState) return;
    if (refreshPromise) { await refreshPromise; if (!fresh) return; }
    if (refreshPromise) return refresh({ fresh });
    refreshPromise = (async () => {
      try { state = { ...state, ...await host.runtimeState(state.version) }; handleResults(); renderOperations(); controls(); if (state.issue || state.targetIssue) message(state.issue || state.targetIssue); }
      catch (error) { message(error.message); }
    })().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }
  async function submit(data) {
    submitting++; controls();
    try { const op = await host.runtimeSubmit({ ...selected(), ...data }); state.operations.push(op); message(`${labels[op.status]} · ${op.label}`); }
    catch (error) { await refresh(); throw error; }
    finally { await refresh({ fresh: true }); submitting--; controls(); }
  }
  let localObservationInFlight = false;
  async function refreshLocalObservation() {
    const el = $('localRuntimeObservation'), check = $('localRuntimeCheck');
    if (localObservationInFlight || !host.localRuntimeObservation) return;
    localObservationInFlight = true;
    check.disabled = true;
    el.textContent = 'Consultando serviço local — isto não autoriza ações.';
    try {
      const observation = await host.localRuntimeObservation();
      if (observation?.schema !== 'ordax.studio-local-runtime-observation/1'
          || observation.authorization !== 'not-established' || observation.canExecute !== false) {
        el.textContent = 'Resposta local incompatível. Nenhuma autorização concedida.';
      } else if (observation.observed === true
          && typeof observation.version === 'string' && /^[0-9.]{1,20}$/.test(observation.version)
          && typeof observation.state === 'string' && /^[a-z0-9-]{1,64}$/.test(observation.state)) {
        el.textContent = `Serviço local respondeu (v${observation.version}; estado: ${observation.state}). Isso NÃO confirma identidade, conta, grants ou execução.`;
      } else {
        el.textContent = 'Serviço local não confirmado. Conecte o Product Runtime com sessão e permissões válidas para operar projetos.';
      }
    } catch {
      el.textContent = 'Serviço local indisponível. Nenhum comando foi enviado.';
    } finally {
      localObservationInFlight = false;
      check.disabled = false;
    }
  }
  $('localRuntimeCheck').disabled = typeof host.localRuntimeObservation !== 'function';
  if ($('localRuntimeCheck').disabled) $('localRuntimeObservation').textContent = 'Observação do serviço local não disponível neste host. Nenhuma autorização foi inferida.';
  $('localRuntimeCheck').addEventListener('click', () => { void refreshLocalObservation(); });
  async function open() { showWorkspace(true); await refresh(); void refreshLocalObservation(); }
  $('openProject').addEventListener('click', () => task(open));
  $('openActivity').addEventListener('click', () => task(async () => { await open(); tab('studioActivity'); $('studioTabActivity').focus(); }));
  $('openContext').addEventListener('click', () => task(async () => { await open(); tab('studioContinuity'); $('studioTabContinuity').focus(); }));
  $('activityScope').addEventListener('change', renderOperations);
  $('activityRefresh').addEventListener('click', () => task(() => refresh({ fresh: true })));
  $('projectClose').addEventListener('click', () => { if (dirty()) { message('Revise ou descarte a edição antes de fechar.'); return; } showWorkspace(false); });
  $('runtimeConnect').addEventListener('click', () => task(async () => {
    submitting++; controls();
    try {
      state = await host.runtimeConnect(); handled = new Set(state.operations.map(op => op.id));
      file = null; reviewed = null; entries = []; clearProjectTools(); $('projectEditor').value = ''; $('projectReviewArea').hidden = true; $('runtimeProject').replaceChildren(); renderEntries();
      $('runtimeDevice').replaceChildren(new Option('Selecione um dispositivo', ''));
      for (const device of state.targets) $('runtimeDevice').append(new Option(deviceLabel(device), device.deviceId));
      const deviceId = desiredBinding ? state.targets.find(target => target.deviceId === desiredBinding.deviceId)?.deviceId : state.targets.length === 1 ? state.targets[0].deviceId : null;
      if (deviceId) { $('runtimeDevice').value = deviceId; if (deviceAvailable(state, deviceId)) await submit({ kind: 'projects' }); }
      message(state.targetIssue || (state.targets.length ? 'Selecione o projeto autorizado para começar.' : 'Nenhum dispositivo autorizado disponível.'));
    } finally { submitting--; controls(); }
  }));
  $('runtimeDevice').addEventListener('change', () => task(async () => { desiredBinding = null; file = null; reviewed = null; entries = []; clearProjectTools(); $('projectEditor').value = ''; $('projectReviewArea').hidden = true; $('runtimeProject').replaceChildren(); renderEntries(); controls(); if (deviceAvailable(state, selected().deviceId)) await submit({ kind: 'projects' }); }));
  $('runtimeProject').addEventListener('change', () => { desiredBinding = currentBinding(); file = null; reviewed = null; entries = []; clearProjectTools(); $('projectReviewArea').hidden = true; $('projectPath').value = '.'; $('projectEditor').value = ''; $('activityScope').value = 'project'; renderEntries(); renderOperations(); controls(); });
  $('projectList').addEventListener('click', () => task(() => submit({ kind: 'directory', path: $('projectPath').value })));
  $('projectFilter').addEventListener('input', renderEntries);
  $('projectEditor').addEventListener('input', () => { reviewed = null; $('projectReviewArea').hidden = true; controls(); });
  $('projectDiscard').addEventListener('click', () => { $('projectEditor').value = file.content; reviewed = null; $('projectReviewArea').hidden = true; controls(); });
  $('projectAttach').addEventListener('click', () => task(async () => { await attach({ kind: 'text', name: `${file.project}/${file.path}`.slice(0, 240), text: file.content }); showWorkspace(false); notify('Arquivo adicionado ao contexto da próxima mensagem.'); }));
  function review(value, description) { reviewed = Object.freeze(value); $('projectReviewDescription').textContent = description; $('projectReviewArea').hidden = false; controls(); requestAnimationFrame(() => $('projectReviewArea').scrollIntoView({ block: 'nearest' })); }
  $('projectReview').addEventListener('click', () => {
    review({ deviceId: file.deviceId, project: file.project, kind: 'write', path: file.path, content: $('projectEditor').value, expectedSha256: file.sha256 }, `Alterar ${file.project}/${file.path} em ${file.deviceId}. O Runtime recusará a gravação se o arquivo tiver mudado.`);
    $('projectDiff').textContent = changePreview(file.content, reviewed.content); $('projectApply').hidden = false; $('terminalRun').hidden = true;
  });
  $('projectApply').addEventListener('click', () => task(async () => { const current = reviewed; if (current?.kind !== 'write') return; reviewed = null; $('projectReviewArea').hidden = true; await submit(current); }));
  $('terminalReview').addEventListener('click', () => task(() => {
    const argv = JSON.parse($('terminalArgv').value);
    if (!Array.isArray(argv) || !argv.length || argv.some(a => typeof a !== 'string' || !a)) throw new Error('Informe os argumentos como uma lista JSON de textos.');
    review({ ...selected(), kind: 'terminal', argv, cwd: $('terminalCwd').value }, `Executar no dispositivo ${selected().deviceId}, projeto ${selected().project}, diretório ${$('terminalCwd').value}.`);
    $('projectDiff').textContent = JSON.stringify(argv, null, 2); $('projectApply').hidden = true; $('terminalRun').hidden = false;
  }));
  for (const id of ['terminalArgv','terminalCwd']) $(id).addEventListener('input', () => { if (reviewed?.kind === 'terminal') { reviewed = null; $('projectReviewArea').hidden = true; controls(); } });
  $('terminalRun').addEventListener('click', () => task(async () => { const current = reviewed; if (current?.kind !== 'terminal') return; reviewed = null; $('projectReviewArea').hidden = true; await submit(current); }));
  for (const button of document.querySelectorAll('[data-studio-tab]')) {
    button.addEventListener('click', () => tab(button.dataset.studioTab));
    button.addEventListener('keydown', event => {
      const buttons = [...document.querySelectorAll('[data-studio-tab]')], index = buttons.indexOf(button);
      const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
      if (next === null) return; event.preventDefault(); tab(buttons[next].dataset.studioTab); buttons[next].focus();
    });
  }
  for (const [id, kind] of Object.entries({ studioGitStatus: 'gitStatus', studioGitDiff: 'gitDiff', studioPreviewStatus: 'preview', studioBriefing: 'briefing', studioContinuityRead: 'continuity', studioSearchRun: 'search' })) {
    $(id).addEventListener('click', () => task(() => submit({ kind, ...(['search','briefing'].includes(kind) ? { query: kind === 'search' ? $('studioSearchQuery').value : '' } : {}) })));
  }
  $('studioContextAttach').addEventListener('click', () => task(async () => {
    if (!contextResult || !workspaceResultBelongs(contextResult, selected())) throw new Error('Consulte novamente o contexto do projeto selecionado.');
    await attach({ kind: 'text', name: `${selected().project}/${contextResult.name}`, text: contextResult.text });
    if (!dirty()) showWorkspace(false); notify('Contexto adicionado ao rascunho para revisão.');
  }));
  $('studioContinuityReview').addEventListener('click', () => {
    if (!$('studioSummary').value.trim()) return message('Informe um resumo antes de revisar.');
    if (!continuityBase) return message('Consulte a continuidade para preservar o registro existente antes de salvar.');
    continuityProposal = Object.freeze({ ...selected(), ...structuredClone(continuityBase), kind: 'continuitySave', summary: $('studioSummary').value, nextAction: $('studioNextAction').value });
    $('studioContinuityProposal').textContent = JSON.stringify(continuityProposal, null, 2); $('studioContinuityReviewArea').hidden = false; controls();
  });
  function invalidateContinuity() { continuityProposal = null; $('studioContinuityReviewArea').hidden = true; controls(); }
  for (const id of ['studioSummary','studioNextAction']) $(id).addEventListener('input', invalidateContinuity);
  $('studioContinuityCancel').addEventListener('click', invalidateContinuity);
  $('studioContinuityDiscard').addEventListener('click', () => { $('studioSummary').value = ''; $('studioNextAction').value = ''; invalidateContinuity(); });
  $('studioContinuityApply').addEventListener('click', () => task(async () => { const value = continuityProposal; if (!value) return; continuityBase = null; invalidateContinuity(); await submit(value); }));
  const timer = setInterval(() => { if (workspaceVisible() || state.operations.some(pending)) refresh(); }, 1000);
  $('workspaceProjectConversations').addEventListener('click', () => task(() => onProjectConversations({ binding: selected(), name: $('runtimeProject').selectedOptions[0]?.textContent || selected().project })));
  window.addEventListener('beforeunload', () => clearInterval(timer));
  return { assertContext, setContext, showConversation: () => showWorkspace(false), canClose: () => !dirty() && !continuityDirty(), async propose(content) { await open(); tab('studioFiles'); if (dirty()) { message('Revise ou descarte a edição atual antes de preparar outra proposta.'); return; } if (file) { $('projectEditor').value = content; controls(); } else { proposal = content; message('Selecione um projeto e abra o arquivo que receberá este código. A proposta ficará pronta para revisão.'); } } };
}
