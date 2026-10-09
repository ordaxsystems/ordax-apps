// Both the portable UI and development host consume this transport-neutral parser.
function readChunk(reader, signal, idleTimeoutMs) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (callback, value) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      callback(value);
    };
    const aborted = () => finish(reject, signal.reason || new Error('Streaming interrompido.'));
    if (signal?.aborted) { aborted(); return; }
    signal?.addEventListener('abort', aborted, { once: true });
    timer = setTimeout(() => finish(reject, new Error('O fluxo do host ficou sem comunicação. Confira a mesma resposta antes de enviar novamente.')), idleTimeoutMs);
    reader.read().then(value => finish(resolve, value), error => finish(reject, error));
  });
}

export async function* readSSE(body, { signal, idleTimeoutMs = 60000 } = {}) {
  if (!body?.getReader) throw new Error('O host não retornou um fluxo de resposta.');
  if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0 || idleTimeoutMs > 300000) throw new TypeError('Prazo de streaming inválido.');
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await readChunk(reader, signal, idleTimeoutMs);
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        if (match.index > 2 * 1024 * 1024) throw new Error('Evento de streaming excedeu o limite.');
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (data === '[DONE]') return;
        if (data) {
          let event;
          try { event = JSON.parse(data); }
          catch { throw new Error('O host retornou um evento de streaming inválido.'); }
          if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string' || !event.type) throw new Error('O host retornou um evento de streaming inválido.');
          yield event;
        }
      }
      if (done) break;
      if (buffer.length > 2 * 1024 * 1024) throw new Error('Evento de streaming excedeu o limite.');
    }
    if (buffer.trim()) throw new Error('Streaming terminou com um evento incompleto.');
  } finally {
    // A stalled source's cancel promise must not keep the UI waiting forever.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
