import test from 'node:test';
import assert from 'node:assert/strict';
import {testGroqApiKey} from '../src/groq-key-health.mjs';

test('validates a Groq key with a bounded models request and never reads provider data',async()=>{
  let request;
  const result=await testGroqApiKey({apiKey:' gsk_private ',fetchImpl:async(url,options)=>{
    request={url,options};
    return {ok:true,status:200,json(){throw Error('body_must_not_be_read')}};
  }});
  assert.deepEqual(result,{ok:true,code:'connected'});
  assert.equal(request.url,'https://api.groq.com/openai/v1/models');
  assert.equal(request.options.method,'GET');
  assert.equal(request.options.headers.authorization,'Bearer gsk_private');
  assert.equal(request.options.redirect,'error');
  assert.equal(request.options.signal instanceof AbortSignal,true);
});

test('maps provider responses to safe status codes without exposing body text',async()=>{
  for(const [status,code] of [[401,'invalid_api_key'],[403,'invalid_api_key'],[429,'rate_limited'],[503,'provider_unavailable']]){
    const result=await testGroqApiKey({apiKey:'gsk_test',fetchImpl:async()=>({ok:false,status,text:async()=>'secret diagnostic'})});
    assert.deepEqual(result,{ok:false,code});
  }
});

test('fails closed for missing key, network errors and bounded request timeouts',async()=>{
  assert.deepEqual(await testGroqApiKey({apiKey:''}),{ok:false,code:'api_key_missing'});
  assert.deepEqual(await testGroqApiKey({apiKey:'gsk_test',fetchImpl:async()=>{throw Error('Bearer gsk_test must not escape');}}),
    {ok:false,code:'network_unavailable'});
  assert.deepEqual(await testGroqApiKey({apiKey:'gsk_test',timeoutMs:1,fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>
    signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))}),
    {ok:false,code:'request_timeout'});
});
