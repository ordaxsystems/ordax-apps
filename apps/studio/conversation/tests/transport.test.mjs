import test from 'node:test';
import assert from 'node:assert/strict';
import { respond } from '../src/host.mjs';
import { readSSE } from '../src/stream.mjs';

async function collect(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

const sse = body => new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });

test('response transport rejects successful HTML/JSON without accepting it as model output', async () => {
  for (const response of [new Response('<html>login</html>'), Response.json({ type: 'done' })]) {
    await assert.rejects(collect(respond({}, async () => response)), /protocolo de streaming/);
    assert.equal(response.body.locked, false);
  }
});

test('response transport uses same-origin session and one uncached POST', async () => {
  let calls = 0, signal;
  const events = await collect(respond({ chatId: 'test' }, async (url, options) => {
    calls++;
    assert.equal(url, '/api/respond');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Accept, 'text/event-stream');
    assert.deepEqual(JSON.parse(options.body), { chatId: 'test' });
    signal = options.signal;
    return sse('data: {"type":"delta","delta":"Olá"}\n\ndata: {"type":"done"}\n\n');
  }));
  assert.deepEqual(events, [{ type: 'delta', delta: 'Olá' }, { type: 'done' }]);
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
});

test('response transport requires application confirmation, not only a transport end marker', async () => {
  for (const body of ['', 'data: [DONE]\n\n', 'data: {"type":"delta","delta":"partial"}\n\n']) {
    let calls = 0;
    await assert.rejects(collect(respond({}, async () => { calls++; return sse(body); })), /sem confirmar/);
    assert.equal(calls, 1);
  }
});

test('response transport handles expired session and malformed/nontext errors', async () => {
  await assert.rejects(collect(respond({}, async () => Response.json({ error: 'Sessão expirada' }, { status: 401 }))), /Sessão expirada/);
  await assert.rejects(collect(respond({}, async () => Response.json({ error: { private: 'value' } }, { status: 500 }))), /Não foi possível concluir/);
  await assert.rejects(collect(respond({}, async () => new Response('{', { status: 500, headers: { 'content-type': 'application/json' } }))), /resposta inválida/);
  await assert.rejects(collect(respond({}, async () => new Response('<html>error</html>', { status: 502 }))), /conectar ao host/);
});

test('response header deadline aborts the only request and never resubmits', async () => {
  let calls = 0;
  await assert.rejects(collect(respond({}, async (_url, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }, { headersTimeoutMs: 10 })), /a tempo/);
  assert.equal(calls, 1);
});

test('a silent stream expires even if the source never completes cancellation', async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } });
  await assert.rejects(collect(readSSE(body, { idleTimeoutMs: 10 })), /sem comunicação/);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test('response done/error cancels a connection which stays open after confirmation', async () => {
  for (const type of ['done', 'error']) {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(`data: {"type":"${type}"}\n\n`)); },
      cancel() { cancelled = true; },
    });
    assert.deepEqual(await collect(respond({}, async () => sse(body), { idleTimeoutMs: 10 })), [{ type }]);
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
  }
});

test('keepalive traffic maintains a live stream without a total generation deadline', async () => {
  let timer, ticks = 0;
  const body = new ReadableStream({
    start(controller) {
      timer = setInterval(() => {
        if (++ticks < 5) controller.enqueue(new TextEncoder().encode(': keepalive\n\n'));
        else { clearInterval(timer); controller.enqueue(new TextEncoder().encode('data: {"type":"done"}\n\n')); controller.close(); }
      }, 5);
    },
    cancel() { clearInterval(timer); },
  });
  assert.deepEqual(await collect(readSSE(body, { idleTimeoutMs: 100 })), [{ type: 'done' }]);
  assert.equal(ticks, 5);
});

test('malformed event objects and invalid UTF-8 fail closed', async () => {
  for (const data of ['null', '[]', '"text"', '{}', '{"type":1}', '{']) {
    await assert.rejects(collect(readSSE(new Response(`data: ${data}\n\n`).body)), /evento de streaming inválido/);
  }
  await assert.rejects(collect(readSSE(new Response(Uint8Array.of(0xff)).body)), TypeError);
});

test('aborted parser and consumer cancellation release the stream reader', async () => {
  const controller = new AbortController();
  const body = new ReadableStream();
  const pending = collect(readSSE(body, { signal: controller.signal }));
  controller.abort(new Error('test cancellation'));
  await assert.rejects(pending, /test cancellation/);
  assert.equal(body.locked, false);
  const response = sse('data: {"type":"delta","delta":"test"}\n\n');
  const stream = respond({}, async () => response);
  assert.equal((await stream.next()).value.type, 'delta');
  await stream.return();
  assert.equal(response.body.locked, false);
});

test('stream deadlines cannot disable bounded waiting', async () => {
  for (const value of [0, -1, Infinity, NaN, 300001]) {
    await assert.rejects(collect(readSSE(new Response('').body, { idleTimeoutMs: value })), /Prazo/);
    await assert.rejects(collect(respond({}, async () => sse(''), { headersTimeoutMs: value })), /Prazo/);
    let calls = 0;
    await assert.rejects(collect(respond({}, async () => { calls++; return sse(''); }, { idleTimeoutMs: value })), /Prazo/);
    assert.equal(calls, 0);
  }
});
