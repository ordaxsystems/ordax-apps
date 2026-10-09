import test from 'node:test';
import assert from 'node:assert/strict';
import { composeTextMessage, MESSAGE_LIMIT } from '../src/message.mjs';
import { readSSE } from '../src/stream.mjs';

test('the total prompt budget includes the names, separators and contents of every text attachment', () => {
  const file = { kind: 'text', name: 'projeto.md', text: 'Conteúdo' };
  assert.equal(composeTextMessage({ text: 'Olá', attachments: [file] }).text, 'Olá\n\nArquivo: projeto.md\n\nConteúdo');
  assert.throws(() => composeTextMessage({ text: 'a'.repeat(MESSAGE_LIMIT - 5), attachments: [file] }), /juntos/);
  assert.throws(() => composeTextMessage({ text: '', attachments: Array(5).fill(file) }), /quatro/);
  assert.throws(() => composeTextMessage({ text: 'imagem', attachments: [{ kind: 'image' }] }), /área Web/);
  for (const value of [null, {}, { text: 123 }, { text: ' ' }]) assert.throws(() => composeTextMessage(value));
});
test('SSE rejects a missing body and oversized complete frames, and accepts keepalive comments', async () => {
  const consume = async body => { const events = []; for await (const event of readSSE(body)) events.push(event); return events; };
  await assert.rejects(consume(null), /fluxo/);
  const body = value => new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(value)); controller.close(); } });
  await assert.rejects(consume(body('data: "' + 'x'.repeat(2 * 1024 * 1024) + '"\n\n')), /limite/);
  assert.deepEqual(await consume(body(': keepalive\n\ndata: {"type":"done"}\n\n')), [{ type: 'done' }]);
});
