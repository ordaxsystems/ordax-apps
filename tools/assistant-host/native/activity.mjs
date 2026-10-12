const rules = [
  ['thinking', /^(pensando|raciocinando|thinking|reasoning)(?:\b|…)/i],
  ['searching', /^(pesquisando|buscando|consultando|searching|browsing|looking up)(?:\b|…)/i],
  ['reading', /^(lendo|analisando|reading|analyzing|analysing|reviewing)(?:\b|…)/i],
  ['tool', /^(executando|usando|running|using|calling)(?:\b|…)/i],
  ['working', /^(trabalhando|gerando|working|generating|preparando|preparing)(?:\b|…)/i],
];
export function observedActivity(page, answer) {
  const signals = (page.signals || []).filter(s => typeof s?.label === 'string' && s.label.length <= 240);
  if (page.busy) {
    for (const signal of signals.slice().reverse()) {
      if (signal.kind === 'tool' && signal.source === 'web') return { kind: 'tool', label: signal.label, source: 'web' };
      const rule = rules.find(([, pattern]) => pattern.test(signal.label));
      if (rule) return { kind: rule[0], label: signal.label, source: 'web' };
    }
    return answer?.text ? { kind: 'responding', label: 'Respondendo', source: 'response' } : { kind: 'working', label: 'ChatGPT trabalhando', source: 'generation' };
  }
  return answer?.status === 'completed' ? { kind: 'completed', label: 'Resposta concluída', source: 'response' } : { kind: 'settling', label: 'Conferindo a conclusão', source: 'bridge' };
}
export function beginActivity(turnId, now) {
  return { turnId, startedAt: now, endedAt: null, events: [] };
}
export function transitionActivity(activity, step, now) {
  if (activity.endedAt !== null) return false;
  const previous = activity.events.at(-1);
  if (previous?.kind === step.kind && previous?.label === step.label) return false;
  const event = { kind: step.kind, label: String(step.label).slice(0, 240), source: step.source, at: now };
  if (activity.events.length < 40) activity.events.push(event); else activity.events[39] = event;
  activity.current = event;
  if (['completed', 'cancelled', 'error', 'interrupted'].includes(step.kind)) activity.endedAt = now;
  return true;
}
