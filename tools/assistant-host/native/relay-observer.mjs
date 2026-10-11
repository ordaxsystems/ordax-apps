// Read-only laboratory observer for the central Studio host.
// An explicit 127.0.0.1 endpoint and a separately provisioned operator token
// are required. Nothing here is Product Identity, inference or device pairing.
const SCHEMA = 'ordax.studio-relay-observation/1';
const offline = state => Object.freeze({schema:SCHEMA,state});
function endpoint(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
      || !url.port || !/^\d+$/.test(url.port)
      || url.pathname !== '/' || url.search || url.hash || url.username || url.password
      || value !== url.origin && value !== url.origin + '/') return null;
    const port = Number(url.port);
    return port >= 1 && port <= 65535 ? url.origin : null;
  } catch { return null; }
}
function boundedInteger(value, max) {
  return Number.isSafeInteger(value) && value >= 0 && value <= max;
}
export function relayLabProjection(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || payload.schema !== 'ordax.relay-lab-status/1'
    || payload.environment !== 'loopback-laboratory'
    || !boundedInteger(payload.acceptingClients,32)
    || !boundedInteger(payload.activeRequests,32)
    || !boundedInteger(payload.retainedReceipts,128)
    || !boundedInteger(payload.failedReceipts,128)
    || !boundedInteger(payload.cancelledReceipts,128)
    || !boundedInteger(payload.timedOutReceipts,128)
    || payload.failedReceipts > payload.retainedReceipts
    || payload.cancelledReceipts + payload.timedOutReceipts > payload.failedReceipts) {
    return offline('unavailable');
  }
  return Object.freeze({
    schema:SCHEMA,state:'connected-laboratory',
    clients:payload.acceptingClients,
    active:payload.activeRequests,
    retained:payload.retainedReceipts,
    failures:payload.failedReceipts,
    cancelled:payload.cancelledReceipts,
    timedOut:payload.timedOutReceipts,
  });
}
export async function observeRelayLab({
  url = process.env.ORDAX_RELAY_LAB_URL,
  token = process.env.ORDAX_RELAY_LAB_ADMIN_TOKEN,
  fetchImpl = fetch,
} = {}) {
  if (!url && !token) return offline('not-configured');
  const base = endpoint(url);
  if (!base || typeof token !== 'string' || token.length < 32) return offline('invalid-configuration');
  try {
    const response = await fetchImpl(base+'/v1/admin/status',{
      method:'GET',
      redirect:'error',cache:'no-store',
      headers:{authorization:'Bearer '+token,accept:'application/json'},
      signal:AbortSignal.timeout(2000),
    });
    if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||'')) {
      return offline('unavailable');
    }
    return relayLabProjection(await response.json());
  } catch { return offline('unavailable'); }
}
