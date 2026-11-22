import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {createOrchestratorMcp} from '../src/orchestrator-mcp.mjs';
import {ForgeRemoteGatewayClient,forgeRemoteCatalogDigest} from '../src/forge-remote-gateway-client.mjs';

const subject='11111111-2222-4333-8444-555555555555';
const issuer='https://jhfphsjptrpmtnzkpwud.supabase.co/auth/v1';
const tool=(name)=>({name,description:'Verified fixture capability',
  inputSchema:{type:'object',properties:{},required:[],additionalProperties:false},
  annotations:{readOnlyHint:true}});
const response=body=>new Response(JSON.stringify(body),{
  status:200,headers:{'content-type':'application/json'}
});

test('live MCP tools/list and tools/call revoke a native reader without restarting the MCP',async()=>{
  let permitted=['status'],callCount=0;
  const service={
    requireAccess:()=>true,
    invoke:async(_ctx,operation)=>{
      if(operation==='status')return {ready:true};
      if(operation==='repository_file_read'){callCount++;return {content:'controlled'};}
      throw Error('unsupported');
    }
  };
  const mcp=createOrchestratorMcp({service,getContext:()=>Object.freeze({}),
    allowedOperations:()=>permitted});
  const invoke=(id,method,params)=>mcp.handle({jsonrpc:'2.0',id,method,params});
  const init=await invoke(1,'initialize',{protocolVersion:'2025-11-25',
    capabilities:{},clientInfo:{name:'test',version:'1'}});
  assert.ok(init.result);
  await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const hasRead=async(id=2)=>(await invoke(id,'tools/list',{}))
    .result.tools.some(x=>x.name==='forge_repository_file_read');
  assert.equal(await hasRead(),false);
  const unknown=()=>invoke(5,'tools/call',{name:'forge_repository_file_read',arguments:{}});
  assert.equal((await unknown()).error?.message,'Unknown tool');
  permitted=['status','repository_file_read'];
  assert.equal(await hasRead(3),true);
  const granted=await unknown();
  assert.equal(granted.result.structuredContent.content,'controlled');
  assert.equal(callCount,1);
  permitted=['status'];
  assert.equal(await hasRead(4),false);
  assert.equal((await unknown()).error?.message,'Unknown tool');
  assert.equal(callCount,1,'revoked tool must not call the service');
});

