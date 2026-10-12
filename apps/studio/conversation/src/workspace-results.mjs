// Presentation only. Authority and project continuity belong to the injected Runtime.
export function workspaceText(kind, result) {
  const raw = result?.data ?? result ?? {};
  const data = ['continuity','continuitySave'].includes(kind) && raw.state && typeof raw.state === 'object' ? raw.state : raw;
  if (['gitDiff','gitStatus'].includes(kind) && typeof (data.diff ?? data.text ?? data.stdout) === 'string') return (data.diff ?? data.text ?? data.stdout).slice(0, 150000) || (kind === 'gitDiff' ? 'Sem alterações no diff.' : 'O Git não retornou alterações.');
  const value = text => String(text ?? '').slice(0, 8000);
  if (kind === 'gitStatus' && data.branch) {
    const entries = data.entries ?? data.changes ?? [];
    return [`Branch: ${value(data.branch)}`, data.dirty === true ? 'Há alterações no projeto.' : data.dirty === false ? 'Área de trabalho limpa.' : '', ...(Array.isArray(entries) ? entries.slice(0, 300).map(entry => `${value(entry.status ?? entry.code)}  ${value(entry.path ?? entry.relative_path)}`) : [])].filter(Boolean).join('\n');
  }
  if (kind === 'search' && Array.isArray(data.matches)) return data.matches.slice(0, 50).map(match => `${value(match.path ?? match.relative_path)}:${value(match.line ?? match.line_number)}\n${value(match.text ?? match.content)}`).join('\n\n') || 'Nenhum resultado encontrado.';
  if (['briefing','continuity','continuitySave'].includes(kind) && typeof data.summary === 'string') {
    return [data.summary, data.next_action && `Próximo passo: ${value(data.next_action)}`, ...(Array.isArray(data.completed) ? data.completed.slice(0, 100).map(item => `Concluído: ${value(item)}`) : []), ...(Array.isArray(data.blockers) ? data.blockers.slice(0, 100).map(item => `Pendência: ${value(item)}`) : [])].filter(Boolean).join('\n\n').slice(0, 150000);
  }
  if (kind === 'preview' && data.mode) {
    const states = { stopped: 'parado', running: 'em execução', ready: 'pronto', starting: 'iniciando', failed: 'falhou' }, state = data.runtime?.state;
    return [`Preview: ${value(data.mode)}`, state && `Estado: ${states[state] || value(state)}`, data.url && `Endereço: ${value(data.url)}`, data.latest_image && 'Existe uma captura disponível no Runtime.'].filter(Boolean).join('\n');
  }
  return JSON.stringify(data, null, 2).slice(0, 150000);
}

export function workspaceResultBelongs(operation, selection) {
  return operation.deviceId === selection.deviceId && operation.project === selection.project;
}

export const workspaceTools = Object.freeze({
  gitStatus: { target: 'studioGitResult', title: 'Estado do Git' },
  gitDiff: { target: 'studioGitResult', title: 'Alterações do Git' },
  search: { target: 'studioSearchResult', title: 'Busca no projeto' },
  briefing: { target: 'studioContinuityResult', title: 'Contexto para continuar' },
  continuity: { target: 'studioContinuityResult', title: 'Continuidade salva' },
  continuitySave: { target: 'studioContinuityResult', title: 'Continuidade atualizada' },
  preview: { target: 'studioPreviewResult', title: 'Preview supervisionado' },
});
