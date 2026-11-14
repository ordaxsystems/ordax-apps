import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createForgeProductSession,FORGE_SUPABASE_URL} from '../src/forge-product-session.mjs';
import {ForgeRemoteGatewayClient,forgeRemoteCatalogDigest} from '../src/forge-remote-gateway-client.mjs';
import {Store} from '../src/store.mjs';

const subject='11111111-2222-4333-8444-555555555555';
function jwt({exp=Math.floor(Date.now()/1000)+3600,client_id}={}){
  const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  return enc({alg:'RS256',typ:'JWT'})+'.'+enc({
    iss:'https://jhfphsjptrpmtnzkpwud.supabase.co/auth/v1',
    aud:'authenticated',role:'authenticated',sub:subject,exp,
    ...(client_id===undefined?{}:{client_id})
  })+'.sig';
}
function safeStorage(){
  return {
    isEncryptionAvailable:()=>true,
    encryptString:value=>Buffer.from('sealed:'+Buffer.from(value).toString('base64')),
    decryptString:buffer=>Buffer.from(String(buffer).slice(7),'base64').toString('utf8')
  };
}
function response(status,body){return new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json'}
});}

test('product session uses one normal Supabase account session, sealed at rest and refreshed without client_id',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'forge-product-session-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    calls.push({url:String(url),body:options.body?JSON.parse(options.body):null});
    if(String(url).endsWith('/auth/v1/otp'))return response(200,{});
    if(String(url).endsWith('/auth/v1/verify'))return response(200,{
      access_token:jwt({exp:Math.floor(Date.now()/1000)+30}),refresh_token:'refresh-one',
      user:{id:subject,email:'owner@example.com'}
    });
    if(String(url).endsWith('/auth/v1/user'))return response(200,{id:subject,email:'owner@example.com'});
    if(String(url).includes('/auth/v1/token?grant_type=refresh_token'))return response(200,{
      access_token:jwt(),refresh_token:'refresh-two',user:{id:subject,email:'owner@example.com'}
    });
    throw Error('unexpected_fetch');
  };
  const session=createForgeProductSession({userRoot:root,safeStorage:safeStorage(),fetchImpl});
  await session.requestOtp('owner@example.com');
  const verified=await session.verifyOtp({email:'owner@example.com',token:'123456'});
  assert.equal(verified.subjectId,subject);
  assert.equal(session.status().connected,true);
  const bytes=fs.readFileSync(path.join(root,'config','forge-product-session.enc')).toString();
  assert.doesNotMatch(bytes,/refresh-one|owner@example\.com/);
  assert.equal(typeof await session.accessToken(),'string');
  assert.ok(calls.some(call=>call.url.includes('grant_type=refresh_token')));
  assert.equal(session.status().connected,true);
});

test('product session refuses OAuth-server client tokens for native Forge authority',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'forge-product-client-token-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const client='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const fetchImpl=async url=>{
    if(String(url).endsWith('/auth/v1/otp'))return response(200,{});
    if(String(url).endsWith('/auth/v1/verify'))return response(200,{
      access_token:jwt({client_id:client}),refresh_token:'refresh',
      user:{id:subject,email:'owner@example.com'}
    });
    throw Error('unexpected_fetch');
  };
  const session=createForgeProductSession({userRoot:root,safeStorage:safeStorage(),fetchImpl});
  await session.requestOtp('owner@example.com');
  await assert.rejects(session.verifyOtp({email:'owner@example.com',token:'654321'}),
    /forge_product_native_session_required/);
  assert.equal(session.status().connected,false);
});

test('remote gateway uses one catalog digest and one leased local MCP execution',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-remote-gateway-'));
  const store=new Store(path.join(dir,'x.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const catalog=[{name:'forge_projects_list',description:'List projects',
    inputSchema:{type:'object',properties:{},required:[],additionalProperties:false},
    annotations:{readOnlyHint:true}}];
  const requests=[];let invokes=0,bound=null;
  const fetchImpl=async(url,options)=>{
    const body=JSON.parse(options.body);requests.push({url:String(url),body});
    if(String(url).endsWith('/register'))return response(200,{ok:true,last_seen_at:'2026-11-14T00:00:00.000Z'});
    if(String(url).endsWith('/start'))return response(200,{ok:true});
    if(String(url).endsWith('/report'))return response(200,{ok:true,status:'succeeded'});
    if(String(url).endsWith('/presence'))return response(200,{ok:true,last_seen_at:'2026-11-14T00:00:10.000Z'});
    throw Error('unexpected_fetch');
  };
  const session={status:()=>({connected:true,subjectId:subject,issuer:'https://jhfphsjptrpmtnzkpwud.supabase.co/auth/v1'}),
    accessToken:async()=>jwt()};
  const client=new ForgeRemoteGatewayClient({store,session,catalogProvider:async()=>catalog,
    toolInvoker:async(name,args)=>{invokes++;return {result:{content:[{type:'text',text:'ok'}],
      structuredContent:{name,args}}};},
    bindOwnerIdentity:value=>{bound=value;},fetchImpl});
  await client.register();
  const register=requests.find(r=>r.url.endsWith('/register'));
  assert.equal(register.body.catalog_digest,forgeRemoteCatalogDigest(catalog));
  assert.deepEqual(register.body.catalog,catalog);
  assert.equal(bound.subjectId,subject);
  const job={request_id:'10000000-0000-4000-8000-000000000001',
    attempt_id:'10000000-0000-4000-8000-000000000002',
    lease_id:'10000000-0000-4000-8000-000000000003',
    tool_name:'forge_projects_list',access_mode:'read',arguments:{}};
  const result=await client.executeJob(job);
  assert.equal(result.status,'succeeded');
  assert.equal(invokes,1);
  const report=requests.find(r=>r.url.endsWith('/report'));
  assert.equal(report.body.succeeded,true);
  assert.equal(report.body.result.structuredContent.name,'forge_projects_list');
});

