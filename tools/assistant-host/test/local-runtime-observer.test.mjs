import test from 'node:test';
import assert from 'node:assert/strict';
import { observeLocalRuntime } from '../native/local-runtime-observer.mjs';
import { createWebServer } from '../web-server.mjs';

const HEALTH = 'http://127.0.0.1:8765/health';
const health = (value, headers = {}) => new Response(JSON.stringify(value), {
  status: 200, headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
});

test('read-only local observation is bounded and never establishes a Product authority', async () => {
  let calls = 0;
  const result = await observeLocalRuntime(async (url, init) => {
    calls++;
    assert.equal(url, HEALTH);
    assert.equal(init.method, 'GET');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.headers.Accept, 'application/json');
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.headers.authorization, undefined);
    return health({ ok: true, state: 'local-ready', version: '0.4.5' });
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, {
    schema: 'ordax.studio-local-runtime-observation/1',
    observed: true, authorization: 'not-established', canExecute: false,
    reason: 'loopback-response', version: '0.4.5', state: 'local-ready',
  });
  assert.equal(Object.isFrozen(result), true);
});

test('unhealthy service is still observed but NEVER marked as connected or executable', async () => {
  const result = await observeLocalRuntime(async () => health({
    ok: false, state: 'control-plane-error', version: '0.4.5',
  }));
  assert.equal(result.observed, true);
  assert.equal(result.reason, 'reported-unhealthy');
  assert.equal(result.canExecute, false);
  assert.equal(result.authorization, 'not-established');
});

test('unsafe, oversized, redirected, malformed, spoofed data and exceptions are fail-closed', async () => {
  const responses = [
    new Response('redirect', { status: 302, headers: { location: 'https://evil.example/collect' } }),
    new Response('<html>fake</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    health({ ok: 'true', state: 'ready', version: '0.4.5' }),
    health({ ok: true, state: 'READY', version: '0.4.5' }),
    health({ ok: true, state: 'ready', version: '../secret' }),
    health({ ok: true, state: 'ready', version: '0.4.5', secret: 'leak' }),
    health({ ok: true, state: 'x'.repeat(4000), version: '0.4.5' }),
    new Response('not-json', { status: 200, headers: { 'content-type': 'application/json' } }),
  ];
  for (const response of responses) {
    const value = await observeLocalRuntime(async () => response);
    assert.equal(value.observed, false);
    assert.equal(value.canExecute, false);
    assert.equal(value.authorization, 'not-established');
    assert.equal(value.version, null);
    assert.ok(['incompatible','unavailable'].includes(value.reason));
  }
  const down = await observeLocalRuntime(async () => { throw Error('private local path'); });
  assert.equal(down.reason, 'unavailable');
  assert.ok(!JSON.stringify(down).includes('private'));
});

test('loopback observation API requires existing Studio session and cannot mutate Product state', async t => {
  let called = 0;
  const runtime = {
    state: () => ({ configured: false, connected: false, targets: [], operations: [] }),
  };
  const bridge = { state: () => ({ chats: [] }), models: () => [] };
  const host = await createWebServer({
    bridge, runtime,
    observeInstalled: async () => {
      called++;
      return { schema: 'ordax.studio-local-runtime-observation/1', observed: true,
        authorization: 'not-established', canExecute: false, reason: 'loopback-response',
        version: '0.4.5', state: 'ready' };
    },
  });
  t.after(() => host.close());
  assert.equal((await fetch(host.origin + '/api/runtime/local-observation')).status, 401);
  assert.equal(called, 0);
  const first = await fetch(host.origin);
  const cookie = first.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(host.origin + '/api/runtime/local-observation', {
    headers: { Cookie: cookie, Host: 'evil.example' },
  })).status, 403);
  assert.equal(called, 0);
  const response = await fetch(host.origin + '/api/runtime/local-observation', { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(value.observed, true);
  assert.equal(value.canExecute, false);
  assert.equal(value.authorization, 'not-established');
  assert.equal(called, 1);
  assert.equal((await (await fetch(host.origin + '/api/runtime', { headers: { Cookie: cookie } })).json()).connected, false);
  assert.equal((await fetch(host.origin + '/api/runtime/operations', {
    method: 'POST', headers: { Cookie: cookie, Origin: host.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'terminal', command: 'whoami' }),
  })).status, 500);
});
