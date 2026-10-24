import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

const SESSION_COOKIE_AGE_SECONDS = 60 * 60 * 24 * 30;
const MAX_BROWSER_SESSIONS = 8;
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const STATIC_FILES = new Map([
  ['/',['desktop/ui.html','text/html; charset=utf-8']],
  ['/ui.html',['desktop/ui.html','text/html; charset=utf-8']],
  ['/ui.css',['desktop/ui.css','text/css; charset=utf-8']],
  ['/ui.js',['desktop/ui.js','text/javascript; charset=utf-8']],
  ['/ui-stage.mjs',['desktop/ui-stage.mjs','text/javascript; charset=utf-8']],
  ['/orchestrator-ui.mjs',['desktop/orchestrator-ui.mjs','text/javascript; charset=utf-8']],
  ['/host-browser-bridge.js',['desktop/host-browser-bridge.js','text/javascript; charset=utf-8']],
  ['/src/provider-compose-availability.mjs',['src/provider-compose-availability.mjs','text/javascript; charset=utf-8']],
  ['/src/task-navigation-status.mjs',['src/task-navigation-status.mjs','text/javascript; charset=utf-8']],
  ['/src/supervisor-role-presets.mjs',['src/supervisor-role-presets.mjs','text/javascript; charset=utf-8']]
]);

// Presentation transport only. All operations still execute the registered
// Electron handlers, which retain the OrchestratorService and Store SSOT.
export const HOST_BROWSER_METHODS = Object.freeze({
  coordinatorChatStatus:['ordax:orchestrator:chat-status',()=>[]],
  coordinatorChatEnable:['ordax:orchestrator:chat-enable',a=>[a[0]]],
  orchestratorInvoke:['ordax:orchestrator:invoke',a=>[{operation:a[0],input:a[1]??{}}]],
  orchestratorMcp:['ordax:orchestrator:mcp',a=>[a[0]]],
  supervisorStatus:['ordax:supervisor:status',()=>[]],
  supervisorSaveKey:['ordax:supervisor:key:save',a=>[a[0]]],
  supervisorRemoveKey:['ordax:supervisor:key:remove',()=>[]],
  setTaskSupervisorRole:['ordax:tasks:supervisor-role:set',a=>[{taskId:a[0],role:a[1]}]],
  supervisorPlan:['ordax:supervisor:plan',a=>[a[0]]],
  supervisorRecoverable:['ordax:supervisor:recoverable',a=>[a[0]]],
  supervisorInspect:['ordax:supervisor:inspect',a=>[a[0]]],
  supervisorApprove:['ordax:supervisor:approve',a=>[a[0]]],
  supervisorDispatch:['ordax:supervisor:dispatch',a=>[a[0]]],
  workspace:['ordax:workspace:get',()=>[]],
  listTasks:['ordax:tasks:list',()=>[]],
  createTask:['ordax:tasks:create',a=>[a[0]]],
  getTask:['ordax:tasks:get',a=>[a[0]]],
  openTask:['ordax:tasks:open',a=>[a[0]]],
  inspectLinkedThread:['ordax:tasks:inspect-linked-thread',a=>[a[0]]],
  loadMessagePage:['ordax:tasks:messages:page',a=>[{taskId:a[0],before:a[1]??null}]],
  renameTask:['ordax:tasks:rename',a=>[{taskId:a[0],title:a[1]}]],
  setDraft:['ordax:tasks:draft:set',a=>[{taskId:a[0],content:a[1],revision:a[2]}]],
  resumeCapsule:['ordax:tasks:resume-capsule',a=>[a[0]]],
  rotateConversation:['ordax:tasks:rotate-conversation',a=>[a[0]]],
  upsertProjectMemory:['ordax:tasks:memory:upsert',a=>[{taskId:a[0],item:a[1]}]],
  archiveProjectMemory:['ordax:tasks:memory:archive',a=>[{taskId:a[0],memoryId:a[1]}]],
  scanMemoryCandidates:['ordax:tasks:memory:candidates:scan',a=>[a[0]]],
  reviewMemoryCandidate:['ordax:tasks:memory:candidates:review',a=>[{taskId:a[0],candidateId:a[1],action:a[2],changes:a[3]}]],
  send:['ordax:tasks:send',a=>[a[0]]],
  labProfileProof:['ordax:lab:profile-proof',()=>[]],
  labBuildProof:['ordax:lab:build-proof',()=>[]],
  providerStatus:['ordax:provider:status',()=>[]],
  providerDiagnostic:['ordax:provider:diagnostic',()=>[]],
  getObserverMode:['ordax:provider:observer-mode:get',()=>[]],
  setObserverMode:['ordax:provider:observer-mode:set',a=>[a[0]]],
  login:['ordax:provider:login',()=>[]],
  home:['ordax:provider:home',()=>[]],
  reload:['ordax:provider:reload',()=>[]],
  setChatVisible:['ordax:chat:visible',a=>[a[0]]]
});

