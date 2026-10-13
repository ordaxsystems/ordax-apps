// Safe, bounded ZIP reader for untrusted APK/XAPK containers.
// No extraction to filesystem, no script execution, no permissive fallback.
import { open } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

const MAX_ARCHIVE = 512 * 1024 * 1024;
const MAX_ENTRY = 256 * 1024 * 1024;
const MAX_ENTRIES = 10000;
const MAX_TOTAL = 1024 * 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });

export class PackageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PackageError';
    this.code = code;
  }
}
function need(condition, code, message) {
  if (!condition) throw new PackageError(code, message);
}
function u16(buf, offset) { need(offset + 2 <= buf.length, 'TRUNCATED', 'ZIP field truncated'); return buf.readUInt16LE(offset); }
function u32(buf, offset) { need(offset + 4 <= buf.length, 'TRUNCATED', 'ZIP field truncated'); return buf.readUInt32LE(offset); }
function checkName(name) {
  need(name.length > 0 && name.length <= 512, 'PATH', 'Invalid entry name length');
  need(!/[\u0000-\u001f\\]/u.test(name), 'PATH', 'Entry contains control or backslash');
  need(!name.startsWith('/') && !/^[A-Za-z]:/u.test(name), 'PATH', 'Entry uses absolute path');
  need(!name.split('/').some(part => part === '..' || part === '.' || part === '' && name !== name.replace(/\/$/, '')), 'PATH', 'Entry contains traversal or empty component');
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function directory(buffer, archiveSize) {
  const begin = Math.max(0, buffer.length - 65557);
  let eocd = -1;
  for (let pos = buffer.length - 22; pos >= begin; --pos) {
    if (u32(buffer, pos) === 0x06054b50 && pos + 22 + u16(buffer, pos + 20) === buffer.length) {
      eocd = pos;
      break;
    }
  }
  need(eocd >= 0, 'DIRECTORY', 'ZIP central directory missing');
  need(u16(buffer, eocd + 4) === 0 && u16(buffer, eocd + 6) === 0, 'MULTIDISK', 'Multidisk ZIP unsupported');
  const count = u16(buffer, eocd + 10);
  const bytes = u32(buffer, eocd + 12);
  const offset = u32(buffer, eocd + 16);
  need(count !== 0xffff && bytes !== 0xffffffff && offset !== 0xffffffff, 'ZIP64', 'ZIP64 requires a separate validated implementation');
  need(count <= MAX_ENTRIES && offset + bytes <= archiveSize && offset + bytes <= archiveSize - (buffer.length - eocd), 'BOUNDS', 'Directory outside archive');
  return { count, offset, bytes };
}
async function readExact(fh, position, length) {
  const b = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await fh.read(b, done, length - done, position + done);
    need(bytesRead > 0, 'TRUNCATED', 'Unexpected end of archive');
    done += bytesRead;
  }
  return b;
}
function readDirectory(central, count, archiveSize) {
  const map = new Map();
  let cursor = 0, total = 0;
  for (let index = 0; index < count; ++index) {
    need(u32(central, cursor) === 0x02014b50, 'DIRECTORY', 'Invalid central entry signature');
    const flags = u16(central, cursor + 8);
    const method = u16(central, cursor + 10);
    const crc = u32(central, cursor + 16);
    const compressed = u32(central, cursor + 20);
    const size = u32(central, cursor + 24);
    const nameLength = u16(central, cursor + 28);
    const extraLength = u16(central, cursor + 30);
    const commentLength = u16(central, cursor + 32);
    const ext = u32(central, cursor + 38);
    const localOffset = u32(central, cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    need(end <= central.length, 'DIRECTORY', 'Truncated central entry');
    need(!(flags & 1), 'ENCRYPTION', 'Encrypted entries unsupported');
    need(!(flags & 0x40), 'ENCRYPTION', 'Strong encryption unsupported');
    need(method === 0 || method === 8, 'COMPRESSION', 'Unsupported compression method');
    need(size <= MAX_ENTRY && compressed <= MAX_ARCHIVE, 'LIMIT', 'Entry exceeds limits');
    need(compressed !== 0xffffffff && size !== 0xffffffff && localOffset !== 0xffffffff, 'ZIP64', 'ZIP64 entry unsupported');
    need(localOffset < archiveSize, 'BOUNDS', 'Local header outside archive');
    const name = utf8.decode(central.subarray(cursor + 46, cursor + 46 + nameLength));
    checkName(name);
    const unixMode = (ext >>> 16) & 0xffff;
    need((unixMode & 0xf000) !== 0xa000, 'SYMLINK', 'Symbolic link entry prohibited');
    need(!map.has(name), 'DUPLICATE', 'Duplicate ZIP entry');
    total += size;
    need(total <= MAX_TOTAL, 'LIMIT', 'Total expanded size exceeded');
    map.set(name, Object.freeze({ name, size, compressed, crc, method, flags, localOffset }));
    cursor = end;
  }
  need(cursor === central.length, 'DIRECTORY', 'Unexpected directory bytes');
  return map;
}
async function fromAccessor(size, range, release) {
  need(Number.isSafeInteger(size) && size >= 22 && size <= MAX_ARCHIVE, 'LIMIT', 'Archive size out of range');
  const tailStart = Math.max(0, size - 65557);
  const tail = await range(tailStart, size - tailStart);
  const metadata = directory(tail, size);
  const central = await range(metadata.offset, metadata.bytes);
  const entries = readDirectory(central, metadata.count, size);
  let closed = false;
  return {
    entries: Object.freeze([...entries.values()]),
    async read(name, limit = MAX_ENTRY) {
      need(!closed, 'CLOSED', 'Archive is closed');
      const entry = entries.get(name);
      need(!!entry, 'MISSING', 'ZIP entry not found');
      need(Number.isSafeInteger(limit) && limit >= 0 && entry.size <= limit, 'LIMIT', 'Entry exceeds read limit');
      const head = await range(entry.localOffset, 30);
      need(u32(head, 0) === 0x04034b50, 'HEADER', 'Invalid local header');
      const flags = u16(head, 6);
      const method = u16(head, 8);
      const nameLength = u16(head, 26);
      const extraLength = u16(head, 28);
      need(method === entry.method && (flags & 1) === 0, 'HEADER', 'Local header mismatch');
      const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
      need(dataOffset + entry.compressed <= metadata.offset, 'BOUNDS', 'Entry overlaps central directory');
      const localName = utf8.decode(await range(entry.localOffset + 30, nameLength));
      need(localName === name, 'HEADER', 'Local filename mismatch');
      const raw = await range(dataOffset, entry.compressed);
      let content;
      try {
        content = entry.method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: limit + 1 });
      } catch (error) {
        throw new PackageError('DEFLATE', 'Failed to decompress entry: ' + error.message);
      }
      need(content.length === entry.size && crc32(content) === entry.crc, 'INTEGRITY', 'Decompressed length or CRC mismatch');
      return content;
    },
    async close() {
      if (!closed) { closed = true; await release(); }
    },
  };
}
export async function openPackage(filePath) {
  const handle = await open(filePath, 'r');
  try {
    const stat = await handle.stat();
    return await fromAccessor(stat.size, (position, length) => readExact(handle, position, length), () => handle.close());
  } catch (error) {
    await handle.close();
    throw error;
  }
}
export async function packageFromBuffer(buffer) {
  need(Buffer.isBuffer(buffer), 'TYPE', 'Archive buffer required');
  return fromAccessor(buffer.length, async (position, length) => {
    need(position >= 0 && length >= 0 && position + length <= buffer.length, 'TRUNCATED', 'Buffer range invalid');
    return buffer.subarray(position, position + length);
  }, async () => {});
}
