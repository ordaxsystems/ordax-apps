// Read-only control-plane snapshot for the *central* Studio interface.
// Device presence is an observation, not Relay enrollment or execution readiness.
// No credentials, user prompts, project paths, private result or raw catalog
// items are admitted to this projection.
export function relayAdminReadiness(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      raw.connected !== true || raw.catalogAvailable === false ||
      !Array.isArray(raw.targets) || !Array.isArray(raw.operations) ||
      raw.targets.length > 100 || raw.operations.length > 1000) {
    return Object.freeze({ state: 'unavailable', deviceCount: 0, reportedOnline: 0, uncertain: 0 });
  }
  const targets = raw.targets;
  const known = new Set();
  let reportedOnline = 0;
  for (const entry of targets) {
    if (!entry || typeof entry !== 'object' ||
        typeof entry.deviceId !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(entry.deviceId) ||
        known.has(entry.deviceId) ||
        (entry.online !== true && entry.online !== false && entry.online !== null)) {
      return Object.freeze({ state: 'unavailable', deviceCount: 0, reportedOnline: 0, uncertain: 0 });
    }
    known.add(entry.deviceId);
    if (entry.online === true) reportedOnline++;
  }
  let uncertain = 0;
  for (const item of raw.operations) {
    if (!item || typeof item !== 'object' || typeof item.status !== 'string') {
      return Object.freeze({ state: 'unavailable', deviceCount: 0, reportedOnline: 0, uncertain: 0 });
    }
    if (['prepared', 'submitting', 'queued', 'running', 'uncertain'].includes(item.status)) uncertain++;
  }
  return Object.freeze({ state: 'product-connected', deviceCount: known.size, reportedOnline, uncertain });
}

export function relayReadinessText(status) {
  return status.state === 'product-connected'
    ? `Product conectado · ${status.deviceCount} dispositivo(s) autorizado(s) · ${status.reportedOnline} informado(s) online · ${status.uncertain} operação(ões) pendente(s) de conferência. Nenhum destes números confirma um cliente Relay conectado.`
    : 'Catálogo Product indisponível ou inválido. Nenhum dispositivo ou Relay foi declarado conectado.';
}
