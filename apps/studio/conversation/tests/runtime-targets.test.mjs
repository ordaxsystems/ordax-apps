import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeTargets as canonicalTargets, PRODUCT_RUNTIME_OPERATIONS } from '../../../../contracts/product-runtime.mjs';
import { runtimeTargets, deviceAvailable, deviceLabel, deviceStatus, assertOperationBinding } from '../src/runtime-targets.mjs';

test('canonical target names and explicit presence survive; legacy timestamps never imply online', () => {
  const targets = runtimeTargets([
    { device_id: 'desktop', device_name: 'Computador principal', name: 'Old', online: false, last_seen_at: '2026-10-09T12:00:00Z', secret: 'never-export' },
    { device_id: 'legacy', name: 'Legado', last_seen_at: '2026-10-09T12:00:00Z' },
    { device_id: 'bad-presence', online: 'false', last_seen_at: 'invalid' },
  ]);
  assert.deepEqual(targets[0], { deviceId: 'desktop', name: 'Computador principal', online: false, lastSeenAt: '2026-10-09T12:00:00.000Z' });
  assert.equal(targets[1].online, null); assert.equal(targets[2].online, null); assert.equal(targets[2].lastSeenAt, null);
  assert.ok(!JSON.stringify(targets).includes('never-export'));
  const state = { connected: true, catalogAvailable: true, targets };
  assert.equal(deviceAvailable(state, 'desktop'), false);
  assert.equal(deviceAvailable(state, 'legacy'), true);
  assert.equal(deviceAvailable(state, 'forged'), false);
  assert.equal(deviceAvailable({ ...state, catalogAvailable: false }, 'legacy'), false);
  assert.match(deviceLabel(targets[0]), /informado offline/);
  assert.match(deviceStatus(state, 'desktop'), /precisam dele ligado/);
  assert.match(deviceStatus(state, 'legacy'), /não informa a presença/);
  assert.match(deviceStatus({ ...state, catalogAvailable: false }, 'desktop'), /não confirmada/);
});

test('malformed, duplicate and oversized catalogs fail closed', () => {
  for (const data of [null, {}, [null], [{ device_id: '../outside' }], [{ device_id: 'a' }, { device_id: 'a' }], Array(101).fill({ device_id: 'a' })]) assert.throws(() => runtimeTargets(data), /Catálogo inválido/);
});

test('Studio rejects a wrong-PC, wrong-project or wrong-action receipt before displaying it', () => {
  const request = { deviceId: 'pc-1', project: 'pasta-1', kind: 'directory' };
  const receipt = { deviceId: 'pc-1', project: 'pasta-1', kind: 'directory', status: 'succeeded' };
  assert.equal(assertOperationBinding(request, receipt), receipt);
  for (const forged of [
    { ...receipt, deviceId: 'pc-2' },
    { ...receipt, project: 'pasta-2' },
    { ...receipt, kind: 'terminal' },
    { ...receipt, deviceId: undefined },
    null,
  ]) {
    assert.throws(() => assertOperationBinding(request, forged), /resultado foi rejeitado/);
  }
  const deviceRequest = { deviceId: 'pc-1', project: '', kind: 'projects' };
  assert.equal(assertOperationBinding(deviceRequest, { deviceId: 'pc-1', project: null, kind: 'projects' }).kind, 'projects');
  assert.throws(() => assertOperationBinding(deviceRequest, { deviceId: 'pc-1', project: 'pasta-2', kind: 'projects' }), /resultado foi rejeitado/);
});

test('Studio and native Product host share one immutable operation and target contract', () => {
  assert.strictEqual(runtimeTargets, canonicalTargets);
  assert.ok(Object.isFrozen(PRODUCT_RUNTIME_OPERATIONS));
  assert.equal(PRODUCT_RUNTIME_OPERATIONS.terminal.action, 'terminal.exec');
  assert.deepEqual(PRODUCT_RUNTIME_OPERATIONS.terminal.fields, ['argv', 'cwd']);
  assert.equal(PRODUCT_RUNTIME_OPERATIONS.terminal.scope, 'project');
  assert.equal(PRODUCT_RUNTIME_OPERATIONS.projects.scope, 'device');
  assert.equal(PRODUCT_RUNTIME_OPERATIONS.projectCreate.scope, 'new-project');
  for (const entry of Object.values(PRODUCT_RUNTIME_OPERATIONS)) {
    assert.equal(Object.isFrozen(entry), true);
    assert.equal(Object.isFrozen(entry.fields), true);
  }
});
