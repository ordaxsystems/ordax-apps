import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createWebServer } from '../web-server.mjs';
import { readSSE } from '../../../apps/studio/conversation/src/stream.mjs';

async function fixture(t) {
  const calls = [], bridge = {
    state: () => ({ connection: { mode: 'chatgpt-web' }, chats: [] }), models: () => [{ id: 'chatgpt-web' }], connect: () => ({ embedded: true }),
    createChat: async () => ({ id: 'aabb' }), selectChat: async id => ({ id }), renameChat: async (id, title) => ({ id, title }), deleteChat: async () => ({ deleted: true }), stop: async () => ({ stopped: true }),
    respond: async (data, emit) => { calls.push(data); emit({ type: 'start', chat: { id: data.chatId } }); emit({ type: 'sync', chat: { id: data.chatId, messages: [{ id: 'answer', text: 'Resposta Web' }] } }); emit({ type: 'done', chat: { id: data.chatId } }); },
  };
  const host = await createWebServer({ bridge }); t.after(() => host.close());
  const initial = await fetch(host.origin); const cookie = initial.headers.get('set-cookie').split(';')[0];
  const request = (route, method = 'GET', data) => fetch(host.origin + route, { method, headers: { Cookie: cookie, Origin: host.origin, 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
  return { ...host, bridge, calls, request, cookie };
}
test('native UI transport returns the Web mode and actual stream without inference routing', async t => {
  const f = await fixture(t);
  assert.equal((await (await f.request('/api/state')).json()).connection.mode, 'chatgpt-web');
  assert.equal((await (await f.request('/api/connect', 'POST', {})).json()).embedded, true);
  const response = await f.request('/api/respond', 'POST', { chatId: 'aabb', message: { text: 'Olá' } });
  const events = []; for await (const e of readSSE(response.body)) events.push(e);
  assert.deepEqual(events.filter(e => ['start', 'sync', 'done'].includes(e.type)).map(e => e.type), ['start', 'sync', 'done']); assert.equal(f.calls.length, 1);
  assert.equal(events.find(e => e.type === 'message').message.text, 'Resposta Web');
  assert.equal((await f.request('/api/chats/aabb/select', 'POST', {})).status, 200);
});
test('loopback transport protects state, mutations, Host and file paths', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.origin + '/api/state')).status, 401);
  assert.equal((await fetch(f.origin + '/api/chats', { method: 'POST', headers: { Cookie: f.cookie, Origin: 'https://evil.test' }, body: '{}' })).status, 403);
  const forged = await new Promise(resolve => { const req = http.get(f.origin + '/api/state', { headers: { Host: 'evil.test', Cookie: f.cookie } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', e => { throw e; }); });
  assert.equal(forged, 403); assert.equal((await f.request('/storage.mjs')).status, 404);
  assert.equal((await f.request('/api/disconnect', 'POST', {})).status, 409);
});

test('disconnecting a stream detaches the viewer without cancelling generation or allowing a duplicate send', async t => {
  const f = await fixture(t); let signal, finish;
  f.bridge.respond = async (_, emit, current) => { signal = current; emit({ type: 'start' }); await new Promise(resolve => { finish = resolve; }); emit({ type: 'done' }); };
  const response = await f.request('/api/respond', 'POST', { chatId: 'aabb', message: { text: 'Olá' } });
  await response.body.cancel(); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(signal.aborted, false); assert.equal((await f.request('/api/respond', 'POST', {})).status, 409);
  f.bridge.stop = async () => { throw Object.assign(new Error('Conversa ativa mudou.'), { status: 409 }); };
  assert.equal((await f.request('/api/stop', 'POST', { chatId: 'another' })).status, 409); assert.equal(signal.aborted, false);
  finish(); await new Promise(resolve => setTimeout(resolve, 10));
});
test('preparation errors after activity events have an explicit terminal event', async t => {
  const f = await fixture(t);
  f.bridge.respond = async (_, emit) => { emit({ type: 'activity', activity: {} }); throw new Error('Editor mudou'); };
  const response = await f.request('/api/respond', 'POST', { chatId: 'aabb' }); const events = [];
  for await (const event of readSSE(response.body)) events.push(event);
  assert.equal(events.at(-1).type, 'error'); assert.match(events.at(-1).message, /Editor mudou/);
});
test('diagnostics omit transcripts and login data; malformed JSON objects are rejected', async t => {
  const f = await fixture(t);
  f.bridge.state = () => ({ capabilities: { deletionRecoveryRequired: true }, web: { ready: true, transport: { state: 'ready', detail: 'secret-login' } }, chats: [{ title: 'Private title', messages: [{ text: 'Private message' }] }] });
  const diagnostic = await (await f.request('/api/diagnostics')).json();
  assert.equal(diagnostic.local.messages, 1); assert.equal(diagnostic.local.conversations, 1);
  assert.equal(diagnostic.recovery.webDeletionJournal, true); assert.equal(diagnostic.recovery.runtimeJournal, false);
  assert.ok(!JSON.stringify(diagnostic).includes('Private')); assert.ok(!JSON.stringify(diagnostic).includes('secret'));
  assert.equal((await f.request('/api/chats/aabb', 'PATCH', 'scalar')).status, 400);
  assert.equal((await fetch(f.origin + '/api/respond', { method: 'POST', headers: { Cookie: f.cookie, Origin: f.origin }, body: '{}' })).status, 415);
});
