// Cross-platform CTest integration. REAL bytecode DEX calls a REAL AArch64
// ELF file, via an explicit trusted host boundary. No JNI or Android runtime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DexSubset } from '../src/dex-vm.mjs';
import { NativeMethodBoundary } from '../src/native-boundary.mjs';
import { registerArm64IntegerMethod } from '../src/arm64-method-bridge.mjs';
import { runDexMethodFromPackage } from '../src/inspect.mjs';

const executablePath = process.argv[2];
const imagePath = process.argv[3];
const owner = 'Ltest/Bridge;';
const hash = createHash('sha256').update(readFileSync(imagePath)).digest('hex');

function leb(value) {
  const out = [];
  do {
    let byte = value & 127;
    value >>>= 7;
    if (value) byte |= 128;
    out.push(byte);
  } while (value);
  return Buffer.from(out);
}
function sealDex(b) {
  createHash('sha1').update(b.subarray(32)).digest().copy(b, 12);
  let s1 = 1, s2 = 0;
  for (const val of b.subarray(12)) {
    s1 = (s1 + val) % 65521; s2 = (s2 + s1) % 65521;
  }
  b.writeUInt32LE(((s2 << 16) | s1) >>> 0, 8);
  return b;
}
function makeDex() {
  const b = Buffer.alloc(0x400);
  b.write('dex\n039\0', 0, 'ascii');
  b.writeUInt32LE(b.length, 32);
  b.writeUInt32LE(112, 36);
  b.writeUInt32LE(0x12345678, 40);
  b.writeUInt32LE(0x1c0, 52);
  b.writeUInt32LE(5, 56); b.writeUInt32LE(0x70, 60); // string IDs
  b.writeUInt32LE(2, 64); b.writeUInt32LE(0x90, 68); // type IDs
  b.writeUInt32LE(1, 72); b.writeUInt32LE(0x9c, 76); // proto IDs
  b.writeUInt32LE(2, 88); b.writeUInt32LE(0xc0, 92); // methods
  b.writeUInt32LE(1, 96); b.writeUInt32LE(0xd8, 100); // classes
  b.writeUInt32LE(b.length - 0x110, 104); b.writeUInt32LE(0x110, 108);

  const names = ['I', 'II', owner, 'nativeAdd', 'callNative'];
  let offset = 0x270;
  for (let i = 0; i < names.length; i++) {
    const ascii = Buffer.from(names[i], 'ascii');
    b.writeUInt32LE(offset, 0x70 + i * 4);
    const prefix = leb(ascii.length);
    prefix.copy(b, offset); offset += prefix.length;
    ascii.copy(b, offset); offset += ascii.length;
    b[offset++] = 0;
  }
  b.writeUInt32LE(0, 0x90); b.writeUInt32LE(2, 0x94); // int + class
  b.writeUInt32LE(1, 0x9c); // shorty 'II'
  b.writeUInt32LE(0, 0xa0); // int return
  b.writeUInt32LE(0x110, 0xa4); // one int param
  b.writeUInt32LE(1, 0x110); b.writeUInt16LE(0, 0x114);

  for (const [index, name] of [[0, 3], [1, 4]]) {
    const at = 0xc0 + index * 8;
    b.writeUInt16LE(1, at);
    b.writeUInt16LE(0, at + 2);
    b.writeUInt32LE(name, at + 4);
  }
  b.writeUInt32LE(1, 0xd8);
  b.writeUInt32LE(1, 0xd8 + 4);
  b.writeUInt32LE(0xffffffff, 0xd8 + 8);
  b.writeUInt32LE(0x140, 0xd8 + 24);
  Buffer.from([
    0, 0, 2, 0,
    0, 0x88, 0x02, 0, // nativeAdd(I)I static native, no code
    1, 9, 0x80, 0x03, // callNative(I)I static, code at 0x180
  ]).copy(b, 0x140);
  b.writeUInt16LE(2, 0x180); // registers
  b.writeUInt16LE(1, 0x182); // ins v1
  b.writeUInt16LE(1, 0x184); // outs
  const code = [0x1071, 0x0000, 0x0001, 0x000a, 0x000f];
  b.writeUInt32LE(code.length, 0x180 + 12);
  code.forEach((word, i) => b.writeUInt16LE(word, 0x190 + i * 2));

  const mapEntries = [
    [0, 1, 0], [1, 5, 0x70], [2, 2, 0x90], [3, 1, 0x9c],
    [5, 2, 0xc0], [6, 1, 0xd8], [0x1001, 1, 0x110],
    [0x2000, 1, 0x140], [0x2001, 1, 0x180],
    [0x1000, 1, 0x1c0], [0x2002, 5, 0x270],
  ];
  b.writeUInt32LE(mapEntries.length, 0x1c0);
  mapEntries.forEach(([kind, count, start], i) => {
    const at = 0x1c4 + 12 * i;
    b.writeUInt16LE(kind, at);
    b.writeUInt32LE(count, at + 4);
    b.writeUInt32LE(start, at + 8);
  });
  return sealDex(b);
}
function crc32(b) {
  let c = 0xffffffff;
  for (const v of b) {
    c ^= v;
    for (let i = 0; i < 8; ++i) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function zip(items) {
  const parts = [], directory = [];
  let offset = 0;
  for (const [name, content] of items) {
    const filename = Buffer.from(name);
    const entry = Buffer.from(content);
    const hdr = Buffer.alloc(30);
    hdr.writeUInt32LE(0x04034b50, 0);
    hdr.writeUInt16LE(20, 4);
    hdr.writeUInt32LE(crc32(entry), 14);
    hdr.writeUInt32LE(entry.length, 18);
    hdr.writeUInt32LE(entry.length, 22);
    hdr.writeUInt16LE(filename.length, 26);
    parts.push(hdr, filename, entry);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc32(entry), 16);
    central.writeUInt32LE(entry.length, 20);
    central.writeUInt32LE(entry.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, filename);
    offset += hdr.length + filename.length + entry.length;
  }
  const center = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(center.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, center, end]);
}

