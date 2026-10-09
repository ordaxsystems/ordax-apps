#!/usr/bin/env node
/**
 * Independent proof of a Windows candidate folder produced by build-windows.mjs.
 *
 * The builder never validates its own output: this separate verifier consumes
 * only the candidate receipt and immutable application manifests, enumerates
 * the resulting folder, hashes the actual bytes and checks fail-closed release
 * state. No profile, account, credentials or public signing/upload.
 */
import { createReadStream } from 'node:fs';
import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const host = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(host, '../..');
const fail = reason => { throw new Error('STUDIO_WINDOWS_CANDIDATE_PROOF=FAIL reason=' + reason); };
const load = async file => JSON.parse(await readFile(file, 'utf8'));
const releaseBase = path.resolve(host, '.data/portable');
const latest = await load(path.join(releaseBase, 'latest-build.json'));
if (!latest || typeof latest.directory !== 'string' || typeof latest.executable !== 'string') fail('receipt-shape');
const root = path.resolve(latest.directory);
const native = path.resolve(latest.executable);
if (path.dirname(root) !== releaseBase) fail('receipt-outside-candidate-root');
if (native !== path.join(root, 'ORDAX Studio.exe')) fail('receipt-executable-mismatch');
if (await realpath(root) !== root) fail('candidate-root-symlink');

const [manifest, dependencies, studio, hostPackage] = await Promise.all([
  load(path.join(root, 'build-manifest.json')),
  load(path.join(root, 'candidate-dependencies.json')),
  load(path.join(repo, 'apps/studio/app.json')),
  load(path.join(host, 'package.json')),
]);
const version = studio.version;
if (!/^\d+\.\d+\.\d+$/.test(version) || studio.id !== 'studio'
    || hostPackage.version !== version || manifest.version !== version
    || dependencies.version !== version) fail('version-ssot');
if (manifest.app !== 'ORDAX Studio' || manifest.candidate !== true
    || manifest.sourceRepository !== 'ordaxsystems/ordax-apps'
    || manifest.sourcePath !== 'apps/studio'
    || manifest.platform !== 'win32'
    || manifest.entrypoint !== 'apps/studio/conversation/src/index.html'
    || manifest.advancedWorkspaceEntrypoint !== 'apps/studio/src/index.html'
    || manifest.officialWindowsHostOwner !== 'ordaxsystems/ordax-runtime'
    || dependencies.candidate !== true
    || dependencies.installation?.artifact !== 'unsigned-portable-folder'
    || dependencies.installation?.officialWindowsInstallerVerified !== false
    || dependencies.installation?.ordaxOSAdapterVerified !== false
    || dependencies.installation?.bundlesSecondRuntimeIntoOrdaxOS !== false
    || dependencies.projectRuntime?.bundled !== false
    || dependencies.presentationRuntime?.electronVersion !== hostPackage.dependencies.electron)
  fail('authority-or-distribution-contract');

const map = new Map();
if (!Array.isArray(manifest.files) || manifest.files.length < 100) fail('inventory-too-small');
for (const record of manifest.files) {
  if (!record || typeof record.path !== 'string' || typeof record.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(record.sha256)
      || record.path.includes('\\') || record.path.startsWith('/')
      || record.path.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
      || map.has(record.path)) fail('unsafe-or-duplicate-inventory');
  map.set(record.path, record.sha256);
}
const seen = new Set();
async function verifyDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const info = await lstat(file);
    if (info.isSymbolicLink()) fail('symlink-in-candidate');
    if (info.isDirectory()) { await verifyDirectory(file); continue; }
    if (!info.isFile()) fail('unexpected-entry');
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (rel === 'build-manifest.json') continue; // Manifest is created after hash enumeration.
    if (!map.has(rel) || seen.has(rel)) fail('unlisted-or-duplicate-file:' + rel);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (hash.digest('hex') !== map.get(rel)) fail('file-hash-mismatch:' + rel);
    seen.add(rel);
  }
}
await verifyDirectory(root);
if (seen.size !== map.size) fail('missing-files');
for (const required of [
  'ORDAX Studio.exe',
  'LICENSE',
  'LICENSES.chromium.html',
  'resources/app/package.json',
  'resources/app/apps/studio/app.json',
  'resources/app/apps/studio/conversation/src/index.html',
  'resources/app/tools/assistant-host/native/main.cjs',
]) {
  if (!seen.has(required)) fail('required-file-absent:' + required);
}
const packagedApp = await load(path.join(root, 'resources/app/apps/studio/app.json'));
const packagedHost = await load(path.join(root, 'resources/app/tools/assistant-host/package.json'));
if (packagedApp.version !== version || packagedHost.version !== version) fail('packaged-version-drift');
console.log('STUDIO_WINDOWS_CANDIDATE_PROOF=PASS');
console.log('STUDIO_WINDOWS_CANDIDATE_FILES_VERIFIED=' + seen.size);
console.log('STUDIO_WINDOWS_CANDIDATE_RELEASE_STATE=UNSIGNED_NOT_PROMOTED');
