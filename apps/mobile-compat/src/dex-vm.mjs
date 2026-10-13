// Strictly bounded Dalvik *instruction subset* for independently verifiable
// static integer methods. Not ART, class initialization, JNI, or Android UI.
import { inspectDex } from './formats.mjs';
import { PackageError } from './zip.mjs';

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
    this.methods = section(bytes, 88, 92, 8, 65535);
    this.classes = section(bytes, 96, 100, 32, MAX_CLASSES);
    this.methodsById = new Map();
    this.methodInfos = new Map();
    this.stringCache = new Map();
    for (let i = 0; i < this.classes.count; i++) {
      const classOffset = this.classes.off + i * 32;
      const classIdx = u32(bytes, classOffset);
      if (classIdx >= this.types.count) fail('DEX_INDEX', 'Invalid class definition type');
      const classDataOffset = u32(bytes, classOffset + 24);
      if (classDataOffset) this.readClassData(classIdx, classDataOffset);
    }
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
        const [, pos] = leb(this.bytes, p); p = pos;
        if (field > 65535) fail('DEX_INDEX', 'Invalid field index');
      }
    }
    let method = 0;
    for (const count of methods) {
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
    if (!(encoded.access & 0x8)) fail('DEX_INSTANCE', 'Only static methods are supported');
    if (encoded.access & 0x100) fail('NATIVE_UNAVAILABLE', 'JNI native method has no authorized implementation');
    if ((encoded.access & 0x400) || !encoded.codeOff) fail('DEX_METHOD', 'Abstract or missing code item');
    if (!info.proto.params.every(x => x === 'I') || !['I', 'V'].includes(info.proto.result)) {
      fail('DEX_TYPE', 'Only int/void method signatures are supported');
    }
    const offset = encoded.codeOff;
    if (offset % 4 !== 0) fail('DEX_SECTION', 'Unaligned DEX code item');
    requireRange(this.bytes, offset, 16, 'Code item missing');
    const regs = u16(this.bytes, offset);
    const ins = u16(this.bytes, offset + 2);
    const outs = u16(this.bytes, offset + 4);
    const tries = u16(this.bytes, offset + 6);
    const insnsCount = u32(this.bytes, offset + 12);
    if (regs > 256 || ins !== info.proto.params.length || regs < ins ||
        outs > 16 || tries || insnsCount === 0 || insnsCount > MAX_INSNS) {
      fail('DEX_CODE', 'Unsupported or invalid code_item bounds');
    }
    requireRange(this.bytes, offset + 16, insnsCount * 2, 'Truncated DEX instructions');
    const item = { info, regs, outs, insnsCount,
      word: p => u16(this.bytes, offset + 16 + p * 2) };
    // Verify the complete instruction stream before interpreting even one
    // code unit. Branches may only land on actual opcode boundaries, never
    // inside a const/invoke payload or in the middle of an instruction.
    const sizeByOpcode = new Map([
      [0x01, 1], [0x0a, 1], [0x0e, 1], [0x0f, 1],
      [0x12, 1], [0x13, 2], [0x14, 3],
      [0x28, 1], [0x29, 2], [0x38, 2],
      [0x71, 3], [0x90, 2], [0x91, 2], [0x92, 2], [0xd8, 2],
    ]);
    const starts = new Set(), targets = [];
    let previous = -1;
    for (let p = 0; p < insnsCount;) {
      const w = item.word(p), opcode = w & 255;
      const size = sizeByOpcode.get(opcode);
      if (!size) fail('DEX_OPCODE', 'Instruction unsupported in verified method');
      if (p + size > insnsCount) fail('DEX_CODE', 'Instruction extends beyond code item');
      starts.add(p);
      if (opcode === 0x0a && previous !== 0x71) {
        fail('DEX_RESULT', 'move-result must directly follow invoke-static');
      }
      if (opcode === 0x28) targets.push(p + sign8(w >>> 8));
      if (opcode === 0x29 || opcode === 0x38) targets.push(p + sign16(item.word(p + 1)));
      previous = opcode;
      p += size;
    }
    for (const destination of targets) {
      if (!starts.has(destination)) fail('DEX_BRANCH', 'Branch into non-instruction or outside code');
    }
    return item;
  }
  execute(owner, name, args, { instructionLimit = 10000, signature } = {}) {
    if (!Array.isArray(args) || args.length > 16 ||
        !args.every(x => Number.isInteger(x) && x >= -2147483648 && x <= 2147483647)) {
      fail('DEX_ARGS', 'Expected bounded signed 32-bit integer arguments');
    }
    if (!Number.isSafeInteger(instructionLimit) || instructionLimit < 1 || instructionLimit > 1000000) {
      fail('DEX_LIMIT', 'Invalid shared instruction budget');
    }
    const entry = this.findStatic(owner, name, signature);
    const budget = { remaining: instructionLimit };
    const value = this.invoke(entry, args, budget, 0);
    return Object.freeze({ format: 'dalvik-integer-subset', value, consumedInstructions: instructionLimit - budget.remaining });
  }
  invoke(id, args, budget, depth) {
    if (depth >= 16) fail('DEX_DEPTH', 'DEX stack depth exceeded');
    const encoded = this.methodsById.get(id);
    if (!encoded) fail('DEX_METHOD', 'Unresolved DEX method');
    if (encoded.access & 0x100) {
      if (!(encoded.access & 0x8)) fail('DEX_INSTANCE', 'Only static native methods are supported');
      const info = this.methodInfo(id);
      if (!this.nativeBoundary) fail('NATIVE_UNAVAILABLE', 'No native provider registered for guest');
      return this.nativeBoundary.call(info, args);
    }
    const item = this.codeItem(id);
    if (args.length !== item.info.proto.params.length) fail('DEX_ARGS', 'Wrong number of method arguments');
    const registers = new Int32Array(item.regs);
    registers.set(args, item.regs - args.length);
    let pc = 0, pending = null, hasPending = false;
    const word = p => {
      if (!Number.isInteger(p) || p < 0 || p >= item.insnsCount) fail('DEX_BRANCH', 'Instruction pointer outside code_item');
      return item.word(p);
    };
    const get = i => { if (i >= registers.length) fail('DEX_REGISTER', 'Register read outside frame'); return registers[i]; };
    const put = (i, value) => { if (i >= registers.length) fail('DEX_REGISTER', 'Register write outside frame'); registers[i] = value | 0; };
    while (true) {
      if (--budget.remaining < 0) fail('DEX_BUDGET', 'Instruction budget exhausted');
      const opWord = word(pc), op = opWord & 0xff, a = opWord >>> 8;
      const oldPc = pc++;
      if (op !== 0x0a) { hasPending = false; pending = null; }
      switch (op) {
        case 0x01: // move vA, vB (12x)
          put(a & 15, get(a >>> 4)); break;
        case 0x0a: // move-result vAA
          if (!hasPending) fail('DEX_RESULT', 'move-result without immediately preceding invoke');
          put(a, pending); hasPending = false; pending = null; break;
        case 0x0e: // return-void
          if (item.info.proto.result !== 'V' || a !== 0) fail('DEX_TYPE', 'Invalid void return');
          return null;
        case 0x0f: // return vAA
          if (item.info.proto.result !== 'I') fail('DEX_TYPE', 'Return type mismatch');
          return get(a);
        case 0x12: { // const/4 (11n)
          const encoded = a >>> 4;
          put(a & 15, encoded & 8 ? encoded - 16 : encoded); break;
        }
        case 0x13: // const/16 (21s)
          put(a, sign16(word(pc++))); break;
        case 0x14: { // const (31i)
          const lower = word(pc++), upper = word(pc++);
          put(a, (lower | upper << 16) | 0); break;
        }
        case 0x28: pc = oldPc + sign8(a); break; // goto (10t)
        case 0x29: pc = oldPc + sign16(word(pc)); break; // goto/16 (20t)
        case 0x38: { // if-eqz vAA, +BBBB
          const delta = sign16(word(pc++));
          if (get(a) === 0) pc = oldPc + delta;
          break;
        }
        case 0x71: { // invoke-static {registers}, method@BBBB (35c)
          const count = a >>> 4, g = a & 15;
          const target = word(pc++), packed = word(pc++);
          if (count > 5 || count > item.outs) fail('DEX_INVOKE', 'Invalid invoke-static registers/outs');
          const indices = [packed & 15, (packed >>> 4) & 15,
            (packed >>> 8) & 15, (packed >>> 12) & 15, g];
          const values = indices.slice(0, count).map(get);
          const result = this.invoke(target, values, budget, depth + 1);
          if (this.methodInfo(target).proto.result === 'I') {
            pending = result; hasPending = true;
          }
          break;
        }
        case 0x90: case 0x91: case 0x92: { // add/sub/mul-int vAA, vBB, vCC (23x)
          const other = word(pc++);
          const left = get(other & 255), right = get(other >>> 8);
          put(a, op === 0x90 ? left + right : op === 0x91 ? left - right : Math.imul(left, right));
          break;
        }
        case 0xd8: { // add-int/lit8 vAA, vBB, #+CC (22b)
          const bc = word(pc++);
          put(a, get(bc & 255) + sign8(bc >>> 8)); break;
        }
        default:
          fail('DEX_OPCODE', 'Unimplemented Dalvik opcode 0x' + op.toString(16).padStart(2, '0'));
      }
    }
  }
}
