import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectPackage, resolveLaunchFromPackage, requireExecutionSupport } from '../src/inspect.mjs';
import { resolveAndroidLaunchManifest } from '../src/manifest-axml.mjs';
import { packageFromBuffer } from '../src/zip.mjs';
import { inspectDex, inspectElf } from '../src/formats.mjs';

function crc32(b) {
  let c = 0xffffffff;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const { name, bytes, flags = 0, corrupt = false } of files) {
    const filename = Buffer.from(name);
    const data = Buffer.from(bytes);
    const check = crc32(data) ^ (corrupt ? 1 : 0);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0);
    l.writeUInt16LE(20, 4); l.writeUInt16LE(flags, 6);
    l.writeUInt32LE(check >>> 0, 14); l.writeUInt32LE(data.length, 18);
    l.writeUInt32LE(data.length, 22); l.writeUInt16LE(filename.length, 26);
    local.push(l, filename, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6);
    c.writeUInt16LE(flags, 8);
    c.writeUInt32LE(check >>> 0, 16); c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24); c.writeUInt16LE(filename.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, filename);
    offset += l.length + filename.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dir, end]);
}
function syntheticDex() {
  const b = Buffer.alloc(112);
  b.write('dex\n039\0', 0, 'binary');
  b.writeUInt32LE(b.length, 32);
  b.writeUInt32LE(112, 36);
  b.writeUInt32LE(0x12345678, 40);
  createHash('sha1').update(b.subarray(32)).digest().copy(b, 12);
  let s1 = 1, s2 = 0;
  for (let i = 12; i < b.length; i++) {
    s1 = (s1 + b[i]) % 65521; s2 = (s2 + s1) % 65521;
  }
  b.writeUInt32LE(((s2 << 16) | s1) >>> 0, 8);
  return b;
}
test('nested XAPK identifies primary DEX and retains resource-only split APK', async () => {
  const apk = zip([{ name: 'classes.dex', bytes: syntheticDex() }]);
  const split = zip([{ name: 'resources.arsc', bytes: Buffer.from([1, 2, 3]) }]);
  const dir = await mkdtemp(join(tmpdir(), 'ordax-mobile-test-'));
  try {
    const filename = join(dir, 'fixture.xapk');
    await writeFile(filename, zip([{ name: 'base.apk', bytes: apk }, { name: 'config.arm64.apk', bytes: split }]));
    const result = await inspectPackage(filename);
    assert.equal(result.kind, 'xapk');
    assert.equal(result.apks.length, 2);
    assert.equal(result.apks[0].dex.version, '039');
    assert.equal(result.apks[1].dexFiles, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('full 23-DEX Android package preserves classes10 to classes19', async () => {
  const dex = syntheticDex();
  const names = ['classes.dex', ...Array.from({ length: 22 }, (_, i) => `classes${i + 2}.dex`)];
  const apk = zip([...names.map(name => ({ name, bytes: dex })),
    { name: 'classes1.dex', bytes: Buffer.from('not a valid multidex name') },
    { name: 'classes01.dex', bytes: Buffer.from('not a valid multidex name') }]);
  const dir = await mkdtemp(join(tmpdir(), 'ordax-mobile-multidex-'));
  try {
    const filename = join(dir, 'instagram-scale-multidex.xapk');
    await writeFile(filename, zip([{ name: 'com.instagram.android.apk', bytes: apk }]));
    const result = await inspectPackage(filename);
    assert.equal(result.kind, 'xapk');
    assert.equal(result.apks[0].dexFiles, 23);
    assert.equal(result.apks[0].dex.version, '039');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('Instagram-scale APK central directory stays bounded and distinguishes count limit', async () => {
  const entries = [{ name: 'classes.dex', bytes: syntheticDex() },
    ...Array.from({ length: 10481 }, (_, i) => ({ name: `assets/entry-${i}.bin`, bytes: Buffer.alloc(0) }))];
  const base = zip(entries);
  const dir = await mkdtemp(join(tmpdir(), 'ordax-mobile-instagram-scale-'));
  try {
    const filename = join(dir, 'instagram-scale.xapk');
    await writeFile(filename, zip([{ name: 'com.instagram.android.apk', bytes: base }]));
    const result = await inspectPackage(filename);
    assert.equal(result.apks[0].dexFiles, 1);
    assert.equal(result.apks[0].dex.version, '039');
    assert.equal(result.apks[0].name, 'com.instagram.android.apk');
  } finally { await rm(dir, { recursive: true, force: true }); }

  const excessive = zip(Array.from({ length: 16385 }, (_, i) => ({
    name: `resources/r-${i}`, bytes: Buffer.alloc(0),
  })));
  await assert.rejects(packageFromBuffer(excessive), {
    code: 'LIMIT', message: 'ZIP entry count exceeds limit',
  });
});
test('rejects traversal and duplicate names before extraction', async () => {
  await assert.rejects(packageFromBuffer(zip([{ name: '../evil.apk', bytes: Buffer.from('no') }])), { code: 'PATH' });
  await assert.rejects(packageFromBuffer(zip([
    { name: 'a.apk', bytes: Buffer.from('one') },
    { name: 'a.apk', bytes: Buffer.from('two') },
  ])), { code: 'DUPLICATE' });
});
test('rejects encrypted container and CRC corruption', async () => {
  await assert.rejects(packageFromBuffer(zip([{ name: 'a.apk', bytes: Buffer.from('a'), flags: 1 }])), { code: 'ENCRYPTION' });
  const archive = await packageFromBuffer(zip([{ name: 'a.apk', bytes: Buffer.from('a'), corrupt: true }]));
  try { await assert.rejects(archive.read('a.apk'), { code: 'INTEGRITY' }); }
  finally { await archive.close(); }
});
test('verifies DEX signature/checksum, rejects malformed ELF', () => {
  const dex = syntheticDex();
  assert.equal(inspectDex(dex).version, '039');
  dex[60] = 11;
  assert.throws(() => inspectDex(dex), { code: 'DEX' });
  assert.throws(() => inspectElf(Buffer.alloc(64)), { code: 'ELF' });
});
function classIndexDex(classNames) {
  const descriptors = classNames.map(x => 'L' + x.replaceAll('.', '/') + ';');
  const n = descriptors.length, stringOff = 112, typesOff = stringOff + n * 4;
  const classesOff = typesOff + n * 4, dataOff = classesOff + n * 32;
  const encoded = descriptors.map(s => {
    const bytes = Buffer.from(s);
    assert.ok(bytes.length > 0 && bytes.length < 128);
    return Buffer.concat([Buffer.from([bytes.length]), bytes, Buffer.from([0])]);
  });
  const total = dataOff + encoded.reduce((a, b) => a + b.length, 0);
  const b = Buffer.alloc(total);
  b.write('dex\n039\0', 0, 'binary');
  b.writeUInt32LE(total, 32); b.writeUInt32LE(112, 36); b.writeUInt32LE(0x12345678, 40);
  b.writeUInt32LE(n, 56); b.writeUInt32LE(stringOff, 60);
  b.writeUInt32LE(n, 64); b.writeUInt32LE(typesOff, 68);
  b.writeUInt32LE(n, 96); b.writeUInt32LE(classesOff, 100);
  let at = dataOff;
  for (let i = 0; i < n; i++) {
    b.writeUInt32LE(at, stringOff + i * 4);
    b.writeUInt32LE(i, typesOff + i * 4);
    b.writeUInt32LE(i, classesOff + i * 32);
    b.writeUInt32LE(1, classesOff + i * 32 + 4);
    b.writeUInt32LE(0xffffffff, classesOff + i * 32 + 8);
    encoded[i].copy(b, at); at += encoded[i].length;
  }
  createHash('sha1').update(b.subarray(32)).digest().copy(b, 12);
  let s1 = 1, s2 = 0;
  for (let i = 12; i < b.length; i++) {
    s1 = (s1 + b[i]) % 65521; s2 = (s2 + s1) % 65521;
  }
  b.writeUInt32LE(((s2 << 16) | s1) >>> 0, 8);
  return b;
}
function binaryLaunchManifest({ disableSecond = false } = {}) {
  const ss = ['manifest', 'package', 'application', 'name', 'activity', 'activity-alias',
    'targetActivity', 'enabled', 'exported', 'intent-filter', 'action', 'category',
    'android.intent.action.MAIN', 'android.intent.category.LAUNCHER',
    'com.instagram.android', '.AppShell', '.RealActivity', '.InternalLauncher', '.MainTabActivity'];
  const index = s => { const i = ss.indexOf(s); assert.notEqual(i, -1); return i; };
  const poolData = [], offsets = [];
  let next = 0;
  for (const s of ss) {
    const value = Buffer.from(s);
    assert.ok(value.length < 128);
    const encoded = Buffer.concat([Buffer.from([value.length, value.length]), value, Buffer.from([0])]);
    offsets.push(next);
    poolData.push(encoded);
    next += encoded.length;
  }
  const pool = Buffer.alloc(28 + ss.length * 4);
  pool.writeUInt16LE(1, 0); pool.writeUInt16LE(28, 2);
  pool.writeUInt32LE(pool.length + next, 4);
  pool.writeUInt32LE(ss.length, 8);
  pool.writeUInt32LE(0x100, 16);
  pool.writeUInt32LE(pool.length, 20);
  offsets.forEach((v, i) => pool.writeUInt32LE(v, 28 + i * 4));
  const start = (name, attributes = {}) => {
    const entries = Object.entries(attributes);
    const b = Buffer.alloc(36 + entries.length * 20);
    b.writeUInt16LE(0x0102, 0); b.writeUInt16LE(16, 2);
    b.writeUInt32LE(b.length, 4);
    b.writeUInt32LE(0xffffffff, 16);
    b.writeUInt32LE(index(name), 20);
    b.writeUInt16LE(20, 24); b.writeUInt16LE(20, 26);
    b.writeUInt16LE(entries.length, 28);
    for (let i = 0; i < entries.length; i++) {
      const [key, value] = entries[i], at = 36 + i * 20;
      b.writeUInt32LE(0xffffffff, at);
      b.writeUInt32LE(index(key), at + 4);
      b.writeUInt32LE(0xffffffff, at + 8);
      b.writeUInt16LE(8, at + 12);
      b[at + 15] = typeof value === 'boolean' ? 18 : 3;
      b.writeUInt32LE(typeof value === 'boolean' ? Number(value) : index(value), at + 16);
    }
    return b;
  };
  const end = name => {
    const b = Buffer.alloc(24);
    b.writeUInt16LE(0x0103, 0); b.writeUInt16LE(16, 2);
    b.writeUInt32LE(24, 4); b.writeUInt32LE(0xffffffff, 16);
    b.writeUInt32LE(index(name), 20); return b;
  };
  const alias = (name, enabled) => [
    start('activity-alias', { name, targetActivity: '.RealActivity', enabled, exported: true }),
    start('intent-filter'), start('action', { name: 'android.intent.action.MAIN' }), end('action'),
    start('category', { name: 'android.intent.category.LAUNCHER' }), end('category'),
    end('intent-filter'), end('activity-alias')];
  const content = Buffer.concat([pool, ...poolData,
    start('manifest', { package: 'com.instagram.android' }),
    start('application', { name: '.AppShell' }),
    start('activity', { name: '.RealActivity', enabled: true }), end('activity'),
    ...alias('.InternalLauncher', false),
    ...alias('.MainTabActivity', !disableSecond),
    end('application'), end('manifest')]);
  const b = Buffer.alloc(8);
  b.writeUInt16LE(3, 0); b.writeUInt16LE(8, 2);
  b.writeUInt32LE(content.length + b.length, 4);
  return Buffer.concat([b, content]);
}
test('real Android binary manifest resolves enabled alias to declared Activity', async () => {
  const manifest = binaryLaunchManifest();
  const plan = resolveAndroidLaunchManifest(manifest);
  assert.deepEqual(plan, {
    packageName: 'com.instagram.android',
    applicationClass: 'com.instagram.android.AppShell',
    launcherComponent: 'com.instagram.android.MainTabActivity',
    activityClass: 'com.instagram.android.RealActivity',
    launcherIsAlias: true,
  });
  assert.throws(() => requireExecutionSupport(plan), {
    code: 'EXECUTION_UNAVAILABLE',
    message: /RealActivity/,
  });
  const base = zip([{ name: 'classes.dex', bytes: classIndexDex(['com.instagram.android.RealActivity']) },
    { name: 'classes2.dex', bytes: syntheticDex() },
    { name: 'classes3.dex', bytes: classIndexDex(['com.instagram.android.AppShell']) },
    { name: 'AndroidManifest.xml', bytes: manifest }]);
  const dir = await mkdtemp(join(tmpdir(), 'ordax-mobile-actual-launch-'));
  try {
    const path = join(dir, 'manifested.xapk');
    await writeFile(path, zip([{ name: 'com.instagram.android.apk', bytes: base }]));
    const expected = { ...plan, applicationDex: 'classes3.dex', activityDex: 'classes.dex' };
    assert.deepEqual(await resolveLaunchFromPackage(path), expected);
    // Direct APK must finish async reads before its file descriptor closes.
    const direct = join(dir, 'manifested.apk');
    await writeFile(direct, base);
    assert.deepEqual(await resolveLaunchFromPackage(direct), expected);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('binary launch manifest rejects disabled launchers and tampered headers', () => {
  const good = binaryLaunchManifest();
  assert.throws(() => resolveAndroidLaunchManifest(binaryLaunchManifest({ disableSecond: true })),
    { code: 'NO_LAUNCHER' });
  assert.throws(() => resolveAndroidLaunchManifest(good.subarray(0, good.length - 1)),
    { code: 'MANIFEST' });
  const corrupt = Buffer.from(good);
  corrupt.writeUInt32LE(0xffffffff, 4);
  assert.throws(() => resolveAndroidLaunchManifest(corrupt), { code: 'MANIFEST' });
});
test('execution is denied until a real guest runtime exists', () => {
  assert.throws(requireExecutionSupport, { code: 'EXECUTION_UNAVAILABLE' });
});
