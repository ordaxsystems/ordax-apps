import test from 'node:test';
import assert from 'node:assert/strict';
import { readSSE } from '../src/stream.mjs';
import { markdownHTML } from '../src/markdown.mjs';
import { validateHost } from '../src/host.mjs';

test('SSE preserves split UTF-8 and CRLF frames across network chunks', async () => {
  const bytes = new TextEncoder().encode(': keepalive\r\n\r\ndata: {"type":"delta","delta":"ação 😀"}\r\n\r\ndata: {"type":"done"}\n\ndata: [DONE]\n\n');
  const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  const events = []; for await (const event of readSSE(stream)) events.push(event);
  assert.deepEqual(events, [{ type: 'delta', delta: 'ação 😀' }, { type: 'done' }]);
});
test('SSE rejects a truncated terminal frame', async () => {
  const stream = new Response('data: {"type":"done"}').body;
  await assert.rejects(async () => { for await (const event of readSSE(stream)) void event; }, /incompleto/);
});
test('model output cannot inject HTML or javascript links', () => {
  const result = markdownHTML('<img src=x onerror="alert(1)">\n\n[evil](javascript:alert(1))\n\n[docs](https://example.com/?a="x")\n\n```html\n<script>alert(1)</script>\n```');
  assert.ok(!result.includes('<img')); assert.ok(!result.includes('<script')); assert.ok(!result.includes('href="javascript:'));
  assert.ok(result.includes('&lt;script&gt;')); assert.ok(result.includes('&quot;'));
  assert.ok(result.includes('rel="noopener noreferrer"'));
});
test('host must implement every conversation capability', () => {
  assert.throws(() => validateHost({}), /state/);
});

test('tables, task lists and code copying preserve escaped model text', () => {
  const result = markdownHTML('| Nome | Valor |\n| --- | --- |\n| <img src=x> | **seguro** |\n\n- [x] Feito\n\n> Uma citação\n\n```js\nconsole.log("<script>")\n```');
  assert.match(result, /<table>/); assert.match(result, /&lt;img src=x&gt;/); assert.match(result, /<strong>seguro<\/strong>/);
  assert.match(result, /aria-label="Concluído"/); assert.match(result, /<blockquote>/); assert.match(result, /data-copy-code/); assert.match(result, /&lt;script&gt;/);
  assert.ok(!result.includes('<img')); assert.ok(!result.includes('onclick='));
});
