import test from 'node:test';
import assert from 'node:assert/strict';
import { WebBridge } from '../native/web-bridge.mjs';
import { validHistory, projectDraftKey } from '../native/history.mjs';
import { chatsInProject } from '../../../apps/studio/conversation/src/project-organization.mjs';
import { createWebServer } from '../web-server.mjs';

async function fixture(t, initial = {}) {
  const disk = { ...initial }, loads = [];
  let rejectWrite = false;
  const storage = { read: async (key, fallback) => structuredClone(disk[key] || fallback), write: async (key, value) => { if (rejectWrite && key === 'web-chats') throw new Error('disk full'); disk[key] = structuredClone(value); } };
  const surface = { webContents: { loadURL: async url => { loads.push(url); }, isDestroyed: () => false, isLoadingMainFrame: () => false, getURL: () => 'https://chatgpt.com/', executeJavaScript: async () => ({ conversationMode: 'chat', selected: true, ready: true, turns: [], baseline: [], busy: false }) } };
  const bridge = new WebBridge({ storage, surface, interval: 100000 }); await bridge.init(); t.after(() => bridge.close());
  return { bridge, disk, loads, storage, surface, failWrites: value => { rejectWrite = value; } };
}

test('startup and project overview never adopt a restored or observed Web conversation', async t => {
  const saved = { projects: [{ id: 'aabb', name: 'A' }], chats: [{ id: 'ccdd', projectId: 'aabb', title: 'Saved', messages: [], webId: 'previous' }], activeId: 'ccdd', activeProjectId: 'aabb' };
  const f = await fixture(t, { 'web-chats': saved });
  f.surface.webContents.executeJavaScript = async () => ({ ready: true, busy: false, conversationId: 'previous', baseline: [], turns: [{ id: 'user', role: 'user', text: 'Old' }] });
  assert.equal(f.bridge.resumeURL(), 'https://chatgpt.com/');
  await f.bridge.refresh(); assert.equal(f.bridge.activeId, null); assert.equal(f.bridge.activeProjectId, null); assert.equal(f.bridge.chats[0].messages.length, 0);
  await f.bridge.selectConversationProject('aabb'); await f.bridge.refresh(); assert.equal(f.bridge.activeId, null); assert.equal(f.bridge.activeProjectId, 'aabb'); assert.equal(f.loads.length, 0);
  await f.bridge.selectChat('ccdd'); await f.bridge.refresh(); assert.equal(f.bridge.activeId, 'ccdd'); assert.equal(f.bridge.chats[0].messages.length, 1);
  await f.bridge.openHome(); await f.bridge.refresh(); assert.equal(f.bridge.state().home, true); assert.equal(f.bridge.activeId, null); assert.equal(f.bridge.chats.length, 1);
  f.failWrites(true); await assert.rejects(f.bridge.selectConversationProject('aabb')); assert.equal(f.bridge.state().home, true); assert.equal(f.bridge.activeProjectId, null);
});

test('project notes persist and invalid changes preserve the last good context', async t => {
  const f = await fixture(t), p = await f.bridge.createProject({ name: 'App', instructions: 'Use TypeScript' });
  assert.equal(f.disk['web-chats'].projects[0].instructions, 'Use TypeScript');
  await f.bridge.updateProject(p.id, { instructions: 'Use Python' });
  assert.equal(f.bridge.findProject(p.id).instructions, 'Use Python');
  await assert.rejects(f.bridge.updateProject(p.id, { instructions: 'x'.repeat(4001) }));
  assert.equal(f.bridge.findProject(p.id).instructions, 'Use Python');
  assert.equal(validHistory({ projects: [{ ...p, instructions: '\0' }], chats: [] }), false);
});

test('legacy history stays unassigned; drafts survive reopening while navigation starts at Home', async t => {
  const legacy = { schemaVersion: 2, chats: [{ id: 'aabb', title: 'Antes', messages: [], webId: 'legacy-web' }], activeId: 'aabb', ignored: [] };
  assert.equal(validHistory(legacy), true);
  const f = await fixture(t, { 'web-chats': legacy });
  assert.equal(f.bridge.activeProjectId, null); assert.equal(chatsInProject(f.bridge.chats, null).length, 1);
  const project = await f.bridge.createProject({ name: 'Meu projeto' }); await f.bridge.selectConversationProject(project.id);
  await f.bridge.drafts.save(projectDraftKey(project.id), { text: 'Rascunho do projeto', attachments: [], revision: 1 });
  await f.bridge.drafts.save('new', { text: 'Rascunho livre', attachments: [], revision: 1 });
  await f.bridge.close();
  const reopened = new WebBridge({ storage: f.storage, surface: f.surface, interval: 100000 }); await reopened.init(); t.after(() => reopened.close());
  assert.equal(reopened.activeProjectId, null); assert.equal(reopened.state().home, true); assert.equal(reopened.activeId, null);
  assert.equal(reopened.drafts.state()[projectDraftKey(project.id)].text, 'Rascunho do projeto');
  assert.equal(reopened.drafts.state().new.text, 'Rascunho livre');
  assert.equal(validHistory(f.disk['web-chats']), true);
});

