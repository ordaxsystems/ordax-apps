import test from 'node:test';
import assert from 'node:assert/strict';
import {requiresOrchestratorWindowsBuild as build} from '../scripts/ci-scope.mjs';

test('documentation-only W3 evidence does not require another Windows package',()=>{
  assert.equal(build(['prototypes/ordax-orchestrator/CODEX-HANDOFF.md']),false);
  assert.equal(build(['prototypes/ordax-orchestrator/docs/audits/HEALTH.md',
    'prototypes/ordax-orchestrator/README.md']),false);
});
test('code, policy, dependency, workflow and unknown changes always rebuild',()=>{
  for(const path of [
    'prototypes/ordax-orchestrator/product/desktop/embedded-worker.mjs',
    'prototypes/ordax-orchestrator/product/package-lock.json',
    'prototypes/ordax-orchestrator/source-lock.json',
    'prototypes/ordax-orchestrator/scripts/ci-scope.mjs',
    '.github/workflows/orchestrator-lab-isolation.yml',
    'apps/sales/src/index.mjs',
    'prototypes/ordax-orchestrator/docs/../product/main.mjs',
    '/prototypes/ordax-orchestrator/docs/unsafe.md',
  ])assert.equal(build([path]),true,path);
});
test('documentation plus even one code file builds and empty/untrusted input fails closed',()=>{
  assert.equal(build(['prototypes/ordax-orchestrator/CODEX-HANDOFF.md',
    'prototypes/ordax-orchestrator/product/test/provider-health.test.mjs']),true);
  assert.equal(build([]),true);
  assert.equal(build(null),true);
  assert.equal(build(['']),true);
  assert.equal(build([42]),true);
});
