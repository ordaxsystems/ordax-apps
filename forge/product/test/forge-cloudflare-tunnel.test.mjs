import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {createServer,request as httpRequest} from 'node:http';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {verifyForgeAccessJwt} from '../src/forge-cloudflare-access.mjs';
import {createForgeCloudflareBridge,FORGE_CLOUDFLARE_HOSTNAME}
  from '../src/forge-cloudflare-mcp-bridge.mjs';
import {FORGE_CLOUDFLARE_TUNNEL_ID,makeForgeCloudflareLaunch,
  createForgeCloudflareTunnelSession,validateForgeCloudflareToken}
  from '../src/forge-cloudflare-tunnel.mjs';
import {installPinnedForgeCloudflared,FORGE_CLOUDFLARED_URL}
  from '../src/forge-cloudflared-install.mjs';

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'forge-test'};
const team='forge-test',audience='abcdefghijklmnop0123456789abcd',now=Date.now();
const base64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
function jwt(override={}){
  const header=base64({alg:'RS256',kid:'forge-test',typ:'JWT'});
  const payload=base64({iss:'https://forge-test.cloudflareaccess.com',aud:[audience],
    sub:'user123',email:'owner@example.com',
    iat:Math.floor(now/1000)-30,exp:Math.floor(now/1000)+600,...override});
  const message=header+'.'+payload;
  return message+'.'+sign('RSA-SHA256',Buffer.from(message),privateKey).toString('base64url');
}
const grant={projectId:'forge_app',port:60252,token:'A'.repeat(43)};
test('Access token requires signed matching issuer, audience and expiry',async()=>{
  const opts={team,audience,keys:[jwk],now:()=>now};
  assert.equal((await verifyForgeAccessJwt(jwt(),opts)).email,'owner@example.com');
  await assert.rejects(verifyForgeAccessJwt(jwt({aud:['different']}),opts),
    /claims_rejected/);
  await assert.rejects(verifyForgeAccessJwt(jwt({exp:10}),opts),/claims_rejected/);
  await assert.rejects(verifyForgeAccessJwt(jwt().slice(0,-4)+'abcd',opts),
    /signature_invalid/);
  await assert.rejects(verifyForgeAccessJwt(jwt(),{...opts,team:'other-team'}),
    /claims_rejected/);
});
const serverAt=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
async function freePort(){
  const candidate=createServer();
  const p=await serverAt(candidate);
  await new Promise(resolve=>candidate.close(resolve));
  return p;
}
function callBridge(port,{token=jwt(),host=FORGE_CLOUDFLARE_HOSTNAME,body='{}',extra={}}={}){
  return new Promise((resolve,reject)=>{
    const headers={'content-type':'application/json',host,...extra};
    if(token!==null)headers['cf-access-jwt-assertion']=token;
    const req=httpRequest({host:'127.0.0.1',port,path:'/mcp',method:'POST',headers},res=>{
      let value='';res.on('data',c=>{value+=c;});res.on('end',()=>resolve({
        status:res.statusCode,value,session:res.headers['mcp-session-id']
      }));
    });req.on('error',reject);req.end(body);
  });
}
test('bridge verifies Access JWT, injects only local bearer, rejects unauthenticated calls',async t=>{
  let seen,owner=true,mutableGrant={...grant};
  const backend=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    seen={authorization:req.headers.authorization,host:req.headers.host,
      origin:req.headers.origin,body};
    res.writeHead(200,{'content-type':'application/json','mcp-session-id':'session-test'});
    res.end(JSON.stringify({jsonrpc:'2.0',result:{ok:true},id:1}));
  });
  mutableGrant.port=await serverAt(backend);
  t.after(()=>new Promise(resolve=>backend.close(resolve)));
  const bridge=createForgeCloudflareBridge({
    port:await freePort(),getLocalGrant:()=>mutableGrant,ownerTrusted:()=>owner,
    keysProvider:async()=>[jwk]
  });
  await bridge.start({team,audience});
  t.after(()=>bridge.stop());
  const port=bridge.status().originPort;
  assert.equal((await callBridge(port,{token:null})).status,401);
  assert.equal((await callBridge(port,{token:jwt({aud:['bad']})})).status,403);
  assert.equal((await callBridge(port,{host:'evil.example'})).status,403);
  const ok=await callBridge(port,{body:'{"jsonrpc":"2.0"}'});
  assert.equal(ok.status,200);
  assert.equal(ok.session,'session-test');
  assert.equal(seen.authorization,'Bearer '+mutableGrant.token);
  assert.equal(seen.host,'127.0.0.1:'+mutableGrant.port);
  assert.equal(seen.origin,undefined);
  assert.equal(seen.body,'{"jsonrpc":"2.0"}');
  owner=false;
  assert.equal((await callBridge(port)).status,403);
});
const tunnelToken=Buffer.from(JSON.stringify({
  a:'account-id',t:FORGE_CLOUDFLARE_TUNNEL_ID,s:'secret-identifier'
})).toString('base64');
test('official connector token stays in isolated environment, never argv',()=>{
  assert.equal(validateForgeCloudflareToken(tunnelToken),tunnelToken);
  const result=makeForgeCloudflareLaunch({
    ownerApproved:true,platform:'win32',token:tunnelToken,
    executablePath:'C:\\Forge\\cloudflared.exe',
    verifyExecutable:()=>{},inheritedEnv:{PATH:'C:\\Windows',UNRELATED_SECRET:'blocked'}
  });
  assert.deepEqual(result.args,['tunnel','--no-autoupdate','run']);
  assert.equal(JSON.stringify(result.args).includes(tunnelToken),false);
  assert.equal(result.env.TUNNEL_TOKEN,tunnelToken);
  assert.equal(result.env.UNRELATED_SECRET,undefined);
  assert.equal(result.env.TUNNEL_MANAGEMENT_DIAGNOSTICS,'false');
  assert.throws(()=>makeForgeCloudflareLaunch({...result,token:tunnelToken,ownerApproved:false}),
    /owner_approval_required/);
  assert.throws(()=>validateForgeCloudflareToken(Buffer.from(JSON.stringify({
    a:'account-id',t:'other-tunnel',s:'secret'
  })).toString('base64')),/identity_mismatch/);
});
test('session starts one process only after authorized bridge and stops both',async()=>{
  let bridgeStarted=0,bridgeStopped=0,child;
  const control=createForgeCloudflareTunnelSession({
    getLocalGrant:()=>grant,ownerTrusted:()=>true,executablePath:'C:\\Forge\\cloudflared.exe',
    createBridge:()=>({
      start:async()=>{bridgeStarted++;},
      stop:async()=>{bridgeStopped++;}
    }),
    launch:()=>({
      command:'C:\\Forge\\cloudflared.exe',args:['tunnel','run'],
      spawnOptions:{shell:false},env:{TUNNEL_TOKEN:tunnelToken}
    }),
    spawnClient:()=>{
      child=new EventEmitter();
      child.kill=()=>{queueMicrotask(()=>child.emit('exit',0));return true;};
      queueMicrotask(()=>child.emit('spawn'));return child;
    }
  });
  assert.equal(control.status().state,'stopped');
  const active=await control.start({ownerApproved:true,token:tunnelToken,team,audience});
  assert.equal(active.state,'running');
  assert.equal(active.remoteChatGptConnected,false);
  assert.equal(bridgeStarted,1);
  await assert.rejects(control.start({ownerApproved:true}),/already_running/);
  control.stop();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(control.status().state,'stopped');
  assert.equal(bridgeStopped,1);
});
test('installer publishes only a file with the verified pinned checksum',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'forge-cloudflare-installer-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const data=Buffer.from('mock binary test only');
  const target=path.join(root,'v1','cloudflared.exe');
  const goodSha=createHash('sha256').update(data).digest('hex');
  const input={target,expectedSha:goodSha,download:async candidate=>{
    fs.writeFileSync(candidate,data,{flag:'wx'});
  }};
  const good=await installPinnedForgeCloudflared(input);
  assert.equal(good.installed,true);
  assert.equal(fs.readFileSync(target).equals(data),true);
  await assert.rejects(installPinnedForgeCloudflared(input),/existing_binary/);
  assert.ok(FORGE_CLOUDFLARED_URL.startsWith('https://github.com/cloudflare/cloudflared/'));
  const other=path.join(root,'v2','cloudflared.exe');
  await assert.rejects(installPinnedForgeCloudflared({
    ...input,target:other,expectedSha:'0'.repeat(64)
  }),/official_sha256_invalid/);
  assert.equal(fs.existsSync(other),false);
});

