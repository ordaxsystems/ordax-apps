/**
 * Read-only discovery of a local ORDAX Runtime candidate.
 *
 * /health is intentionally public on loopback. Therefore this observation
 * NEVER establishes binary identity, Product authentication, a device grant,
 * command execution rights or an alternative Product connection.
 */
const HEALTH = 'http://127.0.0.1:8765/health';
const LIMIT = 2048;
const DEADLINE_MS = 1800;
const offline = reason => Object.freeze({
  schema: 'ordax.studio-local-runtime-observation/1',
  observed: false, authorization: 'not-established', canExecute: false,
  reason, version: null, state: null,
});

export async function observeLocalRuntime(fetchImpl = fetch) {
  const ctrl = new AbortController();
  const deadline = setTimeout(() => ctrl.abort(), DEADLINE_MS);
  try {
    const response = await fetchImpl(HEALTH, {
      method: 'GET', redirect: 'manual', cache: 'no-store',
      credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (response.status !== 200) return offline('unavailable');
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || ''))
      return offline('incompatible');
    if (!response.body) return offline('incompatible');
    const parts = [];
    let size = 0;
    for await (const part of response.body) {
      size += part.byteLength;
      if (size > LIMIT) {
        await response.body.cancel?.().catch(() => {});
        return offline('incompatible');
      }
      parts.push(part);
    }
    // A TCP response is an observation, NOT cryptographic proof of which
    // process owns the port. Fail closed even when its public ok bit is true.
    const raw = Buffer.concat(parts).toString('utf8');
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || typeof value !== 'object'
      || typeof value.ok !== 'boolean'
      || typeof value.state !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value.state)
      || typeof value.version !== 'string' || !/^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$/.test(value.version)
      || Object.keys(value).some(k => !['ok','state','version'].includes(k))) {
      return offline('incompatible');
    }
    return Object.freeze({
      schema: 'ordax.studio-local-runtime-observation/1',
      observed: true, authorization: 'not-established', canExecute: false,
      reason: value.ok ? 'loopback-response' : 'reported-unhealthy',
      version: value.version, state: value.state,
    });
  } catch {
    return offline('unavailable');
  } finally {
    clearTimeout(deadline);
  }
}
