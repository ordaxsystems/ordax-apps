// OrdaX development workbench: three independent OS processes, NOT VMs.
// The clients talk to the canonical Platform Relay lab by genuine loopback HTTP.
// Studio's actual local web-host reads the same Relay operator projection.
// Diagnostic replies are marked NOT GPT. Provider calls require an explicit key.
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {fork} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createWebServer} from '../web-server.mjs';
import {renderCentralConsole} from '../../../apps/central/src/console.mjs';
import {projectCentralReceipts} from '../../../apps/central/src/receipt-projection.mjs';

const SOURCE=fileURLToPath(import.meta.url);
const token=()=>randomBytes(32).toString('hex');
const send=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body))};
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function listen(server,port=0){await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes)});return 'http://127.0.0.1:'+server.address().port}
async function closeClients(children){
  // Windows holds each child's cwd open until the PROCESS ACTUALLY exits.
  // A kill() request is not an exit receipt; never remove the profiles early.
  await Promise.all(children.map(child=>new Promise((done,fail)=>{
    if(child.exitCode!==null||child.signalCode!==null){done();return;}
    const force=setTimeout(()=>child.kill('SIGKILL'),2500);
    const deadline=setTimeout(()=>fail(Error('client_exit_timeout')),9000);
    child.once('exit',()=>{clearTimeout(force);clearTimeout(deadline);done()});
    child.kill();
  })));
}

