const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;
const ZIP64_EOCD = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EXTRA = 0x0001;
const UINT32_MAX = 0xffffffff;
const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  crcTable[index] = value >>> 0;
}

export function normalizeZipPath(path) {
  const parts = [];
  for (const part of String(path).replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return "";
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

export function crc32(bytes, seed = 0xffffffff) {
  let value = seed >>> 0;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function asBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("O contêiner ZIP precisa ser um ArrayBuffer ou uma visão de bytes.");
}

function findEndOfCentralDirectory(view) {
  const start = Math.max(0, view.byteLength - 22 - 65_535);
  for (let offset = view.byteLength - 22; offset >= start; offset--) {
    if (view.getUint32(offset, true) !== ZIP_EOCD) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === view.byteLength) return offset;
  }
  throw new Error("O contêiner ZIP está incompleto ou inválido.");
}

function readUInt64(view, offset, label) {
  const low = view.getUint32(offset, true), high = view.getUint32(offset + 4, true);
  if (high > 0x1fffff) throw new Error(`O ${label} excede os limites de leitura desta versão.`);
  return high * 0x100000000 + low;
}

function readZip64Directory(view, end) {
  const classic = {
    disk: view.getUint16(end + 4, true),
    directoryDisk: view.getUint16(end + 6, true),
    diskCount: view.getUint16(end + 8, true),
    count: view.getUint16(end + 10, true),
    size: view.getUint32(end + 12, true),
    offset: view.getUint32(end + 16, true),
  };
  const locatorOffset = end - 20;
  const hasLocator = locatorOffset >= 0 && view.getUint32(locatorOffset, true) === ZIP64_LOCATOR;
  if (!hasLocator) {
    if (classic.disk !== 0 || classic.directoryDisk !== 0 || classic.diskCount !== classic.count
      || classic.count === 0xffff || classic.size === UINT32_MAX || classic.offset === UINT32_MAX) {
      throw new Error("O arquivo ZIP usa metadados ZIP64 incompletos ou incompatíveis.");
    }
    return { count: classic.count, size: classic.size, offset: classic.offset, end };
  }

  if (view.getUint32(locatorOffset + 4, true) !== 0 || view.getUint32(locatorOffset + 16, true) !== 1) {
    throw new Error("O arquivo ZIP64 dividido em vários discos não é suportado.");
  }
  const zip64Offset = readUInt64(view, locatorOffset + 8, "índice ZIP64");
  if (zip64Offset + 56 > locatorOffset || view.getUint32(zip64Offset, true) !== ZIP64_EOCD) {
    throw new Error("O registro central ZIP64 está incompleto ou inválido.");
  }
  const recordSize = readUInt64(view, zip64Offset + 4, "registro ZIP64");
  if (recordSize < 44 || zip64Offset + 12 + recordSize !== locatorOffset) {
    throw new Error("O tamanho do registro central ZIP64 não confere.");
  }
  const disk = view.getUint32(zip64Offset + 16, true), directoryDisk = view.getUint32(zip64Offset + 20, true);
  const diskCount = readUInt64(view, zip64Offset + 24, "contagem ZIP64"), count = readUInt64(view, zip64Offset + 32, "contagem ZIP64");
  const size = readUInt64(view, zip64Offset + 40, "diretório ZIP64"), offset = readUInt64(view, zip64Offset + 48, "diretório ZIP64");
  if (disk !== 0 || directoryDisk !== 0 || diskCount !== count
    || (classic.diskCount !== 0xffff && classic.diskCount !== diskCount)
    || (classic.count !== 0xffff && classic.count !== count)
    || (classic.size !== UINT32_MAX && classic.size !== size)
    || (classic.offset !== UINT32_MAX && classic.offset !== offset)) {
    throw new Error("Os metadados clássicos e ZIP64 do arquivo não correspondem.");
  }
  return { count, size, offset, end: zip64Offset };
}

function readZip64Extra(view, start, length, needs, label) {
  const result = {};
  let offset = start, end = start + length, zip64 = null;
  while (offset + 4 <= end) {
    const id = view.getUint16(offset, true), size = view.getUint16(offset + 2, true), data = offset + 4;
    if (data + size > end) throw new Error(`Os metadados extras do ${label} estão truncados.`);
    if (id === ZIP64_EXTRA) {
      if (zip64) throw new Error(`O ${label} contém metadados ZIP64 duplicados.`);
      zip64 = { offset: data, end: data + size };
    }
    offset = data + size;
  }
  if (offset !== end) throw new Error(`Os metadados extras do ${label} estão incompletos.`);
  const fields = ["uncompressedSize", "compressedSize", "localOffset", "startDisk"];
  if (fields.some(field => needs[field]) && !zip64) throw new Error(`Faltam metadados ZIP64 em ${label}.`);
  let cursor = zip64?.offset ?? 0;
  for (const field of fields) {
    if (!needs[field]) continue;
    const width = field === "startDisk" ? 4 : 8;
    if (cursor + width > zip64.end) throw new Error(`Os metadados ZIP64 de ${label} estão truncados.`);
    result[field] = width === 4 ? view.getUint32(cursor, true) : readUInt64(view, cursor, label);
    cursor += width;
  }
  return result;
}

export function readZipDirectory(source, { maxEntries = 10_000, maxEntryBytes = 50 * 1024 * 1024, label = "arquivo ZIP" } = {}) {
  const bytes = asBytes(source), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), end = findEndOfCentralDirectory(view);
  const { count, size: directorySize, offset: directoryOffset, end: directoryEnd } = readZip64Directory(view, end);
  if (count > maxEntries || directoryOffset + directorySize !== directoryEnd) {
    throw new Error(`O ${label} usa um formato ZIP que esta versão não suporta.`);
  }

  const entries = new Map();
  let offset = directoryOffset;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > directoryEnd || view.getUint32(offset, true) !== ZIP_CENTRAL) throw new Error(`O índice interno do ${label} está inválido.`);
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const rawCompressedSize = view.getUint32(offset + 20, true), rawUncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true);
    const rawStartDisk = view.getUint16(offset + 34, true), rawLocalOffset = view.getUint32(offset + 42, true);
    const recordEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > directoryEnd || flags & 1) {
      throw new Error(`O ${label} contém um recurso fora dos limites suportados.`);
    }
    const extraStart = offset + 46 + nameLength;
    const zip64 = readZip64Extra(view, extraStart, extraLength, {
      uncompressedSize: rawUncompressedSize === UINT32_MAX,
      compressedSize: rawCompressedSize === UINT32_MAX,
      localOffset: rawLocalOffset === UINT32_MAX,
      startDisk: rawStartDisk === 0xffff,
    }, label);
    const compressedSize = rawCompressedSize === UINT32_MAX ? zip64.compressedSize : rawCompressedSize;
    const uncompressedSize = rawUncompressedSize === UINT32_MAX ? zip64.uncompressedSize : rawUncompressedSize;
    const localOffset = rawLocalOffset === UINT32_MAX ? zip64.localOffset : rawLocalOffset;
    const startDisk = rawStartDisk === 0xffff ? zip64.startDisk : rawStartDisk;
    if (startDisk !== 0 || uncompressedSize > maxEntryBytes || compressedSize > bytes.byteLength || localOffset >= directoryOffset) {
      throw new Error(`O ${label} contém um recurso fora dos limites suportados.`);
    }
    const rawName = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes.buffer, bytes.byteOffset + offset + 46, nameLength));
    const filename = normalizeZipPath(rawName);
    if (!filename || filename.toLowerCase() === "") throw new Error(`O ${label} contém um caminho interno inválido.`);
    const key = filename.toLowerCase();
    if (entries.has(key)) throw new Error(`O ${label} contém caminhos internos duplicados.`);
    entries.set(key, { filename, rawName, flags, method, crc, compressedSize, uncompressedSize, localOffset, directoryOffset });
    offset = recordEnd;
  }
  if (offset !== directoryEnd) throw new Error(`O índice interno do ${label} contém dados inesperados.`);
  return entries;
}

