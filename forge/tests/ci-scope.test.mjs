import test from 'node:test';
import assert from 'node:assert/strict';
import {requiresOrchestratorWindowsBuild as build} from '../scripts/ci-scope.mjs';

test('documentation-only W3 evidence does not require another Windows package',()=>{
  assert.equal(build(['forge/CODEX-HANDOFF.md']),false);
  assert.equal(build(['forge/docs/audits/HEALTH.md',
    'forge/README.md']),false);
});
test('code, policy, dependency, workflow and unknown changes always rebuild',()=>{
  for(const path of [
    'forge/product/desktop/embedded-worker.mjs',
    'forge/product/package-lock.json',
    'forge/source-lock.json',
    'forge/scripts/ci-scope.mjs',
    '.github/workflows/forge-windows-isolation.yml',
    'apps/sales/src/index.mjs',
    'forge/docs/../product/main.mjs',
    '/forge/docs/unsafe.md',
  ])assert.equal(build([path]),true,path);
});
test('documentation plus even one code file builds and empty/untrusted input fails closed',()=>{
  assert.equal(build(['forge/CODEX-HANDOFF.md',
    'forge/product/test/provider-health.test.mjs']),true);
  assert.equal(build([]),true);
  assert.equal(build(null),true);
  assert.equal(build(['']),true);
  assert.equal(build([42]),true);
});
