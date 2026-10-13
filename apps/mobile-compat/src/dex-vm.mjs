// Strictly bounded Dalvik *instruction subset* for independently verifiable
// static/int-instance methods. Not ART, reflection, JNI ABI or Android UI.
import { inspectDex } from './formats.mjs';
import { PackageError } from './zip.mjs';
import { GuestHeap } from './guest-heap.mjs';

function fail(code, reason) { throw new PackageError(code, reason); }
function requireRange(b, off, len, why) {
  if (!Number.isSafeInteger(off) || !Number.isSafeInteger(len) ||
      off < 0 || len < 0 || off > b.length || len > b.length - off) {
    fail('DEX_BOUNDS', why);
  }
}
function u16(b, off) { requireRange(b, off, 2, 'DEX u16 out of range'); return b.readUInt16LE(off); }
function u32(b, off) { requireRange(b, off, 4, 'DEX u32 out of range'); return b.readUInt32LE(off); }
function leb(b, offset) {
  let result = 0;
  for (let i = 0; i < 5; i++) {
    requireRange(b, offset + i, 1, 'DEX ULEB truncated');
    const octet = b[offset + i];
    if (i === 4 && (octet & 0xf0)) fail('DEX_LEB', 'ULEB32 overflow');
    result += (octet & 0x7f) * (2 ** (7 * i));
    if (!(octet & 0x80)) return [result, offset + i + 1];
  }
  fail('DEX_LEB', 'ULEB32 unterminated');
}
function section(b, countOffset, offsetOffset, stride, max) {
  const count = u32(b, countOffset), off = u32(b, offsetOffset);
  if (count > max || (count === 0) !== (off === 0) ||
      (count && off % 4 !== 0)) fail('DEX_SECTION', 'Invalid table count or alignment');
  if (count) requireRange(b, off, count * stride, 'DEX index table outside image');
  return { count, off };
}
function sign8(v) { return (v << 24) >> 24; }
function sign16(v) { return (v << 16) >> 16; }
const MAX_INSNS = 32768;
const MAX_METHODS = 8192;
const MAX_CLASSES = 2048;
const MAX_CLASS_DEPTH = 16;
const virtualKey = info =>
  info.name + '\u0000' + info.proto.params.join('') + '\u0000' + info.proto.result;

