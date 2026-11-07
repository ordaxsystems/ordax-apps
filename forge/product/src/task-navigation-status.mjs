// Present the result of task-opening navigation without certifying W3.
// Provider errors may include URLs or internals; only render safe status codes.
const NAVIGATION_REASONS = new Set([
  'provider_navigation_timeout', 'provider_composer_observation_timeout',
  'navigation_composer_observation_timeout', 'composer_not_found',
  'chatgpt_draft_present', 'visible_draft_present',
  'chatgpt_session_not_observed', 'chatgpt_login_required',
  'chatgpt_verification_required', 'provider_view_unavailable',
  'provider_health_observation_timeout', 'provider_navigation_unavailable',
  'provider_navigation_failed', 'provider_navigation_not_confirmed', 'provider_url_mismatch'
]);

// Human-readable explanations for allowlisted provider navigation outcomes.
// The exact diagnostic code stays in status.reason for support and tests.
// Never expose provider URL, DOM, account details, or a raw exception.
const NAVIGATION_EXPLANATIONS = Object.freeze({
  provider_navigation_timeout:'O ChatGPT não concluiu a abertura da conversa no prazo seguro.',
  provider_composer_observation_timeout:'O ChatGPT não respondeu à verificação de segurança do campo de mensagem. A navegação foi interrompida para preservar qualquer rascunho.',
  navigation_composer_observation_timeout:'O campo do ChatGPT não pôde ser confirmado após a navegação.',
  composer_not_found:'O campo de mensagem do ChatGPT ainda não está disponível.',
  chatgpt_draft_present:'Existe um rascunho no ChatGPT que precisa ser preservado antes de trocar a conversa.',
  visible_draft_present:'Existe um rascunho visível no ChatGPT. Ele foi preservado.',
  chatgpt_session_not_observed:'A sessão do ChatGPT ainda não pôde ser verificada.',
  chatgpt_login_required:'O ChatGPT precisa de login na página oficial.',
  chatgpt_verification_required:'O ChatGPT requer uma verificação na página oficial.',
  provider_view_unavailable:'A visualização do ChatGPT não está disponível no momento.',
  provider_health_observation_timeout:'A consulta do estado do ChatGPT excedeu o prazo seguro.',
  provider_navigation_unavailable:'Não foi possível confirmar a navegação para a conversa vinculada.',
  provider_navigation_failed:'A conversa vinculada apresentou uma falha de navegação.',
  provider_navigation_not_confirmed:'O endereço da conversa vinculada não foi confirmado.',
  provider_url_mismatch:'A página observada não corresponde à conversa GPT vinculada.'
});
const navigationExplanation=reason=>NAVIGATION_EXPLANATIONS[reason] ||
  NAVIGATION_EXPLANATIONS.provider_navigation_unavailable;

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
  if (navigation === 'pending') return {
    kind: 'navigating',
    reason: 'provider_navigation_pending',
    state: 'pending',
    threadRendered: 'false',
    message: 'Histórico e memória locais abertos. Abrindo a conversa GPT vinculada; nenhuma mensagem foi enviada.'
  };
  if (navigation === 'post_commit_failed') {
    const reason = safeTaskNavigationReason(task.provider_navigation_reason);
    return {
      kind: 'unavailable', reason, state: 'error', threadRendered: 'false',
      message: `A resposta do GPT já foi registrada. ${navigationExplanation(reason)} Nenhuma mensagem foi reenviada.`
    };
  }
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
      ? `A conversa vinculada não pôde ser aberta. ${navigationExplanation(reason)} Esta ação não enviou mensagens.`
      : `A conversa vinculada não foi aberta. ${navigationExplanation(reason)} Esta ação não enviou mensagens.`
  };
}