test('rejected remote start never invokes the local MCP effect',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-remote-start-reject-'));
  const store=new Store(path.join(dir,'x.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  let invokes=0;
  const client=new ForgeRemoteGatewayClient({store,
    session:{status:()=>({connected:true,subjectId:subject,issuer:'https://jhfphsjptrpmtnzkpwud.supabase.co/auth/v1'}),
      accessToken:async()=>jwt()},
    catalogProvider:async()=>[{name:'forge_projects_list',description:'List',
      inputSchema:{type:'object',properties:{},required:[],additionalProperties:false}}],
    toolInvoker:async()=>{invokes++;},
    bindOwnerIdentity:()=>{},
    fetchImpl:async url=>String(url).endsWith('/start')
      ?response(409,{ok:false,error:'forge_action_receipt_rejected'})
      :response(200,{ok:true})});
  await assert.rejects(client.executeJob({
    request_id:'20000000-0000-4000-8000-000000000001',
    attempt_id:'20000000-0000-4000-8000-000000000002',
    lease_id:'20000000-0000-4000-8000-000000000003',
    tool_name:'forge_projects_list',arguments:{}
  }),/forge_action_receipt_rejected/);
  assert.equal(invokes,0);
});

test('independent remote claims execute concurrently with distinct leased agent identities',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-remote-parallel-'));
  const store=new Store(path.join(dir,'x.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const calls=[],resolvers=new Map();
  const client=new ForgeRemoteGatewayClient({
    store,maxConcurrent:4,
    session:{status:()=>({connected:true,subjectId:subject,issuer:'https://jhfphsjptrpmtnzkpwud.supabase.co/auth/v1'}),
      accessToken:async()=>jwt()},
    catalogProvider:async()=>[],
    toolInvoker:(name,args)=>new Promise(resolve=>resolvers.set(args.id,resolve)),
    bindOwnerIdentity:()=>{},
    fetchImpl:async(url,options)=>{
      const req={path:String(url),body:JSON.parse(options.body)};
      calls.push(req);
      if(req.path.endsWith('/start'))return response(200,{ok:true});
      if(req.path.endsWith('/report'))return response(200,{ok:true,status:'succeeded'});
      throw Error('unexpected_gateway_request');
    }
  });
  assert.equal(client.status().workers,4);
  assert.equal(new Set(client.agentInstanceIds).size,4);
  const job=id=>({
    request_id:'30000000-0000-4000-8000-00000000000'+id,
    attempt_id:'30000000-0000-4000-8000-00000000001'+id,
    lease_id:'30000000-0000-4000-8000-00000000002'+id,
    tool_name:'forge_projects_list',access_mode:'read',arguments:{id}
  });
  const a=client.executeJob(job(1),{agentInstanceId:client.agentInstanceIds[0]});
  const b=client.executeJob(job(2),{agentInstanceId:client.agentInstanceIds[1]});
  for(let i=0;i<20&&resolvers.size<2;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(resolvers.size,2);
  assert.equal(client.status().activeRequestIds.length,2);
  resolvers.get(2)({result:{content:[],structuredContent:{id:2}}});
  resolvers.get(1)({result:{content:[],structuredContent:{id:1}}});
  await Promise.all([a,b]);
  assert.equal(client.status().activeRequestIds.length,0);
  const starts=calls.filter(c=>c.path.endsWith('/start'));
  const reports=calls.filter(c=>c.path.endsWith('/report'));
  assert.equal(starts.length,2);
  assert.equal(reports.length,2);
  assert.notEqual(starts[0].body.agent_instance_id,starts[1].body.agent_instance_id);
  assert.deepEqual(reports.map(c=>c.body.succeeded),[true,true]);
});

test('parallel start calls register once; stop during registration cannot revive polling',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-remote-start-stop-'));
  const store=new Store(path.join(dir,'x.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  let resolveRegistration=null,registrations=0,presenceOffline=0,claims=0;
  const catalog=[{name:'forge_projects_list',description:'List projects',
    inputSchema:{type:'object',properties:{},required:[],additionalProperties:false},
    annotations:{readOnlyHint:true}}];
  const client=new ForgeRemoteGatewayClient({store,
    session:{status:()=>({connected:true,subjectId:subject,issuer:'https://jhfphsjptrpmtnzkpwud.supabase.co/auth/v1'}),
      accessToken:async()=>jwt()},
    catalogProvider:async()=>catalog,toolInvoker:async()=>({result:{}}),
    bindOwnerIdentity:()=>{},
    fetchImpl:async(url,options)=>{
      const path=String(url);
      if(path.endsWith('/register')){
        registrations++;
        return new Promise(resolve=>{resolveRegistration=()=>resolve(response(200,{
          ok:true,last_seen_at:'2026-11-14T00:00:00Z'
        }));});
      }
      if(path.endsWith('/presence')){
        if(JSON.parse(options.body).online===false)presenceOffline++;
        return response(200,{ok:true,last_seen_at:'2026-11-14T00:00:01Z'});
      }
      if(path.endsWith('/claim')){claims++;return response(200,{ok:true,job:null});}
      throw Error('unexpected_request');
    }
  });
  const first=client.start(),second=client.start();
  for(let i=0;i<20&&!resolveRegistration;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(typeof resolveRegistration,'function');
  const stopped=client.stop();
  resolveRegistration();
  await Promise.all([first,second,stopped]);
  assert.equal(registrations,1);
  assert.equal(presenceOffline,1);
  assert.equal(claims,0);
  assert.equal(client.status().running,false);
});
