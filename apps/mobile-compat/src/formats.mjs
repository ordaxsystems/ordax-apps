// Parse executable formats; detection is not execution.
import { createHash } from 'node:crypto';
import { PackageError } from './zip.mjs';
function requireBytes(buffer, minimum, description) {
  if (!Buffer.isBuffer(buffer) || buffer.length < minimum) throw new PackageError('FORMAT', description + ' is truncated');
}
export function inspectDex(buffer) {
  requireBytes(buffer, 112, 'DEX header');
  const version = buffer.toString('ascii', 4, 7);
  if (buffer.toString('ascii', 0, 4) !== 'dex\n' || buffer[7] !== 0 || !/^[0-9]{3}$/.test(version)) {
    throw new PackageError('DEX', 'Invalid DEX magic');
  }
  const size = buffer.readUInt32LE(32);
  const header = buffer.readUInt32LE(36);
  const endian = buffer.readUInt32LE(40);
  if (size !== buffer.length || header !== 112 || endian !== 0x12345678) {
    throw new PackageError('DEX', 'Invalid DEX size, header or endianness');
  }
  const signature = createHash('sha1').update(buffer.subarray(32)).digest();
  if (!signature.equals(buffer.subarray(12, 32))) {
    throw new PackageError('DEX', 'DEX SHA-1 signature mismatch');
  }
  let s1 = 1, s2 = 0;
  for (let i = 12; i < buffer.length; ++i) {
    s1 = (s1 + buffer[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  if (((s2 << 16) | s1) >>> 0 !== buffer.readUInt32LE(8)) {
    throw new PackageError('DEX', 'DEX Adler32 checksum mismatch');
  }
  return Object.freeze({ format: 'dex', version, bytes: size, stringIds: buffer.readUInt32LE(56), typeIds: buffer.readUInt32LE(64), methodIds: buffer.readUInt32LE(88), classDefs: buffer.readUInt32LE(96) });
}
export function inspectElf(buffer) {
  requireBytes(buffer, 64, 'ELF header');
  if (buffer.readUInt32BE(0) !== 0x7f454c46) throw new PackageError('ELF', 'Invalid ELF magic');
  if (buffer[4] !== 2 || buffer[5] !== 1 || buffer[6] !== 1) throw new PackageError('ELF', 'Requires little-endian ELF64');
  const machine = buffer.readUInt16LE(18);
  if (machine !== 183 && machine !== 62) throw new PackageError('ELF', 'Unsupported ELF machine');
  const programOffset = buffer.readBigUInt64LE(32);
  const sectionOffset = buffer.readBigUInt64LE(40);
  const programEntrySize = buffer.readUInt16LE(54);
  const programCount = buffer.readUInt16LE(56);
  if (programOffset > BigInt(buffer.length) || programOffset + BigInt(programEntrySize) * BigInt(programCount) > BigInt(buffer.length)) {
    throw new PackageError('ELF', 'ELF program headers out of bounds');
  }
  return Object.freeze({ format: 'elf64', abi: machine === 183 ? 'arm64-v8a' : 'x86_64', bytes: buffer.length, programHeaders: programCount, sectionTablePresent: sectionOffset !== 0n });
}

/**
 * Locate declared class definitions inside a checksum-verified DEX image.
 * Metadata-only: does not initialize classes, interpret methods or replace DexSubset.
 */
export function locateDexClassDefinitions(buffer, descriptors) {
  inspectDex(buffer);
  if (!Array.isArray(descriptors) || descriptors.length > 16 ||
      !descriptors.every(x => typeof x === 'string' &&
        /^L[A-Za-z0-9_/$]+;$/.test(x) && x.length <= 512)) {
    throw new PackageError('DEX_TYPE', 'Invalid bounded class descriptor request');
  }
  const u32 = at => {
    if (at < 0 || at > buffer.length - 4) {
      throw new PackageError('DEX_INDEX', 'DEX index outside verified image');
    }
    return buffer.readUInt32LE(at);
  };
  const stringsCount = u32(56), stringsOff = u32(60);
  const typesCount = u32(64), typesOff = u32(68);
  const classesCount = u32(96), classesOff = u32(100);
  if (stringsCount > 1000000 || typesCount > 65535 || classesCount > 65535 ||
      stringsOff > buffer.length || stringsCount * 4 > buffer.length - stringsOff ||
      typesOff > buffer.length || typesCount * 4 > buffer.length - typesOff ||
      classesOff > buffer.length || classesCount * 32 > buffer.length - classesOff) {
    throw new PackageError('DEX_INDEX', 'DEX class index table exceeds image bounds');
  }
  const wanted = new Set(descriptors);
  const found = new Set();
  for (let i = 0; i < classesCount && found.size < wanted.size; i++) {
    const typeIndex = u32(classesOff + i * 32);
    if (typeIndex >= typesCount) throw new PackageError('DEX_INDEX', 'Invalid class type index');
    const stringIndex = u32(typesOff + typeIndex * 4);
    if (stringIndex >= stringsCount) throw new PackageError('DEX_INDEX', 'Invalid class string index');
    let p = u32(stringsOff + stringIndex * 4);
    // Skip bounded ULEB128 MUTF-8 UTF-16 length prefix.
    let terminated = false;
    for (let j = 0; j < 5; j++) {
      if (p >= buffer.length) throw new PackageError('DEX_INDEX', 'Truncated class descriptor');
      const octet = buffer[p++];
      if (!(octet & 0x80)) { terminated = true; break; }
    }
    if (!terminated) throw new PackageError('DEX_INDEX', 'Invalid class string length');
    const end = buffer.indexOf(0, p);
    if (end < 0 || end - p > 512) {
      throw new PackageError('DEX_INDEX', 'Missing or oversized class descriptor');
    }
    const name = buffer.toString('utf8', p, end);
    if (wanted.has(name)) found.add(name);
  }
  return found;
}
