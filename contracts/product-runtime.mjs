// Authorized catalog presentation. Presence is an observation, never a grant.
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(value);
const timestamp = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

export function runtimeTargets(value) {
  if (!Array.isArray(value) || value.length > 100) throw new TypeError('Catálogo inválido do OrdaX Runtime.');
  const seen = new Set();
  return value.map(target => {
    if (!target || !identifier(target.device_id) || seen.has(target.device_id)) throw new TypeError('Catálogo inválido do OrdaX Runtime.');
    seen.add(target.device_id);
    const name = target.device_name || target.name || target.device_id;
    return {
      deviceId: target.device_id,
      name: typeof name === 'string' ? name.replace(/[\x00-\x1f]/g, '').slice(0, 128) : target.device_id,
      online: typeof target.online === 'boolean' ? target.online : null,
      lastSeenAt: timestamp(target.last_seen_at),
    };
  });
}


// Single first-party Studio Product client profile: the UI can propose
// operations, but PostgreSQL's Product/Relay authority must authorize them.
// This registry does not grant remote execution and cannot select target PCs.
const profile = (action, fields, scope) => Object.freeze({
  action, fields: Object.freeze(fields), scope,
});
export const PRODUCT_RUNTIME_OPERATIONS = Object.freeze({
  projects: profile("projects.list", [], "device"),
  projectCreate: profile("workspace.project_create", ["slug","name"], "new-project"),
  projectImport: profile("workspace.bind_project", ["slug","relativePath"], "new-project"),
  directory: profile("workspace.directory_list", ["path"], "project"),
  read: profile("workspace.text_read", ["path"], "project"),
  write: profile("workspace.text_write", ["path","content","expectedSha256"], "project"),
  terminal: profile("terminal.exec", ["argv","cwd"], "project"),
  gitStatus: profile("git.status", [], "project"),
  gitDiff: profile("git.diff", [], "project"),
  search: profile("project.search_text", ["query"], "project"),
  briefing: profile("agent.project_briefing", ["query"], "project"),
  preview: profile("project.preview_status", [], "project"),
  continuity: profile("continuity.get", [], "project"),
  continuitySave: profile("continuity.update", ["summary","nextAction","completed","blockers","changedPaths"], "project"),
});
