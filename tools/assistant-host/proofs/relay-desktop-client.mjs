// Lightweight spoke: a real independent Node process and loopback HTTP port.
// NOT a VM and NOT an installed Studio instance. Never enumerates host files.
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
const id=process.env.ORDAX_LAB_ID,secret=process.env.ORDAX_LAB_SECRET;
const hub=process.env.ORDAX_LAB_URL,central=process.env.ORDAX_LAB_CENTRAL_ORIGIN;
if(!id||!secret||!hub?.startsWith('http://127.0.0.1:')||!central?.startsWith('http://127.0.0.1:')||!process.send)process.exit(2);
// Cookie host scope ignores TCP ports: each embedded client MUST have its own
// cookie name or opening another client overwrites an already logged-in pane.
const cookie=randomBytes(32).toString('hex');
const cookieName='ordax_lab_spoke_'+id;
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data))};
const html=(nonce)=>'<html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
'<style nonce="'+nonce+'">:root{color-scheme:dark;font:14px system-ui;color:#e4f0ff;background:#142238}body{padding:18px;margin:0}'+
'textarea{width:100%;min-height:85px;padding:10px;color:#fff;background:#0d1725;border:1px solid #365c80;border-radius:8px;box-sizing:border-box}'+
'button{margin:10px 0;background:#a0cfff;border:0;border-radius:8px;padding:9px 14px;color:#102137;font-weight:bold;cursor:pointer}'+
'pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #31465f;border-radius:8px;padding:9px;min-height:56px}</style>'+
'<h3>'+id+'</h3><p>Cliente independente · PID '+process.pid+'</p>'+
'<textarea id="prompt" aria-label="Mensagem para a Central">Pedido de status deste Studio de teste.</textarea>'+
'<button id="send">Enviar para a Central</button><pre id="result" aria-live="polite">Aguardando.</pre>'+
'<script nonce="'+nonce+'">document.querySelector("#send").onclick=async()=>{const b=document.querySelector("#send");b.disabled=true;'+
'document.querySelector("#result").textContent="Enviando pelo Relay...";'+
'try{const r=await fetch("/api/send",{method:"POST",headers:{"content-type":"application/json"},'+
'body:JSON.stringify({prompt:document.querySelector("#prompt").value})});'+
'const data=await r.json();document.querySelector("#result").textContent=JSON.stringify({http:r.status,...data},null,2)'+
'}catch{document.querySelector("#result").textContent="Falha de transporte."}finally{b.disabled=false}}</script></html>';
let origin='';
const server=createServer(async(req,res)=>{
  try{
    if(req.headers.host!==new URL(origin).host)return json(res,403,{ok:false,error:'invalid_host'});
    if(req.method==='GET'&&req.url==='/'){
      const nonce=randomBytes(16).toString('hex');
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',
        'set-cookie':cookieName+'='+cookie+'; HttpOnly; SameSite=Strict; Path=/',
        'content-security-policy':"default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'nonce-"+nonce+
        "'; connect-src 'self'; frame-ancestors "+central+"; base-uri 'none'; form-action 'none'",
        'x-content-type-options':'nosniff'});
      res.end(html(nonce));return;
    }
    if(req.method!=='POST'||req.url!=='/api/send')return json(res,404,{ok:false,error:'not_found'});
    if(req.headers.origin!==origin||!String(req.headers.cookie||'').split(';').some(p=>p.trim()===cookieName+'='+cookie))return json(res,403,{ok:false,error:'spoke_session_required'});
    if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return json(res,415,{ok:false,error:'content_type'});
    const bytes=[];let count=0;for await(const chunk of req){count+=chunk.length;if(count>4096)return json(res,413,{ok:false,error:'too_large'});bytes.push(chunk)}
    let payload;try{payload=JSON.parse(Buffer.concat(bytes).toString('utf8'))}catch{return json(res,400,{ok:false,error:'bad_json'})}
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).join(',')!=='prompt'||typeof payload.prompt!=='string'||!payload.prompt.trim()||payload.prompt.length>2048)return json(res,400,{ok:false,error:'invalid_prompt'});
    const requestId=randomUUID();
    process.send({event:'submitted',id,preview:payload.prompt.slice(0,130)});
    const reply=await fetch(hub+'/v1/infer',{method:'POST',headers:{'content-type':'application/json',
      authorization:'Bearer '+secret,'x-ordax-lab-device-id':id},
      body:JSON.stringify({request_id:requestId,prompt:payload.prompt}),signal:AbortSignal.timeout(35000)});
    const data=await reply.json();
    process.send({event:'completed',id,preview:(data.result||data.error||'').slice(0,170)});
    json(res,reply.status,{ok:data.ok===true,request_id:requestId,
      result:typeof data.result==='string'?data.result:undefined,
      error:typeof data.error==='string'?data.error:undefined});
  }catch{process.send?.({event:'completed',id,preview:'transport_unavailable'});
    if(!res.writableEnded)json(res,503,{ok:false,error:'transport_unavailable'})}
});
await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done)});
origin='http://127.0.0.1:'+server.address().port;
process.send({event:'ready',id,pid:process.pid,origin});
process.on('disconnect',()=>server.close());
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
