import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSlug, awaitProjectOperation } from '../src/project-entry.mjs';
test('project name derives a bounded folder identifier without raw path authority', () => {
  assert.equal(projectSlug('Meu Aplicativo Ágil'), 'meu-aplicativo-agil');
  assert.equal(projectSlug('😃'), ''); assert.equal(projectSlug('a'.repeat(100)).length, 64);
  assert.ok(!projectSlug('../escape').includes('/'));
});
test('project workflow observes the same operation and never repeats a write', async () => {
  let reads = 0;
  const host = { runtimeState: async () => ({ operations: [{ id: 'same', status: ++reads === 1 ? 'running' : 'succeeded', result: { data: {} } }] }) };
  assert.equal((await awaitProjectOperation(host, { id: 'same', status: 'queued' }, { sleep: async () => {} })).status, 'succeeded');
  assert.equal(reads, 2);
  for (const status of ['failed','uncertain','cancelled']) await assert.rejects(awaitProjectOperation(host, { id: 'same', status }));
  await assert.rejects(awaitProjectOperation({ runtimeState: async () => ({ operations: [] }) }, { id: 'lost', status: 'queued' }, { sleep: async () => {} }), /registro/);
  await assert.rejects(awaitProjectOperation({ runtimeState: async () => ({ operations: [{ id: 'slow', status: 'running' }] }) }, { id: 'slow', status: 'queued' }, { sleep: async () => {}, attempts: 1 }), /pendente/);
});
