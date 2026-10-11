import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createCentralActivation } = createRequire(import.meta.url)('../native/central-activation.cjs');

test('Central request arriving before Electron UI is ready is delivered only after ready', () => {
  const sent = [];
  const navigation = createCentralActivation(() => sent.push('central'));
  navigation.request(); navigation.request();
  assert.deepEqual(sent, []);
  navigation.markReady();
  assert.deepEqual(sent, ['central']);
  navigation.markReady();
  assert.deepEqual(sent, ['central']);
});

test('Central request after ready is delivered to existing Studio without new authority', () => {
  const sent = [];
  const navigation = createCentralActivation(() => sent.push('central'));
  navigation.markReady();
  navigation.request();
  assert.deepEqual(sent, ['central']);
});

test('Central activation requires a presentation callback', () => {
  assert.throws(() => createCentralActivation(null), TypeError);
});
