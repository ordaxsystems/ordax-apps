import test from 'node:test';
import assert from 'node:assert/strict';
import {makeForgeOfficialTunnelLaunch,validateForgeTunnelTarget}
  from '../src/forge-mcp-official-tunnel.mjs';

const id='project_aabbccdd-0000-4444-aabb-123456789abc';
const tunnelId='tunnel_'+'0123456789abcdef'.repeat(2);
const endpoint='http://127.0.0.1:60252/mcp';
const bearerToken='A'.repeat(43);
const controlPlaneKey='sk-'+('B'.repeat(36));
const executablePath='C:\\Program Files\\OpenAI\\tunnel-client.exe';
const input=()=>({projectId:id,tunnelId,endpoint,bearerToken,
  controlPlaneKey,executablePath,platform:'win32',ownerApproved:true,
  inheritedEnv:{SystemRoot:'C:\\Windows',Path:'C:\\Windows\\System32',
    MCP_COMMAND:'malicious.exe',MCP_SERVER_URL:'https://evil.example/mcp',
    CONTROL_PLANE_API_KEY:'wrong',MCP_EXTRA_HEADERS:'Authorization: wrong',
    OPENAI_API_KEY:'other'}});

test('official tunnel launcher is outbound-only, project scoped and leaks no secrets via flags',()=>{
  const s=makeForgeOfficialTunnelLaunch(input());
  assert.equal(s.command,executablePath);
  assert.deepEqual(s.args,[
    'run','--control-plane.tunnel-id='+tunnelId,
    '--mcp.server-url='+endpoint,
    '--mcp.extra-headers=Authorization: env:FORGE_TUNNEL_LOCAL_BEARER',
    '--mcp.discovery-extra-headers=Authorization: env:FORGE_TUNNEL_LOCAL_BEARER',
    '--health.listen-addr=127.0.0.1:0'
  ]);
  assert.equal(s.env.FORGE_TUNNEL_LOCAL_BEARER,'Bearer '+bearerToken);
  assert.equal(s.env.CONTROL_PLANE_API_KEY,controlPlaneKey);
  assert.equal(s.env.MCP_EXTRA_HEADERS,undefined);
  assert.equal(s.env.MCP_SERVER_URL,undefined);
  assert.equal(s.env.MCP_COMMAND,undefined);
  assert.equal(s.env.OPENAI_API_KEY,undefined);
  assert.equal(s.spawnOptions.shell,false);
  assert.equal(s.spawnOptions.detached,false);
  assert.equal(s.spawnOptions.stdio,'ignore');
  const safe=JSON.stringify({args:s.args,publicStatus:s.publicStatus});
  assert.equal(safe.includes(controlPlaneKey),false);
  assert.equal(safe.includes(bearerToken),false);
  assert.equal(s.publicStatus.remoteChatGptConnected,false);
  assert.equal(s.publicStatus.runtimeReady,false);
  assert.equal(s.publicStatus.projectId,id);
});

test('tunnel preparation refuses unapproved, unscoped, unsafe or public targets',()=>{
  const good=input();
  for(const patch of [
    {ownerApproved:false},{platform:'linux'}, {projectId:'project_../../other'},
    {tunnelId:'tunnel_notreal'}, {endpoint:'http://localhost:60252/mcp'},
    {endpoint:'http://0.0.0.0:60252/mcp'},
    {endpoint:'https://127.0.0.1:60252/mcp'},
    {endpoint:'http://127.0.0.1:60252/mcp?secret=1'},
    {endpoint:'http://127.0.0.1:60252/other'},
    {endpoint:'http://127.0.0.1:80/mcp'},
    {endpoint:'http://user:pass@127.0.0.1:60252/mcp'},
    {bearerToken:'bad'}, {controlPlaneKey:'bad'},
    {executablePath:'cmd.exe'},
    {executablePath:'C:\\Windows\\System32\\cmd.exe'}
  ])assert.throws(()=>makeForgeOfficialTunnelLaunch({...good,...patch}),
    /forge_tunnel_/);
  assert.deepEqual(validateForgeTunnelTarget({projectId:id,tunnelId,endpoint}),
    {projectId:id,tunnelId,endpoint});
});
