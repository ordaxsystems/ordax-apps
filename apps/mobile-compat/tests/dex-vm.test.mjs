import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DexSubset } from '../src/dex-vm.mjs';
import { NativeMethodBoundary } from '../src/native-boundary.mjs';
import { runDexMethodFromPackage, requireExecutionSupport } from '../src/inspect.mjs';

function adler32(b) {
  let s1 = 1, s2 = 0;
  for (const value of b.subarray(12)) {
    s1 = (s1 + value) % 65521; s2 = (s2 + s1) % 65521;
  }
  return ((s2 << 16) | s1) >>> 0;
}
function sealDex(b) {
  createHash('sha1').update(b.subarray(32)).digest().copy(b, 12);
  b.writeUInt32LE(adler32(b), 8);
  return b;
}
function leb(value) {
  const b = [];
  do {
    let byte = value & 127;
    value = Math.floor(value / 128);
    if (value) byte |= 128;
    b.push(byte);
  } while (value);
  return Buffer.from(b);
}
function fixtureDex() {
  // Genuine DEX section layout, including type_lists, class_data, code_items
  // and map_list. Code genuinely implements int sum(int,int), twice(int),
  // plus a native method that MUST NOT run without a JNI implementation.
  const b = Buffer.alloc(0x360);
  b.write('dex\n039\0', 0, 'ascii');
  b.writeUInt32LE(b.length, 32);
  b.writeUInt32LE(112, 36);
  b.writeUInt32LE(0x12345678, 40);
  b.writeUInt32LE(0x220, 52); // map_off
  b.writeUInt32LE(8, 56); b.writeUInt32LE(0x70, 60); // string_ids
  b.writeUInt32LE(3, 64); b.writeUInt32LE(0x90, 68); // type_ids
  b.writeUInt32LE(3, 72); b.writeUInt32LE(0x9c, 76); // proto_ids
  b.writeUInt32LE(3, 88); b.writeUInt32LE(0xc0, 92); // method_ids
  b.writeUInt32LE(1, 96); b.writeUInt32LE(0xd8, 100); // class_defs
  b.writeUInt32LE(b.length - 0xf8, 104); b.writeUInt32LE(0xf8, 108);

  const strings = ['I', 'II', 'III', 'Ltest/Arithmetic;', 'V', 'nativeStub', 'sum', 'twice'];
  let cursor = 0x2c0;
  for (let i = 0; i < strings.length; i++) {
    const raw = Buffer.from(strings[i], 'ascii');
    b.writeUInt32LE(cursor, 0x70 + i * 4);
    const sz = leb(raw.length);
    sz.copy(b, cursor); cursor += sz.length;
    raw.copy(b, cursor); cursor += raw.length;
    b[cursor++] = 0;
  }
  // type ids: I, Ltest/Arithmetic;, V.
  [0, 3, 4].forEach((n, i) => b.writeUInt32LE(n, 0x90 + i * 4));
  // Shorty, return type index=I(0), parameter type list offset.
  for (const [i, shorty, paramOff] of [[0, 0, 0], [1, 1, 0x110], [2, 2, 0x100]]) {
    const off = 0x9c + i * 12;
    b.writeUInt32LE(shorty, off);
    b.writeUInt32LE(0, off + 4);
    b.writeUInt32LE(paramOff, off + 8);
  }
  // Sorted method identifiers: nativeStub, sum, twice.
  for (const [i, proto, name] of [[0, 0, 5], [1, 2, 6], [2, 1, 7]]) {
    const off = 0xc0 + i * 8;
    b.writeUInt16LE(1, off); b.writeUInt16LE(proto, off + 2);
    b.writeUInt32LE(name, off + 4);
  }
  b.writeUInt32LE(1, 0xd8); // class_idx for Ltest/Arithmetic;
  b.writeUInt32LE(1, 0xdc); // public
  b.writeUInt32LE(0xffffffff, 0xe0); // no superclass fixture
  b.writeUInt32LE(0x140, 0xd8 + 24);

  b.writeUInt32LE(2, 0x100); // (II)
  b.writeUInt16LE(0, 0x104); b.writeUInt16LE(0, 0x106);
  b.writeUInt32LE(1, 0x110); b.writeUInt16LE(0, 0x114); // (I)
  const classData = Buffer.from([
    0, 0, 3, 0,            // static_fields, instance_fields, direct_methods, virtual_methods
    0, 0x89, 0x02, 0,      // nativeStub, static|native, code_off=0
    1, 9, 0x80, 0x03,      // sum, static|public, code_off 0x180
    1, 9, 0xa0, 0x03,      // twice, code_off 0x1a0
  ]);
  classData.copy(b, 0x140);

  function code(at, regs, ins, outs, instructions) {
    b.writeUInt16LE(regs, at);
    b.writeUInt16LE(ins, at + 2);
    b.writeUInt16LE(outs, at + 4);
    b.writeUInt32LE(instructions.length, at + 12);
    instructions.forEach((insn, i) => b.writeUInt16LE(insn, at + 16 + i * 2));
  }
  code(0x180, 3, 2, 0, [0x0090, 0x0201, 0x000f]); // add-int v0,v1,v2; return v0
  code(0x1a0, 2, 1, 2, [0x2071, 1, 0x0011, 0x000a, 0x000f]);
  // invoke-static {v1,v1}, method@1; move-result v0; return v0

  // Map list sorted by section offsets: required by DEX file structure.
  const items = [
    [0, 1, 0], [1, 8, 0x70], [2, 3, 0x90],
    [3, 3, 0x9c], [5, 3, 0xc0], [6, 1, 0xd8],
    [0x1001, 2, 0x100], [0x2000, 1, 0x140],
    [0x2001, 2, 0x180], [0x1000, 1, 0x220],
    [0x2002, 8, 0x2c0],
  ];
  b.writeUInt32LE(items.length, 0x220);
  items.forEach(([type, size, off], i) => {
    const pos = 0x224 + i * 12;
    b.writeUInt16LE(type, pos);
    b.writeUInt32LE(size, pos + 4);
    b.writeUInt32LE(off, pos + 8);
  });
  return sealDex(b);
}
function crc32(b) {
  let c = 0xffffffff;
  for (const value of b) {
    c ^= value;
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const b = Buffer.from(name), contents = Buffer.from(data);
    const hdr = Buffer.alloc(30);
    hdr.writeUInt32LE(0x04034b50, 0);
    hdr.writeUInt16LE(20, 4);
    hdr.writeUInt32LE(crc32(contents), 14);
    hdr.writeUInt32LE(contents.length, 18);
    hdr.writeUInt32LE(contents.length, 22);
    hdr.writeUInt16LE(b.length, 26);
    local.push(hdr, b, contents);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6);
    dir.writeUInt32LE(crc32(contents), 16);
    dir.writeUInt32LE(contents.length, 20);
    dir.writeUInt32LE(contents.length, 24);
    dir.writeUInt16LE(b.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, b);
    offset += 30 + b.length + contents.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
test('actual DEX table/class_data/code_item run sum(int,int) and nested invoke-static', () => {
  const vm = new DexSubset(fixtureDex());
  assert.equal(vm.execute('Ltest/Arithmetic;', 'sum', [19, 23]).value, 42);
  assert.equal(vm.execute('Ltest/Arithmetic;', 'sum', [-100, 30]).value, -70);
  assert.equal(vm.execute('Ltest/Arithmetic;', 'twice', [21]).value, 42);
  assert.equal(vm.execute('Ltest/Arithmetic;', 'sum', [2147483647, 1]).value, -2147483648);
});
test('native JNI is never assumed to be present', () => {
  const vm = new DexSubset(fixtureDex());
  assert.throws(() => vm.execute('Ltest/Arithmetic;', 'nativeStub', []), { code: 'NATIVE_UNAVAILABLE' });
  assert.throws(requireExecutionSupport, { code: 'EXECUTION_UNAVAILABLE' });
});
test('host-only native method dispatch is typed, opt-in and never implicit JNI', () => {
  const boundary = new NativeMethodBoundary();
  const owner = 'Ltest/Arithmetic;';
  boundary.register({ owner, name: 'nativeStub', signature: '()I', invoke: () => 42 });
  assert.equal(new DexSubset(fixtureDex(), { nativeBoundary: boundary }).execute(owner, 'nativeStub', []).value, 42);
  assert.throws(
    () => boundary.register({ owner, name: 'nativeStub', signature: '()I', invoke: () => 0 }),
    { code: 'NATIVE_REGISTRATION' }
  );
  const callsNative = fixtureDex();
  // Replace the invoke-static of sum(int,int) with nativeStub()I. The
  // following move-result is a real Dalvik instruction, not synthetic output.
  callsNative.writeUInt16LE(0x0071, 0x1a0 + 16);
  callsNative.writeUInt16LE(0, 0x1a0 + 18);
  callsNative.writeUInt16LE(0, 0x1a0 + 20);
  const vm = new DexSubset(sealDex(callsNative), { nativeBoundary: boundary });
  assert.equal(vm.execute(owner, 'twice', [99]).value, 42);
  const bad = new NativeMethodBoundary();
  bad.register({ owner, name: 'nativeStub', signature: '()I', invoke: () => '42' });
  assert.throws(() => new DexSubset(fixtureDex(), { nativeBoundary: bad }).execute(owner, 'nativeStub', []), { code: 'NATIVE_RESULT' });
  const asyncBoundary = new NativeMethodBoundary();
  asyncBoundary.register({ owner, name: 'nativeStub', signature: '()I', invoke: async () => 42 });
  assert.throws(() => new DexSubset(fixtureDex(), { nativeBoundary: asyncBoundary }).execute(owner, 'nativeStub', []), { code: 'NATIVE_RESULT' });
});
test('unimplemented opcode, bytecode loops and malicious register references fail closed', () => {
  const unimplemented = fixtureDex();
  unimplemented.writeUInt16LE(0x00fe, 0x180 + 16);
  assert.throws(() => new DexSubset(sealDex(unimplemented)).execute('Ltest/Arithmetic;', 'sum', [1, 2]), { code: 'DEX_OPCODE' });
  const loop = fixtureDex();
  loop.writeUInt16LE(0x0028, 0x180 + 16); // goto +0, bounded
  assert.throws(() => new DexSubset(sealDex(loop)).execute('Ltest/Arithmetic;', 'sum', [1, 2], { instructionLimit: 20 }), { code: 'DEX_BUDGET' });
  const branchIntoOperand = fixtureDex();
  branchIntoOperand.writeUInt16LE(0x0228, 0x180 + 16); // goto +2, into const/16 operand
  branchIntoOperand.writeUInt16LE(0x0013, 0x180 + 18);
  branchIntoOperand.writeUInt16LE(0x002a, 0x180 + 20);
  assert.throws(
    () => new DexSubset(sealDex(branchIntoOperand)).execute('Ltest/Arithmetic;', 'sum', [1, 2]),
    { code: 'DEX_BRANCH' }
  );
  const invalidReg = fixtureDex();
  invalidReg.writeUInt16LE(0xff90, 0x180 + 16); // v255 destination
  assert.throws(() => new DexSubset(sealDex(invalidReg)).execute('Ltest/Arithmetic;', 'sum', [1, 2]), { code: 'DEX_REGISTER' });
});
test('corrupt DEX metadata is rejected before method execution', () => {
  const raw = fixtureDex();
  raw[19] ^= 1;
  assert.throws(() => new DexSubset(raw), { code: 'DEX' });
  const invalid = fixtureDex();
  invalid.writeUInt32LE(0xffffff00, 0x140 + 0); // corrupted class_data encoded
  assert.throws(() => new DexSubset(sealDex(invalid)), { code: 'DEX_LIMIT' });
});
test('APK and nested XAPK actually execute bounded static Dalvik bytecode', async () => {
  const dex = fixtureDex();
  const apk = zip([['AndroidManifest.xml', Buffer.from([1, 2, 3])], ['classes.dex', dex]]);
  const xapk = zip([['base.apk', apk], ['config.arm64.apk', zip([['resources.arsc', Buffer.from([1])]])]]);
  const dir = await mkdtemp(join(tmpdir(), 'ordax-dalvik-e2e-'));
  try {
    const apkPath = join(dir, 'app.apk'), xapkPath = join(dir, 'app.xapk');
    await writeFile(apkPath, apk);
    await writeFile(xapkPath, xapk);
    assert.equal((await runDexMethodFromPackage(apkPath, 'Ltest/Arithmetic;', 'sum', [10, 32])).value, 42);
    assert.equal((await runDexMethodFromPackage(xapkPath, 'Ltest/Arithmetic;', 'twice', [21])).value, 42);
    const cli = new URL('../bin/mobile-compat.mjs', import.meta.url);
    const result = spawnSync(process.execPath, [fileURLToPath(cli), 'dex-method', apkPath, 'Ltest/Arithmetic;', 'sum', '19', '23'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).value, 42);
    const denied = spawnSync(process.execPath, [fileURLToPath(cli), 'run', apkPath], { encoding: 'utf8', timeout: 10000 });
    assert.equal(denied.status, 3);
    assert.equal(JSON.parse(denied.stderr).code, 'EXECUTION_UNAVAILABLE');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


// Synthetic but structurally valid DEX built from class_defs, field_ids,
// method_ids and code_items. This exercises real object bytecode, not host
// stubs; the guest object must never be serialized to the host.
function objectDexFixture() {
  const original = fixtureDex();
  const b = Buffer.alloc(0x800);
  original.copy(b);
  b.writeUInt32LE(b.length, 32);
  b.writeUInt32LE(b.length - 0xf8, 104);
  b.writeUInt32LE(13, 56); b.writeUInt32LE(0x400, 60); // string ids
  b.writeUInt32LE(5, 72); b.writeUInt32LE(0x3c0, 76); // prototypes
  b.writeUInt32LE(1, 80); b.writeUInt32LE(0x380, 84); // instance field
  b.writeUInt32LE(7, 88); b.writeUInt32LE(0x3a0, 92); // methods
  b.writeUInt32LE(0x600, 0xd8 + 24); // class data
  const strings = ['I', 'II', 'III', 'Ltest/Arithmetic;', 'V',
    'nativeStub', 'sum', 'twice', '<init>', 'makeObject', 'makeValue',
    'readValue', 'value'];
  let cursor = 0x500;
  strings.forEach((str, i) => {
    const raw = Buffer.from(str, 'ascii'), prefix = leb(raw.length);
    b.writeUInt32LE(cursor, 0x400 + i * 4);
    prefix.copy(b, cursor); cursor += prefix.length;
    raw.copy(b, cursor); cursor += raw.length;
    b[cursor++] = 0;
  });
  // type_ids retained: 0=int, 1=class, 2=void
  const protos = [
    [0, 0, 0], [1, 0, 0x110], [2, 0, 0x100],
    [0, 2, 0x110], [0, 1, 0x110],
  ];
  protos.forEach(([shorty, result, params], i) => {
    const at = 0x3c0 + i * 12;
    b.writeUInt32LE(shorty, at);
    b.writeUInt32LE(result, at + 4);
    b.writeUInt32LE(params, at + 8);
  });
  // instance int field "value", owned by class index 1.
  b.writeUInt16LE(1, 0x380);
  b.writeUInt16LE(0, 0x382);
  b.writeUInt32LE(12, 0x384);
  for (const [i, proto, name] of [
    [0, 0, 5], [1, 2, 6], [2, 1, 7], [3, 3, 8],
    [4, 4, 9], [5, 1, 10], [6, 0, 11],
  ]) {
    const at = 0x3a0 + i * 8;
    b.writeUInt16LE(1, at); b.writeUInt16LE(proto, at + 2);
    b.writeUInt32LE(name, at + 4);
  }
  const classData = Buffer.from([
    0, 1, 6, 1,          // fields: one instance; six direct + one virtual method
    0, 1,                // field delta 0, public instance field
    0, 0x89, 0x02, 0,   // nativeStub ()I
    1, 9, 0x80, 0x03,   // sum at 0x180
    1, 9, 0xa0, 0x03,   // twice at 0x1a0
    1, 1, 0xc0, 0x0c,   // <init>(I)V at 0x640
    1, 9, 0x80, 0x0d,   // makeObject(I)Ltest/Arithmetic; at 0x680
    1, 9, 0xc0, 0x0d,   // makeValue(I)I at 0x6c0
    6, 1, 0x80, 0x0e,   // readValue()I at 0x700, instance virtual method
  ]);
  classData.copy(b, 0x600);
  function code(at, regs, ins, outs, opcodes) {
    b.writeUInt16LE(regs, at);
    b.writeUInt16LE(ins, at + 2);
    b.writeUInt16LE(outs, at + 4);
    b.writeUInt16LE(0, at + 6); // no try blocks
    b.writeUInt32LE(0, at + 8);
    b.writeUInt32LE(opcodes.length, at + 12);
    opcodes.forEach((op, i) => b.writeUInt16LE(op, at + 16 + i * 2));
  }
  code(0x640, 2, 2, 0, [0x1059, 0, 0x000e]);
  code(0x680, 2, 1, 2, [
    0x0022, 1,            // new-instance v0, Ltest/Arithmetic;
    0x2070, 3, 0x0010,   // invoke-direct {v0, v1}, <init>(I)V
    0x0011,              // return-object v0
  ]);
  code(0x6c0, 3, 1, 2, [
    0x1071, 4, 0x0002,  // invoke-static {v2}, makeObject(I)ref
    0x000c,             // move-result-object v0
    0x106e, 6, 0x0000,  // invoke-virtual {v0}, readValue()I
    0x010a,             // move-result v1
    0x010f,             // return v1
  ]);
  code(0x700, 2, 1, 0, [0x1052, 0, 0x000f]); // iget v0,v1; return v0
  return sealDex(b);
}

test('real Dalvik object allocation + ctor + instance field + virtual dispatch stay in guest', () => {
  const vm = new DexSubset(objectDexFixture());
  assert.deepEqual(vm.execute('Ltest/Arithmetic;', 'makeValue', [42]),
    { format: 'dalvik-object-subset', value: 42, allocatedObjects: 1,
      consumedInstructions: 12 });
  assert.equal(vm.execute('Ltest/Arithmetic;', 'makeValue', [-153]).value, -153);
  // An object handle is NOT an integer result or a host pointer.
  assert.throws(() => vm.execute('Ltest/Arithmetic;', 'makeObject', [5]),
    { code: 'DEX_REFERENCE' });
  assert.throws(() => vm.execute('Ltest/Arithmetic;', 'makeValue', [1], { maxObjects: 0 }),
    { code: 'HEAP_LIMIT' });
});

test('object bytecode cannot forge object references, mutate unrelated fields or call wrong receiver', () => {
  const wrongField = objectDexFixture();
  // ReadValue's iget refers to invalid field#7.
  wrongField.writeUInt16LE(7, 0x700 + 18);
  assert.throws(
    () => new DexSubset(sealDex(wrongField)).execute('Ltest/Arithmetic;', 'makeValue', [42]),
    { code: 'DEX_INDEX' });
  const wrongReceiver = objectDexFixture();
  // makeValue substitutes integer v2 for object receiver v0.
  wrongReceiver.writeUInt16LE(0x0002, 0x6c0 + 16 + 6 * 2);
  assert.throws(
    () => new DexSubset(sealDex(wrongReceiver)).execute('Ltest/Arithmetic;', 'makeValue', [42]),
    { code: 'DEX_TYPE' });
  const nullAccess = objectDexFixture();
  // makeObject() sets its receiver to null before constructor.
  nullAccess.writeUInt16LE(0x0013, 0x680 + 16);
  nullAccess.writeUInt16LE(0x0000, 0x680 + 18);
  assert.throws(
    () => new DexSubset(sealDex(nullAccess)).execute('Ltest/Arithmetic;', 'makeValue', [2]),
    { code: 'DEX_NULL' });
});
