// OrdaX development workbench: three independent OS processes, NOT VMs.
// The clients talk to the canonical Platform Relay lab by genuine loopback HTTP.
// Studio's actual local web-host reads the same Relay operator projection.
// Diagnostic replies are marked NOT GPT. Provider calls require an explicit key.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createWebServer} from '../web-server.mjs';

const SOURCE=fileURLToPath(import.meta.url);
const token=()=>randomBytes(32).toString('hex');
const send=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body))};
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function listen(server){await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes)});return 'http://127.0.0.1:'+server.address().port}
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
function html(clients,provider,studio,nonce){
  const frames=clients.map(c=>'<section><header>'+esc(c.id)+' · PID '+c.pid+'</header><iframe src="'+esc(c.origin)+'" title="'+esc(c.id)+'"></iframe></section>').join('');
  return '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>OrdaX Central · Laboratório</title><style nonce="'+nonce+'">'+
  ':root{color-scheme:dark;font:14px system-ui;color:#e5efff;background:#0a101a}body{margin:0}main{max-width:1500px;margin:auto;padding:24px}'+
  'p{line-height:1.5;color:#a9c2e4}#state{padding:12px;border:1px solid #385471;border-radius:10px;background:#152336;white-space:pre-wrap}'+
  '.clients{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:20px 0}section{min-width:0;border:1px solid #36506d;border-radius:12px;overflow:hidden}'+
  'header{padding:12px;background:#213854}iframe{border:0;width:100%;height:320px}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #314963;padding:9px;overflow-wrap:anywhere}td{font-size:12px}'+
  '@media(max-width:900px){.clients{grid-template-columns:1fr}}</style><main>'+
  '<h1>OrdaX Central — Três clientes de teste</h1><p><strong>Três processos Node reais no mesmo Windows.</strong> Os clientes não são VMs nem três instalações do Studio. Cada painel envia mensagens HTTP pelo Relay da Platform. O Studio fornece a observação da Central.</p>'+
  '<p><strong>Provedor: '+(provider==='diagnostic'?'DIAGNÓSTICO LOCAL (NÃO GPT)':'OpenAI API (NÃO plugin ChatGPT)')+'</strong></p>'+
  '<div id="state" aria-live="polite">Conectando observação...</div><div class="clients">'+frames+'</div>'+
  '<h2>Recebimento e encaminhamento na Central</h2><table><thead><tr><th>Hora</th><th>Cliente</th><th>Evento</th><th>Mensagem/recibo</th></tr></thead><tbody id="events"></tbody></table>'+
  '<p>Observador Studio: '+esc(studio)+' . O envio automático ao ChatGPT pelo plugin Product depende de conexão real da Central, ainda não integrada neste laboratório.</p>'+
  '<script nonce="'+nonce+'">'+
  'async function refresh(){try{const r=await fetch("/api/state");if(!r.ok)throw Error();const s=await r.json();document.querySelector("#state").textContent='+
  '"Central: "+s.status+" | Clientes: "+s.clients+" | Ativos: "+s.relay.activeRequests+" | Recibos: "+s.relay.retainedReceipts+" | Studio: "+s.studio.state;'+
  'const body=document.querySelector("#events");body.replaceChildren();for(const e of s.events.slice().reverse()){const tr=document.createElement("tr");for(const v of [e.time,e.id,e.event,e.preview]){const td=document.createElement("td");td.textContent=v||"";tr.append(td)}body.append(tr)}}catch{document.querySelector("#state").textContent="Falha de observação."}}'+
  'refresh();setInterval(refresh,1200)</script></main></html>';
}
export async function startWorkbench({platformRoot,provider='diagnostic'}){
  if(!platformRoot||!['diagnostic','openai-api'].includes(provider))throw Error('invalid_configuration');
  const {startRelayLab}=await import(pathToFileURL(resolve(platformRoot,'control-plane/labs/relay/relay.mjs')).href);
  const clients=Array.from({length:3},(_,i)=>({id:'studio-'+(i+1),secret:token()}));
  const adminToken=token(),cookie=token(),events=[];
  const record=e=>{events.push({time:new Date().toLocaleTimeString('pt-BR'),...e});if(events.length>130)events.shift()};
  let hub=null,studio=null,server=null,root=null,origin='',kids=[];
  const saved={url:process.env.ORDAX_RELAY_LAB_URL,token:process.env.ORDAX_RELAY_LAB_ADMIN_TOKEN};
  try{
    hub=await startRelayLab({devices:clients,adminToken,inferenceTimeoutMs:30000,
      inference:async request=>{
        record({id:request.deviceId,event:'central_received',preview:request.prompt.slice(0,140)});
        try{const answer=await gpt(request,provider);
          record({id:request.deviceId,event:'provider_returned',preview:answer.result.slice(0,180)});
          return answer;
        }catch{record({id:request.deviceId,event:'provider_failed',preview:'provider unavailable; no fabricated GPT reply'});throw Error('adapter_unavailable')}
      }});
    process.env.ORDAX_RELAY_LAB_URL=hub.url;
    process.env.ORDAX_RELAY_LAB_ADMIN_TOKEN=adminToken;
    studio=await createWebServer({bridge:{},runtime:null});
    server=createServer(async(req,res)=>{
      try{
        if(req.headers.host!==new URL(origin).host)return send(res,403,{ok:false,error:'invalid_host'});
        if(req.method==='GET'&&req.url==='/'){
          const nonce=token();res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',
            'set-cookie':'ordax_lab_operator='+cookie+'; HttpOnly; SameSite=Strict; Path=/',
            'content-security-policy':"default-src 'none'; style-src 'nonce-"+nonce+"'; script-src 'nonce-"+nonce+"'; connect-src 'self'; frame-src "+clients.map(c=>c.origin).filter(Boolean).join(' ')+"; frame-ancestors 'none'; base-uri 'none'"});
          res.end(html(clients,provider,studio.origin,nonce));return;
        }
        if(req.method!=='GET'||req.url!=='/api/state')return send(res,404,{ok:false,error:'not_found'});
        if(!String(req.headers.cookie||'').split(';').some(x=>x.trim()==='ordax_lab_operator='+cookie))return send(res,401,{ok:false,error:'operator_session_required'});
        const status=await fetch(hub.url+'/v1/admin/status',{headers:{authorization:'Bearer '+adminToken}});
        const projection=status.ok?await status.json():{activeRequests:0,retainedReceipts:0};
        const p=await fetch(studio.origin+'/src/index.html');
        const session=p.headers.get('set-cookie')?.split(';')[0]||'';
        const obs=await fetch(studio.origin+'/api/relay',{headers:{cookie:session}});
        const studioStatus=obs.ok?await obs.json():{state:'unavailable'};
        return send(res,200,{status:'connected-laboratory',clients:kids.filter(k=>k.exitCode===null).length,
          provider,relay:projection,studio:studioStatus,events});
      }catch{return send(res,503,{ok:false,error:'observer_unavailable'})}
    });
    origin=await listen(server);
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
          record({id:c.id,event:m.event,preview:String(m.preview||'').slice(0,180)});
      });
    }
    return {origin,studioOrigin:studio.origin,provider,
      clients:clients.map(c=>({id:c.id,origin:c.origin,pid:c.pid})),events,
      close:async()=>{
        kids.forEach(k=>k.kill());
        await Promise.allSettled([new Promise(ok=>server.close(ok)),studio.close(),hub.close()]);
        await rm(root,{force:true,recursive:true});
        if(saved.url===undefined)delete process.env.ORDAX_RELAY_LAB_URL;
        else process.env.ORDAX_RELAY_LAB_URL=saved.url;
        if(saved.token===undefined)delete process.env.ORDAX_RELAY_LAB_ADMIN_TOKEN;
        else process.env.ORDAX_RELAY_LAB_ADMIN_TOKEN=saved.token;
      }};
  }catch(e){
    kids.forEach(k=>k.kill());
    await Promise.allSettled([server?new Promise(ok=>server.close(ok)):Promise.resolve(),
      studio?.close(),hub?.close(),root?rm(root,{force:true,recursive:true}):Promise.resolve()]);
    throw e;
  }
}
const args=process.argv.slice(2);
if(args.includes('--self-test')){
  const root=args[args.indexOf('--platform-root')+1];
  const app=await startWorkbench({platformRoot:root});
  try{
    const p=await fetch(app.origin);assert.equal(p.status,200);
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
    console.log('ORDAX_THREE_PROCESS_RELAY_E2E=PASS');
    console.log('PROCESS_PIDS='+app.clients.map(c=>c.pid).join(',')+' REQUESTS=3 RECEIPTS=3');
    console.log('STUDIO_OBSERVER=REAL RELAY_HTTP=REAL SHARED_BROWSER_JAR=PASS CROSS_CLIENT_COOKIE=REJECTED');
    console.log('GPT_PROVIDER=DIAGNOSTIC_NOT_GPT CHATGPT_PLUGIN_E2E=NOT_TESTED PHYSICAL_PCS=1');
  }finally{await app.close()}
}else if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
  const root=args[args.indexOf('--platform-root')+1];
  const provider=args.includes('--openai-api')?'openai-api':'diagnostic';
  const app=await startWorkbench({platformRoot:root,provider});
  console.log('ORDAX_WORKBENCH_READY '+JSON.stringify({central:app.origin,studio:app.studioOrigin,
    clients:app.clients,provider,physicalMachines:1}));
  process.on('SIGINT',()=>app.close().then(()=>process.exit(0)));
  process.on('SIGTERM',()=>app.close().then(()=>process.exit(0)));
}
