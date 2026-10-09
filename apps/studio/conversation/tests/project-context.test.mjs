import test from 'node:test';
import assert from 'node:assert/strict';
import { projectMessage } from '../src/project-context.mjs';
import { composeTextMessage } from '../src/message.mjs';

test('project notes are explicit first-message context, isolated and optional', () => {
  const a = { name: 'A', instructions: 'Regras A' }, b = { name: 'B', instructions: 'Regras B' }, message = { text: 'Começar', attachments: [] };
  const first = projectMessage({ project: a, message });
  assert.match(composeTextMessage(first).text, /Regras A/);
  assert.doesNotMatch(composeTextMessage(projectMessage({ project: b, message })).text, /Regras A/);
  assert.deepEqual(projectMessage({ project: a, message, enabled: false }), message);
  assert.deepEqual(projectMessage({ project: a, messages: [{ role: 'user' }], message }), message);
  assert.deepEqual(projectMessage({ project: null, message }), message);
  assert.equal(projectMessage({ project: a, message: first }).attachments.length, 1);
  assert.equal(message.attachments.length, 0);
});
test('project context shares the attachment and complete message budgets', () => {
  const message = { text: 'x', attachments: Array.from({ length: 4 }, (_, i) => ({ name: `${i}.txt`, kind: 'text', text: 'a' })) };
  assert.throws(() => composeTextMessage(projectMessage({ project: { name: 'A', instructions: 'Contexto' }, message })));
});
