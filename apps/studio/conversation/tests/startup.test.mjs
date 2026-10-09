import test from 'node:test';
import assert from 'node:assert/strict';
import { createStartup } from '../src/startup.mjs';
import { request } from '../src/host.mjs';

test('bootstrap fails closed and retries explicitly without parallel sessions', async () => {
  const states = []; let calls = 0, release;
  const startup = createStartup({ changed: state => states.push(state), load: async () => {
    calls++;
    if (calls === 1) throw new Error('Host indisponível');
    await new Promise(resolve => { release = resolve; });
  } });
  await startup.start();
  assert.equal(states.at(-1).state, 'unavailable');
  assert.equal(calls, 1);
  const retry = startup.start();
  assert.equal(startup.start(), retry);
  await Promise.resolve(); release(); await retry;
  assert.equal(states.at(-1).state, 'ready');
  await startup.start(); assert.equal(calls, 2);
});

test('HTTP transport rejects HTML, malformed JSON and errors without false state', async () => {
  await assert.rejects(request('/api/state', 'GET', undefined, async () => new Response('<html>404</html>', { status: 404, headers: { 'content-type': 'text/html' } })), /host do Studio não está disponível/);
  await assert.rejects(request('/api/state', 'GET', undefined, async () => new Response('{', { headers: { 'content-type': 'application/json' } })), /resposta inválida/);
  await assert.rejects(request('/api/state', 'GET', undefined, async () => Response.json({ error: 'Sessão expirada' }, { status: 401 })), /Sessão expirada/);
  await assert.rejects(request('/api/state', 'GET', undefined, async () => Response.json({ error: { secret: 'internal' } }, { status: 500 })), /Não foi possível/);
});

test('HTTP transport keeps same-origin credentials and never caches session state', async () => {
  const payload = await request('/api/state', 'GET', undefined, async (url, options) => {
    assert.equal(url, '/api/state'); assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store'); assert.ok(options.signal);
    return Response.json({ version: 1 });
  });
  assert.deepEqual(payload, { version: 1 });
});
