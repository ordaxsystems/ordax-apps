import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { isAccountURL, surfaceBounds } = createRequire(import.meta.url)('../native/policy.cjs');

test('native ChatGPT surface admits exact HTTPS login origins', () => {
  assert.equal(isAccountURL('https://chatgpt.com/c/example'), true);
  assert.equal(isAccountURL('https://auth.openai.com/login'), true);
  assert.equal(isAccountURL('https://accounts.google.com/signin'), true);
  for (const url of ['javascript:alert(1)', 'file:///test', 'http://chatgpt.com', 'https://chatgpt.com.evil.example', 'https://evil.example/chatgpt.com']) assert.equal(isAccountURL(url), false);
});
test('native conversation bounds reserve the app toolbar and quota footer', () => {
  assert.deepEqual(surfaceBounds(1240, 820), { x: 744, y: 64, width: 496, height: 724 });
  assert.deepEqual(surfaceBounds(620, 480), { x: 372, y: 64, width: 248, height: 384 });
  assert.deepEqual(surfaceBounds(1240, 820, true), { x: 0, y: 64, width: 1240, height: 724 });
});
