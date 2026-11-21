import test from 'node:test';
import assert from 'node:assert/strict';
import {createForgeOrdaxProductMcp} from '../src/forge-ordax-product-mcp.mjs';
import {FORGE_NATIVE_OAUTH_CLIENT_ID} from '../src/forge-product-session.mjs';

const device='14cef8f4-3c06-4b1b-9e3a-42c74ef7dec5';
function session({connected=true,mode='oauth',
    clientId=FORGE_NATIVE_OAUTH_CLIENT_ID}={}){
  return {status:()=>({connected,mode,clientId}),
    accessToken:async()=> 'secret-lives-only-in-native-owner-session'};
}
const granted={profile_key:'repository-catalog-read',space_id:null,
  project_id:null,valid_until:null,capabilities:[
    {capability:'workspace.repository_catalog',access_mode:'read'}
  ]};

test('native OAuth is mandatory and disconnected/legacy sessions never contact Platform',async()=>{
  let calls=0;
  for(const profile of [{connected:false},{mode:'legacy'},{clientId:'other-client'}]){
    const client=createForgeOrdaxProductMcp({session:session(profile),
      fetchImpl:async()=>{calls++;throw Error('never called');}});
    const result=await client.devices();
    assert.equal(result.available,false);
    assert.equal(result.reason,'forge_native_oauth_required');
    assert.equal(result.deviceBindingCreated,false);
    assert.equal(result.executionAuthorized,false);
  }
  assert.equal(calls,0);
});
test('Product MCP device listing uses only the sealed Forge token and never grants execution',async()=>{
  let calls=0;
  const fetchImpl=async(url,opts)=>{
    calls++;
    assert.equal(url,'https://mcp.ordax.com.br/mcp');
    assert.equal(opts.method,'POST');
    assert.equal(opts.redirect,'error');
    assert.equal(opts.headers.Authorization,
      'Bearer secret-lives-only-in-native-owner-session');
    const query=JSON.parse(opts.body);
    assert.equal(query.method,'tools/call');
    assert.equal(query.params.name,'ordax_targets');
    assert.deepEqual(query.params.arguments,{});
    return Response.json({jsonrpc:'2.0',id:query.id,
      result:{structuredContent:{ok:true,targets:[
        {device_id:device,device_name:'DESKTOP-4UFL03B',online:true,
          grant_groups:[{profile_key:'full-computer-control',space_id:null,
            project_id:null,valid_until:null,capabilities:[
              {capability:'computer.terminal_exec',access_mode:'write'}]}]},
        {device_id:'51ad4baf-7805-499e-9c48-b89f52af1953',
          device_name:'OrdaX Desktop',online:false,grant_groups:[granted]}
      ]}}});
  };
  const client=createForgeOrdaxProductMcp({session:session(),fetchImpl});
  const result=await client.devices();
  assert.equal(calls,1);
  assert.equal(result.available,true);
  assert.equal(result.devices.length,2);
  assert.equal(result.devices[0].repositoryCatalogReadGranted,false);
  assert.equal(result.devices[1].repositoryCatalogReadGranted,true);
  assert.equal(result.devices[0].executionAuthorized,false);
  assert.equal(result.actionDispatched,false);
  assert.equal(result.deviceBindingCreated,false);
  assert.equal(JSON.stringify(result).includes('secret-lives'),false);
});
test('expired grants and forged read/write profiles do not become repository authority',async()=>{
  const fetchImpl=async(_url,opts)=>{
    const query=JSON.parse(opts.body);
    return Response.json({jsonrpc:'2.0',id:query.id,result:{structuredContent:{
      ok:true,targets:[{device_id:device,online:true,grant_groups:[
        {...granted,valid_until:'2020-01-01T00:00:00Z'},
        {...granted,capabilities:[{capability:'workspace.repository_catalog',access_mode:'write'}]}
      ]}]
    }}});
  };
  const result=await createForgeOrdaxProductMcp({session:session(),fetchImpl}).devices();
  assert.equal(result.available,true);
  assert.equal(result.devices[0].repositoryCatalogReadGranted,false);
});
test('Product MCP replies fail closed on mismatched correlation, errors and duplicates',async()=>{
  let n=0;
  const fetchImpl=async(_url,opts)=>{
    const request=JSON.parse(opts.body);
    n++;
    if(n===1)return Response.json({jsonrpc:'2.0',id:'not-original',
      result:{structuredContent:{ok:true,targets:[]}}});
    if(n===2)return Response.json({jsonrpc:'2.0',id:request.id,result:{
      structuredContent:{ok:false,error:'product_grant_not_resolved'}}});
    return Response.json({jsonrpc:'2.0',id:request.id,result:{structuredContent:{
      ok:true,targets:[
        {device_id:device,grant_groups:[]},
        {device_id:device,grant_groups:[]}
      ]
    }}});
  };
  const client=createForgeOrdaxProductMcp({session:session(),fetchImpl});
  const a=await client.devices();
  assert.equal(a.reason,'ordax_product_mcp_invalid_response');
  const b=await client.devices();
  assert.equal(b.reason,'product_grant_not_resolved');
  const c=await client.devices();
  assert.equal(c.reason,'ordax_product_mcp_invalid_response');
});
test('OAuth client never accepts redirects, sends other tools or leaks arbitrary error bodies',async()=>{
  const client=createForgeOrdaxProductMcp({session:session(),
    fetchImpl:async(_url,opts)=>{
      assert.equal(opts.redirect,'error');
      return new Response(JSON.stringify({private_token:'do-not-report'}),
        {status:403,headers:{'content-type':'application/json'}});
    }});
  const result=await client.devices();
  assert.equal(result.reason,'ordax_product_mcp_authorization_required');
  assert.equal(JSON.stringify(result).includes('private_token'),false);
});
