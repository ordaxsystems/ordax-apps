import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectForgeOfficialTunnelClient,officialTunnelComponentDirectory,
  FORGE_TUNNEL_VERSION}
  from '../src/forge-mcp-tunnel-readiness.mjs';

test('OpenAI official tunnel component exposes truthful readiness only',()=>{
  const result=inspectForgeOfficialTunnelClient({
    localAppData:'C:\\ProgrammaticallyNonexistentForgeProfile',platform:'win32',arch:'x64'
  });
  assert.equal(result.installed,false);
  assert.equal(result.remoteConnected,false);
  assert.equal(result.connectionVerified,false);
  assert.equal(result.workspaceEligibility,'unverified');
  assert.ok(result.blocker);
  assert.equal(result.clientVersion,null);
});
test('other platforms and relative Windows paths fail closed',()=>{
  const unsupported=inspectForgeOfficialTunnelClient({
    localAppData:'C:\\Users\\tester\\AppData\\Local',platform:'linux',arch:'x64'
  });
  assert.equal(unsupported.installed,false);
  assert.equal(unsupported.blocker,'unsupported_windows_architecture');
  assert.throws(()=>officialTunnelComponentDirectory('relative\\user'),/windows_profile_unavailable/);
  assert.equal(
    officialTunnelComponentDirectory('C:\\Users\\tester\\AppData\\Local')
      .endsWith('openai-tunnel\\'+FORGE_TUNNEL_VERSION),true);
});
