import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHmac} from 'node:crypto';
import {PassThrough} from 'node:stream';
import {createOrchestratorRuntimeBridge,attachOrchestratorRuntimePipes,
  canonicalHostJson,RUNTIME_BRIDGE_SCHEMA,resolveOrchestratorRuntimeTransport} from '../src/orchestrator-runtime-bridge.mjs';

function fixture(onInvoke){
  let now=100000,bridge,reads=0;
  const build={verified:true,status:'verified',sourceCommit:'a'.repeat(40),contentDigest:'b'.repeat(64)};
  const bootstrap={schema:RUNTIME_BRIDGE_SCHEMA,type:'bootstrap',sessionId:randomUUID(),
    key:randomBytes(32).toString('base64'),ownerUserId:randomUUID(),clientId:'oauth-fixture-client',
    deviceId:randomUUID(),grantId:randomUUID(),capability:'orchestrator.app_read',expiresAt:now+60000,
    expectedCommit:build.sourceCommit,expectedDigest:build.contentDigest,expectedProfile:'c'.repeat(64)};
  bridge=createOrchestratorRuntimeBridge({workspaceSessionId:'session_test',buildProof:build,
    profileFingerprint:bootstrap.expectedProfile,clock:()=>now,
    service:{async invoke(context,operation,input){
      assert.equal(bridge.allows(context,operation),true);reads++;await onInvoke?.();return {operation,input};
    }}});
  const request=(operation='status',input={},id=randomUUID())=>{
    const body={schema:RUNTIME_BRIDGE_SCHEMA,sessionId:bootstrap.sessionId,id,operation,input,
      issuedAt:now,expiresAt:Math.min(now+30000,bootstrap.expiresAt)};
    return {...body,signature:createHmac('sha256',Buffer.from(bootstrap.key,'base64'))
      .update(canonicalHostJson(body)).digest('hex')};
  };
  return {bridge,bootstrap,request,reads:()=>reads,advance:ms=>now+=ms};
}

test('host bootstrap requires the exact attested App and profile before exposing any state',async()=>{
  const f=fixture();
  assert.equal((await f.bridge.handle({...f.bootstrap,expectedProfile:'d'.repeat(64)})).error,'host_bootstrap_rejected');
  assert.equal(f.bridge.connected,false);assert.equal(f.reads(),0);
  assert.equal((await f.bridge.handle(f.bootstrap)).error,'host_session_closed');
});
test('signed read uses a host-minted context; ordinary object lookalikes have no authority',async()=>{
  const f=fixture();assert.equal((await f.bridge.handle(f.bootstrap)).type,'ready');
  assert.equal((await f.bridge.handle(f.request())).ok,true);assert.equal(f.reads(),1);
  assert.equal(f.bridge.allows({actorId:f.bootstrap.ownerUserId},'status'),false);
});
test('tampered inputs, cross-session messages and signature failures never call the App service',async()=>{
  const f=fixture();await f.bridge.handle(f.bootstrap);
  assert.equal((await f.bridge.handle({...f.request('projects_list'),input:{deviceId:'forged'}})).error,'host_signature_rejected');
  assert.equal((await f.bridge.handle({...f.request(),sessionId:randomUUID()})).error,'host_request_rejected');
  assert.equal(f.reads(),0);
});
test('valid signature cannot authorize writes, duplicate reads, expired frames or an expired session',async()=>{
  const f=fixture();await f.bridge.handle(f.bootstrap);
  assert.equal((await f.bridge.handle(f.request('work_send',{content:'No'}))).error,'host_read_only');
  const read=f.request();assert.equal((await f.bridge.handle(read)).ok,true);
  assert.equal((await f.bridge.handle(read)).error,'host_request_replayed');
  const late=f.request();f.advance(31000);
  assert.equal((await f.bridge.handle(late)).error,'host_request_rejected');
  f.advance(30000);assert.equal((await f.bridge.handle(f.request())).error,'host_session_expired');
  assert.equal(f.reads(),1);
});
test('bootstrap cannot enlarge the fixed read-only capability or smuggle caller-controlled identity fields',async()=>{
  const f=fixture();
  assert.equal((await f.bridge.handle({...f.bootstrap,capability:'full-computer-control'})).error,'host_bootstrap_rejected');
  const g=fixture();assert.equal((await g.bridge.handle({...g.bootstrap,allowedOperations:['work_send']})).error,'host_bootstrap_rejected');
  assert.equal(f.reads()+g.reads(),0);
});
test('closing the private pipe drops authority without changing the App service or Store',async()=>{
  const f=fixture(),input=new PassThrough(),output=new PassThrough();let received='';
  output.on('data',chunk=>received+=chunk);
  const detach=attachOrchestratorRuntimePipes({input,output,bridge:f.bridge});
  const line=Buffer.from(JSON.stringify(f.bootstrap)+'\n');
  input.write(line.subarray(0,7));input.write(line.subarray(7));
  await new Promise(r=>setImmediate(r));
  assert.equal(JSON.parse(received.trim()).type,'ready');
  input.write(JSON.stringify(f.request())+'\n');await new Promise(r=>setImmediate(r));
  assert.equal(f.reads(),1);detach();assert.equal(f.bridge.connected,false);
  assert.equal((await f.bridge.handle(f.request())).error,'host_session_closed');
});
test('oversized and invalid UTF-8 framing close the pipe before invoking the service',async()=>{
  for(const chunk of [Buffer.alloc(70000,65),Buffer.from([255,10])]) {
    const f=fixture(),input=new PassThrough(),output=new PassThrough();
    attachOrchestratorRuntimePipes({input,output,bridge:f.bridge});input.write(chunk);
    await new Promise(r=>setImmediate(r));assert.equal(f.bridge.connected,false);assert.equal(f.reads(),0);
  }
});
test('canonical signed wire format preserves Unicode and forbids ambiguous noninteger values',()=>{
  assert.equal(canonicalHostJson({z:'ação',a:[true,null,2]}),'{"a":[true,null,2],"z":"ação"}');
  assert.throws(()=>canonicalHostJson({x:NaN}));assert.throws(()=>canonicalHostJson({x:0.5}));
});

