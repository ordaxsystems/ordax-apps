import {createHash,createPublicKey,randomBytes,randomUUID,verify as verifySignature,constants as cryptoConstants} from 'node:crypto';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const ISSUER='https://auth.openai.com';
const DISCOVERY_URL=ISSUER+'/.well-known/openid-configuration';
const AUTHORIZE_URL=ISSUER+'/api/accounts/authorize';
const TOKEN_URL=ISSUER+'/api/accounts/oauth/token';
const RESOURCE='https://api.openai.com/v1';
const PLAN_SCOPE='chatgpt.tokens.use.direct';
const REQUIRED_SCOPES=new Set(['openid','email','profile','offline_access','resource.invoke',PLAN_SCOPE]);
const SERVICE='br.com.ordax.orchestrator.chatgpt-plan';
const ACCOUNT_PREFIX='host:';
const MAX_JSON_BYTES=1024*1024;

export function defaultCredentialStore() {
  try {return require('@github/keytar');}
  catch {return null;}
}

function safeCode(value,fallback='chatgpt_oauth_failed') {
  const code=String(value||'');
  return /^[a-z][a-z0-9_]{1,80}$/i.test(code)?code:fallback;
}

async function responseJson(response,code) {
  if(!response?.ok)throw Error(code);
  const length=Number(response.headers?.get?.('content-length')||0);
  if(length>MAX_JSON_BYTES)throw Error(code);
  let text;
  try {text=await response.text();} catch {throw Error(code);}
  if(Buffer.byteLength(text,'utf8')>MAX_JSON_BYTES)throw Error(code);
  try {const parsed=JSON.parse(text);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();return parsed;}
  catch {throw Error(code);}
}

function parseJwt(token) {
  if(typeof token!=='string'||token.length>65536)throw Error('chatgpt_id_token_invalid');
  const parts=token.split('.');
  if(parts.length!==3)throw Error('chatgpt_id_token_invalid');
  try {
    const header=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
    const signature=Buffer.from(parts[2],'base64url');
    if(!header||!claims||!signature.length)throw Error();
    return {header,claims,signature,data:Buffer.from(`${parts[0]}.${parts[1]}`)};
  } catch {throw Error('chatgpt_id_token_invalid');}
}

function verifyJwtSignature(jwt,jwk) {
  const key=createPublicKey({key:jwk,format:'jwk'});
  switch(jwt.header.alg) {
    case 'RS256': return verifySignature('RSA-SHA256',jwt.data,key,jwt.signature);
    case 'PS256': return verifySignature('sha256',jwt.data,{key,padding:cryptoConstants.RSA_PKCS1_PSS_PADDING,saltLength:32},jwt.signature);
    case 'ES256': return verifySignature('sha256',jwt.data,{key,dsaEncoding:'ieee-p1363'},jwt.signature);
    case 'EdDSA': return verifySignature(null,jwt.data,key,jwt.signature);
    default: return false;
  }
}

function validateLoopbackRedirect(value) {
  let redirect;
  try {redirect=new URL(value);} catch {throw Error('chatgpt_redirect_uri_invalid');}
  if(redirect.protocol!=='http:'||redirect.hostname!=='127.0.0.1'||redirect.pathname!=='/auth/callback'||
    redirect.username||redirect.password||redirect.search||redirect.hash||!redirect.port)
    throw Error('chatgpt_redirect_uri_invalid');
  return redirect.href;
}

