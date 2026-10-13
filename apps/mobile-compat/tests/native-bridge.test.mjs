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
import { registerArm64IntegerMethod, registerArm64JniIntegerMethod, registerArm64JniIntArrayMethod } from '../src/arm64-method-bridge.mjs';
import { GuestHeap } from '../src/guest-heap.mjs';
import { runDexMethodFromPackage } from '../src/inspect.mjs';

const executablePath = process.argv[2];
const imagePath = process.argv[3];
const owner = 'Ltest/Bridge;';
const isJni = process.argv[4] === 'jni';
const isJniArray = process.argv[4] === 'jni-array';
const mode = isJni ? 'invoke-jni-i32-elf' : 'invoke-i32-elf';
const expectedSchema = isJni ? 'ordax.mobile-compat.jni-static-i32-call/1' : 'ordax.mobile-compat.i32-guest-call/1';
const expected = value => (value + (isJni ? 0x10006 : 2)) | 0;
const nativeTest = executablePath && imagePath && !isJniArray ? test : test.skip;
const arrayTest = executablePath && imagePath && isJniArray ? test : test.skip;
const hash = imagePath ? createHash('sha256').update(readFileSync(imagePath)).digest('hex') : null;

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
  (isJni ? registerArm64JniIntegerMethod : registerArm64IntegerMethod)(nativeBoundary, {
    owner, name: 'nativeAdd', signature: '(I)I',
    executablePath, imagePath: image, sha256: pinnedHash,
  });
  return nativeBoundary;
}

