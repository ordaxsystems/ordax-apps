import http from 'node:http';
import {forgeAccessIssuer,forgeAccessAudience,fetchForgeAccessKeys,
  verifyForgeAccessJwt} from './forge-cloudflare-access.mjs';

export const FORGE_CLOUDFLARE_ORIGIN_PORT=60253;
export const FORGE_CLOUDFLARE_HOSTNAME='forge-mcp.ordax.com.br';
const MAX_BODY=180_000;

function response(res,status,code){
  if(res.writableEnded||res.destroyed)return;
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify({error:code}));
}
function parseGrant(item){
  if(!item||item.projectId!=='forge_app'||
    !Number.isInteger(item.port)||item.port<1024||item.port>65535||
    typeof item.token!=='string'||!/^[A-Za-z0-9_-]{40,128}$/.test(item.token))
    throw Error('forge_cloudflare_local_grant_invalid');
  return item;
}

export function createForgeCloudflareBridge({
  getLocalGrant,ownerTrusted,verifyAccess=verifyForgeAccessJwt,
  keysProvider=fetchForgeAccessKeys,createServer=http.createServer,
  forward=http.request,port=FORGE_CLOUDFLARE_ORIGIN_PORT
}={}){
  if(typeof getLocalGrant!=='function'||typeof ownerTrusted!=='function'||
     !Number.isInteger(port)||port<1024||port>65535)
    throw Error('forge_cloudflare_bridge_ports_required');
  let server=null,active=null,keys=null,keysAt=0;
  let processingKeys=null,starting=false,generation=0;
  const status=()=>Object.freeze({running:server?.listening===true,
    localOnly:true,originPort:server?.listening?port:null,
    remoteChatGptConnected:false,accessVerified:false});
  async function keysFor(team){
    if(keys&&Date.now()-keysAt<60_000)return keys;
    if(processingKeys)return processingKeys;
    processingKeys=Promise.resolve(keysProvider(team)).then(value=>{
      if(!Array.isArray(value)||!value.length)throw Error('forge_cloudflare_keys_unavailable');
      keys=value;keysAt=Date.now();return keys;
    }).finally(()=>{processingKeys=null;});
    return processingKeys;
  }
  async function handle(req,res){
    const session=active;
    if(!session||server?.listening!==true)
      return response(res,503,'forge_cloudflare_bridge_stopped');
    if(req.url!=='/mcp'||!['POST','DELETE'].includes(req.method))
      return response(res,404,'forge_cloudflare_route_invalid');
    if(req.headers.host!==FORGE_CLOUDFLARE_HOSTNAME||
       req.headers.origin!==undefined)
      return response(res,403,'forge_cloudflare_host_rejected');
    const jwt=req.headers['cf-access-jwt-assertion'];
    if(typeof jwt!=='string'||!jwt)
      return response(res,401,'forge_cloudflare_access_required');
    try{
      await verifyAccess(jwt,{team:session.team,audience:session.audience,
        keys:await keysFor(session.team)});
    }catch{return response(res,403,'forge_cloudflare_access_rejected');}
    let grant;
    try{
      if(!ownerTrusted())throw Error('revoked');
      grant=parseGrant(getLocalGrant());
      if(grant.port!==session.grant.port||grant.token!==session.grant.token)
        throw Error('rotated');
    }catch{return response(res,403,'forge_cloudflare_owner_grant_revoked');}
    let size=0;const chunks=[];
    try{
      for await(const part of req){
        size+=part.length;
        if(size>MAX_BODY)return response(res,413,'forge_cloudflare_request_too_large');
        chunks.push(part);
      }
    }catch{return response(res,400,'forge_cloudflare_request_invalid');}
    if(active!==session)return response(res,403,'forge_cloudflare_bridge_revoked');
    const payload=Buffer.concat(chunks);
    const headers={
      Host:'127.0.0.1:'+grant.port,
      Authorization:'Bearer '+grant.token,
      'Content-Length':String(payload.length)
    };
    if(typeof req.headers['content-type']==='string')
      headers['Content-Type']=req.headers['content-type'];
    if(typeof req.headers.accept==='string')headers.Accept=req.headers.accept;
    if(typeof req.headers['mcp-session-id']==='string')
      headers['Mcp-Session-Id']=req.headers['mcp-session-id'];
    if(typeof req.headers['mcp-protocol-version']==='string')
      headers['Mcp-Protocol-Version']=req.headers['mcp-protocol-version'];
    await new Promise(resolve=>{
      const upstream=forward({hostname:'127.0.0.1',port:grant.port,path:'/mcp',
        method:req.method,headers,timeout:15_000},reply=>{
        if(active!==session||!ownerTrusted()){
          reply.resume();response(res,403,'forge_cloudflare_bridge_revoked');return resolve();
        }
        const allowedHeaders={'Cache-Control':'no-store'};
        for(const key of ['content-type','mcp-session-id','mcp-protocol-version'])
          if(typeof reply.headers[key]==='string')allowedHeaders[key]=reply.headers[key];
        res.writeHead(reply.statusCode||502,allowedHeaders);
        reply.on('error',()=>{if(!res.writableEnded)res.destroy();resolve();});
        reply.on('end',resolve);
        reply.pipe(res);
      });
      upstream.on('timeout',()=>upstream.destroy(Error('timeout')));
      upstream.on('error',()=>{
        response(res,502,'forge_cloudflare_local_mcp_unavailable');resolve();
      });
      upstream.end(payload);
    });
  }
  async function start({team,audience}={}){
    if(server||starting)throw Error('forge_cloudflare_bridge_already_running');
    starting=true;
    const expectedGeneration=generation;
    try{
      forgeAccessIssuer(team);forgeAccessAudience(audience);
      if(!ownerTrusted())throw Error('forge_cloudflare_owner_consent_required');
      const grant=parseGrant(getLocalGrant());
      // Revocation while JWKS is being fetched must not create a late listener.
      const trustedKeys=await keysFor(team);
      if(!trustedKeys.length)throw Error('forge_cloudflare_access_keys_unavailable');
      if(generation!==expectedGeneration||!ownerTrusted())
        throw Error('forge_cloudflare_start_cancelled');
      const listener=createServer((req,res)=>{void handle(req,res).catch(()=>{
        response(res,500,'forge_cloudflare_bridge_unavailable');
      });});
      server=listener;
      active={team,audience,grant};
      listener.headersTimeout=10000;listener.requestTimeout=15000;
      try{
        await new Promise((resolve,reject)=>{
          listener.once('error',reject);
          listener.listen(port,'127.0.0.1',()=>{
            listener.off('error',reject);resolve();
          });
        });
        if(generation!==expectedGeneration||server!==listener||!ownerTrusted())
          throw Error('forge_cloudflare_owner_consent_revoked');
        return status();
      }catch(error){
        if(server===listener){server=null;active=null;}
        try{listener.close();}catch{}
        throw error;
      }
    }finally{starting=false;}
  }
  async function stop(){
    generation++;
    active=null;const listener=server;server=null;
    if(listener)await new Promise(resolve=>{
      try{listener.close(()=>resolve());listener.closeAllConnections();}
      catch{resolve();}
    });
    keys=null;keysAt=0;
    return status();
  }
  return Object.freeze({start,stop,status});
}
