import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebServer } from '../web-server.mjs';
import { observeRelayLab, relayLabProjection } from '../native/relay-observer.mjs';

const snapshot = {
  schema:'ordax.relay-lab-status/1', environment:'loopback-laboratory',
  acceptingClients:3, activeRequests:1, retainedReceipts:2,
  failedReceipts:1, cancelledReceipts:1, timedOutReceipts:0,
  privateDevice:'not-for-browser',token:'not-for-browser',prompt:'not-for-browser',
};
test('Relay host observer does not contact arbitrary hosts or leak operator credentials',async()=>{
  const token='x'.repeat(64);
  let calls=0;
  const observer=async (url,options)=>{
    calls++;
    assert.equal(url,'http://127.0.0.1:14567/v1/admin/status');
    assert.equal(options.headers.authorization,'Bearer '+token);
    assert.equal(options.redirect,'error');
    return Response.json(snapshot);
  };
  const accepted=await observeRelayLab({url:'http://127.0.0.1:14567',token,fetchImpl:observer});
  assert.deepEqual(accepted,{
    schema:'ordax.studio-relay-observation/1',state:'connected-laboratory',
    clients:3,active:1,retained:2,failures:1,cancelled:1,timedOut:0,
  });
  assert.ok(!JSON.stringify(accepted).includes('not-for-browser'));
  for(const badUrl of [
    'https://example.com','http://localhost:14567','http://127.0.0.2:14567',
    'http://127.0.0.1:14567@elsewhere.test','http://127.0.0.1:14567/private',
    'http://127.0.0.1:14567?next=remote','file:///tmp/private',
  ]){
    const denied=await observeRelayLab({url:badUrl,token,fetchImpl:observer});
    assert.equal(denied.state,'invalid-configuration');
  }
  assert.equal((await observeRelayLab({url:'http://127.0.0.1:14567',token:'short',fetchImpl:observer})).state,'invalid-configuration');
  assert.equal(calls,1);
});

test('malformed/oversized Relay status is rejected and read failures stay private',async()=>{
  assert.equal(relayLabProjection({...snapshot,activeRequests:40}).state,'unavailable');
  assert.equal(relayLabProjection({...snapshot,retainedReceipts:0}).state,'unavailable');
  assert.equal(relayLabProjection({...snapshot,cancelledReceipts:2}).state,'unavailable');
  const unavailable=await observeRelayLab({url:'http://127.0.0.1:14567',token:'x'.repeat(64),
    fetchImpl:async()=>{throw Error('private-credential');}});
  assert.equal(unavailable.state,'unavailable');
  assert.ok(!JSON.stringify(unavailable).includes('private-credential'));
});

test('central UI Relay endpoint is cookie-protected and publishes only projected summary',async t=>{
  let reads=0;
  const host=await createWebServer({
    bridge:{},runtime:null,
    observeRelay:async()=>{reads++;return relayLabProjection(snapshot);},
  });
  t.after(()=>host.close());
  assert.equal((await fetch(host.origin+'/api/relay')).status,401);
  const page=await fetch(host.origin+'/src/index.html');
  assert.equal(page.status,200);
  const cookie=page.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie?.startsWith('ordax_assistant_web='));
  const response=await fetch(host.origin+'/api/relay',{headers:{cookie}});
  assert.equal(response.status,200);
  assert.equal(reads,1);
  const value=await response.json();
  assert.equal(value.state,'connected-laboratory');
  assert.equal(value.clients,3);
  assert.equal(JSON.stringify(value).includes('not-for-browser'),false);
});
