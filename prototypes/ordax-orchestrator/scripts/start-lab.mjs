import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertBootstrapVersion } from '../lib/version-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const product = path.join(root, 'product');
const args = process.argv.slice(2);
const staged = args.length === 1 && args[0] === '--staged';
if (args.length && !staged) throw Error('usage: node scripts/start-lab.mjs [--staged]');

function start() {
  const version = assertBootstrapVersion(root,
    JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'source-lock.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(product, 'package.json'), 'utf8'));
  const owned = JSON.parse(fs.readFileSync(path.join(product, 'OWNED-SOURCE.json'), 'utf8'));

  if (pkg.name !== lock.targetIdentity.name || pkg.version !== version.version ||
      pkg.build?.appId !== lock.targetIdentity.appId ||
      pkg.build?.productName !== lock.targetIdentity.productName ||
      pkg.build?.win?.executableName !== lock.targetIdentity.productName ||
      owned.source?.commit !== lock.commit ||
      owned.source?.repository !== lock.repository ||
      owned.product?.appId !== lock.targetIdentity.appId) {
    throw Error('owned_product_contract_mismatch');
  }

  const main = fs.readFileSync(path.join(product, 'desktop', 'main.mjs'), 'utf8');
  const worker = fs.readFileSync(path.join(product, 'desktop', 'embedded-worker.mjs'), 'utf8');
  const profileBinding = fs.readFileSync(path.join(product, 'src', 'lab-profile-binding.mjs'), 'utf8');
  if (!main.includes('resolveLabUserRoot({') ||
      !main.includes("app.setPath('userData', userRoot)") ||
      !profileBinding.includes("path.join(localAppData,'OrdaX','OrchestratorLab')") ||
      !main.includes("'ordax-orchestrator-lab.sqlite'") ||
      !worker.includes("'persist:ordax-orchestrator-lab-chatgpt'") ||
      worker.includes('persist:ordax-gratis-chatgpt') ||
      worker.includes('ORDAX_CHATGPT_PARTITION')) {
    throw Error('owned_product_profile_isolation_violation');
  }
  const electronCli = path.join(product, 'node_modules', 'electron', 'cli.js');
  if (!fs.existsSync(electronCli)) {
    throw Error('Owned Lab dependencies missing. Run npm ci --prefix product.');
  }

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // Staged preview must never open the installed profile or compete for its SQLite WAL.
  if (staged) {
    env.LOCALAPPDATA = path.join(root, 'candidate-userdata-v' + version.version);
    env.ORDAX_LAB_SUPERVISOR_ENABLE = '0';
    delete env.GROQ_API_KEY;
  }
  const electronArgs = [electronCli, '.'];
  if (staged) electronArgs.push('--ordax-lab-staged-approved',
    '--ordax-lab-staged-localappdata=' + env.LOCALAPPDATA,
    '--remote-debugging-port=9446');
  const proc = spawnSync(process.execPath, electronArgs, {
    cwd: product, stdio: 'inherit', windowsHide: false, env
  });
  if (proc.error) throw proc.error;
  process.exitCode = proc.status ?? 1;
}
try { start(); }
catch (error) {
  process.stderr.write('Orchestrator Lab refused to start: ' + error.message + '\n');
  process.exitCode = 1;
}
