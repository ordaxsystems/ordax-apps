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
