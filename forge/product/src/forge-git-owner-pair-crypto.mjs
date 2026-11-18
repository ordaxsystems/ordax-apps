// One-shot encrypted transport of the *existing* Forge App MCP bearer.
// This is not an authentication authority, credential database or scheduler.
// The native Owner must approve the displayed key fingerprint before sealing.
import {constants,createHash,createPublicKey,generateKeyPairSync,privateDecrypt,
  publicEncrypt,randomUUID} from 'node:crypto';

const REQUEST='ordax.forge-git.owner-pair-request/1';
const RECEIPT='ordax.forge-git.owner-pair-response/1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN=/^[A-Za-z0-9_-]{40,128}$/;
const KEY=/^[A-Za-z0-9_-]{350,520}$/;
const CT=/^[A-Za-z0-9_-]{342}$/;
const CODE=/^[A-F0-9]{10}$/;
const own=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join(',')===[...keys].sort().join(',');

export function inspectForgeGitPairRequest(request){
  if(!own(request,['schema','requestId','publicKey'])||request.schema!==REQUEST||
     !UUID.test(request.requestId)||typeof request.publicKey!=='string'||
     !KEY.test(request.publicKey))
    throw Error('forge_mcp_pair_request_invalid');
  let key;
  try{
    const bytes=Buffer.from(request.publicKey,'base64url');
    if(bytes.toString('base64url')!==request.publicKey)
      throw Error('noncanonical');
    key=createPublicKey({key:bytes,format:'der',type:'spki'});
    if(key.asymmetricKeyType!=='rsa'||
       key.asymmetricKeyDetails?.modulusLength!==2048||
       Number(key.asymmetricKeyDetails?.publicExponent)!==65537)
      throw Error('unsupported_key');
  }catch{throw Error('forge_mcp_pair_public_key_invalid');}
  // Public, non-secret code used by the Owner to compare both application UIs.
  const code=createHash('sha256')
    .update(request.requestId+'\n'+request.publicKey).digest('hex').slice(0,10).toUpperCase();
  return Object.freeze({requestId:request.requestId,code,key});
}

export function prepareForgeGitPairRequest(){
  const keys=generateKeyPairSync('rsa',{modulusLength:2048,
    publicExponent:0x10001});
  const request=Object.freeze({schema:REQUEST,requestId:randomUUID(),
    publicKey:keys.publicKey.export({format:'der',type:'spki'}).toString('base64url')});
  const {code}=inspectForgeGitPairRequest(request);
  return Object.freeze({request,code,privateKey:keys.privateKey});
}

export function sealExistingForgeMcpGrant(request,token){
  const parsed=inspectForgeGitPairRequest(request);
  if(typeof token!=='string'||!TOKEN.test(token))
    throw Error('forge_mcp_pair_existing_grant_invalid');
  const ciphertext=publicEncrypt({key:parsed.key,
    padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},
    Buffer.from(token,'utf8')).toString('base64url');
  return Object.freeze({schema:RECEIPT,requestId:parsed.requestId,
    code:parsed.code,ciphertext});
}

export function unsealForgeGitPairResponse(prepared,response){
  if(!prepared||!prepared.privateKey||!prepared.request)
    throw Error('forge_mcp_pair_preparation_required');
  const {requestId,code}=inspectForgeGitPairRequest(prepared.request);
  if(!own(response,['schema','requestId','code','ciphertext'])||
     response.schema!==RECEIPT||response.requestId!==requestId||
     response.code!==code||!CODE.test(response.code)||
     typeof response.ciphertext!=='string'||!CT.test(response.ciphertext))
    throw Error('forge_mcp_pair_response_invalid');
  try{
    const data=Buffer.from(response.ciphertext,'base64url');
    if(data.length!==256||data.toString('base64url')!==response.ciphertext)
      throw Error('malformed_ciphertext');
    const token=privateDecrypt({key:prepared.privateKey,
      padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},data)
      .toString('utf8');
    if(!TOKEN.test(token))throw Error('invalid_token');
    return token;
  }catch{throw Error('forge_mcp_pair_response_unseal_failed');}
}
