import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalStorage } from '../storage.mjs';
import { validHistory } from '../native/history.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'ordax-storage-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new LocalStorage(directory);
}
const schema = value => Number.isInteger(value?.counter);
test('critical journals never restore an older backup after corruption, including a second start', async t => {
  const storage = await fixture(t);
  await writeFile(storage.target('sample'), '{damaged receipt'); await writeFile(storage.target('sample') + '.bak', '{"counter":0}');
  await assert.rejects(storage.read('sample', { counter: 0 }, { validate: schema, requireRecovery: true }), { code: 'STORAGE_RECOVERY_REQUIRED' });
  await assert.rejects(storage.write('sample', { counter: 2 }), /preservada/);
  const reopened = new LocalStorage(storage.directory);
  await assert.rejects(reopened.read('sample', { counter: 0 }, { validate: schema, requireRecovery: true }), { code: 'STORAGE_RECOVERY_REQUIRED' });
  assert.equal(JSON.parse(await readFile(storage.target('sample') + '.bak', 'utf8')).counter, 0);
  assert.ok((await readdir(storage.directory)).some(name => name.startsWith('sample.json.corrupt-')));
});
test('missing critical journal with a backup blocks; a genuinely new journal can initialize', async t => {
  const storage = await fixture(t);
  assert.deepEqual(await storage.read('sample', { counter: 0 }, { validate: schema, requireRecovery: true }), { counter: 0 });
  await writeFile(storage.target('sample') + '.bak', '{"counter":9}');
  await assert.rejects(storage.read('sample', { counter: 0 }, { validate: schema, requireRecovery: true }), /recuperação/);
});
test('critical corruption after initialization cannot be overwritten by the next save', async t => {
  const storage = await fixture(t); await storage.read('sample', { counter: 0 }, { validate: schema, requireRecovery: true });
  await storage.write('sample', { counter: 1 }); await writeFile(storage.target('sample'), '{damaged after startup');
  await assert.rejects(storage.write('sample', { counter: 2 }), /preservada/);
  assert.equal(await readFile(storage.target('sample'), 'utf8'), '{damaged after startup');
  await assert.rejects(storage.write('sample', { counter: 3 }), /recuperação/);
});
test('atomic storage serializes writes, keeps the previous valid snapshot and cleans temporary files', async t => {
  const storage = await fixture(t); await storage.read('sample', { counter: 0 }, { validate: schema });
  await Promise.all([storage.write('sample', { counter: 1 }), storage.write('sample', { counter: 2 }), storage.write('sample', { counter: 3 })]);
  assert.deepEqual(await storage.read('sample', {}, { validate: schema }), { counter: 3 });
  assert.deepEqual(JSON.parse(await readFile(storage.target('sample') + '.bak', 'utf8')), { counter: 2 });
  assert.ok(!(await readdir(storage.directory)).some(name => name.endsWith('.tmp')));
});
test('a corrupted primary snapshot is preserved and a valid backup is recovered', async t => {
  const storage = await fixture(t);
  await writeFile(storage.target('sample'), '{bad JSON'); await writeFile(storage.target('sample') + '.bak', '{"counter":7}');
  assert.deepEqual(await storage.read('sample', { counter: 0 }, { validate: schema }), { counter: 7 });
  const corrupt = (await readdir(storage.directory)).find(name => name.startsWith('sample.json.corrupt-'));
  assert.equal(await readFile(path.join(storage.directory, corrupt), 'utf8'), '{bad JSON');
  assert.ok(storage.warnings.length); assert.equal(JSON.parse(await readFile(storage.target('sample'), 'utf8')).counter, 7);
});
test('invalid schemas cannot replace good data; a failed write does not poison subsequent writes', async t => {
  const storage = await fixture(t); await storage.read('sample', { counter: 0 }, { validate: schema });
  await storage.write('sample', { counter: 1 }); await assert.rejects(storage.write('sample', { chats: [] }), /inválido/);
  assert.equal((await storage.read('sample', {}, { validate: schema })).counter, 1);
  const blocker = path.join(storage.directory, 'not-directory'); await writeFile(blocker, 'blocker');
  const broken = new LocalStorage(blocker); await assert.rejects(broken.write('sample', { counter: 2 }));
  broken.directory = path.join(storage.directory, 'repaired'); await mkdir(broken.directory);
  await broken.write('sample', { counter: 3 }); assert.equal((await broken.read('sample', {})).counter, 3);
  for (const name of ['../sample', 'x/y', 'C:\\sample', '']) assert.throws(() => storage.target(name), /inválido/);
});
test('history validation bounds identifiers, duplicates, messages and delivery receipts', () => {
  const good = { chats: [{ id: 'chat', title: 'Título', messages: [{ id: 'u', role: 'user', text: 'Olá' }] }], ignored: [] };
  assert.equal(validHistory(good), true);
  for (const bad of [null, { chats: {} }, { ...good, ignored: [123] }, { ...good, chats: [...good.chats, ...good.chats] }, { chats: [{ ...good.chats[0], delivery: { status: 'completed' } }] }, { chats: [{ ...good.chats[0], messages: [{ id: 'u', role: 'assistant', text: 'a'.repeat(200001) }] }] }]) assert.equal(validHistory(bad), false);
});