test('gateway publishes new Owner tool catalog during a live connection and serializes old heartbeat',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-live-catalog-'));
  const store=new Store(path.join(dir,'forge.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true})});
  const initial=[tool('forge_status')];
  const elevated=[...initial,tool('forge_repository_file_read'),tool('forge_repository_files_list')];
  let current=initial,releaseHeartbeat=()=>{},enteredHeartbeat=()=>{},first=true;
  const entered=new Promise(resolve=>{enteredHeartbeat=resolve});
  const held=new Promise(resolve=>{releaseHeartbeat=resolve});
  const calls=[];
  const client=new ForgeRemoteGatewayClient({
    store,session:{status:()=>({connected:true,subjectId:subject,issuer}),
      accessToken:async()=> 'OWNED_TEST_OAUTH_TOKEN'},
    catalogProvider:async()=>current,
    toolInvoker:async()=>{throw Error('not_called')},
    bindOwnerIdentity:()=>{},
    fetchImpl:async(url,options)=>{
      const route=new URL(url).pathname,body=JSON.parse(options.body);
      calls.push({route,body});
      if(route.endsWith('/presence')&&first){
        first=false;enteredHeartbeat();await held;
      }
      return response({ok:true,last_seen_at:'2026-11-22T09:00:00Z'});
    }
  });
  await client.register();
  assert.equal(client.status().catalogSynchronized,true);
  client.running=true; // fixture: avoid introducing the background claim loop
  const previous=client.presence(true);
  await entered;
  current=elevated;
  const refresh=client.refreshCatalog();
  releaseHeartbeat();
  await previous;
  const changed=await refresh;
  assert.equal(changed.refreshed,true);
  assert.equal(changed.catalogSynchronized,true);
  assert.equal(changed.catalogDigest,forgeRemoteCatalogDigest(elevated));
  assert.deepEqual(calls.filter(x=>x.route.endsWith('/presence'))
    .map(x=>x.body.catalog_digest),[
      forgeRemoteCatalogDigest(initial),forgeRemoteCatalogDigest(elevated)
    ]);
  current=initial;
  const revoked=await client.refreshCatalog();
  assert.equal(revoked.refreshed,true);
  assert.equal(client.status().catalogSynchronized,true);
  assert.equal(calls.at(-1).body.catalog.length,1);
  assert.equal(calls.at(-1).body.catalog[0].name,'forge_status');
  client.running=false;
});

test('failed catalog publication preserves fail-closed transport state and retries on the existing heartbeat',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-catalog-retry-'));
  const store=new Store(path.join(dir,'forge.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true})});
  let catalog=[tool('forge_status')],fail=false;
  const calls=[];
  const client=new ForgeRemoteGatewayClient({
    store,session:{status:()=>({connected:true,subjectId:subject,issuer}),
      accessToken:async()=> 'OWNED_TEST_OAUTH_TOKEN'},
    catalogProvider:async()=>catalog,toolInvoker:async()=>{},
    bindOwnerIdentity:()=>{},
    fetchImpl:async(url,options)=>{
      const route=new URL(url).pathname,body=JSON.parse(options.body);
      calls.push({route,body});
      if(route.endsWith('/presence')&&fail){
        fail=false;
        return new Response(JSON.stringify({ok:false,error:'temporarily_unavailable'}),
          {status:503,headers:{'content-type':'application/json'}});
      }
      return response({ok:true});
    }
  });
  await client.register();client.running=true;
  catalog=[...catalog,tool('forge_repository_file_read')];
  fail=true;
  await assert.rejects(client.refreshCatalog(),/temporarily_unavailable/);
  assert.equal(client.status().catalogSynchronized,false);
  assert.equal(calls.at(-1).body.catalog.length,2);
  await client.presence(true);
  assert.equal(client.status().catalogSynchronized,true);
  assert.equal(calls.at(-1).body.catalog.length,2);
  client.running=false;
});

test('gateway republishes persisted Owner tools after remote identity binds on registration',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-owner-boot-rehydrate-'));
  const store=new Store(path.join(dir,'forge.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true})});
  let ownerIdentityBound=false;
  const base=[tool('forge_status')];
  const read=[...base,tool('forge_repository_inspect')];
  const calls=[];
  const client=new ForgeRemoteGatewayClient({
    store,session:{status:()=>({connected:true,subjectId:subject,issuer}),
      accessToken:async()=> 'OWNED_TEST_OAUTH_TOKEN'},
    catalogProvider:async()=>ownerIdentityBound?read:base,
    toolInvoker:async()=>{throw Error('not_called')},
    bindOwnerIdentity:identity=>{
      assert.equal(identity.subjectId,subject);
      assert.equal(identity.issuer,issuer);
      ownerIdentityBound=true;
    },
    fetchImpl:async(url,options)=>{
      const route=new URL(url).pathname,body=JSON.parse(options.body);
      calls.push({route,body});
      return response({ok:true,last_seen_at:'2026-11-22T20:00:00Z'});
    }
  });
  await client.register();
  assert.equal(ownerIdentityBound,true);
  assert.deepEqual(calls.map(x=>x.route.split('/').at(-1)),
    ['register','presence'],'register existing gateway, then publish the granted tools');
  assert.deepEqual(calls.map(x=>x.body.catalog.map(y=>y.name)),[
    ['forge_status'],['forge_status','forge_repository_inspect']
  ]);
  assert.equal(calls[1].body.catalog_digest,forgeRemoteCatalogDigest(read));
  assert.equal(client.status().catalogSynchronized,true);
  assert.equal(client.status().catalogDigest,forgeRemoteCatalogDigest(read));
  assert.equal(client.running,false,'registration must not start a parallel worker');
});
