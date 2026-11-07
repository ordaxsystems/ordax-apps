import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createForgeOfficialTunnelSession} from '../src/forge-mcp-official-tunnel-session.mjs';

const projectId='project_aaaaaaaa-1111-4444-8888-111111111111';
const tunnelId='tunnel_'+('abcdef0123456789'.repeat(2));
const config={projectId,tunnelId,endpoint:'http://127.0.0.1:60252/mcp',
  bearerToken:'B'.repeat(43),controlPlaneKey:'sk-'+'C'.repeat(40),
  executablePath:'C:\\AppData\\OrdaX\\tunnel-client.exe',
  platform:'win32',ownerApproved:true,inheritedEnv:{}};
function fixture(){
  const calls=[];let active=null;
  const control=createForgeOfficialTunnelSession({spawnClient:(command,args,opts)=>{
    const child=new EventEmitter();
    child.kill=()=>{child.killed=true;child.emit('exit',0);return true;};
    active=child;
    calls.push({command,args,opts});
    queueMicrotask(()=>child.emit('spawn'));
    return child;
  }});
  return {control,calls,get child(){return active;}};
}
test('tunnel stays off until owner explicitly starts one verified project',async()=>{
  const f=fixture();
  assert.deepEqual(f.control.status(),{
    state:'stopped',processRunning:false,projectId:null,tunnelId:null,
    remoteChatGptConnected:false,chatGptCallVerified:false,autostart:false
  });
  await assert.rejects(f.control.start({...config,ownerApproved:false}),/owner_approval_required/);
  assert.equal(f.calls.length,0);
  const connected=await f.control.start(config);
  assert.equal(connected.processRunning,true);
  assert.equal(connected.chatGptCallVerified,false);
  assert.equal(connected.remoteChatGptConnected,false);
  const launched=f.calls[0];
  assert.equal(launched.opts.shell,false);
  assert.equal(launched.opts.stdio,'ignore');
  assert.equal(JSON.stringify(launched.args).includes(config.controlPlaneKey),false);
  assert.equal(JSON.stringify(launched.args).includes(config.bearerToken),false);
  assert.equal(launched.opts.env.CONTROL_PLANE_API_KEY,config.controlPlaneKey);
  await assert.rejects(f.control.start({...config,projectId:'project_other'}),/already_running/);
  assert.equal(f.calls.length,1,'no duplicate connector processes');
  assert.equal(f.control.stop().processRunning,false);
  assert.equal(f.child.killed,true);
  assert.equal(f.control.status().tunnelId,null);
});
test('process failure and exit clear remote readiness, never leak a secret',async()=>{
  let child;
  const control=createForgeOfficialTunnelSession({spawnClient:()=>{
    child=new EventEmitter();child.kill=()=>true;
    queueMicrotask(()=>child.emit('spawn'));return child;
  }});
  await control.start(config);
  child.emit('exit',1);
  assert.equal(control.status().processRunning,false);
  assert.equal(control.status().projectId,null);
  assert.equal(control.status().remoteChatGptConnected,false);
  assert.equal(control.stop().state,'stopped');
});
test('invalid controls cannot spawn or persist any token',async()=>{
  const f=fixture();
  await assert.rejects(f.control.start({...config,controlPlaneKey:'bad'}),/credentials_unavailable/);
  await assert.rejects(f.control.start({...config,endpoint:'https://evil.example/mcp'}),/endpoint_invalid/);
  assert.equal(f.calls.length,0);
  assert.equal(f.control.status().state,'stopped');
});
