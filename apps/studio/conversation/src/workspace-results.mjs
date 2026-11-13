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
  if (kind === 'briefing' && data && typeof data === 'object' && !Array.isArray(data)) {
    const project = data.project && typeof data.project === 'object' ? data.project : {};
    const continuity = data.continuity && typeof data.continuity === 'object' ? data.continuity : {};
    const projectState = continuity.project_state && typeof continuity.project_state === 'object' ? continuity.project_state : {};
    const health = data.health && typeof data.health === 'object' ? data.health : {};
    const git = health.git && typeof health.git === 'object' ? health.git : {};
    const preview = data.preview && typeof data.preview === 'object' ? data.preview : {};
    const previewRuntime = preview.runtime && typeof preview.runtime === 'object' ? preview.runtime : {};
    const itemText = item => value(typeof item === 'string' ? item : item?.path ?? item?.name ?? item?.title ?? item?.summary ?? item?.snippet ?? item?.content);
    const lines = [
      (project.name || project.slug) && `Projeto: ${value(project.name || project.slug)}`,
      typeof data.summary === 'string' && data.summary,
      projectState.summary && `Onde paramos: ${value(projectState.summary)}`,
      projectState.next_action && `Próximo passo: ${value(projectState.next_action)}`,
      ...(Array.isArray(projectState.completed) ? projectState.completed.slice(0, 100).map(item => `Concluído: ${value(item)}`) : []),
      ...(Array.isArray(projectState.blockers) ? projectState.blockers.slice(0, 100).map(item => `Pendência: ${value(item)}`) : []),
      ...(Array.isArray(projectState.changed_paths) ? projectState.changed_paths.slice(0, 100).map(item => `Arquivo alterado: ${value(item)}`) : []),
      (data.repository?.branch || git.branch) && `Git: branch ${value(data.repository?.branch || git.branch)}`,
      git.dirty === true ? `Git: ${Number.isFinite(git.changed_entries) ? git.changed_entries : 'há'} alteração(ões) pendente(s)` : git.dirty === false ? 'Git: área de trabalho limpa' : '',
      preview.mode && `Preview: ${value(preview.mode)}${previewRuntime.state ? ` · ${value(previewRuntime.state)}` : ''}`,
      ...Object.entries(health.adapters || {}).filter(([, item]) => item && typeof item === 'object' && item.enabled === true).slice(0, 20).map(([name, item]) => `Adapter: ${value(name)} · ${value(item.state || 'habilitado')}`),
      ...(Array.isArray(continuity.open_tasks) ? continuity.open_tasks.slice(-16).map(item => `Tarefa aberta: ${itemText(item)}`) : []),
      continuity.latest_checkpoint && `Checkpoint: ${itemText(continuity.latest_checkpoint)}`,
      ...(Array.isArray(continuity.memories) ? continuity.memories.slice(-6).map(item => `Memória do projeto: ${itemText(item)}`) : []),
      ...(Array.isArray(data.attention) ? data.attention.slice(0, 30).map(item => `Atenção: ${value(item)}`) : []),
      ...(Array.isArray(data.workspace?.context_files) ? data.workspace.context_files.slice(0, 30).map(item => `Arquivo de contexto: ${itemText(item)}`) : []),
      ...(Array.isArray(data.workspace?.documents) ? data.workspace.documents.slice(0, 12).map(item => `Documento: ${itemText(item)}`) : []),
      ...(Array.isArray(data.workspace?.scripts) ? data.workspace.scripts.slice(0, 12).map(item => `Script: ${itemText(item)}`) : []),
      ...(Array.isArray(data.workspace?.models) ? data.workspace.models.slice(0, 8).map(item => `Modelo/artefato: ${itemText(item)}`) : []),
    ].filter(Boolean);
    return (lines.join('\n\n') || JSON.stringify(data, null, 2)).slice(0, 150000);
  }
  if (['briefing','continuity','continuitySave'].includes(kind) && typeof data.summary === 'string') {
    return [data.summary, data.next_action && `Próximo passo: ${value(data.next_action)}`, ...(Array.isArray(data.completed) ? data.completed.slice(0, 100).map(item => `Concluído: ${value(item)}`) : []), ...(Array.isArray(data.blockers) ? data.blockers.slice(0, 100).map(item => `Pendência: ${value(item)}`) : []), ...(Array.isArray(data.changed_paths) ? data.changed_paths.slice(0, 100).map(item => `Arquivo alterado: ${value(item)}`) : [])].filter(Boolean).join('\n\n').slice(0, 150000);
  }
  if (kind === 'preview' && data.mode) {
    const states = { stopped: 'parado', running: 'em execução', ready: 'pronto', starting: 'iniciando', failed: 'falhou' }, state = data.runtime?.state;
    return [`Preview: ${value(data.mode)}`, state && `Estado: ${states[state] || value(state)}`, data.url && `Endereço: ${value(data.url)}`, data.latest_image && 'Existe uma captura disponível no Runtime.'].filter(Boolean).join('\n');
  }
  if (['blenderStatus','blenderSchema','blenderScene','blenderInspect','blenderStart','blenderTransform','blenderCreate','blenderMaterial','blenderSave'].includes(kind)) {
    return JSON.stringify(data, null, 2).slice(0, 150000);
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
  blenderStatus: { target: 'studioBlenderResult', title: 'Estado Blender live' },
  blenderSchema: { target: 'studioBlenderResult', title: 'Schema de modelagem Blender' },
  blenderScene: { target: 'studioBlenderResult', title: 'Cena Blender' },
  blenderInspect: { target: 'studioBlenderResult', title: 'Objeto Blender' },
  blenderStart: { target: 'studioBlenderResult', title: 'Blender live iniciado' },
  blenderTransform: { target: 'studioBlenderResult', title: 'Transformação Blender' },
  blenderCreate: { target: 'studioBlenderResult', title: 'Primitiva Blender' },
  blenderMaterial: { target: 'studioBlenderResult', title: 'Material Blender' },
  blenderSave: { target: 'studioBlenderResult', title: 'Cena Blender salva' },
});
