import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { allowSourcePath, deriveSourceFile, assertDerivedIdentity } from '../lib/derive.mjs';
import { applySupervisorOverlay } from '../lib/supervisor-overlay.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'source-lock.json'), 'utf8'));
const options = process.argv.slice(2);
const staged = options.includes('--staged');
const parameters = options.filter(option => option !== '--staged');
if (options.filter(option => option === '--staged').length > 1 ||
    (parameters.length !== 0 && (parameters.length !== 2 || parameters[0] !== '--source'))) {
  throw new Error('usage: node scripts/import-flow.mjs [--source LOCAL_FLOW_REPO] [--staged]');
}
const output = path.join(root, staged ? 'workspace-next' : 'workspace');

function git(directory, args, maxBuffer = 4 * 1024 * 1024) {
  const result = spawnSync('git', ['-C', directory, ...args], {
    encoding: null, maxBuffer, windowsHide: true
  });
  if (result.error || result.status !== 0) {
    throw new Error('git failed (' + args[0] + '): ' +
      (result.error?.message || result.stderr?.toString('utf8').slice(0, 400) || result.status));
  }
  return result.stdout;
}

function verifyPinnedSource(source) {
  const actual = git(source, ['rev-parse', lock.commit + '^{commit}']).toString('utf8').trim();
  if (actual !== lock.commit) throw new Error('source commit mismatch; no files written');
}

function listPinnedFiles(source) {
  const paths = git(source, ['ls-tree', '-r', '--name-only', '-z', lock.commit])
    .toString('utf8').split('\0').filter(Boolean).filter(allowSourcePath);
  if (!paths.includes('desktop/main.mjs') || !paths.includes('desktop/embedded-worker.mjs') ||
      !paths.includes('package-lock.json') || !paths.includes('test/desktop-contract.test.mjs') ||
      !paths.includes('sql/flow-conversation-history.sql') ||
      !paths.includes('sql/flow-oauth-transactions.sql')) {
    throw new Error('pinned source is missing required desktop files');
  }
  return paths.sort();
}

function createWorkspace(source) {
  if (fs.existsSync(output)) {
    throw new Error('workspace exists; refuse to overwrite any generated app or user data');
  }
  verifyPinnedSource(source);
  const paths = listPinnedFiles(source);
  const stage = fs.mkdtempSync(path.join(root, '.import-staging-'));
  const keyFiles = {};
  try {
    for (const relative of paths) {
      const bytes = git(source, ['show', lock.commit + ':' + relative]);
      const transformed = applySupervisorOverlay(relative, deriveSourceFile(relative, bytes, lock));
      if (['package.json', 'desktop/main.mjs', 'desktop/embedded-worker.mjs',
        'desktop/ui.html'].includes(relative)) keyFiles[relative] = transformed;
      const target = path.join(stage, ...relative.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, transformed, { flag: 'wx' });
    }
    // These are lab-owned modules, not copies from the frozen Flow repository.
    const labModules = ['supervisor/coordinator.mjs', 'supervisor/groq-planner.mjs'];
    for (const relative of labModules) {
      const sourcePath = path.join(root, ...relative.split('/'));
      const targetPath = path.join(stage, ...relative.split('/'));
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
    }
        assertDerivedIdentity(keyFiles, lock);
    const provenance = {
      schema: 'ordax.orchestrator-lab-provenance/1',
      fromRepository: lock.repository,
      fromCommit: lock.commit,
      copiedTrackedFiles: paths.length,
      labOwnedModules: labModules,
      appId: lock.targetIdentity.appId,
      userDataSuffix: lock.targetIdentity.userDataSuffix,
      note: 'Local derived workspace. Source of truth for this prototype is the pin and importer in ordax-apps. No upstream writes.'
    };
    fs.writeFileSync(path.join(stage, 'DERIVATION.json'),
      JSON.stringify(provenance, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(stage, output);
    process.stdout.write('Isolated Orchestrator Lab source created: ' + output + '\n');
    process.stdout.write('Pinned Flow commit: ' + lock.commit + '; copied files: ' + paths.length + '\n');
    process.stdout.write('Next: npm ci --prefix workspace && npm run validate --prefix workspace\n');
  } finally {
    if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
  }
}

let temporary = null;
try {
  let source;
  if (parameters[0] === '--source') {
    if (!parameters[1]) throw new Error('missing --source path');
    source = path.resolve(parameters[1]);
  } else {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ordax-orchestrator-source-'));
    source = path.join(temporary, 'flow');
    const clone = spawnSync('git', ['clone', '--quiet', '--no-checkout',
      'https://github.com/' + lock.repository + '.git', source], {
      encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024
    });
    if (clone.status !== 0 || clone.error) {
      throw new Error('Cannot read private pinned Flow repository; use a GitHub-authenticated git session or --source. ' +
        (clone.error?.message || clone.stderr?.slice(0, 250) || 'clone failed'));
    }
  }
  createWorkspace(source);
} catch (error) {
  process.stderr.write('Import cancelled without touching Flow/Gratis: ' + error.message + '\n');
  process.exitCode = 1;
} finally {
  if (temporary && fs.existsSync(temporary)) {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
