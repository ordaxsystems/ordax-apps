// Present the result of task-opening navigation without certifying W3.
// Provider errors may include URLs or internals; only render safe status codes.
export function taskNavigationStatus(task) {
  const navigation = task?.provider_navigation;
  if (navigation !== 'failed' && navigation !== 'not_navigated') return null;
  const raw = String(navigation === 'failed'
    ? (task.provider_navigation_error || '')
    : (task.provider_navigation_reason || ''));
  const reason = /^[a-z][a-z0-9_]{0,100}$/i.test(raw)
    ? raw : 'provider_navigation_unavailable';
  return {
    kind: 'unavailable',
    reason,
    state: 'error',
    threadRendered: 'false',
    message: navigation === 'failed'
      ? `A conversa vinculada não pôde ser aberta (${reason}). Esta ação não enviou mensagens.`
      : `A conversa vinculada não foi aberta (${reason}). Esta ação não enviou mensagens.`
  };
}