async function inflateRawBounded(compressed, expectedSize, label) {
  if (typeof DecompressionStream !== "function") throw new Error("O navegador não oferece o descompactador necessário para este arquivo.");
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader(), chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > expectedSize) {
        await reader.cancel();
        throw new Error(`O tamanho descompactado do ${label} excede o declarado.`);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (total !== expectedSize) throw new Error(`O tamanho descompactado do ${label} não confere.`);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

export async function readZipEntry(source, entry, { label = "arquivo ZIP" } = {}) {
  const bytes = asBytes(source), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset = entry.localOffset;
  if (offset + 30 > entry.directoryOffset || view.getUint32(offset, true) !== ZIP_LOCAL) throw new Error(`Um recurso interno do ${label} está inválido.`);
  const localFlags = view.getUint16(offset + 6, true), localMethod = view.getUint16(offset + 8, true);
  const localNameLength = view.getUint16(offset + 26, true), extraLength = view.getUint16(offset + 28, true);
  const headerEnd = offset + 30 + localNameLength + extraLength;
  const start = headerEnd, end = start + entry.compressedSize;
  if (headerEnd > entry.directoryOffset || localFlags !== entry.flags || localMethod !== entry.method || end > entry.directoryOffset) throw new Error(`Um recurso interno do ${label} está truncado ou inconsistente.`);
  const localName = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes.buffer, bytes.byteOffset + offset + 30, localNameLength));
  if (normalizeZipPath(localName).toLowerCase() !== entry.filename.toLowerCase()) throw new Error(`O nome de um recurso interno do ${label} não confere.`);
  if (!(entry.flags & 0x08) && (view.getUint32(offset + 14, true) !== entry.crc
    || (view.getUint32(offset + 18, true) !== UINT32_MAX && view.getUint32(offset + 18, true) !== entry.compressedSize)
    || (view.getUint32(offset + 22, true) !== UINT32_MAX && view.getUint32(offset + 22, true) !== entry.uncompressedSize))) {
    throw new Error(`O cabeçalho de um recurso interno do ${label} não confere.`);
  }
  if (!(entry.flags & 0x08) && (view.getUint32(offset + 18, true) === UINT32_MAX || view.getUint32(offset + 22, true) === UINT32_MAX)) {
    const localExtraStart = offset + 30 + localNameLength;
    const zip64 = readZip64Extra(view, localExtraStart, extraLength, {
      uncompressedSize: view.getUint32(offset + 22, true) === UINT32_MAX,
      compressedSize: view.getUint32(offset + 18, true) === UINT32_MAX,
      localOffset: false,
      startDisk: false,
    }, label);
    if ((zip64.compressedSize ?? entry.compressedSize) !== entry.compressedSize
      || (zip64.uncompressedSize ?? entry.uncompressedSize) !== entry.uncompressedSize) {
      throw new Error(`Os tamanhos ZIP64 de um recurso interno do ${label} não conferem.`);
    }
  }

  const compressed = new Uint8Array(bytes.buffer, bytes.byteOffset + start, entry.compressedSize);
  let output;
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) throw new Error(`O tamanho do recurso interno do ${label} não confere.`);
    output = compressed;
  } else if (entry.method === 8) {
    try { output = await inflateRawBounded(compressed, entry.uncompressedSize, label); }
    catch (error) { throw new Error(`Não consegui descompactar o ${label}: ${error.message}`); }
  } else throw new Error(`O ${label} usa um método de compactação não suportado.`);
  if (crc32(output) !== entry.crc) throw new Error(`A verificação de integridade de um recurso do ${label} falhou (CRC32).`);
  return output;
}

