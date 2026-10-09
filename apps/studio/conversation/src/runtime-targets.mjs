// Authorized catalog presentation. Presence is an observation, never a grant.
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(value);
const timestamp = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

export function runtimeTargets(value) {
  if (!Array.isArray(value) || value.length > 100) throw new TypeError('Catálogo inválido do OrdaX Runtime.');
  const seen = new Set();
  return value.map(target => {
    if (!target || !identifier(target.device_id) || seen.has(target.device_id)) throw new TypeError('Catálogo inválido do OrdaX Runtime.');
    seen.add(target.device_id);
    const name = target.device_name || target.name || target.device_id;
    return {
      deviceId: target.device_id,
      name: typeof name === 'string' ? name.replace(/[\x00-\x1f]/g, '').slice(0, 128) : target.device_id,
      online: typeof target.online === 'boolean' ? target.online : null,
      lastSeenAt: timestamp(target.last_seen_at),
    };
  });
}

export function deviceAvailable(state, deviceId) {
  const target = state.targets?.find(item => item.deviceId === deviceId);
  return Boolean(state.connected && state.catalogAvailable !== false && target && target.online !== false);
}

export function deviceLabel(target) {
  return `${target.name} · ${target.online === true ? 'informado online' : target.online === false ? 'informado offline' : 'presença não informada'}`;
}

export function deviceStatus(state, deviceId) {
  if (!state.connected) return 'Conecte à plataforma para consultar os dispositivos autorizados.';
  if (state.catalogAvailable === false) return 'Disponibilidade não confirmada. Atualize a conexão antes de executar no computador.';
  const target = state.targets?.find(item => item.deviceId === deviceId);
  if (!target) return 'Selecione um dispositivo autorizado. A conexão com a plataforma não confirma acesso ao computador.';
  const presence = target.online === false
    ? 'Dispositivo informado offline. Arquivos, terminal e preview local precisam dele ligado. Conversas e previews publicados são independentes dessa operação.'
    : target.online === true
      ? 'Dispositivo informado online pela plataforma. A execução ainda depende das permissões e da disponibilidade no momento da ação.'
      : 'A plataforma não informa a presença deste dispositivo. A disponibilidade será consultada novamente antes de enviar uma ação.';
  return presence + (target.lastSeenAt ? ` Última atividade informada: ${new Date(target.lastSeenAt).toLocaleString()}.` : '');
}