nativeTest('real ARM64 ELF receives x0 and returns signed int32 result', () => {
  for (const input of [40, -5, 2147483647]) {
    const data = JSON.parse(execFileSync(executablePath,
      [mode, imagePath, String(input)], { encoding: 'utf8', timeout: 3000 }));
    assert.equal(data.schema, expectedSchema);
    assert.equal(data.value, expected(input));
  }
});
nativeTest('real DEX invokes registered native AArch64 ELF, no simulated arithmetic', () => {
  const vm = new DexSubset(makeDex(), { nativeBoundary: createTrustedBoundary() });
  for (const input of [40, -9, 2147483647]) {
    const result = vm.execute(owner, 'callNative', [input]);
    assert.equal(result.value, expected(input));
    assert.equal(result.consumedInstructions, 3);
  }
  assert.throws(() => new DexSubset(makeDex()).execute(owner, 'callNative', [40]),
    { code: 'NATIVE_UNAVAILABLE' });
});
nativeTest('verified APK and XAPK can call the same native ELF only when host opted in', async () => {
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
      assert.equal(result.value, expected(40));
      await assert.rejects(
        runDexMethodFromPackage(path, owner, 'callNative', [40]),
        { code: 'NATIVE_UNAVAILABLE' });
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
nativeTest('pinning rejects changed or missing native ELF before host executes it', () => {
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
nativeTest('guest cannot specify arbitrary executable arguments, signature or native pointers', () => {
  assert.throws(() => (isJni ? registerArm64JniIntegerMethod : registerArm64IntegerMethod)(new NativeMethodBoundary(), {
    owner, name: 'nativeAdd', signature: '(Ljava/lang/Object;)I',
    executablePath, imagePath, sha256: hash,
  }), { code: 'NATIVE_REGISTRATION' });
  assert.throws(() => execFileSync(executablePath,
    [mode, imagePath, 'not-an-int'], { encoding: 'utf8', timeout: 3000 }));
  assert.throws(() => execFileSync(executablePath,
    [mode, imagePath, '2147483648'], { encoding: 'utf8', timeout: 3000 }));
  assert.throws(() => execFileSync(executablePath,
    [mode, imagePath, '1', '2', '3', '4', '5', '6'],
    { encoding: 'utf8', timeout: 3000 }));
});


function makeArrayDex() {
  const b = makeDex();
  // Extend the *same* test DEX to contain the array type [I.
  b.writeUInt32LE(6, 56);
  b.writeUInt32LE(0x300, 0x70 + 5 * 4);
  b[0x300] = 2;
  b.write('[I', 0x301, 'ascii');
  b[0x303] = 0;
  b.writeUInt32LE(3, 64);
  b.writeUInt32LE(5, 0x98);
  // Keep the public test entrypoint callNative(I)I intact; give only the
  // native method its own ([I)I prototype.
  b.writeUInt32LE(2, 72); // two proto_ids
  b.writeUInt32LE(1, 0xa8); // shorty index (diagnostic only here)
  b.writeUInt32LE(0, 0xac); // return type I
  b.writeUInt32LE(0x118, 0xb0); // array parameter type_list
  b.writeUInt32LE(1, 0x118);
  b.writeUInt16LE(2, 0x11c);
  b.writeUInt16LE(1, 0xc2); // nativeAdd([I)I; callNative(I)I remains unchanged
  b.writeUInt16LE(5, 0x180); // v0..v4
  b.writeUInt16LE(1, 0x182);
  b.writeUInt16LE(1, 0x184);
  // Static callNative(int length): build guest int[], insert 41,
  // invoke native ([I)I, then read the modified array back with aget.
  const instructions = [
    0x4023, 2,       // new-array v0,v4,[I
    0x0213, 41,     // const/16 v2,41
    0x0312,         // const/4 v3,0
    0x024b, 0x0300, // aput v2,v0,v3
    0x1071, 0, 0,   // invoke-static {v0}, nativeAdd([I)I
    0x010a,         // move-result v1
    0x0244, 0x0300, // aget v2,v0,v3
    0x0190, 0x0201, // add-int v1,v1,v2
    0x010f,         // return v1
  ];
  b.writeUInt32LE(instructions.length, 0x18c);
  instructions.forEach((opcode, index) => b.writeUInt16LE(opcode, 0x190 + 2 * index));
  return sealDex(b);
}
function createArrayBoundary(pinnedHash = hash, file = imagePath) {
  const nativeBoundary = new NativeMethodBoundary();
  registerArm64JniIntArrayMethod(nativeBoundary, {
    owner, name: 'nativeAdd', signature: '([I)I',
    executablePath, imagePath: file, sha256: pinnedHash,
  });
  return nativeBoundary;
}
arrayTest('actual Dalvik int[] roundtrip through JNI ARM64 Get/SetIntArrayRegion', () => {
  const vm = new DexSubset(makeArrayDex(), { nativeBoundary: createArrayBoundary() });
  // native ELF: read first jint=41, increment to 42, write back via JNI,
  // return 42; Dalvik aget then observes 42 and computes 84.
  for (const length of [1, 2, 10]) {
    const result = vm.execute(owner, 'callNative', [length]);
    assert.equal(result.value, 84);
    assert.equal(result.allocatedObjects, 1);
  }
  assert.throws(() => new DexSubset(makeArrayDex()).execute(owner, 'callNative', [1]),
    { code: 'NATIVE_UNAVAILABLE' });
});
arrayTest('APK and XAPK call the exact native JNI array implementation', async () => {
  const apk = zip([['AndroidManifest.xml', Buffer.from([1])], ['classes.dex', makeArrayDex()]]);
  const xapk = zip([['base.apk', apk], ['config.arm64.apk',
    zip([['resources.arsc', Buffer.from([1, 2])]])]]);
  const dir = mkdtempSync(join(tmpdir(), 'ordax-array-jni-e2e-'));
  try {
    const paths = [join(dir, 'array.apk'), join(dir, 'array.xapk')];
    writeFileSync(paths[0], apk);
    writeFileSync(paths[1], xapk);
    for (const path of paths) {
      const result = await runDexMethodFromPackage(path, owner, 'callNative', [2],
        { nativeBoundary: createArrayBoundary() });
      assert.equal(result.value, 84);
      await assert.rejects(runDexMethodFromPackage(path, owner, 'callNative', [2]),
        { code: 'NATIVE_UNAVAILABLE' });
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
arrayTest('native JNI failures never commit partial changes to Dalvik arrays', () => {
  const heap = new GuestHeap();
  const ref = heap.allocateIntArray(2);
  heap.setIntArray(ref, 0, 41);
  const failed = new NativeMethodBoundary();
  failed.register({
    owner, name: 'nativeAdd', signature: '([I)I',
    invoke: arr => { arr[0] = 77; throw new Error('native failed'); },
  });
  const info = { owner, name: 'nativeAdd', proto: { params: ['[I'], result: 'I' } };
  assert.throws(() => failed.call(info, [ref], heap), { code: 'NATIVE_FAULT' });
  assert.equal(heap.getIntArray(ref, 0), 41);
  const badReturn = new NativeMethodBoundary();
  badReturn.register({
    owner, name: 'nativeAdd', signature: '([I)I',
    invoke: arr => { arr[0] = 77; return 'bad'; },
  });
  assert.throws(() => badReturn.call(info, [ref], heap), { code: 'NATIVE_RESULT' });
  assert.equal(heap.getIntArray(ref, 0), 41);
  const success = new NativeMethodBoundary();
  success.register({
    owner, name: 'nativeAdd', signature: '([I)I',
    invoke: arr => { arr[0] = 43; return arr[0]; },
  });
  assert.equal(success.call(info, [ref], heap), 43);
  assert.equal(heap.getIntArray(ref, 0), 43);
});
arrayTest('JNI array snapshots reject tampered ELF and invalid binary payloads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ordax-array-tamper-'));
  try {
    const corrupted = join(dir, 'corrupted.elf');
    const image = Buffer.from(readFileSync(imagePath));
    image[image.length - 1] ^= 1;
    writeFileSync(corrupted, image);
    assert.throws(() => new DexSubset(makeArrayDex(),
      { nativeBoundary: createArrayBoundary(hash, corrupted) })
      .execute(owner, 'callNative', [1]), { code: 'NATIVE_FAULT' });
    const broken = join(dir, 'bad-snapshot.bin');
    writeFileSync(broken, Buffer.from('not-a-valid-array'));
    assert.throws(() => execFileSync(executablePath,
      ['invoke-jni-int-array-elf', imagePath, broken],
      { timeout: 3000, encoding: 'utf8' }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
