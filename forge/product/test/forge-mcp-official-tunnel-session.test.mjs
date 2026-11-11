import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createForgeOfficialTunnelSession,probeForgeTunnelReadiness} from '../src/forge-mcp-official-tunnel-session.mjs';

const projectId='project_aaaaaaaa-1111-4444-8888-111111111111';
const tunnelId='tunnel_'+('abcdef0123456789'.repeat(2));
const config={projectId,tunnelId,endpoint:'http://127.0.0.1:60252/mcp',
  bearerToken:'B'.repeat(43),controlPlaneKey:'sk-'+'C'.repeat(40),
  executablePath:'C:\\AppData\\OrdaX\\tunnel-client.exe',
  platform:'win32',ownerApproved:true,inheritedEnv:{}};
function fixture({readinessProbe}={}){
  const calls=[];let active=null;
  const control=createForgeOfficialTunnelSession({readinessProbe,spawnClient:(command,args,opts)=>{
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
    clientReady:false,clientReadiness:'not_observed',
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
test('cannot start a duplicate while Windows is still closing the previous tunnel',async()=>{
  let candidate;
  const control=createForgeOfficialTunnelSession({spawnClient:()=>{
    candidate=new EventEmitter();
    candidate.kill=()=>{candidate.killRequested=true;return true;};
    queueMicrotask(()=>candidate.emit('spawn'));
    return candidate;
  }});
  await control.start(config);
  const stopping=control.stop();
  assert.equal(stopping.state,'stopping');
  assert.equal(stopping.processRunning,true,'shutdown is not yet confirmed');
  assert.equal(candidate.killRequested,true);
  await assert.rejects(control.start(config),/already_running/);
  candidate.emit('exit',0);
  assert.equal(control.status().state,'stopped');
  assert.equal(control.status().projectId,null);
});
test('cancel during startup cannot silently mark a late process as running',async()=>{
  let candidate;
  const control=createForgeOfficialTunnelSession({spawnClient:()=>{
    candidate=new EventEmitter();candidate.kill=()=>true;
    return candidate;
  }});
  const pending=control.start(config);
  assert.equal(control.status().state,'starting');
  assert.equal(control.stop().state,'stopping');
  await assert.rejects(pending,/start_cancelled/);
  candidate.emit('spawn');
  assert.equal(control.status().state,'stopping');
  await assert.rejects(control.start(config),/already_running/);
  candidate.emit('exit',0);
  assert.equal(control.status().state,'stopped');
});
test('tunnel lifecycle notifies the UI on spontaneous exit without exposing credentials',async()=>{
  const observed=[];let child;
  const controller=createForgeOfficialTunnelSession({
    onChange:state=>observed.push(state),
    spawnClient:()=>{
      child=new EventEmitter();child.kill=()=>true;
      queueMicrotask(()=>child.emit('spawn'));
      return child;
    }
  });
  await controller.start(config);
  assert.deepEqual(observed.map(s=>s.state),['starting','running']);
  child.emit('exit',1);
  assert.deepEqual(observed.map(s=>s.state),['starting','running','stopped']);
  assert.equal(observed.at(-1).processRunning,false);
  assert.equal(observed.at(-1).remoteChatGptConnected,false);
  assert.equal(observed.at(-1).chatGptCallVerified,false);
  const serialized=JSON.stringify(observed);
  assert.equal(serialized.includes(config.controlPlaneKey),false);
  assert.equal(serialized.includes(config.bearerToken),false);
});

test('tunnel UI subscription receives lifecycle changes through credential-free IPC',async()=>{
  const fs=await import('node:fs');
  const {fileURLToPath}=await import('node:url');
  const root=fileURLToPath(new URL('../desktop/',import.meta.url));
  const main=fs.readFileSync(root+'main.mjs','utf8');
  const preload=fs.readFileSync(root+'preload.cjs','utf8');
  const ui=fs.readFileSync(root+'forge-local-mcp-ui.js','utf8');
  assert.match(main,/onChange:.*emitRendererEvent\('ordax:forge:tunnel:changed'\)/);
  assert.match(preload,/onForgeOfficialTunnelChanged: callback/);
  assert.match(preload,/ipcRenderer\.removeListener\('ordax:forge:tunnel:changed'/);
  assert.match(ui,/onForgeOfficialTunnelChanged\(\(\)=>\{if\(!mcpBusy\)void refreshMcp\(\)/);
  assert.match(ui,/session\.state!=='stopped'/);
  assert.match(ui,/session\?\.state==='stopping'/);
  assert.match(ui,/officialTunnelSession\?\.state==='starting'/);
  assert.match(ui,/officialTunnelSession\?\.state==='stopping'/);
  assert.match(main,/await forgeOfficialTunnel\.inspectReadiness\(\)/);
  assert.match(ui,/officialTunnelSession\?\.clientReadiness==='not_ready'/);
  assert.match(ui,/officialTunnelSession\?\.clientReady/);
  assert.match(ui,/Estado do túnel indisponível/);
});

test('invalid controls cannot spawn or persist any token',async()=>{
  const f=fixture();
  await assert.rejects(f.control.start({...config,controlPlaneKey:'bad'}),/credentials_unavailable/);
  await assert.rejects(f.control.start({...config,endpoint:'https://evil.example/mcp'}),/endpoint_invalid/);
  assert.equal(f.calls.length,0);
  assert.equal(f.control.status().state,'stopped');
});

test('readyz probes only the verified child URL on loopback, without side effects',async()=>{
  const observed=[];
  const probe=url=>probeForgeTunnelReadiness({
    urlFile:'health.url',readFile:()=>url,
    request:async target=>{observed.push(target);return {status:200};}
  });
  assert.equal(await probe('http://127.0.0.1:48521'),'ready');
  assert.deepEqual(observed,['http://127.0.0.1:48521/readyz']);
  for(const invalid of [
    'https://127.0.0.1:48521','http://localhost:48521',
    'http://127.0.0.2:48521','http://127.0.0.1:48521/mcp',
    'http://127.0.0.1:48521?admin=1','http://127.0.0.1:80',
    'http://user:password@127.0.0.1:48521','http://example.com:48521',
    'http://127.0.0.1:48521/readyz\\nhttp://evil.example'
  ])assert.equal(await probe(invalid),'unverified',invalid);
  assert.equal(observed.length,1,'unsafe URLs never trigger a fetch');
  assert.equal(await probeForgeTunnelReadiness({
    urlFile:'missing.url',readFile:()=>{throw Error('ENOENT');}
  }),'not_observed');
  assert.equal(await probeForgeTunnelReadiness({
    urlFile:'health.url',readFile:()=> 'http://127.0.0.1:48521',
    request:async()=>({status:503})
  }),'not_ready');
  assert.equal(await probeForgeTunnelReadiness({
    urlFile:'health.url',readFile:()=> 'http://127.0.0.1:48521',
    request:async()=>{throw Error('offline');}
  }),'unverified');
});

test('real client readyz is distinct from a ChatGPT workspace call and resets on exit',async()=>{
  const f=fixture({readinessProbe:async()=> 'ready'});
  const started=await f.control.start(config);
  assert.equal(started.clientReady,false);
  assert.equal(started.remoteChatGptConnected,false);
  assert.equal(f.calls[0].args.some(arg=>arg.startsWith('--health.url-file=')),true);
  const observed=await f.control.inspectReadiness();
  assert.equal(observed.clientReadiness,'ready');
  assert.equal(observed.clientReady,true);
  assert.equal(observed.remoteChatGptConnected,false);
  assert.equal(observed.chatGptCallVerified,false);
  f.child.emit('exit',0);
  assert.equal(f.control.status().clientReady,false);
  assert.equal(f.control.status().clientReadiness,'not_observed');
});

test('late health response cannot re-mark a closed tunnel as ready',async()=>{
  let release;
  const f=fixture({readinessProbe:()=>new Promise(resolve=>{release=resolve;})});
  await f.control.start(config);
  const pending=f.control.inspectReadiness();
  f.child.emit('exit',1);
  release('ready');
  const after=await pending;
  assert.equal(after.state,'stopped');
  assert.equal(after.clientReady,false);
  assert.equal(after.remoteChatGptConnected,false);
});

test('real loopback readyz is observed without opening any remote tunnel',async t=>{
  const {createServer}=await import('node:http');
  let statusCode=503;
  const server=createServer((request,response)=>{
    if(request.url!=='/readyz'){response.writeHead(404);return response.end();}
    response.writeHead(statusCode);response.end(statusCode===200?'ready':'not ready');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port;
  const input={urlFile:'health.url',readFile:()=>url};
  assert.equal(await probeForgeTunnelReadiness(input),'not_ready');
  statusCode=200;
  assert.equal(await probeForgeTunnelReadiness(input),'ready');
  assert.equal((await probeForgeTunnelReadiness({...input,readFile:()=>url+'/mcp'})),'unverified');
});
