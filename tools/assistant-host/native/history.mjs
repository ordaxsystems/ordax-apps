import { validPreviewURL } from '../../../apps/studio/conversation/src/preview-url.mjs';
const text = (value, max) => typeof value === 'string' && value.length <= max;
export const projectDraftKey = id => id ? `project:${id}` : 'new';
export const validProjectBinding = binding => binding == null || (binding && typeof binding === 'object' && !Array.isArray(binding) && Object.keys(binding).every(key => ['deviceId','project'].includes(key)) && [binding.deviceId, binding.project].every(value => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(value)));
const event = value => value && /^[a-z][a-z-]{0,39}$/.test(value.kind) && text(value.label, 240) && Number.isFinite(value.at);
const activity = value => !value || (Number.isFinite(value.startedAt) && (value.endedAt === null || Number.isFinite(value.endedAt)) && Array.isArray(value.events) && value.events.length <= 40 && value.events.every(event) && (value.current === undefined || event(value.current)));
const delivery = value => !value || (text(value.id, 128) && ['prepared','submitted','accepted','uncertain','reviewed','completed','interrupted','not-sent'].includes(value.status) && /^[a-f0-9]{64}$/.test(value.fingerprint) && Number.isFinite(value.startedAt) && Array.isArray(value.baseline) && value.baseline.length <= 5000 && value.baseline.every(id => text(id, 1024)) && (value.userId === undefined || text(value.userId, 1024)) && (value.draftKey === undefined || (text(value.draftKey, 128) && Number.isSafeInteger(value.draftRevision) && value.draftRevision >= 0 && value.draftRevision < 1e9)));
export function validHistory(data) {
  if (!data || !Array.isArray(data.chats) || data.chats.length > 100 || !Array.isArray(data.ignored || []) || (data.ignored || []).length > 5000) return false;
  const ids = new Set();
  const projects = data.projects ?? [], projectIds = new Set();
  if (!Array.isArray(projects) || projects.length > 50 || projects.some(project => {
    if (!project || !/^[a-f0-9-]{1,128}$/.test(project.id || '') || projectIds.has(project.id) || !text(project.name, 80) || !project.name.trim() || /[\x00-\x1f]/.test(project.name) || !validProjectBinding(project.binding)) return true;
    if (!validPreviewURL(project.previewUrl)) return true;
    if (project.instructions !== undefined && (!text(project.instructions, 4000) || project.instructions.includes('\0'))) return true;
    projectIds.add(project.id); return false;
  })) return false;
  if (data.activeProjectId != null && !projectIds.has(data.activeProjectId)) return false;
  if ((data.ignored || []).some(id => !text(id, 256)) || (data.activeId != null && !text(data.activeId, 128))) return false;
  return data.chats.every(chat => {
    if (!chat || !text(chat.id, 128) || !chat.id || ids.has(chat.id) || !text(chat.title, 100) || !Array.isArray(chat.messages) || chat.messages.length > 200 || !activity(chat.activity) || !delivery(chat.delivery)) return false;
    if (chat.projectId != null && !projectIds.has(chat.projectId)) return false;
    ids.add(chat.id); const messages = new Set();
    return (chat.webId === null || chat.webId === undefined || text(chat.webId, 256)) && chat.messages.every(message => {
      if (!message || !text(message.id, 1024) || messages.has(message.id) || !['user','assistant'].includes(message.role) || !text(message.text, 200000) || !activity(message.activity)) return false;
      if (message.attachments !== undefined && (!Array.isArray(message.attachments) || message.attachments.length > 4 || message.attachments.some(a => !a || a.kind !== 'text' || !text(a.name, 240) || !text(a.text, 100000)))) return false;
      messages.add(message.id); return true;
    });
  });
}