function createTrustedBoundary(image = imagePath, pinnedHash = hash) {
  const nativeBoundary = new NativeMethodBoundary();
  registerArm64IntegerMethod(nativeBoundary, {
    owner, name: 'nativeAdd', signature: '(I)I',
    executablePath, imagePath: image, sha256: pinnedHash,
  });
  return nativeBoundary;
}

test('real ARM64 ELF receives x0 and returns signed int32 result', () => {
  for (const [input, expected] of [[40, 42], [-5, -3], [2147483647, -2147483647]]) {
    const data = JSON.parse(execFileSync(executablePath,
      ['invoke-i32-elf', imagePath, String(input)], { encoding: 'utf8', timeout: 3000 }));
    assert.equal(data.schema, 'ordax.mobile-compat.i32-guest-call/1');
    assert.equal(data.value, expected);
  }
});
test('real DEX invokes registered native AArch64 ELF, no simulated arithmetic', () => {
  const vm = new DexSubset(makeDex(), { nativeBoundary: createTrustedBoundary() });
  for (const [input, expected] of [[40, 42], [-9, -7], [2147483647, -2147483647]]) {
    const result = vm.execute(owner, 'callNative', [input]);
    assert.equal(result.value, expected);
    assert.equal(result.consumedInstructions, 3);
  }
  assert.throws(() => new DexSubset(makeDex()).execute(owner, 'callNative', [40]),
    { code: 'NATIVE_UNAVAILABLE' });
});
test('verified APK and XAPK can call the same native ELF only when host opted in', async () => {
  const apk = zip([['AndroidManifest.xml', Buffer.from([0])], ['classes.dex', makeDex()]]);
  const xapk = zip([['base.apk', apk], ['config.arm64.apk',
    zip([['resources.arsc', Buffer.from([1])]])]]);
  const dir = mkdtempSync(join(tmpdir(), 'ordax-bridge-package-'));
  try {
    const paths = [join(dir, 'bridge.apk'), join(dir, 'bridge.xapk')];
    writeFileSync(paths[0], apk); writeFileSync(paths[1], xapk);
    for (const path of paths) {
      const result = await runDexMethodFromPackage(path, owner, 'callNative', [40],
        { nativeBoundary: createTrustedBoundary() });
      assert.equal(result.value, 42);
      await assert.rejects(
        runDexMethodFromPackage(path, owner, 'callNative', [40]),
        { code: 'NATIVE_UNAVAILABLE' });
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('pinning rejects changed or missing native ELF before host executes it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ordax-bridge-tamper-'));
  try {
    const mutated = join(dir, 'tampered.elf');
    const bytes = Buffer.from(readFileSync(imagePath));
    bytes[bytes.length - 1] ^= 0x01;
    writeFileSync(mutated, bytes);
    const vm = new DexSubset(makeDex(), {
      nativeBoundary: createTrustedBoundary(mutated, hash),
    });
    assert.throws(() => vm.execute(owner, 'callNative', [40]),
      { code: 'NATIVE_FAULT' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('guest cannot specify arbitrary executable arguments, signature or native pointers', () => {
  assert.throws(() => registerArm64IntegerMethod(new NativeMethodBoundary(), {
    owner, name: 'nativeAdd', signature: '(Ljava/lang/Object;)I',
    executablePath, imagePath, sha256: hash,
  }), { code: 'NATIVE_REGISTRATION' });
  assert.throws(() => execFileSync(executablePath,
    ['invoke-i32-elf', imagePath, 'not-an-int'], { encoding: 'utf8', timeout: 3000 }));
  assert.throws(() => execFileSync(executablePath,
    ['invoke-i32-elf', imagePath, '2147483648'], { encoding: 'utf8', timeout: 3000 }));
  assert.throws(() => execFileSync(executablePath,
    ['invoke-i32-elf', imagePath, '1', '2', '3', '4', '5', '6'],
    { encoding: 'utf8', timeout: 3000 }));
});