test('creating scoped chats, moving and removing a container preserve Web identity, messages and chat draft', async t => {
  const f = await fixture(t), p = await f.bridge.createProject({ name: 'Aplicativo' });
  const chat = await f.bridge.createChat({ projectId: p.id }); chat.webId = 'web-original'; chat.messages = [{ id: 'turn', role: 'user', text: 'Conteúdo', attachments: [] }];
  await f.bridge.drafts.save(chat.id, { text: 'Continuação', attachments: [], revision: 2 });
  const count = f.loads.length;
  await f.bridge.moveChat(chat.id, null); assert.equal(f.loads.length, count); assert.equal(f.bridge.activeProjectId, null);
  await f.bridge.moveChat(chat.id, p.id); await f.bridge.removeProject(p.id);
  const saved = f.bridge.findChat(chat.id);
  assert.equal(saved.webId, 'web-original'); assert.equal(saved.projectId, null); assert.equal(saved.messages[0].text, 'Conteúdo');
  assert.equal(f.bridge.drafts.state()[chat.id].text, 'Continuação'); assert.equal(f.loads.length, count);
  assert.equal(validHistory(f.disk['web-chats']), true);
});

test('removal protects unassigned-to-chat project drafts and project writes roll back on disk failure', async t => {
  const f = await fixture(t), p = await f.bridge.createProject({ name: 'Protegido' });
  await f.bridge.drafts.save(projectDraftKey(p.id), { text: 'Não perder', attachments: [], revision: 1 });
  await assert.rejects(f.bridge.removeProject(p.id), /rascunho/); assert.equal(f.bridge.projects.length, 1);
  f.failWrites(true); await assert.rejects(f.bridge.renameProject(p.id, 'Novo nome'), /salvar/);
  assert.equal(f.bridge.findProject(p.id).name, 'Protegido'); f.failWrites(false);
  await assert.rejects(f.bridge.createProject({ name: 'a\ninvalid' }), /nome/);
  await assert.rejects(f.bridge.createChat({ projectId: 'unknown' }), /encontrado/);
  f.bridge.page = { busy: true }; await assert.rejects(f.bridge.moveChat('missing', null), /aguarde/); f.bridge.page = null;
});

test('history rejects orphaned, duplicate projects and bindings with injected authority', () => {
  const base = { projects: [{ id: 'aabb', name: 'Projeto', binding: null }], chats: [{ id: 'ccdd', projectId: 'aabb', title: 'Chat', messages: [] }] };
  assert.equal(validHistory(base), true);
  assert.equal(validHistory({ ...base, projects: [] }), false);
  assert.equal(validHistory({ ...base, projects: [...base.projects, ...base.projects] }), false);
  assert.equal(validHistory({ ...base, activeProjectId: 'unknown' }), false);
  assert.equal(validHistory({ ...base, projects: [{ ...base.projects[0], binding: { deviceId: 'device', project: 'slug', grant: 'admin' } }] }), false);
});

test('preview configuration persists per project, does not navigate ChatGPT, and rolls back rejected updates', async t => {
  const f=await fixture(t), a=await f.bridge.createProject({name:'Site',previewUrl:'http://localhost:5173'}), b=await f.bridge.createProject({name:'Outro'});
  assert.equal(a.previewUrl,'http://localhost:5173/');assert.equal(b.previewUrl,null);assert.equal(f.loads.length,0);
  await f.bridge.updateProject(a.id,{name:'Site revisado',previewUrl:'https://site.example/preview'});
  assert.equal(f.disk['web-chats'].projects.find(project=>project.id===a.id).previewUrl,'https://site.example/preview');
  await assert.rejects(f.bridge.updateProject(a.id,{previewUrl:'https://chatgpt.com/'}),/Use HTTPS/);
  await assert.rejects(f.bridge.updateProject(a.id,{binding:{deviceId:'forged',project:'forged'}}),/inválida/);
  f.failWrites(true);await assert.rejects(f.bridge.updateProject(a.id,{previewUrl:null}),/salvar/);f.failWrites(false);
  assert.equal(f.bridge.findProject(a.id).previewUrl,'https://site.example/preview');assert.equal(validHistory(f.disk['web-chats']),true);
  assert.equal(validHistory({...f.disk['web-chats'],projects:[{...f.bridge.findProject(a.id),previewUrl:'file:///C:/secret'}]}),false);
});

test('HTTP project routes preserve isolation and require an observed Runtime project before binding', async t => {
  const f = await fixture(t);
  let runtimeState = { connected: false, targets: [], operations: [] };
  const server = await createWebServer({ bridge: f.bridge, runtime: { state: () => runtimeState } }); t.after(() => server.close());
  const page = await fetch(server.origin), cookie = page.headers.get('set-cookie').split(';')[0];
  const request = (route, method, data) => fetch(server.origin + route, { method, headers: { Cookie: cookie, Origin: server.origin, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const binding = { deviceId: 'device', project: 'slug' };
  assert.equal((await request('/api/projects', 'POST', { name: 'Forged', binding })).status, 403);
  runtimeState = { connected: true, targets: [{ deviceId: 'device' }], operations: [{ kind: 'projects', status: 'succeeded', deviceId: 'device', result: { data: { projects: [{ slug: 'slug' }] } } }] };
  const response = await request('/api/projects', 'POST', { name: 'Runtime', binding }); assert.equal(response.status, 201); const project = await response.json();
  assert.equal((await request(`/api/projects/${project.id}/select`, 'POST', {})).status, 200);
  assert.equal((await request('/api/drafts', 'PUT', { key: projectDraftKey(project.id), entry: { text: 'Texto', attachments: [], revision: 1 } })).status, 200);
  assert.equal((await request('/api/drafts', 'PUT', { key: 'project:deadbeef', entry: { text: 'Texto', attachments: [], revision: 1 } })).status, 404);
  assert.equal((await request('/api/projects', 'POST', { name: 'Invalid', authority: 'admin' })).status, 400);
  assert.equal((await request(`/api/projects/${project.id}`, 'DELETE')).status, 409);
  assert.equal((await fetch(server.origin + '/api/projects', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://evil.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Cross origin' }) })).status, 403);
});
