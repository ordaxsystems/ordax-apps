// Present the result of task-opening navigation without certifying W3.
// Provider errors may include URLs or internals; only render safe status codes.
const NAVIGATION_REASONS = new Set([
  'provider_navigation_timeout', 'provider_composer_observation_timeout',
  'navigation_composer_observation_timeout', 'composer_not_found',
  'chatgpt_draft_present', 'visible_draft_present',
  'chatgpt_session_not_observed', 'chatgpt_login_required',
  'chatgpt_verification_required', 'provider_view_unavailable',
  'provider_health_observation_timeout', 'provider_navigation_unavailable'
]);

const TASK_LIST_STATUS_LABELS = Object.freeze({
  running: 'Em andamento',
  error: 'Erro',
  interrupted: 'Interrompida',
  succeeded: 'Concluída'
});

export function taskListStatusLabel(task) {
  if (!task || typeof task !== 'object') return 'Estado indisponível';
  if (task.status === 'ready') {
    if (Number(task.has_draft) === 1) return 'Rascunho salvo';
    if (Number(task.conversation_count) > 0) return 'Em espera';
    return 'Nova conversa';
  }
  return TASK_LIST_STATUS_LABELS[task.status] || 'Estado indisponível';
}

export function safeTaskNavigationReason(value) {
  return typeof value === 'string' && NAVIGATION_REASONS.has(value)
    ? value : 'provider_navigation_unavailable';
}

export function taskNavigationStatus(task) {
  const navigation = task?.provider_navigation;
  if (navigation !== 'failed' && navigation !== 'not_navigated') return null;
  const raw = navigation === 'failed'
    ? (task.provider_navigation_reason || task.provider_navigation_error)
    : task.provider_navigation_reason;
  const reason = safeTaskNavigationReason(raw);
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
