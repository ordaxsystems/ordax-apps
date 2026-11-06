import http from 'node:http';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';

export const FORGE_LOCAL_MCP_OPERATIONS=Object.freeze([
  'project_context','project_memory','project_administrator_snapshot','project_handoff',
  'project_files_status','project_files_list','project_file_read','project_file_write'
]);
const MAX_REQUEST_BYTES=180_000;
const MAX_RESPONSE_BYTES=450_000;
const ID=/^project_[a-zA-Z0-9-]{1,100}$/;
const SESSION=/^[0-9a-f-]{36}$/;
const DEADLINE_MS=30*60_000;

function constantMatch(candidate,expected){
  if(typeof candidate!=='string'||candidate.length>512)return false;
  const a=Buffer.from(candidate),b=Buffer.from(expected);
  return a.length===b.length&&timingSafeEqual(a,b);
}
function json(res,status,value,headers={}) {
  const raw=JSON.stringify(value);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});
  res.end(raw);
}
async function bodyJson(req) {
  let size=0,chunks=[];
  for await(const chunk of req){
    size+=chunk.length;
    if(size>MAX_REQUEST_BYTES)throw Error('forge_mcp_request_too_large');
    chunks.push(chunk);
  }
  const input=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
  const result=JSON.parse(input);
  if(!result||typeof result!=='object'||Array.isArray(result))
    throw Error('forge_mcp_invalid_json');
  return result;
}

// Disabled until explicit owner action in the Electron settings panel.
// One project per ephemeral bearer token; no remote listening, auto-connect,
// browser origins, filesystem token, storage, OpenAI credential or OAuth claim.
export function createForgeLoopbackMcp({createMcp,authorizeProject,clock=Date.now}={}) {
  if(typeof createMcp!=='function'||typeof authorizeProject!=='function'||
     typeof clock!=='function')throw Error('forge_mcp_transport_ports_required');
  let server=null,token=null,projectId=null,port=null,startedAt=0;
  const sessions=new Map();
  const bound=()=>server?.listening===true;
  const active=()=>bound()&&clock()-startedAt<DEADLINE_MS;
  const status=()=>({running:active(),transport:'http_streamable_local',scope:projectId,
    loopbackOnly:true,tokenPersisted:false,remoteChatGptConnected:false,
    endpoint:active()?'http://127.0.0.1:'+port+'/mcp':null,
    expiresAt:active()?new Date(startedAt+DEADLINE_MS).toISOString():null,
    sessions:sessions.size});

  async function onRequest(req,res){
    try{
      if(!active())return json(res,503,{error:'forge_mcp_disabled_or_expired'});
      if(req.url!=='/mcp'||!['POST','DELETE','GET'].includes(req.method))
        return json(res,404,{error:'forge_mcp_route_unavailable'});
      // No browser origins: prevents web pages from using local owner powers.
      if(req.headers.origin!==undefined)return json(res,403,{error:'forge_mcp_browser_origin_denied'});
      if(req.headers.host!=='127.0.0.1:'+port)return json(res,403,{error:'forge_mcp_host_rejected'});
      if(!constantMatch(req.headers.authorization,'Bearer '+token))
        return json(res,401,{error:'forge_mcp_authorization_required'});
      if(req.method==='GET')return json(res,405,{error:'forge_mcp_sse_not_supported'},
        {Allow:'POST, DELETE'});
      const sessionId=req.headers['mcp-session-id'];
      if(req.method==='DELETE'){
        if(typeof sessionId!=='string'||!sessions.delete(sessionId))
          return json(res,404,{error:'forge_mcp_session_unavailable'});
        return json(res,200,{closed:true});
      }
      if(typeof req.headers['content-type']!=='string'||
        req.headers['content-type'].split(';')[0].trim().toLowerCase()!=='application/json')
        return json(res,415,{error:'forge_mcp_json_required'});
      if(req.headers['content-length']&&
        (!/^[0-9]+$/.test(req.headers['content-length'])||
          Number(req.headers['content-length'])>MAX_REQUEST_BYTES))
        return json(res,413,{error:'forge_mcp_request_too_large'});
      let message;
      try{message=await bodyJson(req);}
      catch{return json(res,400,{error:'forge_mcp_invalid_request'});}
      let session;
      let newSessionId=null;
      if(message.method==='initialize'){
        if(sessionId!==undefined||sessions.size>=4)
          return json(res,409,{error:'forge_mcp_session_limit'});
        newSessionId=randomUUID();
        session=createMcp({projectId,allowedOperations:FORGE_LOCAL_MCP_OPERATIONS});
      }else{
        if(typeof sessionId!=='string'||!SESSION.test(sessionId)||
          !sessions.has(sessionId))return json(res,404,{error:'forge_mcp_session_required'});
        session=sessions.get(sessionId);
      }
      // Project authorization is checked on each call, not only on activation.
      if(!authorizeProject(projectId))return json(res,403,{error:'forge_mcp_project_revoked'});
      const result=await session.handle(message);
      if(newSessionId){
        if(!result?.result?.protocolVersion)return json(res,400,{error:'forge_mcp_initialize_rejected'});
        sessions.set(newSessionId,session);
      }
      if(result===null){res.writeHead(202,{'Cache-Control':'no-store'});return res.end();}
      if(Buffer.byteLength(JSON.stringify(result))>MAX_RESPONSE_BYTES)
        return json(res,413,{error:'forge_mcp_response_too_large'});
      return json(res,200,result,newSessionId?{'Mcp-Session-Id':newSessionId}:{});
    }catch{
      if(!res.headersSent)return json(res,500,{error:'forge_mcp_unavailable'});
      res.destroy();
    }
  }
  return Object.freeze({
    status,
    async start(requestedProjectId){
      if(!ID.test(requestedProjectId)||!authorizeProject(requestedProjectId))
        throw Error('forge_mcp_project_not_authorized');
      if(bound()){
        if(active())throw Error('forge_mcp_already_active');
        await this.stop();
      }
      token=randomBytes(32).toString('base64url');
      projectId=requestedProjectId;
      sessions.clear();
      server=http.createServer((req,res)=>{void onRequest(req,res);});
      server.requestTimeout=15_000;
      server.headersTimeout=10_000;
      server.maxRequestsPerSocket=120;
      try{
        await new Promise((resolve,reject)=>{
          server.once('error',reject);
          server.listen(0,'127.0.0.1',()=>{
            server.off('error',reject);
            resolve();
          });
        });
        port=server.address().port;
        startedAt=clock();
        return {...status(),token};
      }catch(error){
        try{server?.close();}catch{}
        server=null;token=null;projectId=null;port=null;
        throw error;
      }
    },
    async stop(){
      const old=server;
      server=null;token=null;projectId=null;port=null;startedAt=0;
      sessions.clear();
      if(old)await new Promise(resolve=>old.close(()=>resolve()));
      return status();
    }
  });
}
