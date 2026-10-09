import { readSSE } from './stream.mjs';

export async function* respond(data, fetchImpl = fetch, { headersTimeoutMs = 20000, idleTimeoutMs = 60000 } = {}) {
  if (!Number.isFinite(headersTimeoutMs) || headersTimeoutMs <= 0 || headersTimeoutMs > 300000) throw new TypeError('Prazo de conexão inválido.');
  if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0 || idleTimeoutMs > 300000) throw new TypeError('Prazo de streaming inválido.');
  const controller = new AbortController();
  let response;
  let timer = setTimeout(() => controller.abort(new Error('O host não confirmou a conexão de resposta a tempo. Confira o envio antes de tentar novamente.')), headersTimeoutMs);
  try {
    response = await fetchImpl('/api/respond', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(data), signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw new Error('Não foi possível conectar ao host da conversa. Confira o envio antes de tentar novamente.');
      let payload;
      try { payload = await response.json(); }
      catch { throw new Error('O host retornou uma resposta inválida.'); }
      throw new Error(typeof payload?.error === 'string' ? payload.error : 'Não foi possível concluir a operação.');
    }
    if (!/^text\/event-stream(?:\s*;|$)/i.test(contentType)) throw new Error('O host não retornou o protocolo de streaming do Studio. Confira o envio antes de tentar novamente.');
    clearTimeout(timer);
    timer = null;
    for await (const event of readSSE(response.body, { signal: controller.signal, idleTimeoutMs })) {
      yield event;
      if (event.type === 'done' || event.type === 'error') return;
    }
    throw new Error('A conexão terminou sem confirmar a resposta. Confira a mesma conversa antes de enviar novamente.');
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
  }
}

export async function request(url, method = 'GET', data, fetchImpl = fetch) {
  const response = await fetchImpl(url, { method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000), headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
  // Static previews do not provide this transport; HTML is never app state.
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
    throw new Error('O host do Studio não está disponível neste endereço. Abra o app pelo host configurado; uma página estática não conecta o Runtime nem o ChatGPT.');
  }
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error('O host retornou uma resposta inválida. Tente conectar novamente.'); }
  if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Não foi possível concluir a operação.');
  return payload;
}

// Provider-neutral port. Production environments inject a platform/runtime adapter.
export function createHttpHost() {
  return Object.freeze({
    state: since => request('/api/state' + (Number.isFinite(since) ? '?since=' + since : '')),
    models: () => request('/api/models'),
    drafts: () => request('/api/drafts'),
    saveDraft: (key, entry) => request('/api/drafts', 'PUT', { key, entry }),
    runtimeState: since => request('/api/runtime' + (Number.isFinite(since) ? '?since=' + since : '')),
    localRuntimeObservation: () => request('/api/runtime/local-observation'),
    runtimeConnect: () => request('/api/runtime/connect', 'POST', {}),
    runtimeSubmit: data => request('/api/runtime/operations', 'POST', data),
    runtimeReview: id => request('/api/runtime/review', 'POST', { id }),
    diagnostics: () => request('/api/diagnostics'),
    connect: accountId => request('/api/connect', 'POST', { accountId }),
    selectAccount: id => request('/api/account', 'POST', { id }),
    disconnect: () => request('/api/disconnect', 'POST', {}),
    selectChat: id => request(`/api/chats/${id}/select`, 'POST', {}),
    openHome: () => request('/api/home', 'POST', {}),
    createChat: projectId => request('/api/chats', 'POST', { ...(projectId !== undefined ? { projectId } : {}) }),
    createProject: data => request('/api/projects', 'POST', data),
    selectConversationProject: id => request(`/api/projects/${id || 'unassigned'}/select`, 'POST', {}),
    renameProject: (id, name, previewUrl, instructions) => request(`/api/projects/${id}`, 'PATCH', { name, ...(previewUrl !== undefined ? { previewUrl } : {}), ...(instructions !== undefined ? { instructions } : {}) }),
    removeProject: id => request(`/api/projects/${id}`, 'DELETE'),
    moveChat: (id, projectId) => request(`/api/chats/${id}`, 'PATCH', { projectId }),
    deleteChat: (id, scope = 'local') => request(`/api/chats/${id}`, 'DELETE', { scope }),
    renameChat: (id, title) => request(`/api/chats/${id}`, 'PATCH', { title }),
    prepareAudioDraft: data => request('/api/audio/prepare', 'POST', data),
    webDraft: id => request(`/api/chats/${id}/web-draft`),
    consumeWebDraft: data => request('/api/audio/consume', 'POST', data),
    reviewDelivery: id => request(`/api/chats/${id}/review`, 'POST', {}),
    stop: chatId => request('/api/stop', 'POST', { chatId }),
    respond: data => respond(data),
  });
}

export function validateHost(host) {
  for (const method of ['state', 'models', 'connect', 'selectAccount', 'disconnect', 'createChat', 'deleteChat', 'renameChat', 'respond', 'stop']) {
    if (typeof host?.[method] !== 'function') throw new TypeError(`Host da conversa do Studio incompleto: ${method}`);
  }
  return host;
}