export function createChatGPTPlanConnection({hostId,credentialStore=defaultCredentialStore(),fetchImpl=globalThis.fetch,
  now=()=>Date.now(),timeoutMs=30000}={}) {
  if(typeof hostId!=='string'||!/^urn:uuid:[0-9a-f-]{36}$/i.test(hostId)||typeof fetchImpl!=='function'||
    !Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000)
    throw Error('chatgpt_connection_ports_required');
  const credentialAccount=ACCOUNT_PREFIX+hostId;
  const pending=new Map();
  let discoveryPromise=null,jwksPromise=null,refreshPromise=null,modelCache=null;
  let planAuthorizedSnapshot=false;

  function secureStorageAvailable() {
    return Boolean(credentialStore&&typeof credentialStore.getPassword==='function'&&
      typeof credentialStore.setPassword==='function'&&typeof credentialStore.deletePassword==='function');
  }
  async function readCredentials() {
    if(!secureStorageAvailable())throw Error('chatgpt_secure_storage_unavailable');
    let raw;
    try {raw=await credentialStore.getPassword(SERVICE,credentialAccount);} catch {throw Error('chatgpt_secure_storage_unavailable');}
    if(raw===null){planAuthorizedSnapshot=false;return null;}
    try {
      const value=JSON.parse(raw);
      if(value?.issuer!==ISSUER||typeof value.clientId!=='string'||typeof value.subject!=='string'||
        !Array.isArray(value.scopes)||typeof value.idToken!=='string'||typeof value.accessToken!=='string'||
        !Number.isSafeInteger(value.accessExpiresAt))throw Error();
      planAuthorizedSnapshot=value.scopes.includes(PLAN_SCOPE)&&value.scopes.includes('resource.invoke');
      return value;
    } catch {planAuthorizedSnapshot=false;throw Error('chatgpt_saved_credentials_invalid');}
  }
  async function writeCredentials(value) {
    if(!secureStorageAvailable())throw Error('chatgpt_secure_storage_unavailable');
    try {await credentialStore.setPassword(SERVICE,credentialAccount,JSON.stringify(value));}
    catch {throw Error('chatgpt_secure_storage_write_failed');}
  }
  async function deleteCredentials() {
    if(!secureStorageAvailable())throw Error('chatgpt_secure_storage_unavailable');
    try {await credentialStore.deletePassword(SERVICE,credentialAccount);} catch {throw Error('chatgpt_secure_storage_delete_failed');}
    modelCache=null;
  }
  async function getDiscovery() {
    if(!discoveryPromise)discoveryPromise=(async()=>{
      const response=await fetchImpl(DISCOVERY_URL,{signal:AbortSignal.timeout(timeoutMs),headers:{Accept:'application/json'}});
      const value=await responseJson(response,'chatgpt_oidc_discovery_failed');
      if(value.issuer!==ISSUER||typeof value.jwks_uri!=='string')throw Error('chatgpt_oidc_discovery_invalid');
      const jwksUrl=new URL(value.jwks_uri);
      if(jwksUrl.protocol!=='https:'||jwksUrl.hostname!=='auth.openai.com')throw Error('chatgpt_oidc_discovery_invalid');
      return value;
    })().catch(error=>{discoveryPromise=null;throw error;});
    return discoveryPromise;
  }
  async function getJwks() {
    if(!jwksPromise)jwksPromise=(async()=>{
      const metadata=await getDiscovery();
      const response=await fetchImpl(metadata.jwks_uri,{signal:AbortSignal.timeout(timeoutMs),headers:{Accept:'application/json'}});
      const value=await responseJson(response,'chatgpt_oidc_keys_unavailable');
      if(!Array.isArray(value.keys)||value.keys.length>64)throw Error('chatgpt_oidc_keys_invalid');
      return value.keys;
    })().catch(error=>{jwksPromise=null;throw error;});
    return jwksPromise;
  }
  async function validateIdToken(token,{clientId,nonce,expectedSubject=null}={}) {
    const jwt=parseJwt(token);
    if(!['RS256','PS256','ES256','EdDSA'].includes(jwt.header.alg)||typeof jwt.header.kid!=='string')
      throw Error('chatgpt_id_token_invalid');
    const keys=await getJwks();
    const jwk=keys.find(item=>item?.kid===jwt.header.kid&&item.use!=='enc'&&(!item.alg||item.alg===jwt.header.alg));
    if(!jwk||!verifyJwtSignature(jwt,jwk))throw Error('chatgpt_id_token_signature_invalid');
    const claims=jwt.claims,nowSeconds=Math.floor(now()/1000);
    const audience=Array.isArray(claims.aud)?claims.aud:[claims.aud];
    if(claims.iss!==ISSUER||!audience.includes(clientId)||!Number.isFinite(claims.exp)||claims.exp<=nowSeconds||
      typeof claims.sub!=='string'||claims.sub.length<1||claims.sub.length>512||
      (nonce!==null&&claims.nonce!==nonce)||(expectedSubject!==null&&claims.sub!==expectedSubject))
      throw Error('chatgpt_id_token_claims_invalid');
    if(claims.iat!==undefined&&(!Number.isFinite(claims.iat)||claims.iat>nowSeconds+300))
      throw Error('chatgpt_id_token_claims_invalid');
    return {subject:claims.sub,email:typeof claims.email==='string'?claims.email.slice(0,320):null,
      name:typeof claims.name==='string'?claims.name.slice(0,160):null};
  }
  async function beginLogin({session,redirectUri}={}) {
    if(typeof session!=='string'||session.length<32)throw Error('host_session_required');
    if(!secureStorageAvailable())throw Error('chatgpt_secure_storage_unavailable');
    const callback=validateLoopbackRedirect(redirectUri);
    for(const [state,item] of pending)if(item.expiresAt<=now())pending.delete(state);
    if(pending.size>=4)throw Error('chatgpt_authorization_limit');
    const existing=await readCredentials();
    const clientId=existing?.clientId||'dynamic_agent_client';
    const state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url');
    const verifier=randomBytes(48).toString('base64url');
    const challenge=createHash('sha256').update(verifier).digest('base64url');
    const params=new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:callback,
      scope:[...REQUIRED_SCOPES].join(' '),resource:RESOURCE,state,nonce,
      code_challenge_method:'S256',code_challenge:challenge,ext_agent_host_id:hostId});
    if(!existing)params.set('agent_name_hint','OrdaX Orchestrator');
    if(existing?.idToken)params.set('id_token_hint',existing.idToken);
    if(existing?.email)params.set('login_hint',existing.email);
    if(existing&&!existing.scopes.includes(PLAN_SCOPE))params.set('prompt','consent');
    pending.set(state,{session,redirectUri:callback,clientId,verifier,nonce,
      expectedSubject:existing?.subject||null,expiresAt:now()+10*60*1000});
    return {authorizationUrl:`${AUTHORIZE_URL}?${params.toString()}`};
  }
  async function completeCallback({session,callbackUrl,redirectUri}={}) {
    if(typeof session!=='string'||typeof callbackUrl!=='string')throw Error('chatgpt_authorization_invalid');
    let callback;
    try {callback=new URL(callbackUrl,validateLoopbackRedirect(redirectUri));}
    catch {throw Error('chatgpt_callback_invalid');}
    if(callback.origin!==new URL(redirectUri).origin||callback.pathname!=='/auth/callback')throw Error('chatgpt_callback_invalid');
    const state=callback.searchParams.get('state');
    const authorization=pending.get(state||'');
    if(!authorization||authorization.session!==session||authorization.expiresAt<=now()||authorization.redirectUri!==redirectUri)
      throw Error('chatgpt_state_invalid');
    pending.delete(state);
    const oauthError=callback.searchParams.get('error');
    if(oauthError)throw Error(oauthError==='access_denied'?'chatgpt_authorization_denied':'chatgpt_authorization_failed');
    const code=callback.searchParams.get('code');
    if(!code||code.length>8192)throw Error('chatgpt_authorization_code_missing');
    const callbackClientId=callback.searchParams.get('client_id');
    let issuedClientId=authorization.clientId;
    if(authorization.clientId==='dynamic_agent_client') {
      if(!callbackClientId||callbackClientId==='dynamic_agent_client'||!/^[-A-Za-z0-9._]{3,256}$/.test(callbackClientId))
        throw Error('chatgpt_registration_incomplete');
      issuedClientId=callbackClientId;
    } else if(callbackClientId&&callbackClientId!==authorization.clientId) {
      throw Error('chatgpt_client_id_mismatch');
    }
    const form=new URLSearchParams({grant_type:'authorization_code',client_id:issuedClientId,code,
      code_verifier:authorization.verifier,redirect_uri:authorization.redirectUri,resource:RESOURCE});
    let tokenResponse;
    try {
      const response=await fetchImpl(TOKEN_URL,{method:'POST',signal:AbortSignal.timeout(timeoutMs),
        headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:form.toString()});
      tokenResponse=await responseJson(response,'chatgpt_token_exchange_failed');
    } catch(error) {
      if(String(error?.message||'').startsWith('chatgpt_'))throw error;
      throw Error(error?.name==='TimeoutError'?'chatgpt_token_exchange_timeout':'chatgpt_token_exchange_failed');
    }
    const scopes=typeof tokenResponse.scope==='string'?tokenResponse.scope.split(/\s+/).filter(Boolean):[];
    const idToken=tokenResponse.id_token;
    const accessToken=tokenResponse.access_token;
    const refreshToken=tokenResponse.refresh_token;
    if(typeof idToken!=='string'||typeof accessToken!=='string'||accessToken.length>65536||
      (refreshToken!==undefined&&(typeof refreshToken!=='string'||refreshToken.length>65536))||
      tokenResponse.token_type?.toLowerCase()!=='bearer'||!Number.isSafeInteger(tokenResponse.expires_in)||tokenResponse.expires_in<60)
      throw Error('chatgpt_token_response_invalid');
    const identity=await validateIdToken(idToken,{clientId:issuedClientId,nonce:authorization.nonce,
      expectedSubject:authorization.expectedSubject});
    const previous=await readCredentials();
    const credentials={issuer:ISSUER,clientId:issuedClientId,hostId,subject:identity.subject,email:identity.email,
      name:identity.name,idToken,accessToken,refreshToken:refreshToken||previous?.refreshToken||null,
      scopes:[...new Set(scopes)],accessExpiresAt:now()+tokenResponse.expires_in*1000,
      savedAt:new Date(now()).toISOString()};
    await writeCredentials(credentials);
    planAuthorizedSnapshot=credentials.scopes.includes(PLAN_SCOPE)&&credentials.scopes.includes('resource.invoke');
    modelCache=null;
    return {connected:true,planUsageAuthorized:scopes.includes(PLAN_SCOPE),email:identity.email,
      name:identity.name,needsReconsent:!scopes.includes(PLAN_SCOPE)};
  }
  async function refreshCredentials(credentials) {
    if(!credentials.refreshToken)throw Error('chatgpt_reauthentication_required');
    const form=new URLSearchParams({grant_type:'refresh_token',client_id:credentials.clientId,
      refresh_token:credentials.refreshToken,resource:RESOURCE});
    let result;
    try {
      const response=await fetchImpl(TOKEN_URL,{method:'POST',signal:AbortSignal.timeout(timeoutMs),
        headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:form.toString()});
      result=await responseJson(response,'chatgpt_token_refresh_failed');
    } catch(error) {
      if(String(error?.message||'').startsWith('chatgpt_'))throw error;
      throw Error(error?.name==='TimeoutError'?'chatgpt_token_refresh_timeout':'chatgpt_token_refresh_failed');
    }
    if(typeof result.access_token!=='string'||!Number.isSafeInteger(result.expires_in)||result.expires_in<60)
      throw Error('chatgpt_token_refresh_invalid');
    const scopes=typeof result.scope==='string'?result.scope.split(/\s+/).filter(Boolean):credentials.scopes;
    if(result.id_token!==undefined)await validateIdToken(result.id_token,{clientId:credentials.clientId,expectedSubject:credentials.subject});
    const next={...credentials,accessToken:result.access_token,
      refreshToken:typeof result.refresh_token==='string'?result.refresh_token:credentials.refreshToken,
      idToken:typeof result.id_token==='string'?result.id_token:credentials.idToken,
      scopes:[...new Set(scopes)],accessExpiresAt:now()+result.expires_in*1000,savedAt:new Date(now()).toISOString()};
    await writeCredentials(next);
    planAuthorizedSnapshot=next.scopes.includes(PLAN_SCOPE)&&next.scopes.includes('resource.invoke');
    return next;
  }
  async function currentCredentials({forceRefresh=false}={}) {
    let credentials=await readCredentials();
    if(!credentials)throw Error('chatgpt_not_connected');
    if(!credentials.scopes.includes(PLAN_SCOPE)||!credentials.scopes.includes('resource.invoke'))
      throw Error('chatgpt_plan_scope_missing');
    if(forceRefresh||credentials.accessExpiresAt<=now()+60000) {
      if(!refreshPromise)refreshPromise=refreshCredentials(credentials).finally(()=>{refreshPromise=null;});
      credentials=await refreshPromise;
    }
    return credentials;
  }
  async function accessToken() {
    const credentials=await currentCredentials();
    return {accessToken:credentials.accessToken,clientId:credentials.clientId,subject:credentials.subject};
  }
  async function status() {
    if(!secureStorageAvailable())return {connected:false,planUsageAuthorized:false,secureStorageAvailable:false,
      reason:'chatgpt_secure_storage_unavailable'};
    try {
      const credentials=await readCredentials();
      if(!credentials){planAuthorizedSnapshot=false;return {connected:false,planUsageAuthorized:false,secureStorageAvailable:true,reason:'not_connected'};}
      const planUsageAuthorized=credentials.scopes.includes(PLAN_SCOPE)&&credentials.scopes.includes('resource.invoke');
      return {connected:true,planUsageAuthorized,secureStorageAvailable:true,email:credentials.email||null,
        name:credentials.name||null,reauthenticationRequired:credentials.accessExpiresAt<=now()&&!credentials.refreshToken};
    } catch(error) {return {connected:false,planUsageAuthorized:false,secureStorageAvailable:true,
      reason:safeCode(error?.message,'chatgpt_credentials_unavailable')};}
  }
  async function listModels(accessTokenValue) {
    if(modelCache&&modelCache.expiresAt>now())return modelCache.models;
    let response;
    try {
      response=await fetchImpl('https://api.openai.com/v1/models',{signal:AbortSignal.timeout(timeoutMs),
        headers:{Authorization:`Bearer ${accessTokenValue}`,Accept:'application/json'}});
    } catch(error) {throw Error(error?.name==='TimeoutError'?'chatgpt_models_timeout':'chatgpt_models_unavailable');}
    const value=await responseJson(response,'chatgpt_models_unavailable');
    const models=Array.isArray(value.models)?value.models.filter(item=>item?.visibility==='list'&&
      typeof item.slug==='string'&&/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(item.slug)).map(item=>item.slug):[];
    if(!models.length)throw Error('chatgpt_no_supported_models');
    modelCache={models,expiresAt:now()+15*60*1000};
    return models;
  }
  async function infer({messages}={}) {
    if(!Array.isArray(messages)||messages.length<1||messages.length>32||
      messages.some(item=>!['system','user','assistant'].includes(item?.role)||typeof item.content!=='string'))
      throw Error('chatgpt_input_invalid');
    let credential,models;
    try {
      credential=await currentCredentials();
      models=await listModels(credential.accessToken);
    } catch(error) {
      const failure=Error(safeCode(error?.message,'chatgpt_preflight_failed'));
      failure.orchestratorFailureCode=failure.message;
      failure.orchestratorRequestOutcome='rejected';
      throw failure;
    }
    let response;
    try {
      response=await fetchImpl('https://api.openai.com/v1/responses',{method:'POST',
        signal:AbortSignal.timeout(Math.max(timeoutMs,60000)),headers:{Authorization:`Bearer ${credential.accessToken}`,
          'Content-Type':'application/json',Accept:'text/event-stream'},
        body:JSON.stringify({model:models[0],input:messages.map(item=>({role:item.role,content:item.content})),
          max_output_tokens:1400,store:false,stream:true})});
    } catch(error) {
      const timedOut=error?.name==='TimeoutError'||error?.name==='AbortError';
      const failure=Error(timedOut?'chatgpt_request_timeout':'chatgpt_network_unavailable');
      failure.orchestratorFailureCode=timedOut?'chatgpt_request_timeout':'chatgpt_network_unavailable';
      failure.orchestratorRequestOutcome='unknown';throw failure;
    }
    if(!response.ok) {
      const failureCode=response.status===401?'chatgpt_auth_rejected':response.status===403?'chatgpt_access_denied':
        response.status===429?'chatgpt_rate_limited':response.status>=500?'chatgpt_service_unavailable':'chatgpt_request_rejected';
      const error=Error(failureCode);error.orchestratorFailureCode=failureCode;
      error.orchestratorRequestOutcome='rejected';error.orchestratorHttpStatus=response.status;throw error;
    }
    if(!response.body||typeof response.body[Symbol.asyncIterator]!=='function') {
      const error=Error('chatgpt_stream_unavailable');error.orchestratorFailureCode=error.message;
      error.orchestratorRequestOutcome='unknown';throw error;
    }
    let buffer='',totalBytes=0,output='',completed=false,failed=false;
    try {
      for await(const chunk of response.body) {
        totalBytes+=chunk.length;
        if(totalBytes>2*1024*1024)throw Error('chatgpt_response_too_large');
        buffer+=Buffer.from(chunk).toString('utf8');
        buffer=buffer.replace(/\r\n/g,'\n');
        if(buffer.length>256*1024)throw Error('chatgpt_event_too_large');
        let separator;
        while((separator=buffer.indexOf('\n\n'))>=0) {
          const frame=buffer.slice(0,separator);buffer=buffer.slice(separator+2);
          const eventName=frame.match(/^event:\s*(.+)$/m)?.[1]?.trim();
          const data=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
          if(!data)continue;
          let event;
          try {event=JSON.parse(data);} catch {throw Error('chatgpt_stream_invalid');}
          if(eventName==='response.output_text.delta'||event.type==='response.output_text.delta') {
            if(typeof event.delta!=='string')throw Error('chatgpt_stream_invalid');
            output+=event.delta;
            if(output.length>12000)throw Error('chatgpt_reply_too_large');
          } else if(eventName==='response.failed'||event.type==='response.failed') {
            failed=true;throw Error(safeCode(event.response?.error?.code,'chatgpt_response_failed'));
          } else if(eventName==='response.incomplete'||event.type==='response.incomplete') {
            failed=true;throw Error('chatgpt_response_incomplete');
          } else if(eventName==='response.completed'||event.type==='response.completed') {
            completed=true;
          } else if(eventName==='error'||event.type==='error') {
            failed=true;throw Error(safeCode(event.error?.code,'chatgpt_response_failed'));
          }
        }
      }
    } catch(error) {
      const safe=Error(safeCode(error?.message,'chatgpt_stream_interrupted'));
      safe.orchestratorFailureCode=safe.message;
      safe.orchestratorRequestOutcome=completed||failed?'response_invalid':'unknown';
      throw safe;
    }
    if(!completed||failed||!output.trim()) {
      const error=Error(completed?'chatgpt_reply_empty':'chatgpt_stream_incomplete');
      error.orchestratorFailureCode=error.message;
      error.orchestratorRequestOutcome=completed?'response_invalid':'unknown';throw error;
    }
    return {content:output,model:models[0]};
  }
  async function disconnect() {
    pending.clear();await deleteCredentials();
    planAuthorizedSnapshot=false;
    return {connected:false};
  }

  return Object.freeze({secureStorageAvailable,status,beginLogin,completeCallback,accessToken,infer,disconnect,
    isPlanAvailable:()=>planAuthorizedSnapshot,
    get hostId(){return hostId;}});
}
