export const projectDraftKey = projectId => projectId ? `project:${projectId}` : 'new';
export const chatsInProject = (chats, projectId) => chats.filter(chat => (chat.projectId || null) === projectId);
export const bindingEquals = (a, b) => (a?.deviceId || null) === (b?.deviceId || null) && (a?.project || null) === (b?.project || null);

export function renderProjectList({ root, projects, chats, activeProjectId, disabled, select }) {
  root.replaceChildren();
  for (const project of [{ id: null, name: 'Sem projeto' }, ...projects]) {
    const button = document.createElement('button'); button.className = 'project-scope-item';
    button.dataset.projectId = project.id || 'unassigned'; button.disabled = disabled;
    button.classList.toggle('active', project.id === activeProjectId);
    if (project.id === activeProjectId) button.setAttribute('aria-current', 'page');
    const icon = document.createElement('span'); icon.className = 'project-scope-icon'; icon.textContent = project.id ? '▱' : '◌'; icon.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span'); name.className = 'project-scope-name'; name.textContent = project.name;
    const count = document.createElement('small'); count.textContent = chatsInProject(chats, project.id).length;
    button.title = project.name; button.append(icon, name, count); button.addEventListener('click', () => select(project.id)); root.append(button);
  }
}
