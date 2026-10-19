import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertDerivedIdentity } from '../lib/derive.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.join(root, 'workspace');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'source-lock.json'), 'utf8'));
const read = name => fs.readFileSync(path.join(workspace, name));

try {
  if (!fs.existsSync(path.join(workspace, 'DERIVATION.json'))) {
    throw new Error('No isolated snapshot found. Run npm run import:flow first.');
  }
  const derivation = JSON.parse(read('DERIVATION.json').toString('utf8'));
  if (derivation.fromCommit !== lock.commit ||
      derivation.appId !== lock.targetIdentity.appId) {
    throw new Error('Source provenance/identity mismatch; execution refused.');
  }
  assertDerivedIdentity({
    'package.json': read('package.json'),
    'desktop/main.mjs': read('desktop/main.mjs'),
    'desktop/embedded-worker.mjs': read('desktop/embedded-worker.mjs'),
    'desktop/ui.html': read('desktop/ui.html')
  }, lock);
  if (!fs.existsSync(path.join(workspace, 'node_modules', 'electron'))) {
    throw new Error('Isolated dependencies missing. Run npm ci --prefix workspace.');
  }
  // Node 26+ on Windows rejects bare .cmd spawnSync (EINVAL). Launch the
  // locally installed Electron CLI through this Node executable, without
  // command-shell interpolation or a dependency on globally installed npm.
  const electronCli = path.join(workspace, 'node_modules', 'electron', 'cli.js');
  if (!fs.existsSync(electronCli)) {
    throw new Error('Electron CLI missing in the isolated workspace.');
  }
  const result = spawnSync(process.execPath, [electronCli, '.'], {
    cwd: workspace, stdio: 'inherit', windowsHide: false,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  process.stderr.write('Orchestrator Lab refused to start: ' + error.message + '\n');
  process.exitCode = 1;
}
