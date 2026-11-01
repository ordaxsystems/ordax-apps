import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {HOST_BROWSER_METHODS,createHostBrowserServer} from '../host/host-browser-server.mjs';

const productRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function rawRequest(url,options={}) {
  return new Promise((resolve,reject)=>{
    const request=http.request(new URL(url),options,response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));
      response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks).toString('utf8')}));
    });
    request.on('error',reject);request.end(options.body);
  });
}

test('host serves only the current UI allowlist with a restrictive browser policy',async()=>{
  const server=createHostBrowserServer({productRoot,assetsRoot:path.join(productRoot,'data','assets'),invoke:async()=>null});
  const {origin}=await server.listen();
  try {
    const page=await fetch(`${origin}/`);
    assert.equal(page.status,200);
    assert.match(page.headers.get('content-security-policy'),/default-src 'none'/);
    assert.match(page.headers.get('x-frame-options'),/DENY/);
    assert.match(await page.text(),/host-browser-bridge\.js/);
    const ui=await fs.readFile(path.join(productRoot,'desktop','ui.html'),'utf8');
    const css=await fs.readFile(path.join(productRoot,'desktop','ui.css'),'utf8');
    assert.match(ui,/<footer class="left-footer">[\s\S]*<details id="hostBrowserControls" class="host-browser-controls"[\s\S]*<\/footer>/);
    assert.doesNotMatch(css,/\.host-browser-controls\{position:fixed/);
    // The Work rail is nested inside contextPanel. A selector that hides
    // contextPanel would make the real work list invisible in coordinator mode.
    assert.ok(ui.indexOf('id="contextPanel"')<ui.indexOf('id="orchestratorWorkRail"'));
    assert.match(css,/body\.orchestrator-focus:not\(\.orchestrator-api-settings\) #contextRail>:not\(#contextPanel\)\{display:none!important\}/);
    assert.match(css,/body\.orchestrator-focus:not\(\.orchestrator-api-settings\) #contextPanel\{display:flex!important;overflow:hidden;padding:0\}/);
    assert.match(css,/body\.orchestrator-focus:not\(\.orchestrator-api-settings\) #contextPanel>:not\(#orchestratorWorkRail\)\{display:none!important\}/);
    assert.doesNotMatch(css,/#contextRail>:not\(#orchestratorWorkRail\)/);
    assert.match(css,/body\.orchestrator-focus\.orchestrator-api-settings #labSupervisorPanel\{display:block!important/);
    const pending=['/ui.js','/host-browser-bridge.js'];
    const checked=new Set();
    for(const route of pending) {
      if(checked.has(route))continue;
      checked.add(route);
      const response=await fetch(`${origin}${route}`);
      assert.equal(response.status,200,`missing host UI module ${route}`);
      const source=await response.text();
      for(const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
        if(!match[1].startsWith('.'))continue;
        const imported=new URL(match[1],`http://127.0.0.1${route}`).pathname;
        if(!checked.has(imported))pending.push(imported);
      }
    }
    assert.equal((await fetch(`${origin}/api/invoke`)).status,401);
    const started=await fetch(`${origin}/api/session`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
    const cookie=started.headers.get('set-cookie').split(';',1)[0];
    const unlisted=await fetch(`${origin}/desktop/main.mjs`,{headers:{Cookie:cookie}});
    assert.equal(unlisted.status,404);
  } finally {await server.close();}
});

test('host requires same-origin browser bootstrap and recovers a browser session safely',async()=>{
  const server=createHostBrowserServer({productRoot,assetsRoot:path.join(productRoot,'data','assets'),invoke:async()=>null});
  const {origin}=await server.listen();
  try {
    const blocked=await fetch(`${origin}/api/session`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(blocked.status,403);
    const started=await fetch(`${origin}/api/session`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
    assert.equal(started.status,200);
    const cookie=started.headers.get('set-cookie').split(';',1)[0];
    const status=await fetch(`${origin}/api/invoke`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({method:'workspace',args:[]})});
    assert.equal(status.status,200);
    const second=await fetch(`${origin}/api/session`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
    assert.equal(second.status,200);
    assert.notEqual(second.headers.get('set-cookie').split(';',1)[0],cookie);
  } finally {await server.close();}
});

test('ChatGPT callback is bound to the host cookie and redirects without exposing its authorization code',async()=>{
  let received=null;
  const server=createHostBrowserServer({productRoot,assetsRoot:path.join(productRoot,'data','assets'),invoke:async()=>null,
    onChatGPTCallback:async(value)=>{received=value;return {connected:true,planUsageAuthorized:true};}});
  const {origin}=await server.listen();
  try {
    const started=await fetch(`${origin}/api/session`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
    const cookie=started.headers.get('set-cookie').split(';',1)[0];
    const redirectUri=server.getAuthorizationRedirectUri();
    assert.equal(redirectUri,`${origin}/auth/callback`);
    const callback=new URL(redirectUri);
    callback.searchParams.set('state','bound-state');
    callback.searchParams.set('code','single-use-secret-code');
    const response=await fetch(callback,{headers:{Cookie:cookie},redirect:'manual'});
    assert.equal(response.status,303);
    assert.equal(response.headers.get('location'),'/?chatgpt=connected');
    assert.equal(received.session.length,43);
    assert.equal(received.redirectUri,redirectUri);
    assert.equal(new URL(received.callbackUrl).searchParams.get('code'),'single-use-secret-code');
  } finally {await server.close();}
});

test('host maps only declared UI methods to existing handlers and sanitizes results',async()=>{
  const calls=[];
  const server=createHostBrowserServer({productRoot,assetsRoot:path.join(productRoot,'data','assets'),invoke:async(...args)=>{
    calls.push(args);return {id:'task-1',api_key:'must-not-leak',local_path:'C:/private/file',nested:{safe:true}};
  }});
  const {origin}=await server.listen();
  try {
    const started=await fetch(`${origin}/api/session`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
    const cookie=started.headers.get('set-cookie').split(';',1)[0];
    const invoke=async payload=>fetch(`${origin}/api/invoke`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(payload)});
    const response=await invoke({method:'orchestratorInvoke',args:['project_list',{limit:20}]});
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{id:'task-1',nested:{safe:true}});
    assert.equal(calls[0][0],'orchestratorInvoke');
    assert.equal(calls[0][1],'ordax:orchestrator:invoke');
    assert.deepEqual(calls[0][2],[{operation:'project_list',input:{limit:20}}]);
    assert.equal((await invoke({method:'arbitraryEval',args:[]})).status,404);
    const preload=await fs.readFile(path.join(productRoot,'desktop','preload.cjs'),'utf8');
    const bridge=await fs.readFile(path.join(productRoot,'desktop','host-browser-bridge.js'),'utf8');
    const hostOnlyMethods=new Set(['chatgptPlanStatus','chatgptPlanLogin','chatgptPlanDisconnect']);
    for(const method of Object.keys(HOST_BROWSER_METHODS)) {
      if(hostOnlyMethods.has(method))assert.doesNotMatch(preload,new RegExp(`^\\s{2}${method}:`,'m'),`${method} is a Host-only OAuth flow`);
      else assert.match(preload,new RegExp(`^\\s{2}${method}:`,'m'),`missing native UI method ${method}`);
      assert.match(bridge,method==='chatgptPlanLogin'?/api\.chatgptPlanLogin\s*=/:new RegExp(`\\b${method}:`),`missing host UI method ${method}`);
    }
  } finally {await server.close();}
});

test('host rejects forged Host and cross-origin write requests',async()=>{
  const server=createHostBrowserServer({productRoot,assetsRoot:path.join(productRoot,'data','assets'),invoke:async()=>null});
  const {origin}=await server.listen();
  try {
    const claimed=await fetch(`${origin}/api/session`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
    const cookie=claimed.headers.get('set-cookie').split(';',1)[0];
    const forged=await rawRequest(`${origin}/api/invoke`,{method:'POST',headers:{Host:'attacker.example',Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:'{}'});
    assert.equal(forged.status,421);
    const crossOrigin=await fetch(`${origin}/api/invoke`,{method:'POST',headers:{Origin:'https://attacker.example','Content-Type':'application/json',Cookie:cookie},body:'{}'});
    assert.equal(crossOrigin.status,403);
  } finally {await server.close();}
});

test('host confirmation stays bound to its session and resolves only an explicit owner choice',async()=>{
  const server=createHostBrowserServer({productRoot,assetsRoot:path.join(productRoot,'data','assets'),invoke:async()=>null});
  const {origin}=await server.listen();
  let reader;
  try {
    const claimed=await fetch(`${origin}/api/session`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
    const cookie=claimed.headers.get('set-cookie').split(';',1)[0];
    const stream=await fetch(`${origin}/api/events`,{headers:{Cookie:cookie}});
    reader=stream.body.getReader();
    await reader.read();
    const confirmation=server.confirm({title:'Enviar mensagem',message:'Confirme o envio',detail:'Texto exato',approveLabel:'Enviar'},{timeoutMs:3000});
    let frame='';
    while(!frame.includes('event: confirm'))frame+=new TextDecoder().decode((await reader.read()).value||new Uint8Array());
    const payload=JSON.parse(frame.split('data: ')[1].split('\n')[0]);
    assert.equal(payload.approveLabel,'Enviar');
    const otherSession=await fetch(`${origin}/api/session`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
    const otherCookie=otherSession.headers.get('set-cookie').split(';',1)[0];
    const denied=await fetch(`${origin}/api/confirmation`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:otherCookie},body:JSON.stringify({id:payload.id,approved:true})});
    assert.equal(denied.status,409);
    const approved=await fetch(`${origin}/api/confirmation`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({id:payload.id,approved:true})});
    assert.equal(approved.status,200);
    assert.equal(await confirmation,true);
  } finally {await reader?.cancel().catch(()=>{});await server.close();}
});

test('host shutdown runs only for an authenticated same-origin browser session',async()=>{
  let shutdownCalls=0;
  const server=createHostBrowserServer({productRoot,assetsRoot:path.join(productRoot,'data','assets'),invoke:async()=>null,onShutdown:()=>shutdownCalls++});
  const {origin}=await server.listen();
  try {
    const started=await fetch(`${origin}/api/session`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
    const cookie=started.headers.get('set-cookie').split(';',1)[0];
    const blocked=await fetch(`${origin}/api/shutdown`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
    assert.equal(blocked.status,401);
    const response=await fetch(`${origin}/api/shutdown`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:'{}'});
    assert.equal(response.status,202);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(shutdownCalls,1);
  } finally {await server.close();}
});
