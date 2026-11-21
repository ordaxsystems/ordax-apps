import test from 'node:test';
import assert from 'node:assert/strict';
import {createForgeOrdaxProductMcp} from '../src/forge-ordax-product-mcp.mjs';
import {FORGE_NATIVE_OAUTH_CLIENT_ID} from '../src/forge-product-session.mjs';

const device='14cef8f4-3c06-4b1b-9e3a-42c74ef7dec5';
const validSession=(clientId=FORGE_NATIVE_OAUTH_CLIENT_ID)=>({
  status:()=>({connected:true,mode:'oauth',clientId}),
  accessToken:async()=> 'sealed-native-forge-oauth-access-token'
});
test('native session is never opened for wrong OAuth client',async()=>{
  let called=0;
  const client=createForgeOrdaxProductMcp({session:validSession('wrong-client'),
    fetchImpl:async()=>{called++;throw Error('never called');}});
  const result=await client.openNativeSession();
  assert.equal(result.ready,false);
  assert.equal(result.reason,'forge_native_oauth_required');
  assert.equal(result.executionAuthorized,false);
  assert.equal(called,0);
});
test('nonce is private per Core lifetime and request never carries ChatGPT correlation',async()=>{
  let nonce=null, calls=0;
  const fetchImpl=async(url,opts)=>{
    calls++;
    assert.equal(url,'https://mcp.ordax.com.br/mcp');
    assert.equal(opts.redirect,'error');
    assert.equal(opts.headers.Authorization,
      'Bearer sealed-native-forge-oauth-access-token');
    const req=JSON.parse(opts.body);
    assert.equal(req.params.name,'ordax_session');
    assert.deepEqual(req.params.arguments,{});
    const meta=req.params._meta;
    assert.equal(Object.keys(meta).join(','),'ordax/native-session');
    assert.match(meta['ordax/native-session'],/^[A-Za-z0-9_-]{43}$/);
    if(nonce===null)nonce=meta['ordax/native-session'];
    else assert.equal(meta['ordax/native-session'],nonce);
    return Response.json({jsonrpc:'2.0',id:req.id,result:{
      structuredContent:{ok:true,authenticated:true,
        client_id:FORGE_NATIVE_OAUTH_CLIENT_ID,device_binding:{
          state:'bound',device_id:device,attested:true,
          dispatch_target_resolved:true,capability_authorization:'checked_per_action'
        }}
    }});
  };
  const client=createForgeOrdaxProductMcp({session:validSession(),fetchImpl});
  for(let i=0;i<2;i++){
    const result=await client.openNativeSession();
    assert.equal(result.ready,true);
    assert.equal(result.deviceBindingAttested,true);
    assert.equal(result.deviceId,device);
    assert.equal(result.executionAuthorized,false);
    assert.equal(result.actionDispatched,false);
    assert.equal(JSON.stringify(result).includes(nonce),false);
    assert.equal(JSON.stringify(result).includes('sealed-native'),false);
  }
  assert.equal(calls,2);
});
test('Owner selection remains a pending challenge, never device authority',async()=>{
  const client=createForgeOrdaxProductMcp({session:validSession(),
    fetchImpl:async(_url,opts)=>{
      const req=JSON.parse(opts.body);
      return Response.json({jsonrpc:'2.0',id:req.id,result:{
        structuredContent:{ok:true,authenticated:true,
          client_id:FORGE_NATIVE_OAUTH_CLIENT_ID,
          owner_selection:{state:'awaiting_owner',
            challenge_id:'33333333-3333-4333-8333-333333333333',
            expires_at:'2027-01-01T00:00:00Z',
            owner_confirmation_required:true,action_dispatched:false}}
      }});
    }});
  const result=await client.openNativeSession();
  assert.equal(result.ready,false);
  assert.equal(result.reason,'forge_owner_device_selection_required');
  assert.equal(result.ownerConfirmationRequired,true);
  assert.equal(result.deviceBindingAttested,false);
});
test('production rollout off reports specific denial and never retries',async()=>{
  let called=0;
  const client=createForgeOrdaxProductMcp({session:validSession(),
    fetchImpl:async()=>{called++;return Response.json({
      ok:false,error:'central_session_marker_required'},{status:409});}});
  const result=await client.openNativeSession();
  assert.equal(called,1);
  assert.equal(result.ready,false);
  assert.equal(result.reason,'forge_native_transport_rollout_required');
  assert.equal(result.actionDispatched,false);
  assert.equal(result.outcomeUnconfirmed,undefined);
});
test('unconfirmed network response is never treated as a failed effect safe to retry',async()=>{
  let called=0;
  const client=createForgeOrdaxProductMcp({session:validSession(),
    fetchImpl:async()=>{called++;throw Error('network failure with secret');}});
  const result=await client.openNativeSession();
  assert.equal(called,1);
  assert.equal(result.reason,'ordax_native_session_outcome_unconfirmed');
  assert.equal(result.outcomeUnconfirmed,true);
  assert.equal(result.executionAuthorized,false);
  assert.equal(JSON.stringify(result).includes('secret'),false);
});
test('forged binding, wrong client and correlation mismatch remain untrusted',async()=>{
  let call=0;
  const client=createForgeOrdaxProductMcp({session:validSession(),
    fetchImpl:async(_url,opts)=>{
      const req=JSON.parse(opts.body);
      call++;
      return Response.json({jsonrpc:'2.0',id:call===1?'different':req.id,
        result:{structuredContent:{ok:true,authenticated:true,
          client_id:call===3?FORGE_NATIVE_OAUTH_CLIENT_ID:'different-client',
          device_binding:{state:'bound',device_id:device,
            attested:call===3?false:true,
            dispatch_target_resolved:true,
            capability_authorization:'checked_per_action'}}}});
    }});
  for(let i=0;i<3;i++){
    const result=await client.openNativeSession();
    assert.equal(result.ready,false);
    assert.equal(result.executionAuthorized,false);
  }
});
