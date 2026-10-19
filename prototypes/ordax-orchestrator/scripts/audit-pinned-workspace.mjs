import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { allowSourcePath, deriveSourceFile } from '../lib/derive.mjs';
import { applySupervisorOverlay } from '../lib/supervisor-overlay.mjs';
import { readProductVersion } from '../lib/version-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function git(repo, ...args) {
  const call = spawnSync('git', ['-C', repo, ...args], { encoding: null, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  if (call.error || call.status !== 0) {
    throw new Error('git_audit_failed: ' + args[0] + ': ' +
      String(call.error?.message || call.stderr?.toString('utf8') || call.status).slice(0, 200));
  }
  return call.stdout;
}

function ownerOf(relative) {
  if (relative.startsWith('apps/flow-client/')) return 'flow-client-out-of-scope';
  if (relative.startsWith('apps/flow-hub/') || relative.startsWith('src/relay/')) return 'flow-hub-out-of-scope';
  if (relative.startsWith('desktop/')) return 'legacy-electron-client';
  if (relative.startsWith('src/')) return 'legacy-client-core-review';
  if (relative.startsWith('test/') || relative.startsWith('scripts/')) return 'development-test';
  return 'reference-or-resource-review';
}

function safeTarget(workspaceDir, relative) {
  if (!relative || relative.includes('\\') || relative.split('/').includes('..') || path.isAbsolute(relative)) {
    throw new Error('invalid_audit_path');
  }
  const base = path.resolve(workspaceDir);
  const parts = relative.split('/');
  let current = base;
  for (const part of parts) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) return { target: current, missing: true };
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('audit_symlink_rejected:' + relative);
  }
  return { target: current, missing: false };
}

// Read-only inspection. Importer generation remains independent; this does not
// read mutable Git working-tree content or touch the original Gratis AppData.
export function auditPinnedWorkspace({ sourceDir, workspaceDir, commit, allow = allowSourcePath,
  transform = (_relative, bytes) => bytes, labModules = [] }) {
  if (!/^[0-9a-f]{40}$/.test(String(commit || ''))) throw new Error('invalid_pinned_commit');
  if (!fs.existsSync(workspaceDir)) throw new Error('derived_workspace_missing');
  const actualCommit = git(sourceDir, 'rev-parse', commit + '^{commit}').toString('utf8').trim();
  if (actualCommit !== commit) throw new Error('pinned_commit_mismatch');
  const entries = git(sourceDir, 'ls-tree', '-r', '-z', commit).toString('utf8').split('\0').filter(Boolean);
  const files = [];
  const problems = [];
  for (const entry of entries) {
    const tab = entry.indexOf('\t');
    if (tab < 0) throw new Error('invalid_git_tree_entry');
    const [mode, type] = entry.slice(0, tab).split(' ');
    const relative = entry.slice(tab + 1);
    if (!allow(relative)) continue;
    if (type !== 'blob' || !['100644', '100755'].includes(mode)) {
      problems.push({ path: relative, error: 'unsupported_source_entry', mode });
      continue;
    }
    const original = git(sourceDir, 'show', commit + ':' + relative);
    const transformed = Buffer.from(transform(relative, original));
    const { target, missing } = safeTarget(workspaceDir, relative);
    const current = missing ? null : fs.readFileSync(target);
    const record = {
      path: relative, owner: ownerOf(relative),
      source_sha256: sha256(original), expected_sha256: sha256(transformed),
      actual_sha256: current ? sha256(current) : null,
      changed_by_derivation: !original.equals(transformed),
      matches_derivation: Boolean(current?.equals(transformed))
    };
    files.push(record);
    if (!record.matches_derivation) problems.push({ path: relative, error: missing ? 'missing_workspace_file' : 'derived_bytes_mismatch' });
  }
  for (const module of labModules) {
    const sourcePath = safeTarget(root, module);
    const derivedPath = safeTarget(workspaceDir, module);
    if (sourcePath.missing || derivedPath.missing) {
      problems.push({ path: module, error: 'lab_owned_module_missing' });
      continue;
    }
    const src = fs.readFileSync(sourcePath.target);
    const dst = fs.readFileSync(derivedPath.target);
    files.push({ path: module, owner: 'orchestrator-lab', source_sha256: sha256(src),
      expected_sha256: sha256(src), actual_sha256: sha256(dst),
      changed_by_derivation: false, matches_derivation: src.equals(dst) });
    if (!src.equals(dst)) problems.push({ path: module, error: 'lab_owned_module_mismatch' });
  }
  return {
    schema: 'ordax.orchestrator-lab-pinned-audit/1', source_commit: commit,
    source_file_count: entries.length, inspected_file_count: files.length,
    changed_by_derivation: files.filter(f => f.changed_by_derivation).map(f => f.path),
    owner_counts: Object.fromEntries([...new Set(files.map(f => f.owner))]
      .sort().map(owner => [owner, files.filter(f => f.owner === owner).length])),
    problems, files
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--source' || args[2] !== '--workspace') {
    throw new Error('usage: node scripts/audit-pinned-workspace.mjs --source PATH --workspace PATH');
  }
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'source-lock.json'), 'utf8'));
  const productVersion = readProductVersion(root);
  const config = { ...lock, productVersion };
  const report = auditPinnedWorkspace({
    sourceDir: path.resolve(args[1]), workspaceDir: path.resolve(args[3]), commit: lock.commit,
    transform: (relative, bytes) => applySupervisorOverlay(relative, deriveSourceFile(relative, bytes, config)),
    labModules: ['supervisor/coordinator.mjs', 'supervisor/groq-planner.mjs']
  });
  // No user prompts, DOM, cookies or model output are read or written.
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (report.problems.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