export class DexSubset {
  constructor(bytes, { nativeBoundary = null } = {}) {
    this.nativeBoundary = nativeBoundary;
    inspectDex(bytes); // SHA-1 and Adler32 are validated before parsing.
    if (!['035', '037', '038', '039'].includes(bytes.toString('ascii', 4, 7))) {
      fail('DEX_VERSION', 'Unsupported DEX subset format');
    }
    this.bytes = bytes;
    this.strings = section(bytes, 56, 60, 4, 1000000);
    this.types = section(bytes, 64, 68, 4, 65535);
    this.protos = section(bytes, 72, 76, 12, 65535);
    this.fields = section(bytes, 80, 84, 8, 65535);
    this.methods = section(bytes, 88, 92, 8, 65535);
    this.classes = section(bytes, 96, 100, 32, MAX_CLASSES);
    this.methodsById = new Map();
    this.methodInfos = new Map();
    this.stringCache = new Map();
    this.fieldInfos = new Map();
    this.classInstanceFields = new Map();
    this.classSuperclasses = new Map();
    this.classAccessFlags = new Map();
    this.classIndicesByName = new Map();
    this.classLineages = new Map();
    this.classVirtualMethods = new Map();
    this.virtualMethodIds = new Set();
    this.directMethodIds = new Set();
    for (let i = 0; i < this.classes.count; i++) {
      const classOffset = this.classes.off + i * 32;
      const classIdx = u32(bytes, classOffset);
      if (classIdx >= this.types.count) fail('DEX_INDEX', 'Invalid class definition type');
      if (this.classInstanceFields.has(classIdx)) fail('DEX_CLASS', 'Duplicate class definition');
      const flags = u32(bytes, classOffset + 4);
      // Android interfaces, enum/annotation class models and implements lists
      // cannot be silently treated as ordinary local Java class layouts.
      if ((flags & (0x200 | 0x2000 | 0x4000)) ||
          ((flags & 0x10) && (flags & 0x400)) ||
          u32(bytes, classOffset + 12) !== 0) {
        fail('DEX_CLASS', 'Unsupported class kind or external interface list');
      }
      this.classInstanceFields.set(classIdx, new Set());
      this.classAccessFlags.set(classIdx, flags);
      this.classSuperclasses.set(classIdx, u32(bytes, classOffset + 8));
      const name = this.type(classIdx);
      if (this.classIndicesByName.has(name)) fail('DEX_CLASS', 'Duplicate class descriptor');
      this.classIndicesByName.set(name, classIdx);
      this.classVirtualMethods.set(classIdx, new Map());
      const classDataOffset = u32(bytes, classOffset + 24);
      if (classDataOffset) this.readClassData(classIdx, classDataOffset);
    }
    // Inspect the local class graph once, before interpreting any guest code.
    // Unresolved external/Android classes remain unsupported, never stubbed.
    for (const index of this.classInstanceFields.keys()) this.classLineage(index);
    // A final virtual method cannot be overridden by a subclass; otherwise
    // the receiver-based dispatch below would violate the DEX class contract.
    for (const [index, implementations] of this.classVirtualMethods) {
      const parents = this.classLineage(index).slice(1);
      for (const key of implementations.keys()) {
        for (const ancestor of parents) {
          const parentMethod = this.classVirtualMethods.get(ancestor).get(key);
          if (parentMethod === undefined) continue;
          if (this.methodsById.get(parentMethod).access & 0x10) {
            fail('DEX_CLASS', 'Overriding a final superclass method is unsupported');
          }
          break;
        }
      }
    }
  }
  classLineage(index, visiting = new Set()) {
    if (this.classLineages.has(index)) return this.classLineages.get(index);
    if (!this.classInstanceFields.has(index) || visiting.has(index) ||
        visiting.size >= MAX_CLASS_DEPTH) {
      fail('DEX_CLASS', 'Missing, cyclic or over-deep superclass chain');
    }
    visiting.add(index);
    const parent = this.classSuperclasses.get(index);
    const lineage = parent === 0xffffffff
      ? [index] : [index, ...this.classLineage(parent, visiting)];
    if (parent !== 0xffffffff && (this.classAccessFlags.get(parent) & 0x10)) {
      fail('DEX_CLASS', 'Cannot extend a final local class');
    }
    visiting.delete(index);
    if (lineage.length > MAX_CLASS_DEPTH) fail('DEX_CLASS', 'Class depth exceeded');
    this.classLineages.set(index, lineage);
    return lineage;
  }
  getString(index) {
    if (index >= this.strings.count) fail('DEX_INDEX', 'Invalid string index');
    if (this.stringCache.has(index)) return this.stringCache.get(index);
    const b = this.bytes;
    const offset = u32(b, this.strings.off + index * 4);
    let [utf16Length, p] = leb(b, offset);
    if (utf16Length > 1024) fail('DEX_STRING', 'String identifier too long');
    let value = '';
    while (true) {
      requireRange(b, p, 1, 'String data truncated');
      const ch = b[p++];
      if (ch === 0) break;
      // This deliberately supports only ASCII for descriptors/method names.
      // Non-ASCII MUTF-8 requires a complete decoder before enabling it.
      if (ch > 0x7f || value.length >= 1024) fail('DEX_STRING', 'Unsupported MUTF-8 identifier');
      value += String.fromCharCode(ch);
    }
    if (value.length !== utf16Length) fail('DEX_STRING', 'String declared length mismatch');
    this.stringCache.set(index, value);
    return value;
  }
  type(index) {
    if (index >= this.types.count) fail('DEX_INDEX', 'Invalid type index');
    return this.getString(u32(this.bytes, this.types.off + index * 4));
  }
  prototype(index) {
    if (index >= this.protos.count) fail('DEX_INDEX', 'Invalid prototype index');
    const at = this.protos.off + index * 12;
    const result = this.type(u32(this.bytes, at + 4));
    const paramOff = u32(this.bytes, at + 8);
    const params = [];
    if (paramOff) {
      if (paramOff % 4) fail('DEX_SECTION', 'Unaligned parameter list');
      const count = u32(this.bytes, paramOff);
      if (count > 16) fail('DEX_LIMIT', 'Too many method parameters');
      requireRange(this.bytes, paramOff + 4, count * 2, 'DEX type_list truncated');
      for (let i = 0; i < count; i++) params.push(this.type(u16(this.bytes, paramOff + 4 + i * 2)));
    }
    return { params, result };
  }
  methodInfo(index) {
    if (index >= this.methods.count) fail('DEX_INDEX', 'Invalid method index');
    if (this.methodInfos.has(index)) return this.methodInfos.get(index);
    const at = this.methods.off + index * 8;
    const owner = this.type(u16(this.bytes, at));
    const proto = this.prototype(u16(this.bytes, at + 2));
    const name = this.getString(u32(this.bytes, at + 4));
    const info = { index, owner, name, proto };
    this.methodInfos.set(index, info);
    return info;
  }
  fieldInfo(index) {
    if (index >= this.fields.count) fail('DEX_INDEX', 'Invalid field index');
    if (this.fieldInfos.has(index)) return this.fieldInfos.get(index);
    const at = this.fields.off + index * 8;
    const ownerIdx = u16(this.bytes, at);
    const type = this.type(u16(this.bytes, at + 2));
    const name = this.getString(u32(this.bytes, at + 4));
    const info = { index, ownerIdx, owner: this.type(ownerIdx), type, name };
    this.fieldInfos.set(index, info);
    return info;
  }
  readClassData(classIdx, offset) {
    let p = offset;
    const fields = [], methods = [];
    for (let i = 0; i < 4; i++) {
      const [n, next] = leb(this.bytes, p); p = next;
      if (n > MAX_METHODS) fail('DEX_LIMIT', 'Class data count limit exceeded');
      (i < 2 ? fields : methods).push(n);
    }
    for (const count of fields) {
      let field = 0;
      for (let i = 0; i < count; i++) {
        const [delta, next] = leb(this.bytes, p); p = next; field += delta;
        const [access, pos] = leb(this.bytes, p); p = pos;
        if (field >= this.fields.count || this.fieldInfo(field).ownerIdx !== classIdx) {
          fail('DEX_INDEX', 'Invalid encoded field ownership/index');
        }
        if (!(access & 0x8)) this.classInstanceFields.get(classIdx).add(field);
      }
    }
    let method = 0;
    for (const [group, count] of methods.entries()) {
      method = 0;
      for (let i = 0; i < count; i++) {
        const [delta, next] = leb(this.bytes, p); p = next; method += delta;
        const [access, next2] = leb(this.bytes, p); p = next2;
        const [codeOff, next3] = leb(this.bytes, p); p = next3;
        if (method >= this.methods.count || this.methodsById.has(method)) {
          fail('DEX_INDEX', 'Duplicate or invalid encoded method');
        }
        if (u16(this.bytes, this.methods.off + method * 8) !== classIdx) {
          fail('DEX_INDEX', 'Method ownership differs from class_data');
        }
        this.methodsById.set(method, { access, codeOff });
        if (group === 1) {
          if ((access & (0x8 | 0x2)) || this.methodInfo(method).name === '<init>') {
            fail('DEX_CLASS', 'Invalid virtual method access or constructor');
          }
          const key = virtualKey(this.methodInfo(method));
          if (this.classVirtualMethods.get(classIdx).has(key)) {
            fail('DEX_CLASS', 'Duplicate class virtual method signature');
          }
          this.classVirtualMethods.get(classIdx).set(key, method);
          this.virtualMethodIds.add(method);
        } else {
          this.directMethodIds.add(method);
        }
      }
    }
  }
  findStatic(owner, name, signature) {
    let selected = null;
    for (const [index] of this.methodsById) {
      const info = this.methodInfo(index);
      if (info.owner !== owner || info.name !== name) continue;
      if (signature && '(' + info.proto.params.join('') + ')' + info.proto.result !== signature) continue;
      if (selected !== null) fail('DEX_AMBIGUOUS', 'Overloaded method requires exact prototype');
      selected = index;
    }
    if (selected !== null) return selected;
    fail('DEX_METHOD', 'Requested method not defined in DEX');
  }
  codeItem(index) {
    const encoded = this.methodsById.get(index);
    if (!encoded) fail('DEX_METHOD', 'Unresolved DEX method');
    const info = this.methodInfo(index);
    if (encoded.access & 0x100) fail('NATIVE_UNAVAILABLE', 'JNI native method has no authorized implementation');
    if ((encoded.access & 0x400) || !encoded.codeOff) fail('DEX_METHOD', 'Abstract or missing code item');
    const supported = type => type === 'I' || type === '[I' || /^L[A-Za-z0-9_/$]+;$/.test(type);
    if (!info.proto.params.every(supported) ||
        !(['I', 'V'].includes(info.proto.result) || supported(info.proto.result))) {
      fail('DEX_TYPE', 'Only int32, references and void method signatures are supported');
    }
    const offset = encoded.codeOff;
    if (offset % 4 !== 0) fail('DEX_SECTION', 'Unaligned DEX code item');
    requireRange(this.bytes, offset, 16, 'Code item missing');
    const regs = u16(this.bytes, offset);
    const ins = u16(this.bytes, offset + 2);
    const outs = u16(this.bytes, offset + 4);
    const tries = u16(this.bytes, offset + 6);
    const insnsCount = u32(this.bytes, offset + 12);
    const isStatic = !!(encoded.access & 0x8);
    if (regs > 256 || ins !== info.proto.params.length + (isStatic ? 0 : 1) ||
        regs < ins || outs > 16 || tries || insnsCount === 0 || insnsCount > MAX_INSNS) {
      fail('DEX_CODE', 'Unsupported or invalid code_item bounds');
    }
    requireRange(this.bytes, offset + 16, insnsCount * 2, 'Truncated DEX instructions');
    const item = { info, regs, outs, insnsCount, isStatic,
      word: p => u16(this.bytes, offset + 16 + p * 2) };
    // Verify the complete instruction stream before interpreting even one
    // code unit. Branches may only land on actual opcode boundaries, never
    // inside a const/invoke payload or in the middle of an instruction.
    const sizeByOpcode = new Map([
      [0x01, 1], [0x07, 1], [0x0a, 1], [0x0c, 1],
      [0x0e, 1], [0x0f, 1], [0x11, 1],
      [0x12, 1], [0x13, 2], [0x14, 3], [0x21, 1], [0x22, 2], [0x23, 2],
      [0x44, 2], [0x4b, 2], [0x52, 2], [0x59, 2],
      [0x28, 1], [0x29, 2], [0x38, 2],
      [0x6e, 3], [0x70, 3], [0x71, 3], [0x90, 2], [0x91, 2], [0x92, 2], [0xd8, 2],
    ]);
    const starts = new Set(), targets = [];
    let previous = -1;
    for (let p = 0; p < insnsCount;) {
      const w = item.word(p), opcode = w & 255;
      const size = sizeByOpcode.get(opcode);
      if (!size) fail('DEX_OPCODE', 'Instruction unsupported in verified method');
      if (p + size > insnsCount) fail('DEX_CODE', 'Instruction extends beyond code item');
      starts.add(p);
      if ((opcode === 0x0a || opcode === 0x0c) &&
          previous !== 0x71 && previous !== 0x70 && previous !== 0x6e) {
        fail('DEX_RESULT', 'move-result must directly follow invoke');
      }
      if (opcode === 0x28) targets.push(p + sign8(w >>> 8));
      if (opcode === 0x29 || opcode === 0x38) targets.push(p + sign16(item.word(p + 1)));
      previous = opcode;
      p += size;
    }
    for (const destination of targets) {
      if (!starts.has(destination)) fail('DEX_BRANCH', 'Branch into non-instruction or outside code');
      if ([0x0a, 0x0c].includes(item.word(destination) & 255)) {
        fail('DEX_RESULT', 'Cannot branch into invoke result retrieval');
      }
    }
    return item;
  }
  execute(owner, name, args, { instructionLimit = 10000, signature, maxObjects = 4096 } = {}) {
    if (!Array.isArray(args) || args.length > 16 ||
        !args.every(x => Number.isInteger(x) && x >= -2147483648 && x <= 2147483647)) {
      fail('DEX_ARGS', 'Expected bounded signed 32-bit integer arguments');
    }
    if (!Number.isSafeInteger(instructionLimit) || instructionLimit < 1 || instructionLimit > 1000000) {
      fail('DEX_LIMIT', 'Invalid shared instruction budget');
    }
    const entry = this.findStatic(owner, name, signature);
    if (!(this.methodsById.get(entry).access & 0x8)) {
      fail('DEX_INSTANCE', 'Only static methods are executable from the public entrypoint');
    }
    const heap = new GuestHeap({ maxObjects });
    const budget = { remaining: instructionLimit };
    const value = this.invoke(entry, args, budget, 0, heap);
    if (this.methodInfo(entry).proto.result !== 'I' &&
        this.methodInfo(entry).proto.result !== 'V') {
      fail('DEX_REFERENCE', 'Guest references cannot escape the method-only host boundary');
    }
    return Object.freeze({ format: 'dalvik-object-subset', value,
      allocatedObjects: heap.size, consumedInstructions: instructionLimit - budget.remaining });
  }
  invoke(id, args, budget, depth, heap) {
    if (depth >= 16) fail('DEX_DEPTH', 'DEX stack depth exceeded');
    const encoded = this.methodsById.get(id);
    if (!encoded) fail('DEX_METHOD', 'Unresolved DEX method');
    if (encoded.access & 0x100) {
      if (!(encoded.access & 0x8)) fail('DEX_INSTANCE', 'Only static native methods are supported');
      const info = this.methodInfo(id);
      if (!this.nativeBoundary) fail('NATIVE_UNAVAILABLE', 'No native provider registered for guest');
      return this.nativeBoundary.call(info, args, heap);
    }
    const item = this.codeItem(id);
    const params = item.isStatic
      ? item.info.proto.params
      : [item.info.owner, ...item.info.proto.params];
    if (args.length !== params.length) fail('DEX_ARGS', 'Method argument count mismatch');
    const registers = new Int32Array(item.regs), refTags = new Uint8Array(item.regs);
    const check = index => { if (index >= registers.length) fail('DEX_REGISTER', 'Register outside frame'); };
    const getInt = index => {
      check(index);
      if (refTags[index]) fail('DEX_TYPE', 'Cannot use an object reference as int32');
      return registers[index];
    };
    const getRef = index => {
      check(index);
      if (refTags[index]) return registers[index];
      if (registers[index] === 0) return 0; // const/4 0 is null
      fail('DEX_TYPE', 'Integer is not a guest object reference');
    };
    const putInt = (index, value) => {
      check(index); registers[index] = value | 0; refTags[index] = 0;
    };
    const putRef = (index, value) => {
      check(index); registers[index] = value; refTags[index] = 1;
    };
    for (let index = 0; index < params.length; index++) {
      const dest = item.regs - params.length + index;
      const value = args[index];
      if (params[index] === 'I') putInt(dest, value);
      else {
        heap.lookup(value, params[index]);
        putRef(dest, value);
      }
    }
    let pc = 0, pending = null, pendingType = null;
    const word = p => {
      if (!Number.isInteger(p) || p < 0 || p >= item.insnsCount) fail('DEX_BRANCH', 'Instruction pointer outside code_item');
      return item.word(p);
    };
    while (true) {
      if (--budget.remaining < 0) fail('DEX_BUDGET', 'Instruction budget exhausted');
      const opWord = word(pc), op = opWord & 0xff, a = opWord >>> 8;
      const oldPc = pc++;
      if (op !== 0x0a && op !== 0x0c) { pendingType = null; pending = null; }
      switch (op) {
        case 0x01: // move vA, vB (12x)
          putInt(a & 15, getInt(a >>> 4)); break;
        case 0x07: // move-object vA,vB (12x)
          putRef(a & 15, getRef(a >>> 4)); break;
        case 0x0a: // move-result vAA
          if (pendingType !== 'I') fail('DEX_RESULT', 'int result unavailable');
          putInt(a, pending); pendingType = null; pending = null; break;
        case 0x0c: // move-result-object vAA
          if (!pendingType || !(pendingType.startsWith('L') || pendingType === '[I')) {
            fail('DEX_RESULT', 'object result unavailable');
          }
          putRef(a, pending); pendingType = null; pending = null; break;
        case 0x0e: // return-void
          if (item.info.proto.result !== 'V' || a !== 0) fail('DEX_TYPE', 'Invalid void return');
          return null;
        case 0x0f: // return vAA
          if (item.info.proto.result !== 'I') fail('DEX_TYPE', 'Return type mismatch');
          return getInt(a);
        case 0x11: // return-object vAA
          if (!item.info.proto.result.startsWith('L') && item.info.proto.result !== '[I') {
            fail('DEX_TYPE', 'Object return type mismatch');
          }
          heap.lookup(getRef(a), item.info.proto.result);
          return getRef(a);
        case 0x12: { // const/4 (11n)
          const encoded = a >>> 4;
          putInt(a & 15, encoded & 8 ? encoded - 16 : encoded); break;
        }
        case 0x13: // const/16 (21s)
          putInt(a, sign16(word(pc++))); break;
        case 0x14: { // const (31i)
          const lower = word(pc++), upper = word(pc++);
          putInt(a, (lower | upper << 16) | 0); break;
        }
        case 0x21: // array-length vA, vB (12x)
          putInt(a & 15, heap.arrayLength(getRef(a >>> 4))); break;
        case 0x23: { // new-array vA, vB, type@CCCC (22c)
          const type = this.type(word(pc++));
          if (type !== '[I') fail('DEX_ARRAY_TYPE', 'Only int[] allocation implemented');
          putRef(a & 15, heap.allocateIntArray(getInt(a >>> 4)));
          break;
        }
        case 0x44: case 0x4b: { // aget/aput vAA, vBB, vCC (23x)
          const operands = word(pc++);
          const array = getRef(operands & 255), index = getInt(operands >>> 8);
          if (op === 0x44) putInt(a, heap.getIntArray(array, index));
          else heap.setIntArray(array, index, getInt(a));
          break;
        }
        case 0x22: { // new-instance vAA, type@BBBB (21c)
          const typeIdx = word(pc++);
          const lineage = this.classLineage(typeIdx);
          if (this.classAccessFlags.get(typeIdx) & 0x400) {
            fail('DEX_CLASS', 'Cannot instantiate an abstract local class');
          }
          const fields = lineage.flatMap(index => [...this.classInstanceFields.get(index)]);
          const ancestors = lineage.slice(1).map(index => this.type(index));
          putRef(a, heap.allocate(this.type(typeIdx), fields, ancestors));
          break;
        }
        case 0x52: { // iget vA,vB, field@CCCC (22c)
          const field = this.fieldInfo(word(pc++));
          if (field.type !== 'I') fail('DEX_FIELD', 'Only int32 instance fields supported');
          putInt(a & 15, heap.readField(getRef(a >>> 4), field.owner, field.index));
          break;
        }
        case 0x59: { // iput vA,vB, field@CCCC (22c)
          const field = this.fieldInfo(word(pc++));
          if (field.type !== 'I') fail('DEX_FIELD', 'Only int32 instance fields supported');
          heap.writeField(getRef(a >>> 4), field.owner, field.index, getInt(a & 15));
          break;
        }
        case 0x28: pc = oldPc + sign8(a); break; // goto (10t)
        case 0x29: pc = oldPc + sign16(word(pc)); break; // goto/16 (20t)
        case 0x38: { // if-eqz vAA, +BBBB
          const delta = sign16(word(pc++));
          if (getInt(a) === 0) pc = oldPc + delta;
          break;
        }
        case 0x6e: case 0x70: case 0x71: { // virtual/direct/static, format 35c
          const count = a >>> 4, g = a & 15;
          const target = word(pc++), packed = word(pc++);
          if (count > 5 || count > item.outs) fail('DEX_INVOKE', 'Invalid invoke register count/outs');
          const callee = this.methodInfo(target);
          const definition = this.methodsById.get(target);
          if (!definition) fail('DEX_METHOD', 'Unresolved target method');
          if (op === 0x71 ? !(definition.access & 8) : (definition.access & 8)) {
            fail('DEX_INVOKE', 'Static versus instance invoke mismatch');
          }
          if (op === 0x70 &&
              (callee.name !== '<init>' || !this.directMethodIds.has(target))) {
            fail('DEX_INVOKE', 'Only local direct constructors supported');
          }
          if (op === 0x6e &&
              (callee.name === '<init>' || !this.virtualMethodIds.has(target))) {
            fail('DEX_INVOKE', 'Virtual target must be declared as virtual');
          }
          const indices = [packed & 15, (packed >>> 4) & 15,
            (packed >>> 8) & 15, (packed >>> 12) & 15, g];
          const types = op === 0x71 ? callee.proto.params : [callee.owner, ...callee.proto.params];
          if (types.length !== count) fail('DEX_INVOKE', 'Wrong Dalvik invoke arity');
          const values = indices.slice(0, count).map((r, i) =>
            types[i] === 'I' ? getInt(r) : getRef(r));
          let destination = target;
          if (op === 0x6e) {
            heap.requireInitialized(values[0], callee.owner);
            const receiver = heap.lookup(values[0], callee.owner);
            const receiverIdx = this.classIndicesByName.get(receiver.type);
            const ownerIdx = this.classIndicesByName.get(callee.owner);
            if (receiverIdx === undefined || ownerIdx === undefined) {
              fail('DEX_CLASS', 'Virtual receiver not declared locally');
            }
            // Resolve from the real receiver class through its local parents.
            for (const cls of this.classLineage(receiverIdx)) {
              const override = this.classVirtualMethods.get(cls).get(virtualKey(callee));
              if (override !== undefined) { destination = override; break; }
              if (cls === ownerIdx) break;
            }
          }
          if (op === 0x70) {
            const receiver = heap.lookup(values[0], callee.owner);
            if (receiver.type !== callee.owner) {
              const current = this.classIndicesByName.get(item.info.owner);
              const parent = this.classIndicesByName.get(callee.owner);
              // Only a child's constructor may invoke its direct parent
              // constructor on its own receiver.
              if (item.info.name !== '<init>' || item.isStatic ||
                  values[0] !== args[0] ||
                  this.classSuperclasses.get(current) !== parent) {
                fail('DEX_INIT', 'Superclass constructor requires direct child initializer');
              }
            }
            const index = this.classIndicesByName.get(callee.owner);
            const superIdx = this.classSuperclasses.get(index);
            heap.enterConstructor(values[0], callee.owner,
              superIdx === 0xffffffff ? null : this.type(superIdx));
          }
          const result = this.invoke(destination, values, budget, depth + 1, heap);
          if (op === 0x70) heap.leaveConstructor(values[0], callee.owner);
          if (callee.proto.result !== 'V') {
            pending = result;
            pendingType = callee.proto.result;
          }
          break;
        }
        case 0x90: case 0x91: case 0x92: { // add/sub/mul-int vAA, vBB, vCC (23x)
          const other = word(pc++);
          const left = getInt(other & 255), right = getInt(other >>> 8);
          putInt(a, op === 0x90 ? left + right : op === 0x91 ? left - right : Math.imul(left, right));
          break;
        }
        case 0xd8: { // add-int/lit8 vAA, vBB, #+CC (22b)
          const bc = word(pc++);
          putInt(a, getInt(bc & 255) + sign8(bc >>> 8)); break;
        }
        default:
          fail('DEX_OPCODE', 'Unimplemented Dalvik opcode 0x' + op.toString(16).padStart(2, '0'));
      }
    }
  }
}
