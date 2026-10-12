// Project-owned address only. Starting a server belongs to the Runtime.
export function normalizePreviewURL(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x20]/.test(value)) throw new Error('Informe um endereço HTTP local ou HTTPS válido para o preview.');
  let url; try { url = new URL(value); } catch { throw new Error('Endereço do preview inválido.'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  const blocked = ['chatgpt.com', 'openai.com', 'google.com', 'microsoftonline.com', 'live.com', 'apple.com'];
  if (url.username || url.password || url.search || url.hash || blocked.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain)) ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback && Number(url.port) >= 1024))) throw new Error('Use HTTPS ou um servidor local com porta acima de 1023, sem credenciais, parâmetros ou fragmentos.');
  return url.href;
}
export function validPreviewURL(value) { try { return normalizePreviewURL(value) === (value || null); } catch { return false; } }

// Human-operated browser surface; no computer automation or provider transport.
export function normalizeBrowserURL(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x20]/.test(value)) throw new Error('Informe um endereço HTTPS ou HTTP local válido.');
  let url; try { url = new URL(value); } catch { throw new Error('Endereço do navegador inválido.'); }
  if (url.username || url.password || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname) && Number(url.port) >= 1024))) throw new Error('Use HTTPS ou HTTP local com porta acima de 1023, sem credenciais no endereço.');
  return url.href;
}