const EVENT_NAMES=new Set(['orchestrator-changed','run-started','task-stage','task-stream','confirm']);
const MIME=new Map([['.css','text/css; charset=utf-8'],['.gif','image/gif'],['.jpeg','image/jpeg'],['.jpg','image/jpeg'],['.png','image/png'],['.svg','image/svg+xml'],['.webp','image/webp'],['.avif','image/avif']]);

function json(res,status,value,headers={}) {
  const body=Buffer.from(JSON.stringify(value));
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':body.length,
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers});
  res.end(body);
}
function cookieValue(header,name) {
  for(const part of String(header||'').split(';')) {
    const [key,...value]=part.trim().split('=');
    if(key===name)return value.join('=');
  }
  return '';
}
async function readJson(req) {
  let length=0;const chunks=[];
  for await(const chunk of req) {
    length+=chunk.length;
    if(length>MAX_REQUEST_BYTES)throw Object.assign(new Error('request_too_large'),{statusCode:413});
    chunks.push(chunk);
  }
  if(!length)return {};
  try {const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}
  catch {throw Object.assign(new Error('invalid_json'),{statusCode:400});}
}
function safeErrorCode(error) {
  const code=String(error?.code||error?.message||'');
  return /^[a-z][a-z0-9_]{1,80}$/i.test(code)?code:'request_failed';
}
function sanitizeResult(value) {
  if(Array.isArray(value))return value.map(sanitizeResult);
  if(!value||typeof value!=='object')return value;
  const result={};
  for(const [key,item] of Object.entries(value)) {
    if(/^(?:local_path|absolute_path|api_key|apiKey|secret|authorization|credential)$/i.test(key))continue;
    result[key]=sanitizeResult(item);
  }
  if(typeof result.url==='string'&&result.url.startsWith('ordax-asset://local/')) {
    try {result.url=`/assets/${encodeURIComponent(decodeURIComponent(result.url.slice('ordax-asset://local/'.length)))}`;}
    catch {delete result.url;}
  }
  return result;
}

