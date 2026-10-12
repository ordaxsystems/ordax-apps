export const phaseNames = { sending: 'Enviando', waiting: 'Aguardando o Web', thinking: 'Pensando', searching: 'Pesquisando', reading: 'Analisando', tool: 'Usando ferramentas', working: 'Trabalhando', responding: 'Respondendo', settling: 'Finalizando', completed: 'Concluído', cancelled: 'Interrompido', error: 'Confira o Web', interrupted: 'Acompanhamento interrompido' };
export function elapsedLabel(start, end = Date.now()) {
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}min ${String(seconds % 60).padStart(2, '0')}s`;
}
export function paintActivity(root, activity) {
  if (!activity?.current) { root.hidden = true; return; }
  root.hidden = false;
  const encoded = JSON.stringify(activity);
  if (root.dataset.snapshot === encoded) return;
  const expanded = root.querySelector('details')?.open ?? false;
  root.dataset.snapshot = encoded; root.replaceChildren();
  root.classList.add('activity-card');
  root.classList.toggle('activity-live', activity.endedAt === null); root.classList.toggle('activity-finished', activity.endedAt !== null);
  for (const name of [...root.classList]) if (name.startsWith('phase-')) root.classList.remove(name);
  root.classList.add('phase-' + activity.current.kind);
  const details = document.createElement('details'); details.open = expanded;
  const summary = document.createElement('summary');
  const icon = document.createElement('span'); icon.className = 'activity-orbit'; icon.setAttribute('aria-hidden', 'true');
  const title = document.createElement('strong'); title.textContent = phaseNames[activity.current.kind] || 'Atividade';
  const timer = document.createElement('span'); timer.className = 'activity-time'; timer.dataset.start = activity.startedAt; timer.dataset.end = activity.endedAt ?? ''; timer.textContent = elapsedLabel(activity.startedAt, activity.endedAt ?? Date.now());
  summary.append(icon, title, timer);
  const chevron = document.createElement('span'); chevron.className = 'activity-chevron'; chevron.textContent = '⌄'; summary.append(chevron);
  const current = document.createElement('p'); current.className = 'activity-detail'; current.textContent = activity.current.label;
  const list = document.createElement('ol'); list.className = 'activity-steps';
  for (const step of activity.events || []) {
    const row = document.createElement('li'), label = document.createElement('span'), at = document.createElement('time');
    label.textContent = step.label; at.textContent = elapsedLabel(activity.startedAt, step.at); row.dataset.phase = step.kind;
    row.append(label, at); list.append(row);
  }
  details.append(summary, current, list); root.append(details);
}
export function tickActivityClocks(root = document) {
  for (const clock of root.querySelectorAll('.activity-time[data-end=""]')) clock.textContent = elapsedLabel(Number(clock.dataset.start));
}
