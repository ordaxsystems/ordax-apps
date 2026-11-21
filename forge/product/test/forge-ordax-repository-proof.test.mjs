import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalOrdaxRepositoryRemote,forgeRuntimeRepositoryProof}
  from '../src/forge-ordax-repository-proof.mjs';
import {createForgeOrdaxProductMcp} from '../src/forge-ordax-product-mcp.mjs';
import {FORGE_NATIVE_OAUTH_CLIENT_ID} from '../src/forge-product-session.mjs';

const DEVICE='14cef8f4-3c06-4b1b-9e3a-42c74ef7dec5';
const REPO='ordaxsystems/ordax-runtime';
const REQUEST='33333333-3333-4333-8333-333333333333';
const sample=(remote='https://github.com/ordaxsystems/ordax-runtime.git')=>({
  ok:true,pending:false,request_id:REQUEST,
  action:{name:'workspace.repository_catalog',device_id:DEVICE,
    status:'succeeded',result:{ok:true,data:{projects:[
      {slug:'runtime',repository:{is_repository:true,remote,branch:'main',
        status_available:true,dirty:false}}
    ]}}}
});

test('only exact GitHub origin identifies a registered OrdaX repository',()=>{
  for(const origin of ['https://github.com/ordaxsystems/ordax-runtime.git',
    'git@github.com:ordaxsystems/ordax-runtime.git',
    'ssh://git@github.com/ordaxsystems/ordax-runtime'])
    assert.equal(canonicalOrdaxRepositoryRemote(origin),REPO);
  for(const origin of ['https://github.com.evil/ordaxsystems/ordax-runtime.git',
    'https://bad@github.com/ordaxsystems/ordax-runtime',
    'https://github.com/ordaxsystems/ordax-others/../ordax-runtime.git',
    'https://github.com/thirdparty/ordax-runtime',
    '/Users/ordax/ordax-runtime','ordaxsystems/ordax-runtime'])
    assert.equal(canonicalOrdaxRepositoryRemote(origin),null);
});

test('physical catalogue proves only an assigned repository on the attested device',()=>{
  const p=forgeRuntimeRepositoryProof({payload:sample(),
    repository:REPO,deviceId:DEVICE});
  assert.equal(p.state,'observed');
  assert.equal(p.verified,true);
  assert.equal(p.runtimeProjectSlug,'runtime');
  assert.equal(p.branch,'main');
  assert.equal(p.runtimeRequestId,REQUEST);
  assert.equal(p.gitExecutionAuthorized,false);
  assert.equal(p.filesAccessible,false);
  assert.equal(p.actionCompleted,true);
  assert.equal(forgeRuntimeRepositoryProof({payload:sample(),
    repository:'ordaxsystems/ordax-os',deviceId:DEVICE}).verified,false);
});

test('pending receipt is preserved without claiming a finished Runtime action',()=>{
  const p=forgeRuntimeRepositoryProof({payload:{
    ok:true,pending:true,request_id:REQUEST,
    action:{name:'workspace.repository_catalog',status:'queued',
      device_id:DEVICE}},repository:REPO,deviceId:DEVICE});
  assert.equal(p.state,'pending');
  assert.equal(p.runtimeRequestId,REQUEST);
  assert.equal(p.actionDispatched,true);
  assert.equal(p.actionCompleted,false);
  assert.equal(p.verified,false);
});

test('untrusted catalog, ambiguous remote, wrong device and malformed receipts fail closed',()=>{
  const body=sample();
  for(const malformed of [
    { ...body,action:{...body.action,device_id:undefined} },
    { ...body,action:{...body.action,device_id:'44444444-4444-4444-8444-444444444444'} },
    { ...body,action:{...body.action,name:'computer.terminal_exec'} },
    { ...body,action:{...body.action,result:{ok:true,data:{projects:[
      body.action.result.data.projects[0],body.action.result.data.projects[0]
    ]}}} },
    sample('https://github.com.evil/ordaxsystems/ordax-runtime'),
    { ...body,request_id:'not-uuid' },
    { ...body,action:{...body.action,result:{ok:true,data:{projects:[
      {slug:'runtime',repository:{...body.action.result.data.projects[0].repository,branch:'../main'}}
    ]}}} },
  ]){
    const p=forgeRuntimeRepositoryProof({payload:malformed,
      repository:REPO,deviceId:DEVICE});
    assert.equal(p.verified,false);
    assert.equal(p.gitExecutionAuthorized,false);
  }
});

test('native repository probe uses attested device and original Runtime request, not caller paths',async()=>{
  const rpc=[];
  const client=createForgeOrdaxProductMcp({
    session:{status:()=>({connected:true,mode:'oauth',
      clientId:FORGE_NATIVE_OAUTH_CLIENT_ID}),
      accessToken:async()=> 'sealed-forge-oauth-token-do-not-log'},
    fetchImpl:async(_url,opts)=>{
      const request=JSON.parse(opts.body);
      rpc.push(request);
      assert.equal(opts.headers.Authorization,'Bearer sealed-forge-oauth-token-do-not-log');
      assert.equal(request.params._meta['openai/session'],undefined);
      assert.match(request.params._meta['ordax/native-session'],/^[A-Za-z0-9_-]{43}$/);
      const tool=request.params.name;
      if(tool==='ordax_session'){
        return Response.json({jsonrpc:'2.0',id:request.id,
          result:{structuredContent:{ok:true,authenticated:true,
            client_id:FORGE_NATIVE_OAUTH_CLIENT_ID,device_binding:{
              state:'bound',device_id:DEVICE,attested:true,
              dispatch_target_resolved:true,capability_authorization:'checked_per_action'
            }}}});
      }
      if(tool==='repository_catalog'){
        assert.deepEqual(request.params.arguments,
          {device_id:DEVICE,wait_for_completion_ms:8000});
        return Response.json({jsonrpc:'2.0',id:request.id,
          result:{structuredContent:{ok:true,pending:true,request_id:REQUEST,
            action:{name:'workspace.repository_catalog',
              device_id:DEVICE,status:'queued'}}}});
      }
      assert.equal(tool,'ordax_action_status');
      assert.deepEqual(request.params.arguments,{
        request_id:REQUEST,wait_for_completion_ms:8000});
      return Response.json({jsonrpc:'2.0',id:request.id,
        result:{structuredContent:sample()}});
    }
  });
  const pending=await client.repositoryProof({repository:REPO});
  assert.equal(pending.state,'pending');
  assert.equal(pending.runtimeRequestId,REQUEST);
  const final=await client.repositoryProof({repository:REPO,mode:'status',
    runtimeRequestId:REQUEST,expectedDeviceId:DEVICE});
  assert.equal(final.state,'observed');
  assert.equal(final.verified,true);
  assert.deepEqual(rpc.map(x=>x.params.name),[
    'ordax_session','repository_catalog','ordax_session','ordax_action_status']);
  assert.equal(JSON.stringify(final).includes('sealed-forge-oauth-token'),false);
});
