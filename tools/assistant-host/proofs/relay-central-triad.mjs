// Cross-owner acceptance probe: installed Node host -> real Platform lab loopback.
// Three *logical* clients, NOT three physical computers or real GPT sessions.
// The Platform owner is imported at the explicitly supplied checkout revision.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWebServer } from '../web-server.mjs';

const platformRoot=process.argv[2];
if (!platformRoot) throw Error('Usage: node relay-central-triad.mjs <platform-checkout-root>');
const {startRelayLab}=await import(pathToFileURL(
  resolve(platformRoot,'control-plane/labs/relay/relay.mjs')
).href);

const clients=Array.from({length:3},(_,i)=>({
  id:'spoke-'+(i+1), secret:randomBytes(32).toString('hex'), marker:'isolated-spoke-'+(i+1),
}));
const operatorSecret=randomBytes(32).toString('hex');
let adapterCalls=0;
const lab=await startRelayLab({
  devices:clients.map(c=>({id:c.id,secret:c.secret})),
  adminToken:operatorSecret,
  inference:async({deviceId,requestId,prompt})=>{
    const client=clients.find(c=>c.id===deviceId);
    assert.ok(client);
    adapterCalls++;
    return {deviceId,requestId,result:client.marker+' :: '+prompt};
  },
});
const savedUrl=process.env.ORDAX_RELAY_LAB_URL;
const savedToken=process.env.ORDAX_RELAY_LAB_ADMIN_TOKEN;
process.env.ORDAX_RELAY_LAB_URL=lab.url;
process.env.ORDAX_RELAY_LAB_ADMIN_TOKEN=operatorSecret;
let host;
const post=(client,request_id,prompt,token=client.secret)=>fetch(lab.url+'/v1/infer',{
  method:'POST',
  headers:{
    authorization:'Bearer '+token,
    'content-type':'application/json',
    'x-ordax-lab-device-id':client.id,
  },
  body:JSON.stringify({request_id,prompt}),
});
try {
  host=await createWebServer({bridge:{},runtime:null});
  // Studio operator UI status is local-session gated: no session, no counts.
  assert.equal((await fetch(host.origin+'/api/relay')).status,401);
  const page=await fetch(host.origin+'/src/index.html');
  assert.equal(page.status,200);
  const cookie=page.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie?.startsWith('ordax_assistant_web='));
  async function snapshot(){
    const response=await fetch(host.origin+'/api/relay',{headers:{cookie}});
    assert.equal(response.status,200);
    return response.json();
  }
  const initial=await snapshot();
  assert.deepEqual([initial.state,initial.clients,initial.retained],[
    'connected-laboratory',3,0,
  ]);
  const firstRequests=[];
  for(let turn=1;turn<=3;turn++){
    // The same UUID may exist for three distinct clients. It must NOT
    // produce a shared replay, history or device result.
    const sharedId=randomUUID();
    const replies=await Promise.all(clients.map(async client=>{
      const prompt='turn-'+turn+' '+client.id;
      const response=await post(client,sharedId,prompt);
      assert.equal(response.status,200,await response.clone().text());
      return {client,prompt,body:await response.json()};
    }));
    for(const {client,prompt,body} of replies){
      assert.equal(body.request_id,sharedId);
      assert.equal(body.replayed,false);
      assert.equal(body.source,'lab-adapter');
      assert.equal(body.result,client.marker+' :: '+prompt);
      for(const other of clients.filter(c=>c!==client)){
        assert.ok(!JSON.stringify(body).includes(other.marker));
        assert.ok(!JSON.stringify(body).includes(other.secret));
      }
      if(turn===1) firstRequests.push({client,prompt,requestId:sharedId});
    }
  }
  assert.equal(adapterCalls,9);
  const old=firstRequests[1];
  const repeated=await post(old.client,old.requestId,old.prompt);
  assert.equal(repeated.status,200);
  assert.equal((await repeated.json()).replayed,true);
  assert.equal(adapterCalls,9);
  assert.equal((await post(clients[0],randomUUID(),'spoofed',clients[1].secret)).status,401);
  assert.equal((await fetch(lab.url+'/v1/devices')).status,404);
  const before=await snapshot();
  assert.deepEqual([before.clients,before.active,before.retained,before.failures],[3,0,9,0]);
  for(const privateValue of [operatorSecret,...clients.flatMap(c=>[c.id,c.secret,c.marker])]){
    assert.equal(JSON.stringify(before).includes(privateValue),false);
  }
  assert.equal(lab.revokeDevice(clients[0].id),true);
  assert.equal((await post(clients[0],randomUUID(),'post-revocation')).status,401);
  const healthy=await post(clients[1],randomUUID(),'after-first-client-revoked');
  assert.equal(healthy.status,200);
  assert.equal((await healthy.json()).result,clients[1].marker+' :: after-first-client-revoked');
  const after=await snapshot();
  assert.deepEqual([after.state,after.clients,after.active,after.retained],[
    'connected-laboratory',2,0,7,
  ]);
  for(const privateValue of [operatorSecret,...clients.flatMap(c=>[c.id,c.secret,c.marker])]){
    assert.equal(JSON.stringify(after).includes(privateValue),false);
  }
  console.log('STUDIO_RELAY_LOOPBACK_E2E=PASS');
  console.log('TRIAD_CLIENTS=3 INDEPENDENT_TURNS=9 POST_REVOCATION_TURNS=1');
  console.log('EXACT_RECIPIENT=PASS CROSS_TOKEN_DENIED=PASS REPLAY_NO_REEXECUTION=PASS');
  console.log('STUDIO_COOKIE_REQUIRED=PASS ADMIN_PROJECTION_PRIVATE=PASS REVOKE=PASS');
  console.log('MODEL_ADAPTER=FIXTURE PHYSICAL_CLIENTS=NOT_TESTED');
} finally {
  await host?.close();
  await lab.close();
  if(savedUrl===undefined) delete process.env.ORDAX_RELAY_LAB_URL;
  else process.env.ORDAX_RELAY_LAB_URL=savedUrl;
  if(savedToken===undefined) delete process.env.ORDAX_RELAY_LAB_ADMIN_TOKEN;
  else process.env.ORDAX_RELAY_LAB_ADMIN_TOKEN=savedToken;
}
