export const projectDraftKey = projectId => projectId ? `project:${projectId}` : 'new';
export const chatsInProject = (chats, projectId) => chats.filter(chat => (chat.projectId || null) === projectId);
export const bindingEquals = (a, b) => (a?.deviceId || null) === (b?.deviceId || null) && (a?.project || null) === (b?.project || null);
