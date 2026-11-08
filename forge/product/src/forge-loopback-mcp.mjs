import http from 'node:http';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';

export const FORGE_LOCAL_MCP_OPERATIONS=Object.freeze([
  'forge_discover','project_context','project_memory','project_administrator_snapshot','project_handoff',
  'project_files_status','project_files_list','project_file_read','project_file_write',
  // Bounded, project-bound work inspection is needed for a tool-using GPT to
  // reference actual task IDs and messages, never invent them from chat text.
  'work_list','work_get','work_messages'
]);
const MAX_REQUEST_BYTES=180_000;
const MAX_RESPONSE_BYTES=450_000;
const ID=/^project_[a-zA-Z0-9-]{1,100}$/;
const SESSION=/^[0-9a-f-]{36}$/;
const TOKEN=/^[A-Za-z0-9_-]{40,128}$/;
const MAX_MCP_SESSIONS=64;
const RECLAIM_IDLE_SESSION_MS=60*60_000; // Capacity pressure only, never a grant TTL.
// Owner approval lives for the running Forge process, not a fixed 30-minute
// wall clock. Credentials remain RAM-only, scoped and revoked on stop/exit.

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
// One listener, distinct owner-approved tokens and immutable project-scoped sessions.
// No remote listening, auto-connect, browser origins, persistence or OAuth claim.
export function createForgeLoopbackMcp({createMcp,authorizeProject,
  projectScope=projectId=>projectId,clock=Date.now}={}) {
  if(typeof createMcp!=='function'||typeof authorizeProject!=='function'||
     typeof projectScope!=='function'||typeof clock!=='function')
    throw Error('forge_mcp_transport_ports_required');
  let server=null,port=null;
  const sessions=new Map(),grants=new Map();
  let pendingInitializations=0;
  const bound=()=>server?.listening===true;
  const captureScope=projectId=>{
    const fingerprint=projectScope(projectId);
    if(typeof fingerprint!=='string'||!fingerprint||fingerprint.length>4096)
      throw Error('forge_mcp_project_scope_invalid');
    return fingerprint;
  };
  const valid=grant=>{
    if(!grant||grants.get(grant.projectId)!==grant)return false;
    try{return captureScope(grant.projectId)===grant.scopeFingerprint;}
    catch{return false;}
  };
  const authorizedGrants=()=>[...grants.values()].filter(valid);
  const active=()=>bound()&&authorizedGrants().length>0;
  const status=()=>{
    const current=bound()?authorizedGrants():[];
    return {running:current.length>0,transport:'http_streamable_local',
      scope:current[0]?.projectId??null,scopes:current.map(grant=>grant.projectId),
      grants:current.map(grant=>({projectId:grant.projectId,
        authorizedAt:new Date(grant.startedAt).toISOString(),
        authorizationLifetime:'until_revoke_or_forge_exit'})),
      loopbackOnly:true,tokenPersisted:false,remoteChatGptConnected:false,
      endpoint:current.length?'http://127.0.0.1:'+port+'/mcp':null,
      expiresAt:null,authorizationLifetime:'until_revoke_or_forge_exit',
      sessions:[...sessions.values()].filter(entry=>valid(entry.grant)).length};
  };

  async function onRequest(req,res){
    try{
      if(!active())return json(res,503,{error:'forge_mcp_disabled'});
      if(req.url!=='/mcp'||!['POST','DELETE','GET'].includes(req.method))
        return json(res,404,{error:'forge_mcp_route_unavailable'});
      // No browser origins: prevents web pages from using local owner powers.
      if(req.headers.origin!==undefined)return json(res,403,{error:'forge_mcp_browser_origin_denied'});
      if(req.headers.host!=='127.0.0.1:'+port)return json(res,403,{error:'forge_mcp_host_rejected'});
      const grant=authorizedGrants().find(item=>constantMatch(
        req.headers.authorization,'Bearer '+item.token));
      if(!grant)return json(res,401,{error:'forge_mcp_authorization_required'});
      if(req.method==='GET')return json(res,405,{error:'forge_mcp_sse_not_supported'},
        {Allow:'POST, DELETE'});
      const sessionId=req.headers['mcp-session-id'];
      if(req.method==='DELETE'){
        const entry=sessions.get(sessionId);
        if(typeof sessionId!=='string'||!entry||entry.grant!==grant)
          return json(res,404,{error:'forge_mcp_session_unavailable'});
        sessions.delete(sessionId);
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
        if(sessionId!==undefined)
          return json(res,409,{error:'forge_mcp_session_limit'});
        // Dead clients sometimes disappear without sending DELETE. Reclaim
        // only sessions inactive for over an hour AND only when all slots
        // are full. Active sessions and their per-project grants survive.
        if(sessions.size+pendingInitializations>=MAX_MCP_SESSIONS){
          const now=clock();
          for(const [id,entry] of sessions){
            if(!valid(entry.grant)||now-entry.lastActivity>RECLAIM_IDLE_SESSION_MS)
              sessions.delete(id);
          }
          if(sessions.size+pendingInitializations>=MAX_MCP_SESSIONS)
            return json(res,409,{error:'forge_mcp_session_limit'});
        }
        newSessionId=randomUUID();
        session=createMcp({projectId:grant.projectId,
          allowedOperations:FORGE_LOCAL_MCP_OPERATIONS});
      }else{
        if(typeof sessionId!=='string'||!SESSION.test(sessionId))
          return json(res,404,{error:'forge_mcp_session_required'});
        const entry=sessions.get(sessionId);
        // A valid token for B cannot reuse A's session, even on the same URL.
        if(!entry||entry.grant!==grant)
          return json(res,404,{error:'forge_mcp_session_required'});
        session=entry.handler;
        entry.lastActivity=clock();
      }
      // Project authority is revalidated for every request, not just approval.
      if(!authorizeProject(grant.projectId))
        return json(res,403,{error:'forge_mcp_project_revoked'});
      if(newSessionId)pendingInitializations++; // Reserve capacity before asynchronous MCP handshake.
      let result;
      try{result=await session.handle(message);}
      finally{if(newSessionId)pendingInitializations--;}
      if(newSessionId){
        if(!result?.result?.protocolVersion)return json(res,400,{error:'forge_mcp_initialize_rejected'});
        sessions.set(newSessionId,{handler:session,grant,lastActivity:clock()});
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
    // Restored credentials are allowed only on the trusted Electron owner path.
    async start(requestedProjectId,{listenPort=0,resumeToken=null}={}){
      if(!ID.test(requestedProjectId)||!authorizeProject(requestedProjectId))
        throw Error('forge_mcp_project_not_authorized');
      if(bound()){
        if(active())throw Error('forge_mcp_already_active');
        await this.stop();
      }
      if(!Number.isInteger(listenPort)||listenPort<0||listenPort>65535||
          (listenPort>0&&listenPort<1024)||
          (resumeToken!==null&&(typeof resumeToken!=='string'||!TOKEN.test(resumeToken))))
        throw Error('forge_mcp_resume_connection_invalid');
      const grant={projectId:requestedProjectId,
        scopeFingerprint:captureScope(requestedProjectId),
        token:resumeToken??randomBytes(32).toString('base64url'),startedAt:clock()};
      grants.clear();grants.set(requestedProjectId,grant);
      sessions.clear();
      server=http.createServer((req,res)=>{void onRequest(req,res);});
      server.requestTimeout=15_000;
      server.headersTimeout=10_000;
      server.maxRequestsPerSocket=120;
      try{
        await new Promise((resolve,reject)=>{
          server.once('error',reject);
          server.listen(listenPort,'127.0.0.1',()=>{
            server.off('error',reject);
            resolve();
          });
        });
        port=server.address().port;
        return {...status(),token:grant.token,projectId:grant.projectId};
      }catch(error){
        try{server?.close();}catch{}
        server=null;port=null;grants.clear();sessions.clear();
        throw error;
      }
    },
    addProject(requestedProjectId,{resumeToken=null}={}){
      if(!active())throw Error('forge_mcp_not_active');
      if(!ID.test(requestedProjectId)||!authorizeProject(requestedProjectId))
        throw Error('forge_mcp_project_not_authorized');
      if(valid(grants.get(requestedProjectId)))throw Error('forge_mcp_project_already_granted');
      if(authorizedGrants().length>=8)throw Error('forge_mcp_project_limit');
      // Every new project requires independent Owner consent. Revoked tokens
      // cannot be reused, even when the same project is authorized again.
      if(resumeToken!==null&&(typeof resumeToken!=='string'||!TOKEN.test(resumeToken)))
        throw Error('forge_mcp_resume_connection_invalid');
      for(const [id,entry] of sessions)
        if(entry.grant.projectId===requestedProjectId)sessions.delete(id);
      const grant={projectId:requestedProjectId,
        scopeFingerprint:captureScope(requestedProjectId),
        token:resumeToken??randomBytes(32).toString('base64url'),startedAt:clock()};
      grants.set(requestedProjectId,grant);
      return {...status(),token:grant.token,projectId:grant.projectId};
    },
    // Not exposed through IPC or status; Main uses this to seal credentials.
    localGrant(requestedProjectId){
      const grant=grants.get(requestedProjectId);
      if(!bound()||!valid(grant))return null;
      return {projectId:grant.projectId,token:grant.token,port};
    },
    async revokeProject(requestedProjectId){
      if(!grants.delete(requestedProjectId))throw Error('forge_mcp_project_not_granted');
      for(const [id,entry] of sessions)
        if(entry.grant.projectId===requestedProjectId)sessions.delete(id);
      if(!authorizedGrants().length)return this.stop();
      return status();
    },
    async stop(){
      const old=server;
      server=null;port=null;grants.clear();sessions.clear();
      if(old)await new Promise(resolve=>old.close(()=>resolve()));
      return status();
    }
  });
}
