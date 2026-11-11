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
    '--mcp.server-url=url='+endpoint,
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

test('health URL file is private process configuration, never remote readiness proof',()=>{
  const healthUrlFile='C:\\Users\\tester\\AppData\\Local\\Temp\\forge-unique\\health.url';
  const result=makeForgeOfficialTunnelLaunch({...input(),healthUrlFile});
  assert.equal(result.args.at(-1),'--health.url-file='+healthUrlFile);
  assert.equal(result.publicStatus.runtimeReady,false);
  assert.equal(result.publicStatus.remoteChatGptConnected,false);
  assert.equal(JSON.stringify(result.args).includes(input().controlPlaneKey),false);
  for(const candidate of ['health.url','..\\health.url','https://other.example/health.url',
    'C:\\Users\\tester\\health.txt'])
    assert.throws(()=>makeForgeOfficialTunnelLaunch({...input(),healthUrlFile:candidate}),
      /health_url_file_invalid/);
});

test('official legacy and namespaced tunnel IDs are preserved unchanged',()=>{
  const valid=[
    tunnelId,
    'tunnel_'+'z9'.repeat(16),
    'tunnel_ab12_'+'z9'.repeat(16),
    'tunnel_9x7b_'+'a1'.repeat(16)
  ];
  for(const targetId of valid){
    const value=validateForgeTunnelTarget({projectId:id,tunnelId:targetId,endpoint});
    assert.equal(value.tunnelId,targetId);
    const launch=makeForgeOfficialTunnelLaunch({...input(),tunnelId:targetId});
    assert.equal(launch.args[1],'--control-plane.tunnel-id='+targetId);
    assert.equal(launch.publicStatus.tunnelId,targetId);
  }
  const invalid=[
    'tunnel_'+'a'.repeat(31),'tunnel_'+'a'.repeat(33),
    'tunnel_ab1_'+'a'.repeat(32),'tunnel_abcde_'+'a'.repeat(32),
    'tunnel_ab_12_'+'a'.repeat(32),
    'tunnel_AB12_'+'a'.repeat(32),
    'tunnel_ab12_'+'A'.repeat(32),
    'tunnel_ab12_'+'a'.repeat(31)+'-',
    'tunnel_ab12_'+'a'.repeat(32)+'?x=1',
    'tunnel_µb12_'+'a'.repeat(32),
    'tunnel_ab12_'+'a'.repeat(32)+'\n'
  ];
  for(const targetId of invalid)
    assert.throws(()=>validateForgeTunnelTarget({projectId:id,tunnelId:targetId,endpoint}),
      /identifier_invalid/);
});

test('tunnel preparation refuses unapproved, unscoped, unsafe or public targets',()=>{
  const good=input();
  for(const patch of [
    {ownerApproved:false},{platform:'linux'}, {projectId:'project_../../other'},
    {tunnelId:'tunnel_notreal'}, {tunnelId:'tunnel__'+'a'.repeat(32)},
    {endpoint:'http://localhost:60252/mcp'},
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