export function createHostBrowserServer({productRoot,assetsRoot,invoke,readAsset,onShutdown=()=>{}}) {
  if(typeof invoke!=='function')throw new TypeError('host_browser_invoke_required');
  const root=path.resolve(productRoot);
  const sessions=new Map();
  const streams=new Set();
  const confirmations=new Map();
  let origin=null,closed=false;
  const sessionCookie=session=>`ordax_host_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_COOKIE_AGE_SECONDS}`;
  function authenticated(req) {
    const token=cookieValue(req.headers.cookie,'ordax_host_session');
    const lastSeen=sessions.get(token);
    if(!lastSeen||Date.now()-lastSeen>SESSION_COOKIE_AGE_SECONDS*1000){sessions.delete(token);return null;}
    sessions.set(token,Date.now());
    return token;
  }
  const server=http.createServer(async(req,res)=>{
    const expectedHost=origin?.slice('http://'.length);
    if(!origin||req.headers.host!==expectedHost)return json(res,421,{error:'host_rejected'});
    let url;
    try {url=new URL(req.url||'/',origin);}catch{return json(res,400,{error:'invalid_url'});}
    const writes=new Set(['POST','PUT','PATCH','DELETE']);
    if(writes.has(req.method||'')&&(req.headers.origin!==origin||req.headers['content-type']?.split(';')[0]!=='application/json'))
      return json(res,403,{error:'origin_rejected'});

    if(req.method==='GET'&&STATIC_FILES.has(url.pathname)) {
      const relative=STATIC_FILES.get(url.pathname)[0];
      try {
        const file=path.resolve(root,relative);
        if(!file.startsWith(root+path.sep))return json(res,404,{error:'not_found'});
        const body=await fs.readFile(file);
        res.writeHead(200,{'Content-Type':STATIC_FILES.get(url.pathname)[1],'Content-Length':body.length,'Cache-Control':'no-store',
          'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
          'Content-Security-Policy':"default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});
        return res.end(body);
      }catch{return json(res,404,{error:'not_found'});}
    }

    if(req.method==='POST'&&url.pathname==='/api/session') {
      let body;try{body=await readJson(req);}catch(error){return json(res,error.statusCode||400,{error:safeErrorCode(error)});}
      if(Object.keys(body).length)return json(res,400,{error:'unexpected_session_payload'});
      const existing=authenticated(req);
      if(existing)return json(res,200,{ok:true},{'Set-Cookie':sessionCookie(existing)});
      // The browser creates its local session through same-origin JSON. Every
      // write requires the exact loopback Origin and JSON content type, so a
      // lost first Set-Cookie response can be retried without broadening CORS.
      for(const [token,lastSeen] of sessions)if(Date.now()-lastSeen>SESSION_COOKIE_AGE_SECONDS*1000)sessions.delete(token);
      if(sessions.size>=MAX_BROWSER_SESSIONS)return json(res,429,{error:'host_session_limit'});
      const session=randomBytes(32).toString('base64url');sessions.set(session,Date.now());
      return json(res,200,{ok:true},{'Set-Cookie':sessionCookie(session)});
    }

    const session=authenticated(req);
    if(!session)return json(res,401,{error:'host_session_required'});

    if(req.method==='GET'&&url.pathname==='/api/events') {
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive',
        'X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});
      res.write('retry: 2000\n\n');
      const client={session,res};streams.add(client);
      const heartbeat=setInterval(()=>{if(!res.destroyed)res.write(': keepalive\n\n');},15000);
      req.on('close',()=>{clearInterval(heartbeat);streams.delete(client);});
      return;
    }

    if(req.method==='POST'&&url.pathname==='/api/confirmation') {
      let body;try{body=await readJson(req);}catch(error){return json(res,error.statusCode||400,{error:safeErrorCode(error)});}
      const pending=confirmations.get(String(body.id||''));
      if(!pending||pending.session!==session||typeof body.approved!=='boolean')return json(res,409,{error:'confirmation_not_pending'});
      confirmations.delete(String(body.id));pending.resolve(body.approved);return json(res,200,{resolved:true});
    }

    if(req.method==='POST'&&url.pathname==='/api/shutdown') {
      json(res,202,{stopping:true});setImmediate(()=>onShutdown());return;
    }

    if(req.method==='POST'&&url.pathname==='/api/invoke') {
      let body;try{body=await readJson(req);}catch(error){return json(res,error.statusCode||400,{error:safeErrorCode(error)});}
      const method=String(body.method||''),definition=HOST_BROWSER_METHODS[method];
      if(!definition||!Array.isArray(body.args))return json(res,404,{error:'method_not_available'});
      try {
        const args=definition[1](body.args);
        if(!Array.isArray(args))return json(res,400,{error:'invalid_arguments'});
        return json(res,200,sanitizeResult(await invoke(method,definition[0],args,{session})));
      }catch(error){return json(res,400,{error:safeErrorCode(error)});}
    }

    if(req.method==='GET'&&url.pathname.startsWith('/assets/')) {
      try {
        const id=decodeURIComponent(url.pathname.slice('/assets/'.length));
        const asset=typeof readAsset==='function'?await readAsset(id,{session}):null;
        if(!asset?.local_path)return json(res,404,{error:'not_found'});
        const safeRoot=await fs.realpath(path.resolve(assetsRoot));
        const resolved=await fs.realpath(path.resolve(asset.local_path));
        if(!resolved.startsWith(safeRoot+path.sep))return json(res,404,{error:'not_found'});
        const body=await fs.readFile(resolved);
        res.writeHead(200,{'Content-Type':MIME.get(path.extname(resolved).toLowerCase())||'application/octet-stream',
          'Content-Length':body.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
        return res.end(body);
      }catch{return json(res,404,{error:'not_found'});}
    }
    return json(res,404,{error:'not_found'});
  });

  return {
    async listen() {
      if(origin)throw new Error('host_browser_already_listening');
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
      origin=`http://127.0.0.1:${server.address().port}`;
      return {origin,url:origin+'/'};
    },
    publish(name,payload) {
      if(!EVENT_NAMES.has(name))return;
      const frame=`event: ${name}\ndata: ${JSON.stringify(sanitizeResult(payload))}\n\n`;
      for(const client of streams)if(!client.res.destroyed)client.res.write(frame);
    },
    confirm({title,message,detail,approveLabel='Confirmar',cancelLabel='Cancelar'},{timeoutMs=120000}={}) {
      if(closed||streams.size===0)return Promise.resolve(false);
      const active=[...streams].filter(client=>sessions.has(client.session)&&!client.res.destroyed).at(-1);
      if(!active)return Promise.resolve(false);
      const id=randomUUID();
      return new Promise(resolve=>{
        const timer=setTimeout(()=>{confirmations.delete(id);resolve(false);},timeoutMs);
        confirmations.set(id,{session:active.session,resolve:value=>{clearTimeout(timer);resolve(value);}});
        const payload={id,title:String(title||''),message:String(message||''),detail:String(detail||''),approveLabel:String(approveLabel),cancelLabel:String(cancelLabel)};
        active.res.write(`event: confirm\ndata: ${JSON.stringify(sanitizeResult(payload))}\n\n`);
      });
    },
    async close() {
      closed=true;
      for(const pending of confirmations.values())pending.resolve(false);
      confirmations.clear();
      for(const client of streams)client.res.end();streams.clear();sessions.clear();
      if(server.listening)await new Promise(resolve=>server.close(resolve));
    }
  };
}