async function gpt(request,provider){
  if(provider==='diagnostic')return {deviceId:request.deviceId,requestId:request.requestId,
    result:'[DIAGNÓSTICO — NÃO É GPT] '+request.deviceId+' recebeu: '+request.prompt};
  if(provider!=='openai-api'||!process.env.ORDAX_LAB_OPENAI_API_KEY)throw Error('provider_not_connected');
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:request.signal,
    headers:{authorization:'Bearer '+process.env.ORDAX_LAB_OPENAI_API_KEY,'content-type':'application/json'},
    body:JSON.stringify({model:process.env.ORDAX_LAB_OPENAI_MODEL||'gpt-5-mini',store:false,
      input:[{role:'developer',content:'Você representa a Central OrdaX neste teste. Responda em português indicando o identificador do cliente.'},
        {role:'user',content:'Cliente '+request.deviceId+': '+request.prompt}],max_output_tokens:260})});
  if(!response.ok)throw Error('provider_http_failed');
  const data=await response.json();
  const answer=(data.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n').trim();
  if(!answer||answer.length>4096)throw Error('invalid_provider_response');
  return {deviceId:request.deviceId,requestId:request.requestId,result:answer};
}
export async function startWorkbench({platformRoot,provider='diagnostic',centralPort=0}){
  if(!platformRoot||!['diagnostic','openai-api'].includes(provider)||!Number.isInteger(centralPort)||centralPort<0||centralPort>65535||(centralPort>0&&centralPort<1024))throw Error('invalid_configuration');
  const {startRelayLab}=await import(pathToFileURL(resolve(platformRoot,'control-plane/labs/relay/relay.mjs')).href);
  const clients=Array.from({length:3},(_,i)=>({id:'studio-'+(i+1),secret:token()}));
  const adminToken=token(),cookie=token(),events=[];
  const record=e=>{events.push({time:new Date().toLocaleTimeString('pt-BR'),...e});if(events.length>130)events.shift()};
  let hub=null,studio=null,server=null,root=null,origin='',kids=[],studioCookie='';
  const saved={url:process.env.ORDAX_RELAY_LAB_URL,token:process.env.ORDAX_RELAY_LAB_ADMIN_TOKEN};
  try{
    hub=await startRelayLab({devices:clients,adminToken,inferenceTimeoutMs:30000,
      inference:async request=>{
        record({id:request.deviceId,requestId:request.requestId,event:'central_received',preview:request.prompt.slice(0,140)});
        try{const answer=await gpt(request,provider);
          record({id:request.deviceId,requestId:request.requestId,event:'provider_returned',preview:answer.result.slice(0,180)});
          return answer;
        }catch{record({id:request.deviceId,requestId:request.requestId,event:'provider_failed',preview:'provider unavailable; no fabricated GPT reply'});throw Error('adapter_unavailable')}
      }});
    process.env.ORDAX_RELAY_LAB_URL=hub.url;
    process.env.ORDAX_RELAY_LAB_ADMIN_TOKEN=adminToken;
    studio=await createWebServer({bridge:{},runtime:null});
    // Reuse one real Studio operator session instead of creating a fresh
    // session on every Central poll. The Studio observer remains the SSOT.
    const studioEntry=await fetch(studio.origin+'/src/index.html');
    studioCookie=studioEntry.headers.get('set-cookie')?.split(';')[0]||'';
    if(!studioEntry.ok||!studioCookie.startsWith('ordax_assistant_web='))
      throw Error('studio_operator_session_unavailable');
    server=createServer(async(req,res)=>{
      try{
        if(req.headers.host!==new URL(origin).host)return send(res,403,{ok:false,error:'invalid_host'});
        if(req.method==='GET'&&req.url==='/'){
          const nonce=token();res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',
            'set-cookie':'ordax_lab_operator='+cookie+'; HttpOnly; SameSite=Strict; Path=/',
            'content-security-policy':"default-src 'none'; style-src 'nonce-"+nonce+"'; script-src 'nonce-"+nonce+"'; connect-src 'self'; frame-src "+clients.map(c=>c.origin).filter(Boolean).join(' ')+"; frame-ancestors 'none'; base-uri 'none'"});
          res.end(renderCentralConsole({clients,provider,studio:studio.origin},nonce));return;
        }
        if(req.method!=='GET'||req.url!=='/api/state')return send(res,404,{ok:false,error:'not_found'});
        if(!String(req.headers.cookie||'').split(';').some(x=>x.trim()==='ordax_lab_operator='+cookie))return send(res,401,{ok:false,error:'operator_session_required'});
        // Exactly one authority for operational projection: the existing Studio
        // Relay observer. Never duplicate admin polling or invent zero counters.
        const obs=await fetch(studio.origin+'/api/relay',{headers:{cookie:studioCookie}});
        if(!obs.ok)return send(res,503,{ok:false,error:'studio_observer_unavailable'});
        const studioStatus=await obs.json();
        if(studioStatus.state!=='connected-laboratory')return send(res,503,{ok:false,error:'relay_unavailable'});
        const projection={activeRequests:studioStatus.active,
          retainedReceipts:studioStatus.retained,failedReceipts:studioStatus.failures};
        return send(res,200,{status:'connected-laboratory',clients:kids.filter(k=>k.exitCode===null).length,
          provider,relay:projection,studio:studioStatus,events,receipts:projectCentralReceipts(events)});
      }catch{return send(res,503,{ok:false,error:'observer_unavailable'})}
    });
    origin=await listen(server,centralPort);
    root=await mkdtemp(resolve(tmpdir(),'ordax-relay-workbench-'));
    for(const c of clients){
      const profile=resolve(root,c.id);await mkdir(profile,{recursive:true});
      const child=fork(resolve(dirname(SOURCE),'relay-desktop-client.mjs'),[],{
        cwd:profile,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,
          ORDAX_LAB_ID:c.id,ORDAX_LAB_SECRET:c.secret,ORDAX_LAB_URL:hub.url,
          ORDAX_LAB_CENTRAL_ORIGIN:origin},stdio:['ignore','pipe','pipe','ipc']});
      kids.push(child);child.stdout?.resume();child.stderr?.resume();
      const ready=await new Promise((done,fail)=>{
        const timeout=setTimeout(()=>fail(Error('spoke_timeout')),12000);
        const onMessage=m=>{if(m?.event==='ready'&&m.id===c.id){clearTimeout(timeout);child.off('exit',onExit);done(m)}};
        const onExit=()=>{clearTimeout(timeout);child.off('message',onMessage);fail(Error('spoke_exited'))};
        child.once('message',onMessage);child.once('exit',onExit);
      });
      c.origin=ready.origin;c.pid=ready.pid;
      record({id:c.id,event:'spoke_online',preview:'Process PID '+c.pid});
      child.on('message',m=>{
        if(m?.id===c.id&&['submitted','completed'].includes(m.event))
          record({id:c.id,requestId:m.requestId,event:m.event,
            httpStatus:m.httpStatus,ok:m.ok===true,preview:String(m.preview||'').slice(0,180)});
      });
    }
    return {origin,studioOrigin:studio.origin,provider,
      clients:clients.map(c=>({id:c.id,origin:c.origin,pid:c.pid})),events,
      close:async()=>{
        await closeClients(kids);
        await Promise.all([new Promise(ok=>server.close(ok)),studio.close(),hub.close()]);
        await rm(root,{force:true,recursive:true});
        if(saved.url===undefined)delete process.env.ORDAX_RELAY_LAB_URL;
        else process.env.ORDAX_RELAY_LAB_URL=saved.url;
        if(saved.token===undefined)delete process.env.ORDAX_RELAY_LAB_ADMIN_TOKEN;
        else process.env.ORDAX_RELAY_LAB_ADMIN_TOKEN=saved.token;
      }};
  }catch(e){
    await closeClients(kids);
    await Promise.all([server?new Promise(ok=>server.close(ok)):Promise.resolve(),
      studio?.close(),hub?.close()]);
    if(root)await rm(root,{force:true,recursive:true});
    throw e;
  }
}
const args=process.argv.slice(2);
if(args.includes('--self-test')){
  const root=args[args.indexOf('--platform-root')+1];
  const app=await startWorkbench({platformRoot:root});
  try{
    const p=await fetch(app.origin);assert.equal(p.status,200);
    const page=await p.text();
    assert.match(page, /OrdaX Central/);
    assert.match(page, /data-view="connections"/);
    assert.match(page, /data-view="inbox"/);
    assert.match(page, /data-view="chats"/);
    assert.match(page, /id="chatMessages"/);
    assert.match(page, /id="receiptRows"/);
    const inlineScript=page.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
    assert.ok(inlineScript,"Central operator browser script missing");
    new Script(inlineScript,{filename:"ordax-central-console.js"});
    assert.equal((page.match(/<iframe /g)||[]).length,3,'One embedded console per client; no duplicate frames');
    const op=p.headers.get('set-cookie')?.split(';')[0];
    assert.equal((await fetch(app.origin+'/api/state')).status,401);
    // Emulate ONE real browser cookie jar shared by all 127.0.0.1 ports.
    // Previously the third iframe overwrote the first two sessions, causing 403.
    const jar=new Map();
    for(const c of app.clients){
      const home=await fetch(c.origin);assert.equal(home.status,200);
      const setCookie=home.headers.get('set-cookie')?.split(';')[0];
      assert.ok(setCookie?.startsWith('ordax_lab_spoke_'+c.id+'='));
      const separator=setCookie.indexOf('=');
      jar.set(setCookie.slice(0,separator),setCookie.slice(separator+1));
    }
    assert.equal(jar.size,3,'Browser cookie names must remain unique across ports');
    const cookie=[...jar].map(([key,value])=>key+'='+value).join('; ');
    const outs=await Promise.all(app.clients.map(async(c,i)=>{
      const prompt='Mensagem E2E '+(i+1)+' de '+c.id;
      const noCookie=await fetch(c.origin+'/api/send',{method:'POST',headers:{origin:c.origin,'content-type':'application/json'},body:JSON.stringify({prompt})});
      assert.equal(noCookie.status,403);
      const otherCookie=[...jar].filter(([name])=>name!=='ordax_lab_spoke_'+c.id).map(([name,value])=>name+'='+value).join('; ');
      const wrongClient=await fetch(c.origin+'/api/send',{method:'POST',headers:{origin:c.origin,cookie:otherCookie,'content-type':'application/json'},body:JSON.stringify({prompt})});
      assert.equal(wrongClient.status,403);
      const r=await fetch(c.origin+'/api/send',{method:'POST',headers:{origin:c.origin,cookie,'content-type':'application/json'},body:JSON.stringify({prompt})});
      assert.equal(r.status,200);const body=await r.json();assert.equal(body.ok,true);
      assert.equal(body.result,'[DIAGNÓSTICO — NÃO É GPT] '+c.id+' recebeu: '+prompt);
      return body.request_id;
    }));
    assert.equal(new Set(app.clients.map(x=>x.pid)).size,3);
    assert.equal(new Set(outs).size,3);
    const status=await fetch(app.origin+'/api/state',{headers:{cookie:op}});
    assert.equal(status.status,200);const state=await status.json();
    assert.equal(state.relay.retainedReceipts,3);
    assert.equal(state.studio.state,'connected-laboratory');
    assert.equal(state.events.filter(x=>x.event==='central_received').length,3);
    assert.equal(state.events.filter(x=>x.event==='provider_returned').length,3);
    assert.equal(state.receipts.state,'laboratory');
    assert.equal(state.receipts.receipts.length,3);
    for(const c of app.clients){
      const row=state.receipts.receipts.find(x=>x.deviceId===c.id);
      assert.ok(row,'missing receipt for '+c.id);
      assert.equal(row.status,'completed');
      assert.equal(row.delivered,true);
      assert.equal(row.received,true);
      assert.equal(row.providerReturned,true);
      assert.equal(row.httpStatus,200);
      assert.ok(outs.includes(row.requestId));
    }
    console.log('ORDAX_THREE_PROCESS_RELAY_E2E=PASS');
    console.log('PROCESS_PIDS='+app.clients.map(c=>c.pid).join(',')+' REQUESTS=3 RECEIPTS=3');
    console.log('STUDIO_OBSERVER=REAL RELAY_HTTP=REAL SHARED_BROWSER_JAR=PASS CROSS_CLIENT_COOKIE=REJECTED');
    console.log('GPT_PROVIDER=DIAGNOSTIC_NOT_GPT CHATGPT_PLUGIN_E2E=NOT_TESTED PHYSICAL_PCS=1');
  }finally{await app.close()}
}else if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
  const root=args[args.indexOf('--platform-root')+1];
  const provider=args.includes('--openai-api')?'openai-api':'diagnostic';
  const ix=args.indexOf('--central-port');
  const centralPort=ix>=0?Number(args[ix+1]):0;
  const app=await startWorkbench({platformRoot:root,provider,centralPort});
  console.log('ORDAX_WORKBENCH_READY '+JSON.stringify({central:app.origin,studio:app.studioOrigin,
    clients:app.clients,provider,physicalMachines:1}));
  process.on('SIGINT',()=>app.close().then(()=>process.exit(0)));
  process.on('SIGTERM',()=>app.close().then(()=>process.exit(0)));
}