test('revoking a pending Access preflight cannot leave a late MCP listener',async()=>{
  let release;
  const bridge=createForgeCloudflareBridge({
    port:await freePort(),getLocalGrant:()=>grant,ownerTrusted:()=>true,
    keysProvider:()=>new Promise(resolve=>{release=resolve;})
  });
  const pending=bridge.start({team,audience});
  assert.equal(bridge.status().running,false);
  await bridge.stop();
  release([jwk]);
  await assert.rejects(pending,/start_cancelled/);
  assert.equal(bridge.status().running,false);
});

test('stopping during async bridge activation cannot spawn an orphan connector',async()=>{
  let release;let spawns=0;
  const control=createForgeCloudflareTunnelSession({
    getLocalGrant:()=>grant,ownerTrusted:()=>true,
    executablePath:'C:\\Forge\\cloudflared.exe',
    launch:()=>({command:'C:\\Forge\\cloudflared.exe',args:['tunnel','run'],
      spawnOptions:{shell:false},env:{TUNNEL_TOKEN:tunnelToken}}),
    createBridge:()=>({start:()=>new Promise(resolve=>{release=resolve;}),
      stop:async()=>{}}),
    spawnClient:()=>{spawns++;throw Error('must never spawn');}
  });
  const pending=control.start({ownerApproved:true,token:tunnelToken,team,audience});
  control.stop();
  release();
  await assert.rejects(pending,/start_cancelled/);
  assert.equal(spawns,0);
  assert.equal(control.status().state,'stopped');
});
