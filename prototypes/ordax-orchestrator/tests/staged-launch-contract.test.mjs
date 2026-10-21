import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('staged launcher checks canonical owned profile resolver, not obsolete main inline path', () => {
  const launcher = read('scripts/start-lab.mjs');
  const main = read('product/desktop/main.mjs');
  const binding = read('product/src/lab-profile-binding.mjs');
  assert.match(launcher, /main\.includes\('resolveLabUserRoot\(\{'\)/);
  assert.match(launcher, /main\.includes\("app\.setPath\('userData', userRoot\)"\)/);
  assert.match(main, /resolveLabUserRoot\(\{/);
  assert.match(main, /app\.setPath\('userData', userRoot\)/);
  assert.match(binding, /path\.join\(localAppData,'OrdaX','OrchestratorLab'\)/);
  assert.doesNotMatch(launcher, /main\.includes\("'OrdaX', 'OrchestratorLab'"\)/);
});

test('staged launcher explicitly binds candidate profile and debug port', () => {
  const launcher = read('scripts/start-lab.mjs');
  const binding = read('product/src/lab-profile-binding.mjs');
  assert.match(launcher, /if \(staged\) electronArgs\.push\('--ordax-lab-staged-approved'/);
  assert.match(launcher, /'--ordax-lab-staged-localappdata=' \+ env\.LOCALAPPDATA/);
  assert.match(launcher, /'--remote-debugging-port=9446'/);
  assert.match(launcher, /spawnSync\(process\.execPath, electronArgs/);
  assert.match(binding, /const approvalFlag='--ordax-lab-staged-approved'/);
  assert.match(binding, /const stagedPrefix='--ordax-lab-staged-localappdata='/);
  assert.match(binding, /lab_staged_profile_explicit_binding_required/);
  assert.match(launcher, /delete env\.GROQ_API_KEY/);
  assert.match(launcher, /ORDAX_LAB_SUPERVISOR_ENABLE = '0'/);
});
