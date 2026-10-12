import test from 'node:test';
import assert from 'node:assert/strict';
import { DraftStore, validDrafts } from '../native/drafts.mjs';
import { DraftController } from '../../../apps/studio/conversation/src/drafts.mjs';

const entry = (text, revision = 1) => ({ text, revision, attachments: [] });
function disk() {
  const values = {}; return { values, read: async (key, fallback) => structuredClone(values[key] || fallback), write: async (key, data) => { values[key] = structuredClone(data); } };
}
test('drafts survive reopening and stale saves cannot restore an accepted message', async () => {
  const storage = disk(), store = new DraftStore(storage); await store.init();
  await store.save('aabb', entry('Mensagem', 3)); await store.consume({ draftKey: 'aabb', draftRevision: 3 });
  assert.equal((await store.save('aabb', entry('Mensagem', 3))).text, '');
  await store.save('ccdd', entry('Outra conversa'));
  const reopened = new DraftStore(storage); await reopened.init();
  assert.equal(reopened.state().aabb.revision, 4); assert.equal(reopened.state().ccdd.text, 'Outra conversa');
  await reopened.save('aabb', entry('Nova mensagem', 5)); await reopened.consume({ draftKey: 'aabb', draftRevision: 3 });
  assert.equal(reopened.state().aabb.text, 'Nova mensagem');
});
test('draft write failures preserve the last good state and allow a later retry', async () => {
  const storage = disk(), store = new DraftStore(storage); await store.init(); await store.save('new', entry('Salvo'));
  const write = storage.write; storage.write = async () => { throw new Error('Disk full'); };
  await assert.rejects(store.save('new', entry('Pendente', 2)), /Disk full/); assert.equal(store.state().new.text, 'Salvo');
  storage.write = write; await store.save('new', entry('Pendente', 2)); assert.equal(store.state().new.text, 'Pendente');
  assert.equal(validDrafts({ schemaVersion: 1, entries: { '../escape': entry('x') } }), false);
  assert.equal(validDrafts({ schemaVersion: 1, entries: { new: entry('x', NaN) } }), false);
});
test('the exact saved revision and combined attachment text are required before submission', async () => {
  const store = new DraftStore(disk()); await store.init();
  await store.save('aabb', { ...entry('Pergunta', 6), attachments: [{ kind: 'text', name: 'README.md', text: 'Contexto' }] });
  const { composeTextMessage } = await import('../../../apps/studio/conversation/src/message.mjs');
  const text = composeTextMessage(store.state().aabb).text;
  await store.validateSubmission('aabb', 6, text);
  await assert.rejects(store.validateSubmission('aabb', 5, text), /mudou/);
  await assert.rejects(store.validateSubmission('aabb', 6, 'Pergunta'), /mudou/);
});
test('draft controller serializes network saves, retains failed edits and consumes a detached stream receipt', async () => {
  let fail = true, active = 0, max = 0; const saved = [];
  const controller = new DraftController({ drafts: async () => ({ aabb: entry('Inicial', 2) }), saveDraft: async (key, value) => {
    active++; max = Math.max(max, active); await new Promise(resolve => setTimeout(resolve, 5)); active--;
    if (fail) throw new Error('Offline'); saved.push([key, value]); return value;
  } });
  await controller.init(); controller.set('aabb', entry('Pendente')); await assert.rejects(controller.flush(), /Offline/);
  fail = false; await controller.flush(); assert.equal(saved[0][1].text, 'Pendente');
  controller.set('aabb', entry('Enviado')); const revision = controller.get('aabb').revision; const first = controller.flush();
  controller.consume({ draftKey: 'aabb', draftRevision: revision, userId: 'accepted' }); await first;
  assert.equal(controller.get('aabb').text, ''); assert.equal(controller.get('aabb').revision, revision + 1);
  controller.set('ccdd', entry('Arquivo')); await Promise.all([controller.flush(), controller.flush()]); assert.equal(max, 1);
});
