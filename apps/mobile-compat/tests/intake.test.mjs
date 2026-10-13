import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectPackage, requireExecutionSupport } from '../src/inspect.mjs';
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
test('execution is denied until a real guest runtime exists', () => {
  assert.throws(requireExecutionSupport, { code: 'EXECUTION_UNAVAILABLE' });
});