async function crc32Blob(blob) {
  let value = 0xffffffff;
  const reader = blob.stream().getReader();
  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      for (const byte of chunk) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
    }
  } finally { reader.releaseLock(); }
  return (value ^ 0xffffffff) >>> 0;
}

function asBlob(data) {
  if (data instanceof Blob) return data;
  if (data instanceof Uint8Array || data instanceof ArrayBuffer) return new Blob([data]);
  throw new TypeError("Cada recurso ZIP precisa ser um Blob ou bytes.");
}

export async function createStoredZipBlob(sourceEntries, { type = "application/zip" } = {}) {
  if (!Array.isArray(sourceEntries) || !sourceEntries.length || sourceEntries.length > 100) throw new TypeError("A lista de recursos ZIP é inválida.");
  const encoder = new TextEncoder(), entries = [], names = new Set();
  let offset = 0;
  for (const sourceEntry of sourceEntries) {
    const name = String(sourceEntry?.name || "");
    if (!name || normalizeZipPath(name) !== name || name.startsWith("/") || name.includes(":") || name.split("/").some(part => part === "..")) {
      throw new Error("O pacote contém um caminho de arquivo inválido.");
    }
    const key = name.toLowerCase();
    if (names.has(key)) throw new Error("O pacote contém nomes de arquivo duplicados.");
    names.add(key);
    const nameBytes = encoder.encode(name), data = asBlob(sourceEntry.data);
    if (nameBytes.byteLength > 65_535 || data.size > UINT32_MAX || offset > UINT32_MAX) throw new Error("O recurso ZIP excede o limite desta versão.");
    const entry = { name, nameBytes, data, crc: await crc32Blob(data), offset, size: data.size };
    entries.push(entry);
    offset += 30 + nameBytes.byteLength + data.size;
    if (offset > UINT32_MAX) throw new Error("O pacote excede o limite ZIP desta versão.");
  }

  const parts = [];
  for (const entry of entries) {
    const header = new Uint8Array(30), view = new DataView(header.buffer);
    view.setUint32(0, ZIP_LOCAL, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true); view.setUint16(10, 0, true); view.setUint16(12, 0x21, true);
    view.setUint32(14, entry.crc, true); view.setUint32(18, entry.size, true); view.setUint32(22, entry.size, true);
    view.setUint16(26, entry.nameBytes.byteLength, true); view.setUint16(28, 0, true);
    parts.push(header, entry.nameBytes, entry.data);
  }

  const directoryOffset = offset, centralParts = [];
  for (const entry of entries) {
    const header = new Uint8Array(46), view = new DataView(header.buffer);
    view.setUint32(0, ZIP_CENTRAL, true); view.setUint16(4, 20, true); view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true); view.setUint16(10, 0, true); view.setUint16(12, 0, true); view.setUint16(14, 0x21, true);
    view.setUint32(16, entry.crc, true); view.setUint32(20, entry.size, true); view.setUint32(24, entry.size, true);
    view.setUint16(28, entry.nameBytes.byteLength, true); view.setUint16(30, 0, true); view.setUint16(32, 0, true);
    view.setUint16(34, 0, true); view.setUint16(36, 0, true); view.setUint32(38, 0, true); view.setUint32(42, entry.offset, true);
    centralParts.push(header, entry.nameBytes);
  }
  const directorySize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  if (directoryOffset + directorySize + 22 > UINT32_MAX) throw new Error("O pacote excede o limite ZIP desta versão.");
  const end = new Uint8Array(22), endView = new DataView(end.buffer);
  endView.setUint32(0, ZIP_EOCD, true); endView.setUint16(4, 0, true); endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true); endView.setUint16(10, entries.length, true);
  endView.setUint32(12, directorySize, true); endView.setUint32(16, directoryOffset, true); endView.setUint16(20, 0, true);
  return new Blob([...parts, ...centralParts, end], { type });
}
