// Read provider JSON without buffering an unbounded response in memory.
export async function readBoundedJsonResponse(response, {maxBytes, errorCode} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024 ||
      typeof errorCode !== 'string' || !/^[a-z0-9_]{1,100}$/.test(errorCode))
    throw Error('bounded_json_response_options_invalid');

  const stream = response?.body;
  if (typeof stream?.getReader !== 'function') throw Error(errorCode);
  let reader;
  try { reader = stream.getReader(); } catch { throw Error(errorCode); }

  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw Error(errorCode);
      byteLength += value.byteLength;
      if (byteLength > maxBytes) throw Error(errorCode);
      chunks.push(value);
    }

    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    return JSON.parse(text);
  } catch {
    try { await reader.cancel(); } catch { /* The body may already be closed. */ }
    throw Error(errorCode);
  } finally {
    try { reader.releaseLock(); } catch { /* A failed stream may already be released. */ }
  }
}
