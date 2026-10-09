import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductRuntime, productSubjectJournalKey, validSubjectJournal } from '../native/product-runtime.mjs';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const label = subject => subject === A ? 'alice' : 'bob';

function fixture() {
  const disk = new Map();
  const storage = {
    async read(key, fallback, { validate } = {}) {
      const record = structuredClone(disk.has(key) ? disk.get(key) : fallback);
      if (validate && !validate(record)) {
        throw Object.assign(new Error('O registro local requer recuperação.'), { code: 'STORAGE_RECOVERY_REQUIRED' });
      }
      return record;
    },
    async write(key, data) { disk.set(key, structuredClone(data)); },
  };
  let actions = 0, sessionReads = 0, remoteSubjectOverride = null;
  const fetcher = async (url, init) => {
    const token = init.headers.Authorization;
    const subject = token === 'Bearer alice-token' ? A : token === 'Bearer bob-token' ? B : null;
    if (!subject) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    if (url.endsWith('/session')) {
      sessionReads++;
      return Response.json({ ok: true, session: { subject_id: remoteSubjectOverride || subject } });
    }
    if (url.includes('/targets')) {
      return Response.json({ ok: true, targets: [{ device_id: label(subject)+'-device', online: true }] });
    }
    actions++;
    return Response.json({ ok: true, request_id: 'receipt-' + label(subject) });
  };
  function runtime() {
    return new ProductRuntime({ storage, fetcher, env: { ORDAX_PRODUCT_CONTROL_PLANE_URL: 'https://control.example.test' }, interval: 100000 });
  }
  const op = (subject, status = 'succeeded') => ({
    id: 'op-' + label(subject), kind: 'projects', status, deviceId: label(subject)+'-device',
    project: null, requestId: 'receipt-'+label(subject),
    createdAt: '2026-10-09T12:00:00.000Z', label: 'Private '+label(subject),
    result: { data: { private: label(subject)+'-secret' } },
  });
  return { disk, storage, runtime, op, setSubject: s => { remoteSubjectOverride = s; },
    getActions: () => actions, sessionReads: () => sessionReads };
}

test('strict canonical subject derives bounded non-reversible storage names', () => {
  const key = productSubjectJournalKey(A);
  assert.match(key, /^product-ops-[0-9a-f]{28}$/);
  assert.equal(key.length, 40);
  assert.equal(key.includes(A), false);
  assert.notEqual(key, productSubjectJournalKey(B));
  for (const forged of ['../etc/passwd', '', 'user@example.com', A.toUpperCase(), 'a'.repeat(400)]) {
    assert.throws(() => productSubjectJournalKey(forged), /Product inválida/);
  }
});

test('Alice and Bob never see each other journal receipts on sign-in or restart', async () => {
  const f = fixture();
  const alice = f.runtime(); await alice.init();
  const connectedA = await alice.acceptAccountToken('alice-token');
  assert.equal(connectedA.connected, true);
  assert.deepEqual(connectedA.operations, []);
  alice.operations.push(f.op(A));
  await alice.persist();
  await alice.close();
  const keyA = productSubjectJournalKey(A);
  assert.equal(f.disk.get(keyA).subjectId, A);
  assert.equal(f.disk.get(keyA).schemaVersion, 2);

  const bob = f.runtime(); await bob.init();
  const connectedB = await bob.acceptAccountToken('bob-token');
  assert.deepEqual(connectedB.operations, []);
  bob.operations.push(f.op(B));
  await bob.persist();
  await bob.close();
  assert.ok(!JSON.stringify(f.disk.get(productSubjectJournalKey(B))).includes('alice-secret'));
  assert.ok(!JSON.stringify(f.disk.get(keyA)).includes('bob-secret'));

  const aliceAgain = f.runtime(); await aliceAgain.init();
  const reconnected = await aliceAgain.acceptAccountToken('alice-token');
  assert.equal(reconnected.operations.length, 1);
  assert.equal(reconnected.operations[0].result.data.private, 'alice-secret');
  assert.ok(!JSON.stringify(reconnected).includes('bob-secret'));
  await aliceAgain.close();
  assert.equal(f.getActions(), 0);
});

test('legacy anonymous journal is not silently attributed to an authenticated subject', async () => {
  const f = fixture();
  const legacy = { schemaVersion: 1, operations: [f.op(A)] };
  f.disk.set('runtime-operations', structuredClone(legacy));
  const runtime = f.runtime(); await runtime.init();
  assert.equal(runtime.state().operations.length, 1);
  const state = await runtime.acceptAccountToken('bob-token');
  assert.equal(state.operations.length, 0);
  assert.equal(state.connected, true);
  assert.deepEqual(f.disk.get('runtime-operations'), legacy);
  await runtime.close();
  assert.deepEqual(f.disk.get('runtime-operations'), legacy);
  assert.equal(f.disk.get(productSubjectJournalKey(B)).subjectId, B);
});

test('an anonymous uncertain journal blocks account adoption without hitting network', async () => {
  const f = fixture();
  f.disk.set('runtime-operations', { schemaVersion: 1, operations: [f.op(A, 'uncertain')] });
  const runtime = f.runtime(); await runtime.init();
  await assert.rejects(runtime.acceptAccountToken('bob-token'), /Confira ou recupere/);
  assert.equal(f.sessionReads(), 0);
  assert.equal(runtime.state().configured, false);
  await runtime.close();
  assert.equal(f.disk.get('runtime-operations').operations[0].status, 'uncertain');
});

test('tampered subject journal cannot be re-owned, overwritten or bypassed on the next login', async () => {
  const f = fixture();
  const key = productSubjectJournalKey(A);
  f.disk.set(key, { schemaVersion: 2, subjectId: B, operations: [f.op(B)] });
  const runtime = f.runtime(); await runtime.init();
  await assert.rejects(runtime.acceptAccountToken('alice-token'), /recuperação/);
  assert.equal(runtime.state().configured, false);
  assert.equal(runtime.state().connected, false);
  assert.equal(runtime.state().recoveryRequired, true);
  await runtime.close();
  assert.deepEqual(f.disk.get(key).operations[0].result.data, { private: 'bob-secret' });
  assert.equal(f.getActions(), 0);
});

test('malformed or mismatched Product subjects never unlock the runtime or create files', async () => {
  const f = fixture();
  const runtime = f.runtime(); await runtime.init();
  f.setSubject('not-a-uuid');
  await assert.rejects(runtime.acceptAccountToken('alice-token'), /Product inválida/);
  assert.equal(runtime.state().configured, false);
  assert.deepEqual([...f.disk.keys()], []);
  f.setSubject(null);
  await runtime.acceptAccountToken('alice-token');
  f.setSubject(B);
  await assert.rejects(runtime.connect(), /identidade Product mudou/);
  assert.equal(runtime.state().connected, false);
  await runtime.close();
});

test('subject journal validator requires strict schema, subject, and valid operation records', () => {
  const record = { schemaVersion: 2, subjectId: A, operations: [] };
  assert.equal(validSubjectJournal(record, A), true);
  for (const forged of [
    { ...record, subjectId: B }, { ...record, schemaVersion: 1 },
    { ...record, extra: true }, { ...record, operations: '[]' },
    { ...record, operations: [{ status: 'succeeded' }] },
  ]) assert.equal(validSubjectJournal(forged,A), false);
});
