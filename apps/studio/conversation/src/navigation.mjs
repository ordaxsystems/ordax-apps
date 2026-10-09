// Presentation state only. Selection, drafts and persistence remain with the host.
export const navigationPages = ['conversation', 'recent', 'projects', 'project'];
export function recentConversations(chats, { projectId, query = '' } = {}) {
  const needle = query.trim().toLocaleLowerCase('pt-BR');
  return chats.filter(chat => (projectId === undefined || (chat.projectId || null) === projectId)
    && (!needle || [chat.title, ...chat.messages.map(message => message.text)].some(text => text?.toLocaleLowerCase('pt-BR').includes(needle))))
    .map(chat => ({ ...chat, lastAt: chat.messages.at(-1)?.createdAt || chat.createdAt }))
    .sort((a, b) => (Date.parse(b.lastAt) || 0) - (Date.parse(a.lastAt) || 0) || a.id.localeCompare(b.id));
}
export function conversationDay(value, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Mais antigas';
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(day); yesterday.setDate(day.getDate() - 1);
  return date >= day ? 'Hoje' : date >= yesterday ? 'Ontem' : 'Mais antigas';
}

const paths = {
  conversation: 'M20 11.5a8 8 0 0 1-8 8H4l1.6-4A8 8 0 1 1 20 11.5Z',
  recent: 'M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  projects: 'M3 7V5h6l2 2h10v13H3V7Zm0 3h18',
};
export function navigationIcon(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[kind]); svg.append(path); return svg;
}
function element(tag, className, text) {
  const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node;
}
export function createNavigation({ state, openChat, openProject, newChat, options, changed }) {
  const $ = id => document.getElementById(id);
  let page = 'conversation', stamp = '';
  function go(next, { focus = true } = {}) {
    if (!navigationPages.includes(next)) throw new Error('Área do Studio inválida.');
    const previous = page; page = next;
    if (previous !== next) $('search').value = '';
    paint(); changed?.();
    if (focus && previous !== next) (page === 'conversation' ? $('conversationTitle') : page === 'project' ? $('projectScopeName') : $('directoryTitle')).focus({ preventScroll: true });
  }
  function paint() {
    const { chats, projects, activeId, projectId, disabled, previewAvailable } = state();
    const selected = projects.find(value => value.id === projectId);
    document.body.dataset.studioPage = page;
    const collection = page !== 'conversation';
    $('studioDirectory').hidden = !collection;
    $('contextSelect').textContent = selected?.name || 'Sem projeto'; $('contextSelect').disabled = disabled;
    $('conversationProjectOptions').disabled = disabled;
    $('projectScopeName').textContent = selected?.name || 'Sem projeto';
    $('conversationProjectOptions').hidden = !selected;
    for (const button of document.querySelectorAll('button[data-studio-page]')) {
      const active = button.dataset.studioPage === (page === 'project' ? 'projects' : page);
      button.setAttribute('aria-current', active ? 'page' : 'false'); button.disabled = disabled;
    }
    $('directoryTitle').textContent = page === 'recent' ? 'Continuar' : page === 'project' ? selected?.name || 'Sem projeto' : 'Projetos';
    $('directoryDescription').textContent = page === 'recent' ? 'Retome de onde você parou.' : page === 'project' ? 'Seu contexto e suas conversas, em um só lugar.' : 'Um espaço para cada ideia que ganha forma.';
    $('projectOverview').hidden = page !== 'project';
    $('projectsBack').hidden = page !== 'project';
    $('createConversationProject').hidden = page !== 'projects'; $('createConversationProject').disabled = disabled;
    $('directoryNewChat').hidden = page !== 'recent'; $('directoryNewChat').disabled = disabled;
    $('projectNewChat').disabled = disabled; $('projectResources').disabled = disabled;
    $('projectPreview').disabled = !previewAvailable || disabled;
    $('projectPreview').title = previewAvailable ? 'Abrir preview deste projeto' : 'Preview requer um host com superfície de projeto';
    $('projectMonogram').textContent = selected?.name?.[0]?.toUpperCase() || '○';
    $('projectBindingInfo').textContent = selected?.binding ? 'Espaço de trabalho conectado' : 'Conversas organizadas neste dispositivo';
    $('search').placeholder = page === 'projects' ? 'Buscar projetos' : page === 'project' ? 'Buscar neste projeto' : 'Buscar conversas';
    $('search').setAttribute('aria-label', $('search').placeholder);
    $('conversationProjects').hidden = page !== 'projects'; $('chatList').hidden = page === 'projects';
    const needle = $('search').value.trim().toLocaleLowerCase('pt-BR');
    const visible = recentConversations(chats, { ...(page === 'project' ? { projectId } : {}), query: needle });
    const nextStamp = JSON.stringify([page, activeId, projectId, disabled, needle, new Date().toLocaleDateString('pt-BR'), projects, visible.map(value => value.id), chats.map(value => [value.id, value.projectId, value.title, value.messages.at(-1)?.text?.slice(0, 140), value.messages.at(-1)?.createdAt])]);
    if (stamp === nextStamp) return; stamp = nextStamp;
    $('conversationProjects').replaceChildren(); $('chatList').replaceChildren();
    if (!collection) return;
    if (page === 'projects') {
      const filtered = projects.filter(value => value.name.toLocaleLowerCase('pt-BR').includes(needle));
      for (const value of filtered) {
        const button = element('button', 'studio-project-card'); button.type = 'button'; button.dataset.projectId = value.id; button.disabled = disabled;
        const monogram = element('span', 'studio-monogram', value.name[0].toUpperCase()); monogram.setAttribute('aria-hidden', 'true');
        const body = element('span', 'directory-card-body'); body.append(element('strong', '', value.name), element('small', '', `${chats.filter(chat => chat.projectId === value.id).length} conversas · ${value.binding ? 'Workspace conectado' : 'Espaço de conversas'}`));
        button.append(monogram, body, element('span', 'directory-chevron', '›')); button.addEventListener('click', () => openProject(value.id)); $('conversationProjects').append(button);
      }
      if (!filtered.length) $('conversationProjects').append(element('p', 'directory-empty', needle ? 'Nenhum projeto encontrado.' : 'Seu próximo projeto começa aqui. Crie um novo ou abra um existente.'));
      return;
    }
    let group = '';
    for (const value of visible) {
      const day = conversationDay(value.lastAt);
      if (day !== group) { group = day; $('chatList').append(element('h3', 'directory-day', day)); }
      const row = element('div', 'directory-chat-row');
      const button = element('button', 'directory-chat'); button.type = 'button'; button.dataset.chatId = value.id; button.disabled = disabled;
      if (activeId === value.id) button.setAttribute('aria-current', 'page');
      const icon = element('span', 'directory-chat-icon'); icon.append(navigationIcon('conversation'));
      const body = element('span', 'directory-card-body'); body.append(element('strong', '', value.title));
      const snippet = value.messages.at(-1)?.text?.trim().replace(/\s+/g, ' ').slice(0, 140);
      body.append(element('small', 'directory-snippet', snippet || 'Conversa pronta para começar'));
      if (page === 'recent') body.append(element('span', 'directory-project-badge', projects.find(project => project.id === value.projectId)?.name || 'Sem projeto'));
      button.append(icon, body, element('span', 'directory-chevron', '›')); button.addEventListener('click', () => openChat(value.id));
      const more = element('button', 'directory-more', '•••'); more.type = 'button'; more.dataset.chatOptions = value.id; more.disabled = disabled; more.setAttribute('aria-label', `Opções de ${value.title}`); more.addEventListener('click', () => options(value.id));
      row.append(button, more); $('chatList').append(row);
    }
    if (!visible.length) $('chatList').append(element('p', 'directory-empty', needle ? 'Nenhuma conversa encontrada.' : page === 'project' ? 'Este projeto ainda não tem conversas. Crie a primeira.' : 'Suas conversas recentes aparecerão aqui.'));
  }
  for (const button of document.querySelectorAll('button[data-studio-page]')) {
    const icon = navigationIcon(button.dataset.studioPage); button.prepend(icon);
  }
  $('search').addEventListener('input', paint);
  $('directoryNewChat').addEventListener('click', newChat);
  $('projectNewChat').addEventListener('click', newChat);
  return { go, paint, current: () => page };
}
