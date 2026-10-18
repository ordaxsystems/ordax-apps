import { relayAdminReadiness } from './relay-readiness.mjs';
import { operationLabels } from './runtime-activity.mjs';

// Presentation only: Product and the existing Relay observer remain the owners.
// No inference, credentials, client pairing, new broker or remote chat history.
const IN_FLIGHT = new Set(['prepared', 'submitting', 'queued', 'running']);
const OPEN = new Set([...IN_FLIGHT, 'uncertain']);
const VALID = new Set([...OPEN, 'succeeded', 'failed', 'cancelled', 'not-sent', 'reviewed']);
const idValid = value => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
const textSafe = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 128) : '';
const whenValid = value => typeof value === 'string' && value.length < 50 && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString() : null;
const isCount = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;

export function centralViewModel(raw, observation) {
  const safe = relayAdminReadiness(raw);
  const lab = observation?.schema === 'ordax.studio-relay-observation/1'
    && observation.state === 'connected-laboratory'
    && isCount(observation.clients, 32) && isCount(observation.active, 32)
    && isCount(observation.retained, 128) && isCount(observation.failures, 128)
    && observation.failures <= observation.retained
    ? { state: 'laboratory', clients: observation.clients, active: observation.active,
      retained: observation.retained, failures: observation.failures }
    : { state: 'unavailable' };
  if (safe.state !== 'product-connected') {
    return { state: raw?.accountConnected === true ? 'account-connected' : 'unavailable',
      devices: [], operations: [], total: null, reportedOnline: null,
      pending: null, uncertain: null, lab };
  }
  const receipts = raw.operations;
  if (receipts.some(op => !VALID.has(op.status) || !idValid(op.deviceId))) {
    return { state: 'unavailable', devices: [], operations: [], total: null, reportedOnline: null,
      pending: null, uncertain: null, lab };
  }
  const operations = receipts.filter(op => raw.targets.some(target => target.deviceId === op.deviceId)).map(op => ({
    // Whitelist published receipt metadata; never project prompts, paths,
    // private results or credentials into the operator workspace.
    deviceId: op.deviceId, status: op.status,
    id: idValid(op.requestId) ? op.requestId : idValid(op.id) ? op.id : null,
    kind: textSafe(op.kind) || 'Operação',
    createdAt: whenValid(op.createdAt),
    finishedAt: whenValid(op.finishedAt),
  })).sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  const devices = raw.targets.map(target => {
    const operations = receipts.filter(op => op.deviceId === target.deviceId);
    return { id: target.deviceId, name: textSafe(target.name) || target.deviceId,
      reportedOnline: target.online, lastSeenAt: whenValid(target.lastSeenAt),
      operations: operations.length, active: operations.filter(op => IN_FLIGHT.has(op.status)).length,
      uncertain: operations.filter(op => op.status === 'uncertain').length,
      failed: operations.filter(op => op.status === 'failed').length };
  });
  devices.sort((a, b) =>
    (b.reportedOnline === true ? 2 : b.reportedOnline === null ? 1 : 0)
    - (a.reportedOnline === true ? 2 : a.reportedOnline === null ? 1 : 0)
    || a.name.localeCompare(b.name, 'pt-BR'));
  return { state: 'product-connected', devices, operations,
    total: safe.deviceCount, reportedOnline: safe.reportedOnline,
    pending: operations.filter(op => IN_FLIGHT.has(op.status)).length,
    uncertain: operations.filter(op => op.status === 'uncertain').length, lab };
}
// Presentation of the already-authorized account capability; this never
// tries to mint credentials or infer grants from the ChatGPT Web login.
export function centralAccountCopy(connected, available, accountVerified = false) {
  if (connected) return Object.freeze({
    state: 'connected',
    label: 'Conectado',
    title: 'Computador disponível',
    description: 'Este computador está autorizado no OrdaX. As ações continuam limitadas pelas permissões concedidas.',
    action: 'Abrir configuração',
    hint: 'Abrir a configuração deste computador e das permissões do Runtime.',
    warning: 'Dispositivos autorizados não equivalem a clientes Relay conectados.',
  });
  if (accountVerified) return Object.freeze({
    state: 'account',
    label: 'Conta conectada',
    title: 'Autorizar observação deste computador',
    description: 'Sua Conta OrdaX está autenticada. Autorize somente observação deste computador para o cliente MCP consentido.',
    action: 'Autorizar observação',
    hint: 'Conceder somente o perfil computer-observe por 30 dias ao cliente MCP consentido.',
    warning: 'Conta OrdaX autenticada; acesso remoto ainda não autorizado. Nenhum computador foi presumido conectado.',
  });
  if (available === 'unavailable') return Object.freeze({
    state: 'unavailable',
    label: 'Runtime indisponível',
    title: 'Verificar instalação',
    description: 'Esta edição não expõe o login OrdaX integrado. Use o Studio instalado junto do Runtime oficial.',
    action: 'Verificar Runtime',
    hint: 'Abrir a configuração e o diagnóstico do Runtime instalado.',
    warning: 'Esta versão portátil não habilita login na Conta OrdaX. O acesso Product exige o Studio integrado ao Runtime oficial.',
  });
  if (available === 'available') return Object.freeze({
    state: 'disconnected',
    label: 'Não conectado',
    title: 'Conectar este computador',
    description: 'Entre na sua Conta OrdaX para registrar este PC pelo Runtime oficial e torná-lo disponível aos clientes autorizados.',
    action: 'Conectar este computador',
    hint: 'Abrir o login da Conta OrdaX e conectar este computador.',
    warning: 'Nenhum computador foi autorizado ainda.',
  });
  return Object.freeze({
    state: 'unknown',
    label: 'Verificando…',
    title: 'Conectar este computador',
    description: 'O Studio está verificando se o Runtime oficial oferece o login da Conta OrdaX.',
    action: 'Verificar Runtime',
    hint: 'Abrir a configuração do Runtime enquanto a disponibilidade da conta é verificada.',
    warning: 'A disponibilidade do Runtime ainda não foi confirmada.',
  });
}
function el(tag, className, label) {
  const node = document.createElement(tag);
  node.className = className;
  if (label !== undefined) node.textContent = label;
  return node;
}
// Refresh only while the operator page is visible, using the same Product
// read method as manual refresh. No background monitoring or new state owner.
export function centralPollDue({ checking, checkedAt, visible, now = Date.now() }) {
  return visible === true && checking !== true && checkedAt instanceof Date
    && Number.isFinite(checkedAt.getTime()) && Number.isFinite(now)
    && now - checkedAt.getTime() >= 30000;
}
// Bounded, read-only observations: an unresponsive host must not lock the
// operator controls forever. This does not cancel/reissue device operations.
const CENTRAL_READ_TIMEOUT_MS = 12000;
export function centralReadSources(host, accountHost, timeoutMs = CENTRAL_READ_TIMEOUT_MS) {
  const deadline = Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= CENTRAL_READ_TIMEOUT_MS
    ? timeoutMs : CENTRAL_READ_TIMEOUT_MS;
  const settle = read => new Promise(resolve => {
    let complete = false;
    const finish = result => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ status: 'rejected', reason: new Error('central-read-timeout') }), deadline);
    Promise.resolve().then(read).then(
      value => finish({ status: 'fulfilled', value }),
      reason => finish({ status: 'rejected', reason }),
    );
  });
  return Promise.all([
    settle(() => typeof host?.runtimeState === 'function' ? host.runtimeState() : Promise.reject(new Error('Product não integrado'))),
    settle(() => typeof host?.relayObservation === 'function' ? host.relayObservation() : Promise.reject(new Error('Relay não integrado'))),
    settle(() => typeof accountHost?.available === 'function' ? accountHost.available() : null),
  ]);
}

