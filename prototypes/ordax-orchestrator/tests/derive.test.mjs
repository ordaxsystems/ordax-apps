import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowSourcePath, deriveSourceFile, assertDerivedIdentity } from '../lib/derive.mjs';
import { applySupervisorOverlay } from '../lib/supervisor-overlay.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'source-lock.json'), 'utf8'));
const text = (p, v) => deriveSourceFile(p, Buffer.from(v, 'utf8'), lock).toString('utf8');
const artifact = 'OrdaX-Gratis-' + '$' + '{version}.exe';
const pkg = {
  name: 'ordax-gratis', version: '0.4.12',
  build: { appId: 'br.com.ordax.gratis', productName: 'OrdaX Gratis',
    files: ['desktop/**/*','src/*.mjs','package.json'],
    win: { executableName: 'OrdaX Gratis', artifactName: artifact } }
};
const main = [
  "app.setName('OrdaX Gratis');",
  "const userRoot = path.join(localAppData, 'OrdaX', 'Gratis');",
  "const store = new Store(path.join(dataRoot, 'ordax-gratis.sqlite'));",
  "title: 'OrdaX Gratis',",
  "app.commandLine.appendSwitch('remote-debugging-port', '9444');"
].join('\n');
const worker = "this.partition = process.env.ORDAX_CHATGPT_PARTITION || 'persist:ordax-gratis-chatgpt';";
const html = '<title>OrdaX Gratis</title><p>Gratis • memória local</p>';

test('source pin and disabled promotion flags are explicit', () => {
  assert.match(lock.commit, /^[a-f0-9]{40}$/);
  assert.equal(lock.repository, 'ordaxsystems/ordax-flow');
  assert.equal(lock.targetIdentity.appId, 'br.com.ordax.orchestrator.lab');
  assert.equal(lock.distributionEnabled, false);
  assert.equal(lock.modelSupervisorEnabled, false);
  assert.equal(lock.externalUserIngressEnabled, false);
});

test('tracked-file allowlist excludes git metadata, traversal and secrets', () => {
  for (const accepted of ['desktop/main.mjs', 'src/store.mjs', 'build/icon.png',
    'package.json', 'test/store.test.mjs', 'sql/flow-conversation-history.sql']) {
    assert.equal(allowSourcePath(accepted), true, accepted);
  }
  for (const denied of ['../desktop/main.mjs', 'src/../../.env', '/etc/passwd',
    '.git/config', '.env', 'node_modules/electron/index.js', 'src\\evil.js',
    'config/secrets.json', 'desktop/../../cookies']) {
    assert.equal(allowSourcePath(denied), false, denied);
  }
});

test('fork has isolated appId, userData, SQLite and debugging port', () => {
  const p = JSON.parse(text('package.json', JSON.stringify(pkg)));
  assert.equal(p.build.appId, 'br.com.ordax.orchestrator.lab');
  assert.equal(p.build.productName, 'OrdaX Orchestrator Lab');
  assert.equal(p.name, 'ordax-orchestrator-lab');
  assert.deepEqual(p.build.files, ['desktop/**/*','src/*.mjs','supervisor/**/*','package.json']);
  assert.equal(p.build.win.artifactName, 'OrdaX-Orchestrator-Lab-' + '$' + '{version}.exe');
  const m = text('desktop/main.mjs', main);
  assert.match(m, /app\.setName\('OrdaX Orchestrator Lab'\)/);
  assert.match(m, /'OrdaX', 'OrchestratorLab'/);
  assert.match(m, /'ordax-orchestrator-lab\.sqlite'/);
  assert.doesNotMatch(m, /'OrdaX', 'Gratis'|ordax-gratis\.sqlite|9444/);
  assert.match(m, /9445/);
});

test('fork cannot use Gratis session even if legacy env variable is present', () => {
  const w = text('desktop/embedded-worker.mjs', worker);
  assert.equal(w, "this.partition = 'persist:ordax-orchestrator-lab-chatgpt';");
  assert.doesNotMatch(w, /ORDAX_CHATGPT_PARTITION|ordax-gratis-chatgpt/);
});

test('UI and desktop-contract fixture use new lab identity', () => {
  assert.equal(text('desktop/ui.html', html),
    '<title>OrdaX Orchestrator Lab</title><p>Orchestrator Lab • memória isolada</p>');
  const assertion = 'assert.match(main, /OrdaX[\'"], [\'"]Gratis/);\n' +
    "assert.deepEqual(pkg.build.files, ['desktop/**/*','src/*.mjs','package.json']);";
  assert.match(text('test/desktop-contract.test.mjs', assertion), /OrchestratorLab/);
});

test('import fails closed if pinned source drifts', () => {
  assert.throws(() => text('desktop/main.mjs', main.replace("'Gratis'", "'Other'")),
    /Pinned Flow source differs/);
  assert.throws(() => text('desktop/embedded-worker.mjs', "this.partition = 'persist:other-chat';"),
    /Pinned Flow source differs/);
  assert.throws(() => text('package.json', JSON.stringify({ ...pkg, version: '0.4.13' })),
    /Expected values to be strictly equal/);
});

test('derived source validation rejects original app credentials/session authority', () => {
  const good = {
    'package.json': deriveSourceFile('package.json', JSON.stringify(pkg), lock),
    'desktop/main.mjs': deriveSourceFile('desktop/main.mjs', main, lock),
    'desktop/embedded-worker.mjs': deriveSourceFile('desktop/embedded-worker.mjs', worker, lock),
    'desktop/ui.html': deriveSourceFile('desktop/ui.html', html, lock)
  };
  assert.doesNotThrow(() => assertDerivedIdentity(good, lock));
  assert.throws(() => assertDerivedIdentity({
    ...good, 'desktop/embedded-worker.mjs': Buffer.from(worker)
  }));
});

test('copied binary module is unchanged byte-for-byte', () => {
  const source = Buffer.from([0, 255, 7, 8, 10]);
  assert.deepEqual(deriveSourceFile('build/icon.png', source, lock), source);
});


test('lab-only supervisor overlay is fail-closed and does not import old Flow privileges', () => {
  const miniMain = [
    "import { app, BrowserWindow, ipcMain, protocol, net } from 'electron';",
    "import path from 'node:path';",
    "app.whenReady().then(async () => {"
  ].join('\n');
  const output = applySupervisorOverlay('desktop/main.mjs',miniMain).toString('utf8');
  assert.match(output,/SupervisorCoordinator/);
  assert.match(output,/supervisor_disabled/);
  assert.match(output,/dialog\.showMessageBox/);
  assert.match(output,/runTask\(taskId,content/);
  assert.match(output,/GROQ_API_KEY/);
  assert.doesNotMatch(output,/app\.setName\('OrdaX Gratis'\)/);
  assert.throws(()=>applySupervisorOverlay('desktop/main.mjs','app.whenReady()'),/Pinned Flow surface drifted/);
  const preload = applySupervisorOverlay('desktop/preload.cjs',
    "  workspace: () => ipcRenderer.invoke('ordax:workspace:get'),");
  assert.match(preload.toString('utf8'),/supervisorApprove/);
  const html = applySupervisorOverlay('desktop/ui.html','    </aside>\n  </main>');
  assert.match(html.toString('utf8'),/Supervisor OrdaX Lab/);
  assert.match(html.toString('utf8'),/labSupervisorObjective/);
  const js = applySupervisorOverlay('desktop/ui.js','// original UI');
  assert.match(js.toString('utf8'),/labSupervisorPlan/);
  assert.match(js.toString('utf8'),/supervisorStatus/);
});
