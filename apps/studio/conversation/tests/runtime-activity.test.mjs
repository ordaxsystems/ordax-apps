import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleOperations, operationReceipt } from '../src/runtime-activity.mjs';
test('activity isolates completed project history but keeps every blocking receipt visible', () => {
  const operations = [{ id: 'a', deviceId: 'device', project: 'a', status: 'succeeded' }, { id: 'b', deviceId: 'device', project: 'b', status: 'succeeded' }, { id: 'other-device', deviceId: 'other', project: 'a', status: 'succeeded' }, { id: 'pending', deviceId: 'other', project: 'b', status: 'uncertain' }];
  assert.deepEqual(visibleOperations(operations, { deviceId: 'device', project: 'a' }).map(o => o.id), ['pending','a']);
  assert.equal(visibleOperations(operations, {}, true).length, 4);
  assert.deepEqual(operations.map(o => o.id), ['a','b','other-device','pending']);
});
test('copied receipts preserve correlation and omit command, result, context and credentials', () => {
  const receipt = JSON.parse(operationReceipt({
    id: 'local', requestId: 'remote', kind: 'blenderTransform', action: 'blender.live_object_transform',
    requestSha256: 'd'.repeat(64), effectSha256: 'e'.repeat(64),
    deviceId: 'device', project: 'a', status: 'succeeded', label: 'private command',
    result: { text: 'private context' }, token: 'secret',
  }));
  assert.equal(receipt.requestId, 'remote'); assert.equal(receipt.project, 'a');
  assert.equal(receipt.action, 'blender.live_object_transform');
  assert.equal(receipt.requestSha256, 'd'.repeat(64)); assert.equal(receipt.effectSha256, 'e'.repeat(64));
  assert.ok(!JSON.stringify(receipt).includes('private')); assert.ok(!JSON.stringify(receipt).includes('secret'));
  const malformed = JSON.parse(operationReceipt({
    id: 'malformed', requestId: 'remote-2', kind: 'terminal', action: 'bad action with spaces',
    requestSha256: 'x'.repeat(64), effectSha256: 'e'.repeat(63), error: 'long error message with spaces',
    deviceId: 'device', project: 'a', status: 'failed',
  }));
  assert.equal(malformed.action, null);
  assert.equal(Object.hasOwn(malformed, 'requestSha256'), false);
  assert.equal(Object.hasOwn(malformed, 'effectSha256'), false);
  assert.equal(Object.hasOwn(malformed, 'errorCode'), false);
});

test('write receipts expose only verified content digests for independent audit', () => {
  const expected = 'a'.repeat(64), proposed = 'b'.repeat(64), confirmed = 'c'.repeat(64);
  const receipt = JSON.parse(operationReceipt({
    id: 'local-write', requestId: 'remote-write', kind: 'write', deviceId: 'device', project: 'a', status: 'succeeded',
    expectedSha256: expected, proposedSha256: proposed,
    result: { data: { sha256: confirmed, content: 'private file content', command: 'private command' } },
  }));
  assert.deepEqual(receipt.contentDigests, {
    expectedSha256: expected,
    proposedSha256: proposed,
    resultSha256: confirmed,
  });
  assert.equal(JSON.stringify(receipt).includes('private'), false);
  const malformed = JSON.parse(operationReceipt({
    id: 'bad', requestId: 'bad-remote', kind: 'write', deviceId: 'device', project: 'a', status: 'failed',
    expectedSha256: '../not-a-digest', proposedSha256: 'd'.repeat(63), result: { sha256: 'e'.repeat(65) },
  }));
  assert.equal(Object.hasOwn(malformed, 'contentDigests'), false);
});
