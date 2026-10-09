import test from 'node:test';
import assert from 'node:assert/strict';
import { changePreview } from '../src/changes.mjs';
test('change preview isolates the replacement hunk and bounds large edits', () => {
  assert.equal(changePreview('a\nb\nc', 'a\nx\nc'), '@@ linha 2 · 1 removidas · 1 adicionadas @@\n- b\n+ x');
  assert.match(changePreview('a', 'a\nb'), /0 removidas · 1 adicionadas/);
  assert.match(changePreview('x\n'.repeat(300), 'y\n'.repeat(300)), /Prévia limitada/);
});
