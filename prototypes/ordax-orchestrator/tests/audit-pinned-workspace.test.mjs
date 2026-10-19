import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { auditPinnedWorkspace } from '../scripts/audit-pinned-workspace.mjs';

function fixture() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ordax-pinned-audit-'));
  const source = path.join(temp, 'source');
  const workspace = path.join(temp, 'workspace');
  fs.mkdirSync(source);
  fs.mkdirSync(workspace);
  const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'OrdaX Test');
  git('config', 'user.email', 'test@example.invalid');
  for (const base of [source, workspace]) {
    fs.mkdirSync(path.join(base, 'desktop'));
    fs.mkdirSync(path.join(base, 'src'));
  }
  fs.writeFileSync(path.join(source, 'desktop', 'main.mjs'), 'original\n');
  fs.writeFileSync(path.join(source, 'src', 'store.mjs'), 'store\n');
  git('add', '.');
  git('commit', '-qm', 'pinned test fixture');
  const commit = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(workspace, 'desktop', 'main.mjs'), 'derived\n');
  fs.writeFileSync(path.join(workspace, 'src', 'store.mjs'), 'store\n');
  const transform = (file, bytes) => file === 'desktop/main.mjs'
    ? Buffer.from('derived\n') : bytes;
  const audit = () => auditPinnedWorkspace({
    sourceDir: source, workspaceDir: workspace, commit, transform
  });
  return { temp, source, workspace, commit, audit };
}

test('read-only audit hashes pinned blobs, names owners and identifies changed bytes', t => {
  const f = fixture();
  t.after(() => fs.rmSync(f.temp, { recursive: true, force: true }));
  const before = fs.readFileSync(path.join(f.source, 'desktop', 'main.mjs'));
  const report = f.audit();
  assert.deepEqual(report.problems, []);
  assert.equal(report.inspected_file_count, 2);
  assert.deepEqual(report.changed_by_derivation, ['desktop/main.mjs']);
  assert.equal(report.owner_counts['legacy-electron-client'], 1);
  assert.equal(report.owner_counts['legacy-client-core-review'], 1);
  assert.match(report.files[0].source_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(fs.readFileSync(path.join(f.source, 'desktop', 'main.mjs')), before);
});

test('tampering with derived workspace is detected without modifying source', t => {
  const f = fixture();
  t.after(() => fs.rmSync(f.temp, { recursive: true, force: true }));
  fs.writeFileSync(path.join(f.workspace, 'src', 'store.mjs'), 'unexpected edit');
  assert.deepEqual(f.audit().problems,
    [{ path: 'src/store.mjs', error: 'derived_bytes_mismatch' }]);
  assert.equal(fs.readFileSync(path.join(f.source, 'src', 'store.mjs'), 'utf8'), 'store\n');
});

test('missing workspace file is diagnosed, without restoring it automatically', t => {
  const f = fixture();
  t.after(() => fs.rmSync(f.temp, { recursive: true, force: true }));
  fs.unlinkSync(path.join(f.workspace, 'src', 'store.mjs'));
  assert.deepEqual(f.audit().problems, [{ path: 'src/store.mjs', error: 'missing_workspace_file' }]);
  assert.equal(fs.existsSync(path.join(f.workspace, 'src', 'store.mjs')), false);
});

test('source pin cannot drift to a different commit', t => {
  const f = fixture();
  t.after(() => fs.rmSync(f.temp, { recursive: true, force: true }));
  assert.throws(() => auditPinnedWorkspace({
    sourceDir: f.source, workspaceDir: f.workspace, commit: '0'.repeat(40)
  }), /git_audit_failed/);
});

test('audit refuses symlinked derived source file', t => {
  const f = fixture();
  t.after(() => fs.rmSync(f.temp, { recursive: true, force: true }));
  const target = path.join(f.workspace, 'src', 'store.mjs');
  fs.unlinkSync(target);
  try {
    fs.symlinkSync(path.join(f.source, 'src', 'store.mjs'), target);
  } catch (error) {
    if (error?.code === 'EPERM') return; // Non-privileged Windows host.
    throw error;
  }
  assert.throws(() => f.audit(), /audit_symlink_rejected/);
});
