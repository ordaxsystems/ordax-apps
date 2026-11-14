import {createPublicKey,verify as verifySignature} from 'node:crypto';

export const FORGE_SUPABASE_ISSUER='https://jhfphsjptrpmtnzkpwud.supabase.co/auth/v1';
export const FORGE_SUPABASE_AUDIENCE='authenticated';
export const FORGE_SUPABASE_JWKS_URL='https://jhfphsjptrpmtnzkpwud.supabase.co/auth/v1/.well-known/jwks.json';
export const FORGE_SUPABASE_SCOPES=Object.freeze(['openid','email','offline_access']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALGS=new Set(['RS256','ES256']);
const CLOCK_SKEW=60;
let jwks=null,jwksAt=0,jwksPromise=null;

function decodeJson(part){
  try{return JSON.parse(Buffer.from(part,'base64url').toString('utf8'));}
  catch{return null;}
}
function audienceMatches(value){
  return value===FORGE_SUPABASE_AUDIENCE||
    (Array.isArray(value)&&value.every(item=>typeof item==='string')&&value.includes(FORGE_SUPABASE_AUDIENCE));
}
async function loadKeys(fetchImpl=fetch){
  if(jwks&&Date.now()-jwksAt<60_000)return jwks;
  if(jwksPromise)return jwksPromise;
  jwksPromise=(async()=>{
    const res=await fetchImpl(FORGE_SUPABASE_JWKS_URL,{
      headers:{accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10_000)
    });
    if(!res.ok)throw Error('forge_supabase_jwks_unavailable');
    const body=await res.json();
    if(!body||!Array.isArray(body.keys)||body.keys.length<1||body.keys.length>64)
      throw Error('forge_supabase_jwks_invalid');
    jwks=body.keys;jwksAt=Date.now();return jwks;
  })().finally(()=>{jwksPromise=null;});
  return jwksPromise;
}
function verificationAlgorithm(alg){
  if(alg==='RS256')return 'RSA-SHA256';
  if(alg==='ES256')return 'sha256';
  throw Error('forge_supabase_token_algorithm_invalid');
}
export function forgeSupabaseResourceMetadata(){
  return Object.freeze({
    resource:'https://forge-mcp.ordax.com.br/mcp',
    authorization_servers:[FORGE_SUPABASE_ISSUER],
    bearer_methods_supported:['header'],
    scopes_supported:[...FORGE_SUPABASE_SCOPES]
  });
}
export async function verifyForgeSupabaseBearer(authorization,{
  expectedSubject,fetchImpl=fetch,now=Math.floor(Date.now()/1000)
}={}){
  if(typeof authorization!=='string'||!authorization.startsWith('Bearer ')||authorization.length>16_384)
    throw Error('forge_supabase_auth_required');
  if(typeof expectedSubject!=='string'||!UUID.test(expectedSubject))
    throw Error('forge_supabase_owner_binding_required');
  const token=authorization.slice(7);
  const parts=token.split('.');
  if(parts.length!==3||parts.some(part=>!part))throw Error('forge_supabase_token_invalid');
  const header=decodeJson(parts[0]),payload=decodeJson(parts[1]);
  if(!header||!payload)throw Error('forge_supabase_token_invalid');
  const alg=typeof header.alg==='string'?header.alg:'';
  const kid=typeof header.kid==='string'?header.kid:'';
  if(!ALGS.has(alg)||!kid)throw Error('forge_supabase_token_algorithm_invalid');
  const exp=Number.isFinite(payload.exp)?payload.exp:0;
  const nbf=Number.isFinite(payload.nbf)?payload.nbf:null;
  if(payload.iss!==FORGE_SUPABASE_ISSUER||!audienceMatches(payload.aud)||
      typeof payload.sub!=='string'||!UUID.test(payload.sub)||
      payload.sub.toLowerCase()!==expectedSubject.toLowerCase()||
      payload.role!=='authenticated'||exp<=now-CLOCK_SKEW||
      (nbf!==null&&nbf>now+CLOCK_SKEW)||
      typeof payload.client_id!=='string'||!UUID.test(payload.client_id))
    throw Error('forge_supabase_token_claims_invalid');
  const keys=await loadKeys(fetchImpl);
  const jwk=keys.find(item=>item&&item.kid===kid&&(!item.alg||item.alg===alg));
  if(!jwk)throw Error('forge_supabase_signing_key_not_found');
  let key;
  try{key=createPublicKey({key:jwk,format:'jwk'});}
  catch{throw Error('forge_supabase_signing_key_invalid');}
  const valid=verifySignature(verificationAlgorithm(alg),
    Buffer.from(parts[0]+'.'+parts[1]),key,Buffer.from(parts[2],'base64url'));
  if(!valid)throw Error('forge_supabase_signature_invalid');
  return Object.freeze({
    subjectId:payload.sub,clientId:payload.client_id,
    issuer:payload.iss,expiresAt:exp,role:payload.role
  });
}
