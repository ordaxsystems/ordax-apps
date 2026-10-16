'use strict';
const { isAccountURL } = require('./policy.cjs');

const MCP_URL = 'https://mcp.ordax.com.br/mcp';
const MCP_AUTH_ISSUER = 'https://jhfphsjptrpmtnzkpwud.supabase.co/auth/v1';
const PLUGINS_URL = 'https://chatgpt.com/plugins';
const SOURCE_URL = 'https://github.com/ordaxsystems/ordax-platform';
const AUTH_ORIGINS = new Set([
  new URL(MCP_URL).origin,
  new URL(MCP_AUTH_ISSUER).origin,
]);

function isPluginURL(value) {
  try {
    const url = new URL(value);
    return !url.username
      && !url.password
      && !url.port
      && (isAccountURL(value) || (url.protocol === 'https:' && AUTH_ORIGINS.has(url.origin)));
  } catch {
    return false;
  }
}

async function boundedJSON(response) {
  if (!response.body) throw new Error('Metadados ausentes.');
  const reader = response.body.getReader();
  let size = 0;
  let text = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) throw new Error('Metadados muito extensos.');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Metadados inválidos.');
    return data;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function createPluginConnection({ fetcher = fetch, openExternal, now = Date.now }) {
  let checking;
  let latest = { status: 'unchecked', checkedAt: null };
  const info = () => ({
    name: 'MCP OrdaX',
    mcpURL: MCP_URL,
    sourceURL: SOURCE_URL,
    pluginsURL: PLUGINS_URL,
    ...latest,
  });

  async function check() {
    if (checking) return checking;
    checking = (async () => {
      const request = (url, options = {}) => fetcher(url, {
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(12000),
        headers: { Accept: 'application/json' },
        ...options,
      });
      try {
        const resourceURL = new URL('/.well-known/oauth-protected-resource', MCP_URL);
        const resource = await request(resourceURL);
        if (!resource.ok) throw new Error('O serviço não publicou os metadados OAuth.');
        const metadata = await boundedJSON(resource);
        const issuer = metadata.authorization_servers?.[0];
        if (metadata.resource !== MCP_URL || issuer !== MCP_AUTH_ISSUER) {
          throw new Error('A autoridade pública do MCP não corresponde ao contrato canônico. Atualize o app antes de conectar.');
        }

        const discovery = await request(issuer + '/.well-known/oauth-authorization-server');
        if (!discovery.ok) throw new Error('O servidor de login está indisponível.');
        const auth = await boundedJSON(discovery);
        const ownEndpoint = value => {
          try {
            const url = new URL(value);
            return url.protocol === 'https:'
              && !url.username
              && !url.password
              && url.origin === new URL(issuer).origin;
          } catch {
            return false;
          }
        };
        if (
          auth.issuer !== issuer
          || !ownEndpoint(auth.authorization_endpoint)
          || !ownEndpoint(auth.token_endpoint)
          || !auth.code_challenge_methods_supported?.includes('S256')
          || !(ownEndpoint(auth.registration_endpoint) || auth.client_id_metadata_document_supported === true)
        ) {
          throw new Error('O servidor não oferece o fluxo OAuth esperado pelo ChatGPT.');
        }

        const probe = await request(MCP_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-06-18',
              capabilities: {},
              clientInfo: { name: 'ordax-assistant-connection-check', version: '0.6.0' },
            },
          }),
        });
        const challenge = probe.headers.get('www-authenticate') || '';
        await probe.body?.cancel();
        if (probe.status !== 401 || !challenge.includes(resourceURL.href)) {
          throw new Error('O MCP não apresentou o desafio de autenticação esperado.');
        }

        latest = {
          status: 'available',
          oauth: true,
          checkedAt: now(),
          configurationDrift: false,
          oauthSettings: {
            issuer,
            authorizationEndpoint: auth.authorization_endpoint,
            tokenEndpoint: auth.token_endpoint,
            registrationEndpoint: ownEndpoint(auth.registration_endpoint) ? auth.registration_endpoint : '',
            clientRegistration: ownEndpoint(auth.registration_endpoint) ? 'DCR' : 'CIMD',
            pkce: 'S256',
            scopes: ['openid', 'email', 'offline_access']
              .filter(scope => (metadata.scopes_supported || auth.scopes_supported || []).includes(scope))
              .join(' '),
          },
        };
      } catch (error) {
        latest = {
          status: 'unavailable',
          oauth: false,
          checkedAt: now(),
          error: error instanceof TypeError || error.name === 'TimeoutError'
            ? 'Não foi possível verificar o serviço. Tente novamente.'
            : error.message.slice(0, 240),
        };
      }
      return info();
    })().finally(() => { checking = null; });
    return checking;
  }

  return Object.freeze({
    info,
    check,
    browser: async () => {
      await openExternal(PLUGINS_URL);
      return { opened: true };
    },
  });
}

module.exports = {
  createPluginConnection,
  isPluginURL,
  MCP_URL,
  MCP_AUTH_ISSUER,
  PLUGINS_URL,
};
