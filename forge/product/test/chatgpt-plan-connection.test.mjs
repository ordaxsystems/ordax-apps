import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {createChatGPTPlanConnection} from '../host/chatgpt-plan-connection.mjs';

const privateKeyPair=generateKeyPairSync('rsa',{modulusLength:2048});
const publicJwk={...privateKeyPair.publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256',use:'sig'};
function makeIdToken({nonce,clientId='oaiapp_test123',subject='acct_test',now=Date.now()}={}) {
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const head=encode({alg:'RS256',typ:'JWT',kid:'test-key'});
  const claims=encode({iss:'https://auth.openai.com',aud:clientId,sub:subject,nonce,
    email:'test@example.com',name:'OrdaX tester',iat:Math.floor(now/1000),exp:Math.floor(now/1000)+3600});
  const body=`${head}.${claims}`;
  return `${body}.${sign('RSA-SHA256',Buffer.from(body),privateKeyPair.privateKey).toString('base64url')}`;
}

function credentialStore() {
  const values=new Map();
  return {
    values,
    async getPassword(service,account){return values.get(`${service}:${account}`)||null;},
    async setPassword(service,account,value){values.set(`${service}:${account}`,value);},
    async deletePassword(service,account){return values.delete(`${service}:${account}`);}
  };
}

test('ChatGPT Plan OAuth binds PKCE/state/session, verifies the ID token and streams a completed inference',async()=>{
  const vault=credentialStore();
  const now=()=>1792872000000;
  let authorization=null,tokenRequest=null,inferenceBody=null;
  const fetchImpl=async(url,options={})=>{
    if(url==='https://auth.openai.com/.well-known/openid-configuration')
      return new Response(JSON.stringify({issuer:'https://auth.openai.com',jwks_uri:'https://auth.openai.com/.well-known/jwks.json'}));
    if(url==='https://auth.openai.com/.well-known/jwks.json')return new Response(JSON.stringify({keys:[publicJwk]}));
    if(url==='https://auth.openai.com/api/accounts/oauth/token') {
      tokenRequest=new URLSearchParams(options.body);
      assert.equal(tokenRequest.get('grant_type'),'authorization_code');
      assert.equal(tokenRequest.get('redirect_uri'),redirectUri);
      assert.equal(tokenRequest.get('resource'),'https://api.openai.com/v1');
      assert.ok(tokenRequest.get('code_verifier'));
      assert.equal(authorization.searchParams.get('code_challenge'),createHash('sha256')
        .update(tokenRequest.get('code_verifier')).digest('base64url'));
      return new Response(JSON.stringify({token_type:'Bearer',access_token:'access-secret',refresh_token:'refresh-secret',
        expires_in:3600,scope:'openid email profile offline_access resource.invoke chatgpt.tokens.use.direct',
        id_token:makeIdToken({nonce:authorization.searchParams.get('nonce'),clientId:tokenRequest.get('client_id'),now:now()})}));
    }
    if(url==='https://api.openai.com/v1/models') {
      assert.equal(options.headers.Authorization,'Bearer access-secret');
      return new Response(JSON.stringify({models:[{slug:'gpt-test',visibility:'list'}]}));
    }
    if(url==='https://api.openai.com/v1/responses') {
      assert.equal(options.headers.Authorization,'Bearer access-secret');
      inferenceBody=JSON.parse(options.body);
      const frames=[
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ORDAx "}\n\n',
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"GPT_OK"}\n\n',
        'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n'
      ].join('');
      return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(frames));controller.close();}}),
        {headers:{'content-type':'text/event-stream'}});
    }
    throw Error('unexpected_test_request');
  };
  const connection=createChatGPTPlanConnection({hostId:'urn:uuid:11111111-2222-4333-8444-555555555555',
    credentialStore:vault,fetchImpl,now});
  const redirectUri='http://127.0.0.1:45678/auth/callback';
  const {authorizationUrl}=await connection.beginLogin({session:'s'.repeat(48),redirectUri});
  authorization=new URL(authorizationUrl);
  assert.equal(authorization.origin,'https://auth.openai.com');
  assert.equal(authorization.searchParams.get('client_id'),'dynamic_agent_client');
  assert.equal(authorization.searchParams.get('ext_agent_host_id'),'urn:uuid:11111111-2222-4333-8444-555555555555');
  assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');
  assert.match(authorization.searchParams.get('code_challenge'),/^[A-Za-z0-9_-]{43}$/);
  const callback=new URL(redirectUri);
  callback.searchParams.set('code','single-use-code');
  callback.searchParams.set('state',authorization.searchParams.get('state'));
  callback.searchParams.set('client_id','oaiapp_test123');
  const connected=await connection.completeCallback({session:'s'.repeat(48),callbackUrl:callback.href,redirectUri});
  assert.deepEqual(connected,{connected:true,planUsageAuthorized:true,email:'test@example.com',name:'OrdaX tester',needsReconsent:false});
  assert.equal(tokenRequest.get('client_id'),'oaiapp_test123');
  assert.equal(connection.isPlanAvailable(),true);
  // Reconstruct the connection with the same OS-vault boundary as a fresh
  // process would use; the new instance must rediscover and refresh the saved
  // authorization instead of relying on the login object's memory.
  const reopenedConnection=createChatGPTPlanConnection({hostId:'urn:uuid:11111111-2222-4333-8444-555555555555',
    credentialStore:vault,fetchImpl,now});
  const status=await reopenedConnection.status();
  assert.equal(status.connected,true);
  assert.equal(status.planUsageAuthorized,true);
  assert.equal(JSON.stringify(status).includes('access-secret'),false);
  assert.equal(reopenedConnection.isPlanAvailable(),true);

  const answer=await reopenedConnection.infer({messages:[{role:'system',content:'You coordinate.'},{role:'user',content:'Responda.'}]});
  assert.deepEqual(answer,{content:'ORDAx GPT_OK',model:'gpt-test'});
  assert.equal(inferenceBody.store,false);
  assert.equal(inferenceBody.stream,true);
  assert.equal(inferenceBody.model,'gpt-test');
  const saved=[...vault.values.values()][0];
  assert.equal(saved.includes('access-secret'),true);
});

test('ChatGPT Plan OAuth rejects callback state from another browser session and never exchanges it',async()=>{
  let exchanges=0;
  const connection=createChatGPTPlanConnection({hostId:'urn:uuid:22222222-2222-4333-8444-555555555555',
    credentialStore:credentialStore(),fetchImpl:async url=>{
      if(url==='https://auth.openai.com/api/accounts/oauth/token')exchanges++;
      throw Error('unexpected_request');
    }});
  const redirectUri='http://127.0.0.1:45678/auth/callback';
  const started=await connection.beginLogin({session:'a'.repeat(48),redirectUri});
  const auth=new URL(started.authorizationUrl),callback=new URL(redirectUri);
  callback.searchParams.set('state',auth.searchParams.get('state'));
  callback.searchParams.set('code','never-exchange');
  callback.searchParams.set('client_id','oaiapp_untrusted');
  await assert.rejects(connection.completeCallback({session:'b'.repeat(48),callbackUrl:callback.href,redirectUri}),/chatgpt_state_invalid/);
  assert.equal(exchanges,0);
});
