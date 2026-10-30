import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProductVersion } from '../lib/version-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ownedRoot = path.join(root, 'product');
const read = rel => fs.readFileSync(path.join(root,rel),'utf8');

test('tracked product has its own canonical identity and version', () => {
  const version=readProductVersion(root);
  const sourceLock=JSON.parse(read('source-lock.json'));
  const pkg=JSON.parse(read('product/package.json'));
  const npmLock=JSON.parse(read('product/package-lock.json'));
  const origin=JSON.parse(read('product/OWNED-SOURCE.json'));
  assert.equal(pkg.version,version.version);
  assert.equal(pkg.name,sourceLock.targetIdentity.name);
  assert.equal(pkg.build.appId,sourceLock.targetIdentity.appId);
  assert.equal(pkg.build.productName,sourceLock.targetIdentity.productName);
  assert.equal(npmLock.version,version.version);
  assert.equal(npmLock.packages[''].version,version.version);
  assert.equal(origin.source.repository,sourceLock.repository);
  assert.equal(origin.source.commit,sourceLock.commit);
  assert.equal(origin.product.appId,sourceLock.targetIdentity.appId);
});

test('product is under version control and not a generated workspace or copied Flow Hub', () => {
  assert.ok(fs.existsSync(path.join(ownedRoot,'src','store.mjs')));
  assert.ok(fs.existsSync(path.join(ownedRoot,'supervisor','coordinator.mjs')));
  assert.ok(fs.existsSync(path.join(ownedRoot,'desktop','embedded-worker.mjs')));
  for(const banned of ['src/relay','apps','sql','node_modules/.git']) {
    assert.equal(fs.existsSync(path.join(ownedRoot,banned)),false,banned);
  }
  const origin=JSON.parse(read('product/OWNED-SOURCE.json'));
  assert.ok(origin.files.length >= 35);
  const paths=origin.files.map(x=>x.path);
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(paths.every(x=>!x.startsWith('src/relay/')&&!x.startsWith('apps/')&&!x.startsWith('sql/')));
});

test('start defaults to the Node host while explicit Electron retains its isolated profile', () => {
  const bootstrap=JSON.parse(read('package.json'));
  assert.equal(bootstrap.scripts.start,'node product/scripts/start-host.mjs');
  assert.equal(bootstrap.scripts['start:electron'],'node scripts/start-lab.mjs');
  assert.ok(!('import:flow' in bootstrap.scripts));
  const launch=read('scripts/start-lab.mjs');
  assert.match(launch,/path\.join\(root, 'product'\)/);
  assert.doesNotMatch(launch,/workspace-next|workspace'|workspace"/);
  assert.match(launch,/staged/);
  const main=read('product/desktop/main.mjs');
  const worker=read('product/desktop/embedded-worker.mjs');
  const profile=read('product/src/lab-profile-binding.mjs');
  assert.match(main,/resolveLabUserRoot/);
  assert.match(main,/app\.setPath\('userData', userRoot\)/);
  assert.match(profile,/path\.join\(localAppData,'OrdaX','OrchestratorLab'\)/);
  assert.match(profile,/lab_staged_profile_explicit_binding_required/);
  assert.match(main,/ordax-orchestrator-lab\.sqlite/);
  assert.doesNotMatch(main,/'OrdaX', 'Gratis'|ordax-gratis\.sqlite/);
  assert.match(worker,/persist:ordax-orchestrator-lab-chatgpt/);
  assert.doesNotMatch(worker,/persist:ordax-gratis-chatgpt|ORDAX_CHATGPT_PARTITION/);
});

test('owned product keeps manual ChatGPT Web as required and supervisor gated', () => {
  const main=read('product/desktop/main.mjs');
  const worker=read('product/desktop/embedded-worker.mjs');
  assert.match(worker,/class EmbeddedChatWorker/);
  assert.match(main,/ORDAX_LAB_SUPERVISOR_ENABLE/);
  assert.match(main,/runTask/);
  const store=read('product/src/store.mjs');
  assert.match(main,/store\.beginProviderRun\(taskId, prompt/);
  assert.match(store,/this\.startRun\(taskId, workerId, observerMode\)/);
  assert.match(main,/finishRun/);
});
