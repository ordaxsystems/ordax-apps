// Both the portable UI and development host consume this transport-neutral parser.
export async function* readSSE(body) {
  if (!body?.getReader) throw new Error('O host não retornou um fluxo de resposta.');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        if (match.index > 2 * 1024 * 1024) throw new Error('Evento de streaming excedeu o limite.');
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (data && data !== '[DONE]') yield JSON.parse(data);
      }
      if (done) break;
      if (buffer.length > 2 * 1024 * 1024) throw new Error('Evento de streaming excedeu o limite.');
    }
    if (buffer.trim()) throw new Error('Streaming terminou com um evento incompleto.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
