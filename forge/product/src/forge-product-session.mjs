import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {FORGE_SUPABASE_ISSUER} from './forge-supabase-auth.mjs';

export const FORGE_SUPABASE_URL='https://jhfphsjptrpmtnzkpwud.supabase.co';
export const FORGE_SUPABASE_PUBLISHABLE_KEY='sb_publishable_JHFaNBnQbkWLvdHI4zZDpQ_3RJWg6Bf';
export const FORGE_NATIVE_OAUTH_CLIENT_ID='6a94ae80-a59c-4f48-a32c-2e15da34374f';
export const FORGE_NATIVE_OAUTH_PORT=8767;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL=/^[^\s@]{1,120}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
const TOKEN_MAX=32_768;
const CALLBACK_PATH='/oauth/callback';
const OAUTH_TIMEOUT_MS=5*60_000;

function decodePayload(token){
  if(typeof token!=='string'||token.length<20||token.length>TOKEN_MAX)return null;
  const parts=token.split('.');
  if(parts.length!==3)return null;
  try{return JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));}
  catch{return null;}
}
function validateSession(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||
     typeof body.access_token!=='string'||body.access_token.length>TOKEN_MAX||
     typeof body.refresh_token!=='string'||body.refresh_token.length>TOKEN_MAX)
    throw Error('forge_product_session_invalid');
  const payload=decodePayload(body.access_token);
  if(!payload||payload.iss!==FORGE_SUPABASE_ISSUER||payload.aud!=='authenticated'||
     payload.role!=='authenticated'||typeof payload.sub!=='string'||!UUID.test(payload.sub)||
     !Number.isFinite(payload.exp))
    throw Error('forge_product_session_invalid');
  let clientId=null,mode='legacy';
  if(payload.client_id!==undefined&&payload.client_id!==null){
    if(typeof payload.client_id!=='string'||
       payload.client_id.toLowerCase()!==FORGE_NATIVE_OAUTH_CLIENT_ID)
      throw Error('forge_product_native_oauth_client_invalid');
    clientId=payload.client_id.toLowerCase();
    mode='oauth';
  }
  return {subjectId:payload.sub.toLowerCase(),issuer:payload.iss,
    expiresAt:Number(payload.exp)*1000,clientId,mode};
}
async function responseJson(res,code){
  let body=null;try{body=await res.json();}catch{}
  if(!res.ok){
    const message=typeof body?.error_code==='string'?body.error_code:
      typeof body?.error==='string'?body.error:
      typeof body?.code==='string'?body.code:code;
    throw Error(message||code);
  }
  return body;
}
function sameSecret(a,b){
  const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));
  return x.length===y.length&&x.length>0&&timingSafeEqual(x,y);
}
function base64urlRandom(bytes=32){return randomBytes(bytes).toString('base64url');}