test('authenticated renewal rotates keys, extends only a live lease and invalidates old frames',async()=>{
  const f=fixture();const ready=await f.bridge.handle(f.bootstrap);
  assert.equal(ready.leaseRenewal,'hmac-sha256-key-rotation/1');
  const old=f.request(),newKey=randomBytes(32).toString('base64');
  const renewal=f.request('$lease_renew',{key:newKey,expiresAt:400000});
  const result=await f.bridge.handle(renewal);
  assert.deepEqual(result.result,{leaseRenewal:ready.leaseRenewal,expiresAt:400000});
  assert.equal((await f.bridge.handle(old)).error,'host_signature_rejected');
  assert.equal((await f.bridge.handle(renewal)).error,'host_signature_rejected');
  f.bootstrap.key=newKey;f.bootstrap.expiresAt=400000;
  f.advance(61000);
  assert.equal((await f.bridge.handle(f.request())).ok,true);
  assert.equal((await f.bridge.handle(f.request('work_send'))).error,'host_read_only');
  assert.equal(f.reads(),1);
});

test('renewal cannot alter identity, reuse key, remove the lease bound or resurrect expiration',async()=>{
  for(const change of [
    {expiresAt:160000},{expiresAt:400001},{expiresAt:Infinity},
    {key:'invalid'},{ownerUserId:randomUUID()},{capability:'computer.full'},
  ]) {
    const f=fixture();await f.bridge.handle(f.bootstrap);
    // Infinity has no canonical signed representation: reject it before wire use.
    if(change.expiresAt===Infinity){assert.throws(()=>f.request('$lease_renew',change));continue;}
    const input={key:randomBytes(32).toString('base64'),expiresAt:400000,...change};
    assert.equal((await f.bridge.handle(f.request('$lease_renew',input))).error,'host_renewal_rejected');
    assert.equal((await f.bridge.handle(f.request())).ok,true);
  }
  const f=fixture();await f.bridge.handle(f.bootstrap);
  assert.equal((await f.bridge.handle(f.request('$lease_renew',{
    key:f.bootstrap.key,expiresAt:400000}))).error,'host_renewal_rejected');
  const pending=f.request('$lease_renew',{key:randomBytes(32).toString('base64'),expiresAt:400000});
  f.advance(60000);
  assert.equal((await f.bridge.handle(pending)).error,'host_session_expired');
  assert.equal(f.bridge.connected,false);
});

test('24 hours of simulated leases retain one session and bounded replay memory',async()=>{
  const f=fixture();await f.bridge.handle(f.bootstrap);
  const sessionId=f.bootstrap.sessionId;
  // 360 four-minute advances: no provider calls, wall-clock wait or new bootstrap.
  for(let index=0;index<360;index++) {
    const key=randomBytes(32).toString('base64'),expiresAt=400000+index*240000;
    const result=await f.bridge.handle(f.request('$lease_renew',{key,expiresAt}));
    assert.equal(result.ok,true);
    f.bootstrap.key=key;f.bootstrap.expiresAt=expiresAt;
    f.advance(240000);
    assert.equal((await f.bridge.handle(f.request())).ok,true);
  }
  assert.equal(f.bootstrap.sessionId,sessionId);assert.equal(f.reads(),360);
});

test('renewal cannot race an active read or invalidate its live context',async()=>{
  let finish;
  const pending=new Promise(resolve=>finish=resolve),f=fixture(()=>pending);
  await f.bridge.handle(f.bootstrap);
  const read=f.bridge.handle(f.request());
  assert.equal((await f.bridge.handle(f.request('$lease_renew',{
    key:randomBytes(32).toString('base64'),expiresAt:400000}))).error,'host_exchange_busy');
  finish();assert.equal((await read).ok,true);
});

test('Windows managed transport accepts one exact local pipe and never guesses a fallback',()=>{
  const name=String.raw`\\.\pipe\ordax.orchestrator.11111111-2222-3333-4444-555555555555`;
  const flag='--ordax-runtime-bridge-pipe='+name;
  assert.deepEqual(resolveOrchestratorRuntimeTransport([flag],'win32'),{kind:'windows-pipe',name});
  assert.deepEqual(resolveOrchestratorRuntimeTransport(['--ordax-runtime-bridge-fds'],'win32'),{kind:'inherited'});
  assert.equal(resolveOrchestratorRuntimeTransport([],'win32'),null);
  for(const args of [[flag,flag],[flag,'--ordax-runtime-bridge-fds'],
    ['--ordax-runtime-bridge-pipe=\\server\\pipe\\name'],
    ['--ordax-runtime-bridge-pipe=http://localhost:1234'],
    ['--ordax-runtime-bridge-pipe='+name+'\\suffix'],['--ordax-runtime-bridge-stdio']])
    assert.throws(()=>resolveOrchestratorRuntimeTransport(args,'win32'));
  assert.throws(()=>resolveOrchestratorRuntimeTransport([flag],'linux'));
});

