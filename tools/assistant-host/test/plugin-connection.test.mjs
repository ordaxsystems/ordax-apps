import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createPluginConnection, isPluginURL, MCP_URL, PLUGINS_URL } = createRequire(import.meta.url)('../native/plugin-connection.cjs');
const issuer = 'https://eobcxuyvhkvdmkbaihwh.supabase.co/auth/v1';
const resource = { resource: MCP_URL, authorization_servers: [issuer], scopes_supported: ['openid', 'email', 'offline_access'] };
const auth = { issuer, authorization_endpoint: issuer + '/oauth/authorize', token_endpoint: issuer + '/oauth/token', registration_endpoint: issuer + '/oauth/clients/register', code_challenge_methods_supported: ['S256'] };
function fixture(modify = data => data) {
  const requests = [], opened = [];
  const plugin = createPluginConnection({ now: () => 100, openExternal: async value => opened.push(value), fetcher: async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('oauth-protected-resource')) return Response.json(modify(structuredClone(resource)));
    if (String(url).endsWith('oauth-authorization-server')) return Response.json(modify(structuredClone(auth)));
    return new Response(null, { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource', MCP_URL)}"` } });
  } });
  return { plugin, requests, opened };
}
test('public check verifies production OAuth and reports drift without claiming installation or accessing tools', async () => {
  const f = fixture(); const [a, b] = await Promise.all([f.plugin.check(), f.plugin.check()]);
  assert.deepEqual(a, b); assert.equal(a.status, 'available'); assert.equal(a.configurationDrift, true); assert.equal(a.checkedAt, 100);
  assert.equal('connected' in a, false); assert.equal(f.requests.length, 3);
  assert.equal(a.oauthSettings.clientRegistration, 'DCR'); assert.equal(a.oauthSettings.scopes, 'openid email offline_access');
  assert.equal(a.oauthSettings.authorizationEndpoint, auth.authorization_endpoint); assert.equal(a.oauthSettings.pkce, 'S256');
  assert.equal('clientSecret' in a.oauthSettings, false); assert.equal('clientId' in a.oauthSettings, false);
  for (const { options } of f.requests) { assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit'); assert.equal(options.headers.Authorization, undefined); }
  assert.equal(JSON.parse(f.requests[2].options.body).method, 'initialize');
});
test('unknown issuers and cross-origin metadata are rejected before any unauthenticated probe', async () => {
  for (const modify of [j => j.authorization_servers ? { ...j, authorization_servers: ['https://attacker.example/auth'] } : j, j => j.authorization_endpoint ? { ...j, authorization_endpoint: 'https://attacker.example/authorize' } : j, j => j.code_challenge_methods_supported ? { ...j, code_challenge_methods_supported: ['plain'] } : j]) {
    const f = fixture(modify); const state = await f.plugin.check(); assert.equal(state.status, 'unavailable'); assert.ok(f.requests.length < 3);
  }
});
test('metadata reads are bounded and errors do not expose response bodies or bearer tokens', async () => {
  const plugin = createPluginConnection({ fetcher: async () => new Response('x'.repeat(40000)) });
  const value = await plugin.check(); assert.equal(value.status, 'unavailable'); assert.match(value.error, /extensos/); assert.ok(value.error.length < 250);
});
test('external browser opens the fixed Plugins URL without account or tool access', async () => {
  const f = fixture(); await f.plugin.browser(); assert.deepEqual(f.opened, [PLUGINS_URL]);
});
test('plugin OAuth navigation permits only exact trusted HTTPS authorities', () => {
  for (const url of [PLUGINS_URL, MCP_URL.replace('/mcp', '/oauth/consent'), issuer + '/oauth/authorize', 'https://accounts.google.com/']) assert.equal(isPluginURL(url), true);
  for (const url of ['https://attacker.supabase.co/', 'https://chatgpt.com.attacker.example/', 'javascript:alert(1)', 'http://chatgpt.com/', 'https://user:secret@chatgpt.com/', 'file:///C:/example.exe']) assert.equal(isPluginURL(url), false);
});