export function createForgeProductSession({
  userRoot,safeStorage,fetchImpl=globalThis.fetch,now=()=>Date.now(),platform=process.platform,
  openExternal=null,oauthPort=FORGE_NATIVE_OAUTH_PORT
}={}){
  if(typeof userRoot!=='string'||!path.isAbsolute(userRoot)||
     typeof fetchImpl!=='function'||typeof now!=='function'||
     !Number.isInteger(oauthPort)||oauthPort<0||oauthPort>65535)
    throw Error('forge_product_session_ports_required');
  const file=path.join(userRoot,'config','forge-product-session.enc');
  let refreshing=null,connecting=null;
  const supported=()=>platform==='win32'&&safeStorage?.isEncryptionAvailable?.()===true&&
    typeof safeStorage.encryptString==='function'&&typeof safeStorage.decryptString==='function';
  function read(){
    if(!supported()||!fs.existsSync(file))return null;
    try{
      const raw=safeStorage.decryptString(fs.readFileSync(file));
      const data=JSON.parse(raw);
      const claims=validateSession(data);
      if(typeof data.email!=='string'||!EMAIL.test(data.email))return null;
      return {...data,...claims};
    }catch{return null;}
  }
  function save(body,email){
    if(!supported())throw Error('forge_product_secure_storage_unavailable');
    const claims=validateSession(body);
    const normalized=String(email||body?.user?.email||'').trim().toLowerCase();
    if(!EMAIL.test(normalized))throw Error('forge_product_email_invalid');
    const value=JSON.stringify({access_token:body.access_token,
      refresh_token:body.refresh_token,email:normalized});
    const sealed=safeStorage.encryptString(value);
    if(!Buffer.isBuffer(sealed)||sealed.length<32)throw Error('forge_product_session_seal_failed');
    fs.mkdirSync(path.dirname(file),{recursive:true});
    const temp=file+'.'+randomUUID()+'.tmp';
    try{fs.writeFileSync(temp,sealed,{flag:'wx',mode:0o600});fs.renameSync(temp,file);}
    catch(error){try{fs.rmSync(temp,{force:true});}catch{} throw error;}
    return {...claims,email:normalized};
  }
  async function verifyUser(accessToken){
    const res=await fetchImpl(FORGE_SUPABASE_URL+'/auth/v1/user',{
      method:'GET',redirect:'manual',signal:AbortSignal.timeout(15_000),
      headers:{apikey:FORGE_SUPABASE_PUBLISHABLE_KEY,accept:'application/json',
        Authorization:'Bearer '+accessToken}
    });
    const body=await responseJson(res,'forge_product_user_verification_failed');
    if(!body||typeof body.id!=='string'||!UUID.test(body.id))
      throw Error('forge_product_user_verification_failed');
    return {id:body.id.toLowerCase(),email:typeof body.email==='string'?body.email.toLowerCase():null};
  }
  async function persistVerified(body,fallbackEmail=''){
    const claims=validateSession(body);
    const identity=await verifyUser(body.access_token);
    if(identity.id!==claims.subjectId)throw Error('forge_product_identity_mismatch');
    const saved=save(body,identity.email||fallbackEmail);
    return {connected:true,subjectId:saved.subjectId,issuer:saved.issuer,
      email:saved.email,clientId:saved.clientId,mode:saved.mode};
  }
  async function refresh(){
    if(refreshing)return refreshing;
    refreshing=(async()=>{
      const current=read();
      if(!current)throw Error('forge_product_session_unavailable');
      let res;
      if(current.mode==='oauth'){
        res=await fetchImpl(FORGE_SUPABASE_URL+'/auth/v1/oauth/token',{
          method:'POST',redirect:'manual',signal:AbortSignal.timeout(15_000),
          headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({grant_type:'refresh_token',
            client_id:FORGE_NATIVE_OAUTH_CLIENT_ID,refresh_token:current.refresh_token}).toString()
        });
      }else{
        // Transitional compatibility for an already sealed pre-PKCE Forge session.
        // New sign-ins never use this endpoint.
        res=await fetchImpl(FORGE_SUPABASE_URL+'/auth/v1/token?grant_type=refresh_token',{
          method:'POST',redirect:'manual',signal:AbortSignal.timeout(15_000),
          headers:{apikey:FORGE_SUPABASE_PUBLISHABLE_KEY,accept:'application/json',
            'content-type':'application/json'},
          body:JSON.stringify({refresh_token:current.refresh_token})
        });
      }
      const body=await responseJson(res,'forge_product_refresh_failed');
      await persistVerified(body,current.email);
      return read();
    })().finally(()=>{refreshing=null;});
    return refreshing;
  }
  async function accessToken(){
    let current=read();
    if(!current)throw Error('forge_product_session_unavailable');
    if(current.expiresAt<=now()+90_000)current=await refresh();
    return current.access_token;
  }
  async function connectBrowser(){
    if(connecting)return connecting;
    if(!supported())throw Error('forge_product_secure_storage_unavailable');
    if(typeof openExternal!=='function')throw Error('forge_product_browser_unavailable');
    connecting=(async()=>{
      const verifier=base64urlRandom(48);
      const challenge=createHash('sha256').update(verifier).digest('base64url');
      const state=base64urlRandom(32);
      let server,timeout;
      try{
        const completion=new Promise((resolve,reject)=>{
          let settled=false;
          const finish=(error,value)=>{
            if(settled)return;settled=true;
            if(timeout)clearTimeout(timeout);
            try{server?.closeIdleConnections?.();}catch{}
            try{server?.closeAllConnections?.();}catch{}
            try{server?.close();}catch{}
            error?reject(error):resolve(value);
          };
          server=http.createServer(async(req,res)=>{
            try{
              if(req.method!=='GET')throw Error('forge_product_oauth_callback_invalid');
              const url=new URL(req.url||'','http://127.0.0.1');
              if(url.pathname!==CALLBACK_PATH)throw Error('forge_product_oauth_callback_invalid');
              const allowed=new Set(['code','state','error','error_description']);
              if([...url.searchParams.keys()].some(key=>!allowed.has(key)))
                throw Error('forge_product_oauth_callback_invalid');
              if(url.searchParams.get('error'))
                throw Error('forge_product_oauth_denied');
              if(!sameSecret(url.searchParams.get('state'),state))
                throw Error('forge_product_oauth_state_invalid');
              const code=url.searchParams.get('code')||'';
              if(code.length<8||code.length>4096)throw Error('forge_product_oauth_code_invalid');
              const address=server.address();
              if(!address||typeof address==='string')throw Error('forge_product_oauth_loopback_invalid');
              const redirectUri='http://127.0.0.1:'+address.port+CALLBACK_PATH;
              const tokenRes=await fetchImpl(FORGE_SUPABASE_URL+'/auth/v1/oauth/token',{
                method:'POST',redirect:'manual',signal:AbortSignal.timeout(15_000),
                headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded'},
                body:new URLSearchParams({grant_type:'authorization_code',code,
                  client_id:FORGE_NATIVE_OAUTH_CLIENT_ID,redirect_uri:redirectUri,
                  code_verifier:verifier}).toString()
              });
              const body=await responseJson(tokenRes,'forge_product_oauth_exchange_failed');
              const account=await persistVerified(body);
              res.writeHead(200,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store',
                'connection':'close'});
              res.end('Conta OrdaX conectada ao Forge. Você pode fechar esta aba.');
              finish(null,account);
            }catch(error){
              try{
                res.writeHead(400,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store',
                  'connection':'close'});
                res.end('Não foi possível concluir a conexão da Conta OrdaX.');
              }catch{}
              finish(error);
            }
          });
          server.once('error',error=>finish(error));
          timeout=setTimeout(()=>finish(Error('forge_product_oauth_timeout')),OAUTH_TIMEOUT_MS);
          timeout.unref?.();
        });
        await new Promise((resolve,reject)=>{
          const onError=error=>reject(error);
          server.once('error',onError);
          server.listen(oauthPort,'127.0.0.1',()=>{
            server.off('error',onError);resolve();
          });
        });
        const address=server.address();
        if(!address||typeof address==='string')throw Error('forge_product_oauth_loopback_invalid');
        const redirectUri='http://127.0.0.1:'+address.port+CALLBACK_PATH;
        const authorize=new URL(FORGE_SUPABASE_URL+'/auth/v1/oauth/authorize');
        authorize.search=new URLSearchParams({
          response_type:'code',client_id:FORGE_NATIVE_OAUTH_CLIENT_ID,
          redirect_uri:redirectUri,state,code_challenge:challenge,
          code_challenge_method:'S256',scope:'openid email offline_access'
        }).toString();
        await openExternal(authorize.toString());
        return await completion;
      }finally{
        if(timeout)clearTimeout(timeout);
        try{server?.close();}catch{}
      }
    })().finally(()=>{connecting=null;});
    return connecting;
  }
  return Object.freeze({
    supported,
    status(){
      const current=read();
      return {supported:supported(),connected:Boolean(current),
        subjectId:current?.subjectId??null,issuer:current?.issuer??null,
        email:current?.email??null,expiresAt:current?.expiresAt??null,
        clientId:current?.clientId??null,mode:current?.mode??null,
        authPending:connecting!==null};
    },
    connectBrowser,accessToken,refresh,
    disconnect(){try{fs.rmSync(file,{force:true});}catch{} return {connected:false};}
  });
}
