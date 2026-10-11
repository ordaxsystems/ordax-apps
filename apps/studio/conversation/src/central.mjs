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
    return { state: 'unavailable', devices: [], operations: [], total: null, reportedOnline: null,
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
    pending: receipts.filter(op => IN_FLIGHT.has(op.status)).length,
    uncertain: receipts.filter(op => op.status === 'uncertain').length, lab };
}
function el(tag, className, label) {
  const node = document.createElement(tag);
  node.className = className;
  if (label !== undefined) node.textContent = label;
  return node;
}
export function createCentralPanel({ host }) {
  const $ = id => document.getElementById(id);
  let model = centralViewModel(null, null);
  let selected = null, checking = false, issue = '', checkedAt = null;
  let filter = '', operationFilter = 'all';
  const metric = (id, value) => { $(id).textContent = value === null ? '—' : String(value); };
  function paint() {
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
      : 'Product indisponível · nenhum dispositivo foi presumido conectado';
    $('centralWarning').textContent = issue || 'Dispositivos autorizados não equivalem a clientes Relay conectados.';
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
      ? 'Conecte a Conta OrdaX ao Runtime para consultar os dispositivos.'
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
      const results = await Promise.allSettled([
        typeof host?.runtimeState === 'function' ? host.runtimeState() : Promise.reject(new Error('Product não integrado')),
        typeof host?.relayObservation === 'function' ? host.relayObservation() : Promise.reject(new Error('Relay não integrado')),
      ]);
      const product = results[0].status === 'fulfilled' ? results[0].value : null;
      const relay = results[1].status === 'fulfilled' ? results[1].value : null;
      model = centralViewModel(product, relay);
      if (results[0].status !== 'fulfilled') issue = 'Não foi possível consultar o Product. Confira o Runtime no espaço de trabalho.';
      checkedAt = new Date();
    } finally { checking = false; paint(); }
  }
  $('centralRefresh').addEventListener('click', refresh);
  $('centralOperationFilter').addEventListener('change', event => {
    operationFilter = ['all','active','uncertain','failed','finished'].includes(event.target.value) ? event.target.value : 'all'; paint();
  });
  $('centralFilter').addEventListener('input', event => {
    filter = event.target.value.trim().toLocaleLowerCase('pt-BR').slice(0, 128); paint();
  });
  paint();
  return Object.freeze({ open: refresh, refresh, paint });
}
