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
  const receipt = JSON.parse(operationReceipt({ id: 'local', requestId: 'remote', deviceId: 'device', project: 'a', status: 'succeeded', label: 'private command', result: { text: 'private context' }, token: 'secret' }));
  assert.equal(receipt.requestId, 'remote'); assert.equal(receipt.project, 'a');
  assert.ok(!JSON.stringify(receipt).includes('private')); assert.ok(!JSON.stringify(receipt).includes('secret'));
});
