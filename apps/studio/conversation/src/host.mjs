import { readSSE } from './stream.mjs';

async function request(url, method = 'GET', data) {
  const response = await fetch(url, { method, credentials: 'same-origin', signal: AbortSignal.timeout(20000), headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Não foi possível concluir a operação.');
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
    async *respond(data) {
      const response = await fetch('/api/respond', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!response.ok) { const payload = await response.json(); throw new Error(payload.error); }
      yield* readSSE(response.body);
    },
  });
}

export function validateHost(host) {
  for (const method of ['state', 'models', 'connect', 'selectAccount', 'disconnect', 'createChat', 'deleteChat', 'renameChat', 'respond', 'stop']) {
    if (typeof host?.[method] !== 'function') throw new TypeError(`Host da conversa do Studio incompleto: ${method}`);
  }
  return host;
}
