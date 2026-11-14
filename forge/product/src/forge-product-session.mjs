import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {FORGE_SUPABASE_ISSUER} from './forge-supabase-auth.mjs';

export const FORGE_SUPABASE_URL='https://jhfphsjptrpmtnzkpwud.supabase.co';
export const FORGE_SUPABASE_PUBLISHABLE_KEY='sb_publishable_JHFaNBnQbkWLvdHI4zZDpQ_3RJWg6Bf';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL=/^[^\s@]{1,120}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
const OTP=/^[0-9]{6,8}$/;
const TOKEN_MAX=32_768;

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
  // Native owner endpoints deliberately require a normal Supabase user
  // session. OAuth-server client tokens carry client_id and belong to the
  // external MCP client boundary, not to the local Forge instance.
  if(payload.client_id!==undefined&&payload.client_id!==null)
    throw Error('forge_product_native_session_required');
  return {subjectId:payload.sub.toLowerCase(),issuer:payload.iss,
    expiresAt:Number(payload.exp)*1000};
}
async function responseJson(res,code){
  let body=null;try{body=await res.json();}catch{}
  if(!res.ok) {
    const message=typeof body?.error_code==='string'?body.error_code:
      typeof body?.code==='string'?body.code:code;
    throw Error(message||code);
  }
  return body;
}
export function createForgeProductSession({
  userRoot,safeStorage,fetchImpl=globalThis.fetch,now=()=>Date.now(),platform=process.platform
}={}){
  if(typeof userRoot!=='string'||!path.isAbsolute(userRoot)||
     typeof fetchImpl!=='function'||typeof now!=='function')
    throw Error('forge_product_session_ports_required');
  const file=path.join(userRoot,'config','forge-product-session.enc');
  let pendingEmail=null,refreshing=null;
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
  async function authFetch(endpoint,options={}){
    return fetchImpl(FORGE_SUPABASE_URL+endpoint,{
      ...options,redirect:'manual',signal:AbortSignal.timeout(15_000),
      headers:{apikey:FORGE_SUPABASE_PUBLISHABLE_KEY,accept:'application/json',
        ...(options.body?{'content-type':'application/json'}:{}),...(options.headers||{})}
    });
  }
  async function verifyUser(accessToken){
    const res=await authFetch('/auth/v1/user',{headers:{Authorization:'Bearer '+accessToken}});
    const body=await responseJson(res,'forge_product_user_verification_failed');
    if(!body||typeof body.id!=='string'||!UUID.test(body.id))
      throw Error('forge_product_user_verification_failed');
    return {id:body.id.toLowerCase(),email:typeof body.email==='string'?body.email.toLowerCase():null};
  }
  async function refresh(){
    if(refreshing)return refreshing;
    refreshing=(async()=>{
      const current=read();
      if(!current)throw Error('forge_product_session_unavailable');
      const res=await fetchImpl(FORGE_SUPABASE_URL+'/auth/v1/token?grant_type=refresh_token',{
        method:'POST',redirect:'manual',signal:AbortSignal.timeout(15_000),
        headers:{apikey:FORGE_SUPABASE_PUBLISHABLE_KEY,accept:'application/json',
          'content-type':'application/json'},
        body:JSON.stringify({refresh_token:current.refresh_token})
      });
      const body=await responseJson(res,'forge_product_refresh_failed');
      const identity=await verifyUser(body.access_token);
      const claims=validateSession(body);
      if(identity.id!==claims.subjectId)throw Error('forge_product_identity_mismatch');
      save(body,identity.email||current.email);
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
  return Object.freeze({
    supported,
    status(){
      const current=read();
      return {supported:supported(),connected:Boolean(current),
        subjectId:current?.subjectId??null,issuer:current?.issuer??null,
        email:current?.email??null,expiresAt:current?.expiresAt??null,
        otpPending:pendingEmail!==null};
    },
    async requestOtp(email){
      const normalized=String(email||'').trim().toLowerCase();
      if(!EMAIL.test(normalized))throw Error('forge_product_email_invalid');
      const res=await authFetch('/auth/v1/otp',{method:'POST',
        body:JSON.stringify({email:normalized,create_user:false})});
      await responseJson(res,'forge_product_otp_request_failed');
      pendingEmail=normalized;
      return {sent:true,email:normalized};
    },
    async verifyOtp({email,token}={}){
      const normalized=String(email||pendingEmail||'').trim().toLowerCase();
      const code=String(token||'').trim();
      if(!EMAIL.test(normalized)||!OTP.test(code)||pendingEmail!==normalized)
        throw Error('forge_product_otp_invalid');
      const res=await authFetch('/auth/v1/verify',{method:'POST',
        body:JSON.stringify({email:normalized,token:code,type:'email'})});
      const body=await responseJson(res,'forge_product_otp_verify_failed');
      const claims=validateSession(body);
      const identity=await verifyUser(body.access_token);
      if(identity.id!==claims.subjectId)throw Error('forge_product_identity_mismatch');
      pendingEmail=null;
      const saved=save(body,identity.email||normalized);
      return {connected:true,subjectId:saved.subjectId,issuer:saved.issuer,email:saved.email};
    },
    accessToken,refresh,
    disconnect(){pendingEmail=null;try{fs.rmSync(file,{force:true});}catch{} return {connected:false};}
  });
}
