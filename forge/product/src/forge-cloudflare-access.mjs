import {createPublicKey,verify} from 'node:crypto';

const TEAMS=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const BASE64URL=/^[A-Za-z0-9_-]+$/;
const MAX_JWT_BYTES=12000;

// Cloudflare Access is the OAuth authority; a tunnel token is NOT authorization.
// Forge independently validates the signature, issuer, audience, dates and owner
// identity of every request before any project-bound local MCP call.
export function forgeAccessIssuer(team){
  if(typeof team!=='string'||!TEAMS.test(team))
    throw Error('forge_cloudflare_access_team_invalid');
  return 'https://'+team+'.cloudflareaccess.com';
}
export function forgeAccessAudience(aud){
  if(typeof aud!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(aud))
    throw Error('forge_cloudflare_access_audience_invalid');
  return aud;
}
function decodePart(part){
  if(!BASE64URL.test(part)||part.length>MAX_JWT_BYTES)
    throw Error('forge_cloudflare_access_jwt_invalid');
  try{
    const value=JSON.parse(Buffer.from(part,'base64url').toString('utf8'));
    if(!value||typeof value!=='object'||Array.isArray(value))
      throw Error('invalid');
    return value;
  }catch{throw Error('forge_cloudflare_access_jwt_invalid');}
}
export async function fetchForgeAccessKeys(team,{request=fetch}={}){
  const issuer=forgeAccessIssuer(team);
  let res;
  try{res=await request(issuer+'/cdn-cgi/access/certs',{
    method:'GET',redirect:'error',signal:AbortSignal.timeout(5000)
  });}
  catch{throw Error('forge_cloudflare_access_keys_unavailable');}
  if(res.status!==200)throw Error('forge_cloudflare_access_keys_unavailable');
  let data;
  try{data=await res.json();}catch{throw Error('forge_cloudflare_access_keys_invalid');}
  if(!Array.isArray(data?.keys)||data.keys.length>20)
    throw Error('forge_cloudflare_access_keys_invalid');
  return data.keys;
}
export async function verifyForgeAccessJwt(token,{
  team,audience,keys=null,request=fetch,now=Date.now
}={}){
  const issuer=forgeAccessIssuer(team),expectedAud=forgeAccessAudience(audience);
  if(typeof token!=='string'||token.length>MAX_JWT_BYTES)
    throw Error('forge_cloudflare_access_token_required');
  const parts=token.split('.');
  if(parts.length!==3||!BASE64URL.test(parts[2]))
    throw Error('forge_cloudflare_access_jwt_invalid');
  const [header,payload]=[decodePart(parts[0]),decodePart(parts[1])];
  if(header.alg!=='RS256'||typeof header.kid!=='string'||!header.kid)
    throw Error('forge_cloudflare_access_algorithm_rejected');
  const seconds=Math.floor(now()/1000);
  const acceptedAud=Array.isArray(payload.aud)?payload.aud:[payload.aud];
  if(payload.iss!==issuer||!acceptedAud.includes(expectedAud)||
     !Number.isInteger(payload.exp)||payload.exp<=seconds||
     !Number.isInteger(payload.iat)||payload.iat>seconds+60||
     (payload.nbf!==undefined&&(!Number.isInteger(payload.nbf)||payload.nbf>seconds))||
     typeof payload.email!=='string'||!payload.email.includes('@'))
    throw Error('forge_cloudflare_access_claims_rejected');
  const candidates=keys??await fetchForgeAccessKeys(team,{request});
  const key=Array.isArray(candidates)?candidates.find(k=>k?.kid===header.kid&&k?.kty==='RSA'):null;
  if(!key)throw Error('forge_cloudflare_access_signing_key_unavailable');
  let trusted=false;
  try{
    trusted=verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),
      createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url'));
  }catch{throw Error('forge_cloudflare_access_signature_invalid');}
  if(!trusted)throw Error('forge_cloudflare_access_signature_invalid');
  return Object.freeze({email:payload.email,subject:payload.sub??null});
}