export function createCentralPanel({ host, openRuntime, accountHost }) {
  const $ = id => document.getElementById(id);
  let model = centralViewModel(null, null);
  let selected = null, checking = false, issue = '', checkedAt = null;
  let accountAvailability = 'unknown', observeAuthorized = false;
  let ownerAuthority = null, ownerIssue = '', ownerClientId = '';
  let filter = '', operationFilter = 'all';
  const metric = (id, value) => { $(id).textContent = value === null ? '—' : String(value); };
  function paint() {
    const connection = centralAccountCopy(model.state === 'product-connected', accountAvailability, model.state === 'account-connected');
    $('centralConnectionCard').dataset.state = connection.state;
    $('centralConnectionState').textContent = connection.label;
    $('centralConnectionTitle').textContent = connection.title;
    $('centralConnectionDescription').textContent = connection.description;
    const authorizeObserve = model.state === 'account-connected';
    $('centralConnect').disabled = checking || (authorizeObserve
      ? observeAuthorized || typeof accountHost?.authorizeObserve !== 'function'
      : typeof openRuntime !== 'function');
    $('centralConnect').textContent = authorizeObserve && observeAuthorized ? 'Observação autorizada' : connection.action;
    $('centralConnect').title = connection.hint;
    $('centralRefresh').disabled = checking;
    $('centralRefresh').textContent = checking ? 'Verificando…' : 'Atualizar estado';
    $('centralChecked').textContent = checking ? 'Consultando fontes autorizadas…'
      : checkedAt ? 'Última consulta: ' + checkedAt.toLocaleTimeString('pt-BR')
      : 'Sem consulta nesta sessão';
    metric('centralTotal', model.total);
    metric('centralOnline', model.reportedOnline);
    metric('centralActive', model.pending);
    metric('centralUncertain', model.uncertain);
    $('centralProductStatus').textContent = model.state === 'product-connected'
      ? 'Catálogo Product conectado · presença informada pela plataforma'
      : model.state === 'account-connected'
      ? observeAuthorized ? 'Conta OrdaX autenticada · observação MCP autorizada' : 'Conta OrdaX autenticada · acesso remoto não autorizado'
      : 'Product indisponível · nenhum dispositivo foi presumido conectado';
    const ownerReady = model.state === 'account-connected' && typeof accountHost?.ownerAuthority === 'function';
    $('centralOwnerPanel').hidden = !ownerReady;
    if (ownerReady) {
      const clients = Array.isArray(ownerAuthority?.clients) ? ownerAuthority.clients : [];
      const select = $('centralOwnerClient');
      const previous = ownerClientId;
      select.replaceChildren();
      const placeholder = document.createElement('option');
      placeholder.value = ''; placeholder.textContent = 'Selecione um cliente MCP consentido';
      select.append(placeholder);
      for (const client of clients) {
        const option = document.createElement('option');
        option.value = client.client_id;
        option.textContent = client.client_name + ' · ' + client.client_id;
        select.append(option);
      }
      ownerClientId = clients.some(client => client.client_id === previous)
        ? previous : clients.length === 1 ? clients[0].client_id : '';
      select.value = ownerClientId;
      select.disabled = checking || clients.length < 2;
      const grant = (ownerAuthority?.grant_groups || []).find(item => item.client_id === ownerClientId);
      $('centralOwnerAuthorizeFull').disabled = checking || !ownerClientId || Boolean(grant);
      $('centralOwnerRevokeFull').disabled = checking || !grant;
      $('centralOwnerStatus').textContent = ownerIssue || (!clients.length
        ? 'Nenhum cliente OAuth consentido encontrado para esta Conta OrdaX.'
        : !ownerClientId ? 'Há vários clientes: selecione o cliente MCP explicitamente.'
        : grant ? 'Acesso total remoto ativo para este cliente. Válido até ' +
          (grant.valid_until ? new Date(grant.valid_until).toLocaleString('pt-BR') : 'revogação')
        : 'Cliente selecionado. O acesso total remoto ainda não está concedido.');
    }
    $('centralWarning').textContent = issue || connection.warning;
    $('centralLabStatus').textContent = model.lab.state === 'laboratory'
      ? 'Laboratório local autenticado (não é produção)'
      : 'Relay não confirmado neste Studio';
    metric('centralLabClients', model.lab.state === 'laboratory' ? model.lab.clients : null);
    metric('centralLabRequests', model.lab.state === 'laboratory' ? model.lab.active : null);
    $('centralDeviceList').replaceChildren();
    const entries = model.devices.filter(device =>
      device.name.toLocaleLowerCase('pt-BR').includes(filter)
      || device.id.toLocaleLowerCase('pt-BR').includes(filter));
    $('centralDeviceEmpty').hidden = entries.length > 0;
    $('centralDeviceEmpty').textContent = model.state !== 'product-connected'
      ? model.state === 'account-connected'
        ? 'Conta autenticada. Autorize o Relay e os dispositivos antes de consultar.'
        : 'Conecte a Conta OrdaX ao Runtime para consultar os dispositivos.'
      : filter ? 'Nenhum dispositivo encontrado.' : 'Nenhum dispositivo autorizado foi informado.';
    if (!model.devices.some(d => d.id === selected)) selected = null;
    for (const device of entries) {
      const button = el('button', 'central-device-row');
      button.type = 'button'; button.dataset.centralDevice = device.id;
      button.setAttribute('aria-pressed', String(selected === device.id));
      const dot = el('span', 'central-presence'); dot.dataset.presence = String(device.reportedOnline);
      dot.setAttribute('aria-hidden', 'true');
      const details = el('span', 'central-device-name');
      details.append(el('strong', '', device.name), el('small', '', device.reportedOnline === true
        ? 'Informado online' : device.reportedOnline === false ? 'Informado offline' : 'Presença desconhecida'));
      const number = el('span', 'central-device-count', String(device.active));
      number.setAttribute('aria-label', device.active + ' operações pendentes');
      button.append(dot, details, number);
      button.addEventListener('click', () => { selected = device.id; paint(); });
      $('centralDeviceList').append(button);
    }
    const device = model.devices.find(d => d.id === selected);
    $('centralSelectedTitle').textContent = device?.name || 'Selecione um dispositivo';
    $('centralSelectedState').textContent = device ? (
      device.reportedOnline === true ? 'Presença informada online' :
      device.reportedOnline === false ? 'Presença informada offline' : 'Presença não informada'
    ) : 'Sem seleção';
    $('centralSelectedDetail').textContent = device
      ? `${device.active} em andamento · ${device.uncertain} incertas · ${device.failed} falhas. Último registro de presença: ${device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString('pt-BR') : 'não informado'}.`
      : 'Selecione um computador para conferir sua atividade. A execução continua no Runtime.';
    const visibleOperations = (model.operations || []).filter(op => (!selected || op.deviceId === selected) && (
      operationFilter === 'all'
      || operationFilter === 'active' && IN_FLIGHT.has(op.status)
      || operationFilter === 'uncertain' && op.status === 'uncertain'
      || operationFilter === 'failed' && op.status === 'failed'
      || operationFilter === 'finished' && ['succeeded', 'cancelled', 'reviewed', 'not-sent'].includes(op.status)
    ));
    $('centralOperationCount').textContent = model.state === 'product-connected' ? String(visibleOperations.length) : '—';
    $('centralOperationList').replaceChildren();
    $('centralOperationEmpty').hidden = visibleOperations.length > 0;
    $('centralOperationEmpty').textContent = model.state !== 'product-connected'
      ? 'Conecte o Product para consultar recibos.'
      : operationFilter !== 'all' ? 'Nenhuma operação com esse status.' : 'Nenhuma operação registrada neste escopo.';
    for (const op of visibleOperations.slice(0, 80)) {
      const item = el('li', 'central-operation-row');
      const info = el('div', 'central-operation-info');
      info.append(el('strong', '', op.kind), el('small', '', (model.devices.find(d => d.id === op.deviceId)?.name || op.deviceId)
        + ' · ' + (op.createdAt ? new Date(op.createdAt).toLocaleString('pt-BR') : 'Horário não informado')));
      const state = el('span', 'central-operation-status', operationLabels[op.status] || op.status);
      state.dataset.state = op.status;
      if (op.id) state.title = 'Recibo ' + op.id;
      item.append(info, state);
      $('centralOperationList').append(item);
    }
    $('centralOperationLimit').hidden = visibleOperations.length <= 80;
    $('centralConversationsStatus').textContent = 'Conversas por PC indisponíveis: a autoridade Relay ainda não fornece sessões de IA por cliente com recibos verificáveis. O Studio não usa seu histórico pessoal como se fosse o de outros computadores.';
  }
  async function refresh() {
    if (checking) return;
    checking = true; issue = ''; paint();
    try {
      const results = await centralReadSources(host, accountHost);
      accountAvailability = results[2].status === 'fulfilled'
        ? results[2].value === true ? 'available' : results[2].value === false ? 'unavailable' : 'unknown'
        : 'unknown';
      const product = results[0].status === 'fulfilled' ? results[0].value : null;
      const relay = results[1].status === 'fulfilled' ? results[1].value : null;
      model = centralViewModel(product, relay);
      ownerAuthority = null;
      ownerIssue = '';
      if (model.state === 'account-connected' && typeof accountHost?.ownerAuthority === 'function') {
        try { ownerAuthority = await accountHost.ownerAuthority(); }
        catch (error) { ownerIssue = error?.message || 'Falha ao consultar autorização Owner.'; }
      }
      if (results[0].status !== 'fulfilled') issue = 'Não foi possível consultar o Product. Confira o Runtime no espaço de trabalho.';
      checkedAt = new Date();
    } finally { checking = false; paint(); }
  }
  $('centralConnect').addEventListener('click', () => {
    if (checking) return;
    const authorizeObserve = model.state === 'account-connected';
    const action = authorizeObserve ? accountHost?.authorizeObserve : openRuntime;
    if (typeof action !== 'function') return;
    checking = true; issue = ''; paint();
    Promise.resolve().then(action).then(result => {
      if (!authorizeObserve) return;
      if (result?.authorized !== true || result?.profile !== 'computer-observe') throw new Error('A autorização de observação não foi confirmada.');
      observeAuthorized = true; issue = 'Observação MCP autorizada para o cliente consentido.';
    }).catch(error => {
      issue = error?.message || (authorizeObserve ? 'Não foi possível autorizar observação deste computador.' : 'Não foi possível abrir a conexão OrdaX.');
    }).finally(() => { checking = false; paint(); });
  });
  $('centralOwnerClient').addEventListener('change', event => {
    ownerClientId = String(event.target.value || ''); ownerIssue = ''; paint();
  });
  async function ownerMutation(type) {
    if (checking || model.state !== 'account-connected' || !ownerClientId) return;
    const grant = (ownerAuthority?.grant_groups || []).find(item => item.client_id === ownerClientId);
    const action = type === 'authorize' && !grant ? () => accountHost?.authorizeFull?.(ownerClientId)
      : type === 'revoke' && grant ? () => accountHost?.revokeFull?.(ownerClientId, grant.grant_group_id) : null;
    if (!action) return;
    checking = true; ownerIssue = ''; paint();
    try {
      const result = await action();
      if (result?.cancelled) return;
      if (type === 'authorize' && result?.authorized !== true
          || type === 'revoke' && result?.revoked !== true) {
        throw new Error('A autoridade Owner não confirmou a alteração.');
      }
      ownerAuthority = await accountHost.ownerAuthority();
    } catch (error) {
      ownerIssue = error?.message || 'Não foi possível alterar a autorização remota.';
    } finally { checking = false; paint(); }
  }
  $('centralOwnerAuthorizeFull').addEventListener('click', () => { void ownerMutation('authorize'); });
  $('centralOwnerRevokeFull').addEventListener('click', () => { void ownerMutation('revoke'); });
  $('centralRefresh').addEventListener('click', refresh);
  $('centralOperationFilter').addEventListener('change', event => {
    operationFilter = ['all','active','uncertain','failed','finished'].includes(event.target.value) ? event.target.value : 'all'; paint();
  });
  $('centralFilter').addEventListener('input', event => {
    filter = event.target.value.trim().toLocaleLowerCase('pt-BR').slice(0, 128); paint();
  });
  paint();
  return Object.freeze({ open: refresh, refresh, paint,
    poll: () => {
      if (centralPollDue({ checking, checkedAt, visible: !document.hidden && !$('centralPanel').hidden && $('projectDialog').hidden && !document.querySelector('dialog[open]') })) void refresh();
    },
  });
}
