import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeTargets, deviceAvailable, deviceLabel, deviceStatus } from '../src/runtime-targets.mjs';

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
