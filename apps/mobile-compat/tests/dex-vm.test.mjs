import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DexSubset } from '../src/dex-vm.mjs';
import { GuestHeap } from '../src/guest-heap.mjs';
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
    assert.equal(denied.status, 3, denied.stderr);
    assert.equal(JSON.parse(denied.stderr).code, 'MANIFEST');
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
  b.writeUInt32LE(1, 80); b.writeUInt32LE(0x360, 84); // instance field
  b.writeUInt32LE(7, 88); b.writeUInt32LE(0x380, 92); // methods
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
  b.writeUInt16LE(1, 0x360);
  b.writeUInt16LE(0, 0x362);
  b.writeUInt32LE(12, 0x364);
  for (const [i, proto, name] of [
    [0, 0, 5], [1, 2, 6], [2, 1, 7], [3, 3, 8],
    [4, 4, 9], [5, 1, 10], [6, 0, 11],
  ]) {
    const at = 0x380 + i * 8;
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
  code(0x640, 2, 2, 0, [0x0159, 0, 0x000e]); // iput v1,v0, field@0
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


test('guest constructors must complete before virtual calls, inheritance stays fail-closed', () => {
  const earlyVirtual = objectDexFixture();
  // Turn invoke-direct constructor call into invoke-virtual getter on an
  // uninitialized receiver: method#6, one argument, register v0.
  earlyVirtual.writeUInt16LE(0x106e, 0x680 + 16 + 2 * 2);
  earlyVirtual.writeUInt16LE(6, 0x680 + 16 + 3 * 2);
  earlyVirtual.writeUInt16LE(0, 0x680 + 16 + 4 * 2);
  assert.throws(() => new DexSubset(sealDex(earlyVirtual))
    .execute('Ltest/Arithmetic;', 'makeValue', [5]), { code: 'DEX_INIT' });

  const inherited = objectDexFixture();
  inherited.writeUInt32LE(1, 0xd8 + 8); // unsupported self/superclass layout
  assert.throws(() => new DexSubset(sealDex(inherited))
    .execute('Ltest/Arithmetic;', 'makeValue', [5]), { code: 'DEX_CLASS' });
});
// Two fully local DEX classes: Derived extends Arithmetic. Both instance
// fields share a single guest allocation; the parent virtual callsite must
// dispatch the Derived override only after super() has completed.
function inheritedObjectDexFixture() {
  const b = objectDexFixture();
  b.writeUInt32LE(14, 56);
  b.writeUInt32LE(0x5c0, 0x400 + 13 * 4);
  b[0x5c0] = 14;
  b.write('Ltest/Derived;', 0x5c1, 'ascii');
  b[0x5cf] = 0;
  b.writeUInt32LE(4, 64);
  b.writeUInt32LE(13, 0x9c);
  b.writeUInt32LE(2, 80);
  b.writeUInt16LE(3, 0x368); b.writeUInt16LE(0, 0x36a);
  b.writeUInt32LE(12, 0x36c);
  // Move sections to nonoverlapping free space in this fixture.
  b.copy(b, 0x440, 0x380, 0x380 + 7 * 8);
  b.writeUInt32LE(9, 88); b.writeUInt32LE(0x440, 92);
  for (const [i, proto, name] of [[7, 3, 8], [8, 0, 11]]) {
    const at = 0x440 + i * 8;
    b.writeUInt16LE(3, at); b.writeUInt16LE(proto, at + 2);
    b.writeUInt32LE(name, at + 4);
  }
  b.copy(b, 0x4a0, 0xd8, 0xf8);
  b.writeUInt32LE(2, 96); b.writeUInt32LE(0x4a0, 100);
  b.writeUInt32LE(3, 0x4c0);
  b.writeUInt32LE(1, 0x4c4);
  b.writeUInt32LE(1, 0x4c8);
  b.writeUInt32LE(0x740, 0x4c0 + 24);
  Buffer.from([
    0, 1, 1, 1,
    1, 1,
    7, 1, 0x80, 0x0f,
    8, 1, 0xb0, 0x0f,
  ]).copy(b, 0x740);
  function code(at, regs, ins, outs, words) {
    b.writeUInt16LE(regs, at); b.writeUInt16LE(ins, at + 2);
    b.writeUInt16LE(outs, at + 4); b.writeUInt16LE(0, at + 6);
    b.writeUInt32LE(0, at + 8); b.writeUInt32LE(words.length, at + 12);
    words.forEach((w, i) => b.writeUInt16LE(w, at + 16 + i * 2));
  }
  code(0x780, 2, 2, 2, [
    0x2070, 3, 0x0010, // Derived.<init> calls Arithmetic.<init>
    0x0159, 1,         // iput own field after super()
    0x000e,
  ]);
  code(0x7b0, 3, 1, 0, [
    0x2052, 0,         // read inherited Arithmetic field
    0x2152, 1,         // read Derived field
    0x0090, 0x0100,   // add two int32 fields
    0x000f,
  ]);
  b.writeUInt16LE(3, 0x680 + 18); // factory new-instance Derived
  b.writeUInt16LE(7, 0x680 + 16 + 3 * 2); // invoke Derived.<init>
  return sealDex(b);
}

test('inherited guest fields, chained constructors and virtual overriding execute from DEX', () => {
  const vm = new DexSubset(inheritedObjectDexFixture());
  const one = vm.execute('Ltest/Arithmetic;', 'makeValue', [42]);
  assert.equal(one.value, 84);
  assert.equal(one.allocatedObjects, 1);
  assert.equal(vm.execute('Ltest/Arithmetic;', 'makeValue', [-9]).value, -18);
  assert.throws(() => vm.execute('Ltest/Arithmetic;', 'makeObject', [7]),
    { code: 'DEX_REFERENCE' });
});

// Exercise the DEX invoke-super opcode, not a direct host callback. The
// parent getter and child override both execute on the same guest object.
function invokeSuperObjectDexFixture() {
  const b = inheritedObjectDexFixture();
  b.writeUInt16LE(1, 0x7b0 + 4); // one outgoing receiver word
  const code = [
    0x106f, 6, 0x0002, // invoke-super {v2}, Arithmetic.readValue()I
    0x000a,            // move-result v0
    0x2152, 1,         // iget v1, v2, Derived.value
    0x0090, 0x0100,   // add-int v0, v0, v1
    0x000f,
  ];
  b.writeUInt32LE(code.length, 0x7b0 + 12);
  code.forEach((word, i) => b.writeUInt16LE(word, 0x7b0 + 16 + i * 2));
  return sealDex(b);
}

test('invoke-super executes inherited DEX method without redispatching into child override', () => {
  const vm = new DexSubset(invokeSuperObjectDexFixture());
  for (const input of [42, -11, 0]) {
    const result = vm.execute('Ltest/Arithmetic;', 'makeValue', [input]);
    assert.equal(result.value, input * 2);
    assert.equal(result.allocatedObjects, 1);
  }
});

test('invoke-super denies unrelated target, forged receiver and static caller', () => {
  const wrongTarget = invokeSuperObjectDexFixture();
  wrongTarget.writeUInt16LE(8, 0x7b0 + 18); // Derived method is not a superclass
  assert.throws(() => new DexSubset(sealDex(wrongTarget))
    .execute('Ltest/Arithmetic;', 'makeValue', [6]), { code: 'DEX_INVOKE' });

  const wrongReceiver = invokeSuperObjectDexFixture();
  wrongReceiver.writeUInt16LE(0x0001, 0x7b0 + 20);
  assert.throws(() => new DexSubset(sealDex(wrongReceiver))
    .execute('Ltest/Arithmetic;', 'makeValue', [6]), { code: 'DEX_INVOKE' });

  const staticCaller = invokeSuperObjectDexFixture();
  staticCaller.writeUInt16LE(0x106f, 0x6c0 + 16);
  staticCaller.writeUInt16LE(6, 0x6c0 + 18);
  assert.throws(() => new DexSubset(sealDex(staticCaller))
    .execute('Ltest/Arithmetic;', 'makeValue', [6]), { code: 'DEX_INVOKE' });

  const noMoveResult = invokeSuperObjectDexFixture();
  // A move-result opcode cannot be reached without preceding invoke.
  noMoveResult.writeUInt16LE(0x0014, 0x7b0 + 16); // const/31i, then illegal move-result
  assert.throws(() => new DexSubset(sealDex(noMoveResult))
    .execute('Ltest/Arithmetic;', 'makeValue', [6]), { code: 'DEX_RESULT' });
});

// Validate object typing and reference branches using real DEX code_item
// instructions on the existing two-class fixture. No guest handles leak.
function localTypeDexFixture({
  action = 'instance-of', type = 1, allocateParent = false, nullRef = false,
  branch = null,
} = {}) {
  const b = inheritedObjectDexFixture();
  if (allocateParent) {
    b.writeUInt16LE(1, 0x680 + 18); // new-instance Arithmetic
    b.writeUInt16LE(3, 0x680 + 16 + 3 * 2); // parent constructor
  }
  let opcodes;
  if (branch) {
    opcodes = [
      0x1071, 4, 0x0002, // invoke-static makeObject(int)
      0x000c,            // move-result-object v0
      ...(nullRef ? [0x0012] : []), // const/4 v0, 0 -> null
      (branch === 'eqz' ? 0x0038 : 0x0039), 4,
      0x1112, 0x010f, // const/4 v1, 1 ; return v1
      0x0112, 0x010f, // const/4 v1, 0 ; return v1
    ];
  } else if (action === 'instance-of') {
    opcodes = [
      0x1071, 4, 0x0002,
      0x000c, // receive derived object
      ...(nullRef ? [0x0012] : []),
      0x0120, type, 0x010f, // instance-of v1, v0; return v1
    ];
  } else {
    opcodes = [
      0x1071, 4, 0x0002,
      0x000c,
      ...(nullRef ? [0x0012] : []),
      0x001f, type, // check-cast v0
      0x106e, 6, 0x0000, // virtual getter on resulting receiver
      0x010a, 0x010f,
    ];
  }
  b.writeUInt32LE(opcodes.length, 0x6c0 + 12);
  opcodes.forEach((word, i) => b.writeUInt16LE(word, 0x6c0 + 16 + i * 2));
  return sealDex(b);
}

test('instance-of and check-cast use the actual local class hierarchy', () => {
  for (const target of [1, 3]) {
    assert.equal(new DexSubset(localTypeDexFixture({ type: target }))
      .execute('Ltest/Arithmetic;', 'makeValue', [42]).value, 1);
    assert.equal(new DexSubset(localTypeDexFixture({ action: 'check-cast', type: target }))
      .execute('Ltest/Arithmetic;', 'makeValue', [42]).value, 84);
  }
  assert.equal(new DexSubset(localTypeDexFixture({ type: 3, allocateParent: true }))
    .execute('Ltest/Arithmetic;', 'makeValue', [42]).value, 0);
  assert.throws(() => new DexSubset(localTypeDexFixture({
    action: 'check-cast', type: 3, allocateParent: true,
  })).execute('Ltest/Arithmetic;', 'makeValue', [42]), { code: 'DEX_CAST' });
});

test('null reference has no instance type; reference zero-tests branch correctly', () => {
  assert.equal(new DexSubset(localTypeDexFixture({ nullRef: true }))
    .execute('Ltest/Arithmetic;', 'makeValue', [7]).value, 0);
  for (const [branch, nullRef, expected] of [
    ['eqz', true, 0], ['eqz', false, 1],
    ['nez', true, 1], ['nez', false, 0],
  ]) {
    assert.equal(new DexSubset(localTypeDexFixture({ branch, nullRef }))
      .execute('Ltest/Arithmetic;', 'makeValue', [7]).value, expected);
  }
  // Java check-cast on null is valid; subsequent virtual call is not.
  assert.throws(() => new DexSubset(localTypeDexFixture({
    action: 'check-cast', nullRef: true,
  })).execute('Ltest/Arithmetic;', 'makeValue', [7]), { code: 'DEX_NULL' });
});

test('type tests fail closed on primitive/external class indices and forged handles', () => {
  assert.throws(() => new DexSubset(localTypeDexFixture({ type: 0 }))
    .execute('Ltest/Arithmetic;', 'makeValue', [1]), { code: 'DEX_TYPE' });
  assert.throws(() => new DexSubset(localTypeDexFixture({ type: 65535 }))
    .execute('Ltest/Arithmetic;', 'makeValue', [1]), { code: 'DEX_INDEX' });
  const mutated = localTypeDexFixture();
  mutated.writeUInt16LE(0x2020, 0x6c0 + 16 + 4 * 2); // v2 is raw int, not ref
  assert.throws(() => new DexSubset(sealDex(mutated))
    .execute('Ltest/Arithmetic;', 'makeValue', [42]), { code: 'DEX_TYPE' });
  const heap = new GuestHeap();
  const child = heap.allocate('Ltest/Derived;', [], ['Ltest/Arithmetic;']);
  assert.equal(heap.isInstance(child, 'Ltest/Arithmetic;'), true);
  assert.equal(heap.isInstance(child, 'Ltest/Other;'), false);
  assert.equal(heap.isInstance(0, 'Ltest/Arithmetic;'), false);
  assert.throws(() => heap.isInstance(123456, 'Ltest/Arithmetic;'), { code: 'DEX_REFERENCE' });
});

test('local classes reject cyclic, missing and incomplete superclass initialization', () => {
  const cyclic = inheritedObjectDexFixture();
  cyclic.writeUInt32LE(3, 0x4c8);
  assert.throws(() => new DexSubset(sealDex(cyclic)), { code: 'DEX_CLASS' });
  const missing = inheritedObjectDexFixture();
  missing.writeUInt32LE(2, 0x4c8);
  assert.throws(() => new DexSubset(sealDex(missing)), { code: 'DEX_CLASS' });
  const skipSuper = inheritedObjectDexFixture();
  [0x0112, 0x0112, 0x0112].forEach((word, i) =>
    skipSuper.writeUInt16LE(word, 0x780 + 16 + i * 2));
  assert.throws(() => new DexSubset(sealDex(skipSuper))
    .execute('Ltest/Arithmetic;', 'makeValue', [5]), { code: 'DEX_INIT' });
  const heap = new GuestHeap();
  const ref = heap.allocate('Ltest/Derived;', [0, 1], ['Ltest/Arithmetic;']);
  assert.equal(heap.lookup(ref, 'Ltest/Arithmetic;').type, 'Ltest/Derived;');
  assert.throws(() => heap.lookup(ref, 'Ltest/Other;'), { code: 'DEX_REFERENCE' });
  assert.throws(() => heap.enterConstructor(ref, 'Ltest/Arithmetic;', null),
    { code: 'DEX_INIT' });
});

test('DEX virtual ownership enforces final classes, final methods and unsupported class kinds', () => {
  const finalClass = inheritedObjectDexFixture();
  finalClass.writeUInt32LE(0x11, 0x4a4); // Arithmetic is final
  assert.throws(() => new DexSubset(sealDex(finalClass)), { code: 'DEX_CLASS' });

  const finalMethod = inheritedObjectDexFixture();
  finalMethod[0x61f] = 0x11; // Arithmetic.readValue() is final
  assert.throws(() => new DexSubset(sealDex(finalMethod)), { code: 'DEX_CLASS' });

  const badVirtual = inheritedObjectDexFixture();
  badVirtual[0x74b] = 0x03; // Derived.readValue() cannot be private virtual
  assert.throws(() => new DexSubset(sealDex(badVirtual)), { code: 'DEX_CLASS' });

  const interfaceClass = inheritedObjectDexFixture();
  interfaceClass.writeUInt32LE(0x201, 0x4c4);
  assert.throws(() => new DexSubset(sealDex(interfaceClass)), { code: 'DEX_CLASS' });

  const unresolvedInterfaces = inheritedObjectDexFixture();
  unresolvedInterfaces.writeUInt32LE(0x100, 0x4cc);
  assert.throws(() => new DexSubset(sealDex(unresolvedInterfaces)), { code: 'DEX_CLASS' });

  const abstractChild = inheritedObjectDexFixture();
  abstractChild.writeUInt32LE(0x401, 0x4c4);
  assert.throws(() => new DexSubset(sealDex(abstractChild))
    .execute('Ltest/Arithmetic;', 'makeValue', [5]), { code: 'DEX_CLASS' });
});

test('guest object quotas, initialization and field ownership are enforced', () => {
  const heap = new GuestHeap({ maxObjects: 1 });
  assert.throws(() => heap.allocate('Ltest/Box;', Array.from({length: 129}, (_, i) => i)),
    { code: 'HEAP_LIMIT' });
  const handle = heap.allocate('Ltest/Box;', [1]);
  assert.equal(heap.readField(handle, 'Ltest/Box;', 1), 0);
  assert.throws(() => heap.requireInitialized(handle, 'Ltest/Box;'), { code: 'DEX_INIT' });
  heap.writeField(handle, 'Ltest/Box;', 1, -42);
  heap.markInitialized(handle, 'Ltest/Box;');
  heap.requireInitialized(handle, 'Ltest/Box;');
  assert.equal(heap.readField(handle, 'Ltest/Box;', 1), -42);
  assert.throws(() => heap.readField(handle, 'Ltest/Other;', 1), { code: 'DEX_REFERENCE' });
  assert.throws(() => heap.readField(handle, 'Ltest/Box;', 3), { code: 'DEX_FIELD' });
  assert.throws(() => heap.allocate('Ltest/Box;', []), { code: 'HEAP_LIMIT' });
  assert.throws(() => heap.lookup(0), { code: 'DEX_NULL' });
  assert.throws(() => heap.lookup(12345), { code: 'DEX_REFERENCE' });
});


test('object bytecode also runs from APK and XAPK through the real package intake', async () => {
  const apk = zip([['AndroidManifest.xml', Buffer.from([1, 2, 3])],
    ['classes.dex', objectDexFixture()]]);
  const xapk = zip([['base.apk', apk],
    ['config.arm64.apk', zip([['resources.arsc', Buffer.from([1])]])]]);
  const dir = await mkdtemp(join(tmpdir(), 'ordax-dalvik-objects-'));
  try {
    const apkPath = join(dir, 'objects.apk'), xapkPath = join(dir, 'objects.xapk');
    await writeFile(apkPath, apk);
    await writeFile(xapkPath, xapk);
    for (const path of [apkPath, xapkPath]) {
      const outcome = await runDexMethodFromPackage(path, 'Ltest/Arithmetic;', 'makeValue', [42]);
      assert.equal(outcome.value, 42);
      assert.equal(outcome.allocatedObjects, 1);
      assert.equal(outcome.format, 'dalvik-object-subset');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('branches cannot jump directly into move-result-object', () => {
  const raw = objectDexFixture();
  // A well-formed invoke/move-result pair stays at words 0..3.
  // A later goto -1 must not jump back into that move-result-object.
  raw.writeUInt16LE(0xff28, 0x6c0 + 16 + 4 * 2);
  raw.writeUInt16LE(0x0012, 0x6c0 + 16 + 5 * 2);
  raw.writeUInt16LE(0x0012, 0x6c0 + 16 + 6 * 2);
  raw.writeUInt16LE(0x0012, 0x6c0 + 16 + 7 * 2);
  assert.throws(() => new DexSubset(sealDex(raw)).execute('Ltest/Arithmetic;', 'makeValue', [1]),
    { code: 'DEX_RESULT' });
});


// The same structured DEX fixture used for objects, extended with the type
// descriptor [I and real Dalvik array opcodes in an existing static method.
// No shell, emulator, Android OS, or host-side method imitation.
function arrayDexFixture() {
  const b = objectDexFixture();
  b.writeUInt32LE(14, 56); // 14 string ids, add descriptor '[I'
  const last = b.readUInt32LE(0x400 + 12 * 4);
  const next = last + 1 + 'value'.length + 1;
  b.writeUInt32LE(next, 0x400 + 13 * 4);
  b[next] = 2;
  b.write('[I', next + 1, 'ascii');
  b[next + 3] = 0;
  b.writeUInt32LE(4, 64); // four type ids
  b.writeUInt32LE(0x450, 68);
  for (let i = 0; i < 3; i++) b.writeUInt32LE(b.readUInt32LE(0x90 + i * 4), 0x450 + i * 4);
  b.writeUInt32LE(13, 0x45c); // type idx 3 => [I
  const insns = [
    0x3023, 3,        // new-array v0,v3,type@3: int[size]
    0x0213, 42,       // const/16 v2,#42
    0x024b, 0x0400,   // aput v2,v0,v4
    0x0144, 0x0400,   // aget v1,v0,v4
    0x010f,           // return v1
  ];
  // Keep the expanded code_item separate from the neighboring method:
  // a 9-word code_item needs 34 bytes, which would overlap the 0x1a0 item.
  const codeOff = 0x740;
  b[0x600 + 12] = 0xc0; // sum method code_off ULEB128 = 0x740
  b[0x600 + 13] = 0x0e;
  b.writeUInt16LE(5, codeOff);
  b.writeUInt16LE(2, codeOff + 2);
  b.writeUInt32LE(insns.length, codeOff + 12);
  for (let i = 0; i < insns.length; i++) b.writeUInt16LE(insns[i], codeOff + 16 + i * 2);
  return sealDex(b);
}
test('actual Dalvik new-array/aput/aget returns int32 and allocates one guest array', () => {
  const vm = new DexSubset(arrayDexFixture());
  const out = vm.execute('Ltest/Arithmetic;', 'sum', [5, 2]);
  assert.equal(out.value, 42);
  assert.equal(out.allocatedObjects, 1);
  assert.equal(vm.execute('Ltest/Arithmetic;', 'sum', [5, 4]).value, 42);
  // An independent entrypoint invocation creates its own private heap.
  assert.equal(vm.execute('Ltest/Arithmetic;', 'sum', [3, 0]).allocatedObjects, 1);
});
test('Dalvik guest array rejects negative size, oversized size and out-of-range indexes', () => {
  const vm = new DexSubset(arrayDexFixture());
  for (const [length, index, code] of [
    [-1, 0, 'DEX_ARRAY_SIZE'],
    [0, 0, 'DEX_ARRAY_BOUNDS'],
    [2, 2, 'DEX_ARRAY_BOUNDS'],
    [2, -1, 'DEX_ARRAY_BOUNDS'],
    [65537, 0, 'HEAP_LIMIT'],
  ]) {
    assert.throws(() => vm.execute('Ltest/Arithmetic;', 'sum', [length, index]), { code });
  }
});
test('Dalvik array opcodes fail closed for unsupported reference array classes and forged receivers', () => {
  const wrongArrayType = arrayDexFixture();
  wrongArrayType.writeUInt16LE(1, 0x740 + 18); // Ltest/Arithmetic; instead of [I
  assert.throws(
    () => new DexSubset(sealDex(wrongArrayType)).execute('Ltest/Arithmetic;', 'sum', [5, 2]),
    { code: 'DEX_ARRAY_TYPE' }
  );
  const forged = arrayDexFixture();
  // aput uses register v3 (length int), not array handle register v0.
  forged.writeUInt16LE(0x0403, 0x740 + 16 + 5 * 2);
  assert.throws(
    () => new DexSubset(sealDex(forged)).execute('Ltest/Arithmetic;', 'sum', [5, 2]),
    { code: 'DEX_TYPE' }
  );
});
test('opaque heap arrays enforce cell quotas, isolation and typed access', () => {
  const heap = new GuestHeap({ maxObjects: 4 });
  const array = heap.allocateIntArray(2);
  assert.equal(heap.arrayLength(array), 2);
  assert.equal(heap.getIntArray(array, 0), 0);
  heap.setIntArray(array, 1, -42);
  assert.equal(heap.getIntArray(array, 1), -42);
  assert.throws(() => heap.getIntArray(array, 2), { code: 'DEX_ARRAY_BOUNDS' });
  assert.throws(() => heap.setIntArray(array, 0, 1.5), { code: 'DEX_ARRAY_TYPE' });
  assert.throws(() => heap.getIntArray(0, 0), { code: 'DEX_NULL' });
  assert.throws(() => heap.readField(array, '[I', 0), { code: 'DEX_FIELD' });
  const object = heap.allocate('Ltest/Box;', []);
  assert.throws(() => heap.arrayLength(object), { code: 'DEX_REFERENCE' });
  assert.throws(() => heap.allocateIntArray(65537), { code: 'HEAP_LIMIT' });
  assert.throws(() => heap.allocateIntArray(-2), { code: 'DEX_ARRAY_SIZE' });
  const separate = new GuestHeap();
  assert.throws(() => separate.getIntArray(array, 0), { code: 'DEX_REFERENCE' });
});
test('APK and XAPK boundaries execute actual Dalvik int[] code without exporting guest pointers', async () => {
  const apk = zip([['AndroidManifest.xml', Buffer.from([1, 2, 3])],
    ['classes.dex', arrayDexFixture()]]);
  const xapk = zip([['base.apk', apk], ['config.arm64.apk',
    zip([['resources.arsc', Buffer.from([9, 8])]])]]);
  const dir = await mkdtemp(join(tmpdir(), 'ordax-dalvik-arrays-'));
  try {
    const files = [join(dir, 'arrays.apk'), join(dir, 'arrays.xapk')];
    await writeFile(files[0], apk);
    await writeFile(files[1], xapk);
    for (const file of files) {
      const result = await runDexMethodFromPackage(file, 'Ltest/Arithmetic;', 'sum', [3, 1]);
      assert.equal(result.value, 42);
      assert.equal(result.allocatedObjects, 1);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
