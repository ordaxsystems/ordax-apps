import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProductVersion } from '../lib/version-policy.mjs';
import {PRODUCT_NAME} from '../product/src/product-brand.mjs';

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
  // Forge is the current package identity; sourceLock keeps the original
  // imported technical identity as historical, immutable provenance.
  assert.equal(pkg.name,'ordax-forge');
  assert.equal(npmLock.name,pkg.name);
  assert.equal(npmLock.packages[''].name,pkg.name);
  assert.equal(sourceLock.targetIdentity.name,'ordax-forge');
  assert.equal(pkg.build.appId,sourceLock.targetIdentity.appId);
  // The source lock preserves the original technical snapshot, not the live commercial brand.
  assert.equal(pkg.build.productName,PRODUCT_NAME);
  assert.equal(sourceLock.targetIdentity.productName,'OrdaX Forge');
  assert.equal(npmLock.version,version.version);
  assert.equal(npmLock.packages[''].version,version.version);
  assert.equal(origin.source.repository,sourceLock.repository);
  assert.equal(origin.source.commit,sourceLock.commit);
  // The one-time Flow extraction provenance is immutable, even after Forge
  // becomes the sole live app identity and executable.
  assert.equal(origin.product.appId,'br.com.ordax.orchestrator.lab');
});

test('product is under version control and not a generated workspace or copied Flow Hub', () => {
  assert.ok(fs.existsSync(path.join(ownedRoot,'src','store.mjs')));
  assert.equal(fs.existsSync(path.join(ownedRoot,'supervisor','coordinator.mjs')),false);
  assert.equal(fs.existsSync(path.join(ownedRoot,'supervisor','groq-planner.mjs')),false);
  assert.ok(fs.existsSync(path.join(ownedRoot,'supervisor','recovery.mjs')));
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
  assert.match(profile,/path\.join\(localAppData,'OrdaX','Forge'\)/);
  assert.match(profile,/lab_staged_profile_explicit_binding_required/);
  assert.match(main,/ordax-forge\.sqlite/);
  assert.doesNotMatch(main,/'OrdaX', 'Gratis'|ordax-gratis\.sqlite/);
  assert.match(worker,/persist:ordax-forge-chatgpt/);
  assert.doesNotMatch(worker,/persist:ordax-gratis-chatgpt|ORDAX_CHATGPT_PARTITION/);
});

test('owned product keeps GPT Web observational and Forge MCP as the sole tool authority', () => {
  const main=read('product/desktop/main.mjs');
  const worker=read('product/desktop/embedded-worker.mjs');
  const contract=read('product/src/forge-contract.mjs');
  assert.match(worker,/class EmbeddedChatWorker/);
  assert.match(worker,/allowSend=true/);
  assert.match(worker,/provider_send_disabled_for_passive_app/);
  assert.match(main,/new EmbeddedChatWorker\(\{id:'primary',allowSend:false\}\)/);
  assert.match(main,/createForgeLoopbackMcp/);
  assert.match(main,/FORGE_APP_MCP_OPERATIONS/);
  assert.doesNotMatch(main,/coordinator:null|createGroqCoordinatorConversation|createGroqSupervisorPlanner/);
  assert.doesNotMatch(main,/GROQ_API_KEY|api\.groq\.com/);
  assert.doesNotMatch(main,/const mcpApp='forge-mcp'|async function runTask\(|ownerDispatch|ordax:tasks:send|store\.beginProviderRun\(taskId, prompt|finishRun\(/);
  assert.doesNotMatch(contract,/\['forjador_send'|\['work_send'|\['proposal_send'/);
});
