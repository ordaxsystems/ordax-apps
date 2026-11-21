import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Store} from '../src/store.mjs';
import {ForgeMcpOwnerTrust} from '../src/forge-mcp-owner-trust.mjs';
import {createForgeWindowsSafeStorage} from '../src/forge-windows-safe-storage.mjs';
import {FORGE_NATIVE_OAUTH_CLIENT_ID} from '../src/forge-product-session.mjs';

const product=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const selected=process.platform==='win32'&&process.env.ORDAX_FORGE_TEST_OWNER_CUTOVER==='1';
const issuer='https://jhfphsjptrpmtnzkpwud.supabase.co/auth/v1';
const subject='11111111-2222-4333-8444-555555555555';
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt=()=>encode({alg:'RS256',typ:'JWT'})+'.'+encode({
  iss:issuer,aud:'authenticated',role:'authenticated',sub:subject,
  client_id:FORGE_NATIVE_OAUTH_CLIENT_ID,exp:Math.floor(Date.now()/1000)+7200
})+'.signature-for-isolated-test-only';

async function waitFor(fn,timeout=17000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    try{const value=await fn();if(value)return value;}catch{}
    await new Promise(resolve=>setTimeout(resolve,140));
  }
  throw Error('forge_node_owner_physical_acceptance_timeout');
}
function sealDpapiKey(secret){
  // Synthetic key is sent to the native Windows API only through stdin,
  // never env/argv or logs. Output is DPAPI-protected Local State material.
  const script=[
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.Security",
    "$b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())",
    "$cipher=[System.Security.Cryptography.ProtectedData]::Protect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "$wrapper=New-Object byte[] ($cipher.Length+5)",
    "[Text.Encoding]::ASCII.GetBytes('DPAPI').CopyTo($wrapper,0)",
    "$cipher.CopyTo($wrapper,5)",
    "[Console]::Out.Write([Convert]::ToBase64String($wrapper))",
    "[Array]::Clear($b,0,$b.Length)",
    "[Array]::Clear($cipher,0,$cipher.Length)"
  ].join(';');
  const answer=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive',
    '-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{
    input:secret.toString('base64'),encoding:'utf8',windowsHide:true,
    stdio:['pipe','pipe','pipe'],timeout:11000,maxBuffer:3000
  });
  if(answer.status!==0)throw Error('forge_node_owner_test_dpapi_protect_failed');
  const value=String(answer.stdout||'').trim();
  if(!/^[A-Za-z0-9+/]+=*$/.test(value))
    throw Error('forge_node_owner_test_dpapi_blob_invalid');
  return value;
}
async function initializeProfile(folder){
  const userRoot=path.join(folder,'OrdaX','Forge');
  const dataRoot=path.join(userRoot,'data');
  fs.mkdirSync(path.join(userRoot,'config'),{recursive:true});
  fs.mkdirSync(dataRoot,{recursive:true});
  const rawKey=randomBytes(32);
  const sealed=sealDpapiKey(rawKey);
  fs.writeFileSync(path.join(userRoot,'Local State'),
    JSON.stringify({os_crypt:{encrypted_key:sealed}}));
  rawKey.fill(0);
  const secure=createForgeWindowsSafeStorage({userRoot});
  assert.equal(secure.isEncryptionAvailable(),true);
  const contents=JSON.stringify({
    access_token:jwt(),refresh_token:'synthetic-refresh-not-reusable',
    email:'test-only@example.com'
  });
  const credentialPath=path.join(userRoot,'config','forge-product-session.enc');
  fs.writeFileSync(credentialPath,secure.encryptString(contents));
  assert.equal(fs.readFileSync(credentialPath).includes(Buffer.from('synthetic-refresh')),false);
  const store=new Store(path.join(dataRoot,'ordax-forge.sqlite'));
  const trust=new ForgeMcpOwnerTrust({
    store,appIdentity:userRoot,scopeSignature:projectId=>'app-private:'+projectId
  });
  trust.trustApp({expectedScopeHash:trust.appScopeHash()});
  store.close();
  return {userRoot,dataRoot};
}

test('physical isolated Windows Node owns OAuth, MCP gateway and SQLite without Electron',
  {skip:!selected},async t=>{
    const folder=await fsp.mkdtemp(path.join(os.tmpdir(),'forge-owner-native-gate-'));
    let child;
    t.after(async()=>{
      if(child&&child.exitCode===null)child.kill();
      await fsp.rm(folder,{recursive:true,force:true,maxRetries:5,retryDelay:170});
    });
    const {userRoot,dataRoot}=await initializeProfile(folder);
    const receipts=path.join(folder,'gateway-events.ndjson');
    const preload=path.join(folder,'mock-gateway.mjs');
    fs.writeFileSync(preload,`import fs from 'node:fs';
globalThis.fetch=async(url,init={})=>{
  const u=new URL(String(url));
  if(u.origin!=='https://forge-mcp.ordax.com.br')throw Error('forge_test_no_external_network');
  const stage=u.pathname.split('/').pop();
  if(stage==='claim'){
    await new Promise(resolve=>setTimeout(resolve,1200));
    return new Response(JSON.stringify({ok:true,job:null}),{status:200,headers:{'content-type':'application/json'}});
  }
  fs.appendFileSync(process.env.FORGE_TEST_RECEIPTS_PATH,
    JSON.stringify({stage,authorized:Boolean(init.headers?.authorization?.startsWith('Bearer '))})+'\\n');
  return new Response(JSON.stringify({ok:true,last_seen_at:new Date().toISOString()}),
    {status:200,headers:{'content-type':'application/json'}});
};
`);
    const argv=['--import',pathToFileURL(preload).href,'scripts/start-host.mjs',
      '--forge-owner-core','--forge-owner-core-approved'];
    const output=[];
    child=spawn(process.execPath,argv,{
      cwd:product,windowsHide:true,stdio:['ignore','pipe','pipe'],
      env:{...process.env,LOCALAPPDATA:folder,
        FORGE_TEST_RECEIPTS_PATH:receipts}
    });
    child.stdout.on('data',data=>output.push(data.toString('utf8')));
    let stderr='';
    child.stderr.on('data',data=>{stderr+=data.toString('utf8').slice(0,150)});
    const origin=await waitFor(()=>{
      if(child.exitCode!==null)throw Error('forge_node_owner_exited_early');
      const match=output.join('').match(/ORDAX_HOST_BROWSER_URL=(http:\/\/127\.0\.0\.1:[0-9]+)/);
      return match?.[1];
    },10000).catch(error=>{
      const safe=Array.from(stderr.matchAll(/(?:forge|host|node)_[a-z0-9_]{4,80}/g),m=>m[0]).slice(0,6);
      const diagnostic=stderr.slice(0,350).replace(/[A-Za-z0-9_-]{90,}/g,'[redacted]');
      throw Error(error.message+'; exit='+child.exitCode+'; stages='+safe.join(',')+'; trace='+diagnostic);
    });
    const lock=JSON.parse(fs.readFileSync(path.join(dataRoot,'host-process.lock'),'utf8'));
    assert.equal(lock.pid,child.pid);
    const calls=await waitFor(()=>{
      if(!fs.existsSync(receipts))return null;
      const lines=fs.readFileSync(receipts,'utf8').trim().split(/\r?\n/)
        .map(line=>JSON.parse(line));
      return lines.find(row=>row.stage==='register'&&row.authorized)?lines:null;
    });
    assert.ok(calls.some(item=>item.stage==='register'));
    assert.ok(calls.every(item=>item.authorized));
    const res=await fetch(origin+'/api/session',{
      method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'
    });
    assert.equal(res.status,200);
    const cookie=res.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie?.startsWith('ordax_host_session='));
    const ping=await fetch(origin+'/api/invoke',{
      method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},
      body:JSON.stringify({method:'orchestratorInvoke',args:['projects_list',{}]})
    });
    assert.equal(ping.status,200);
    const projects=await ping.json();
    assert.ok(Array.isArray(projects.projects));
    assert.equal(fs.existsSync(path.join(userRoot,'config','forge-product-session.enc')),true);
    assert.equal(fs.readdirSync(path.join(userRoot,'config')).length,1);
    assert.equal(fs.existsSync(path.join(dataRoot,'ordax-forge.sqlite')),true);
    // Stop through the existing authenticated Host shutdown route; no new
    // lifecycle service, no secret in the emitted result.
    await fetch(origin+'/api/shutdown',{
      method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},
      body:'{}'
    });
    await waitFor(()=>child.exitCode!==null,14000);
    const lockStillThere=fs.existsSync(path.join(dataRoot,'host-process.lock'));
    assert.equal(child.exitCode,0,'Node Host shutdown exit code: '+child.exitCode+' stderr='+
      stderr.slice(0,350).replace(/[A-Za-z0-9_-]{90,}/g,'[redacted]'));
    assert.equal(lockStillThere,false,'Node Host did not release the profile lock');
    const persisted=JSON.parse(fs.readFileSync(path.join(userRoot,'Local State'),'utf8'));
    assert.ok(persisted.os_crypt.encrypted_key.startsWith('RFBBUEk'));
    assert.equal(stderr.includes('synthetic-refresh-not-reusable'),false);
    // No contact with the actual Owner profile or real Forge gateway.
    assert.notEqual(path.resolve(userRoot).toLowerCase(),
      path.join(process.env.LOCALAPPDATA,'OrdaX','Forge').toLowerCase());
  }
);

test('Windows Electron safeStorage and Node share the exact synthetic profile crypto',
  {skip:!selected},async t=>{
    const folder=await fsp.mkdtemp(path.join(os.tmpdir(),'forge-oscrypt-native-'));
    let child;
    t.after(async()=>{
      if(child&&child.exitCode===null)child.kill();
      await fsp.rm(folder,{recursive:true,force:true,maxRetries:5,retryDelay:170});
    });
    const {userRoot}=await initializeProfile(folder);
    const secure=createForgeWindowsSafeStorage({userRoot});
    const nodeBlob=path.join(folder,'node-to-electron.blob');
    const electronBlob=path.join(folder,'electron-to-node.blob');
    const expected='Node-to-Electron synthetic DPAPI test only';
    fs.writeFileSync(nodeBlob,secure.encryptString(expected));
    const appFolder=path.join(folder,'electron-probe');
    fs.mkdirSync(appFolder,{recursive:true});
    fs.writeFileSync(path.join(appFolder,'package.json'),
      JSON.stringify({name:'forge-synthetic-oscrypt-interop',version:'0.0.1',main:'main.cjs'}));
    fs.writeFileSync(path.join(appFolder,'main.cjs'),[
      "const {app,safeStorage}=require('electron');",
      "const fs=require('node:fs');",
      "process.stdout.write('INTEROP_STAGE_MAIN_LOADED\\n');",
      "app.setName('Forge synthetic interop');",
      "app.setPath('userData',process.env.FORGE_TEST_CRYPTO_ROOT);",
      "app.whenReady().then(()=>{",
      "  try {",
      "    process.stdout.write('INTEROP_STAGE_APP_READY\\n');",
      "    const decoded=safeStorage.decryptString(fs.readFileSync(process.env.FORGE_TEST_NODE_BLOB));",
      "    if(decoded!=='Node-to-Electron synthetic DPAPI test only')throw Error('oscrypt_decrypt_mismatch');",
      "    fs.writeFileSync(process.env.FORGE_TEST_ELECTRON_BLOB,safeStorage.encryptString('Electron-to-Node synthetic only'));",
      "    process.stdout.write('FORGE_OSCRYPT_INTEROP_OK\\n');",
      "    app.exit(0);",
      "  } catch {process.stderr.write('FORGE_OSCRYPT_INTEROP_FAILED\\n');app.exit(1);}",
      "}).catch(()=>app.exit(2));"
    ].join('\n'));
    const cli=path.join(product,'node_modules','electron','cli.js');
    assert.equal(fs.existsSync(cli),true);
    child=spawn(process.execPath,[cli,appFolder],{
      cwd:product,windowsHide:true,stdio:['ignore','pipe','pipe'],
      env:{...Object.fromEntries(Object.entries(process.env)
        .filter(([key])=>key!=='ELECTRON_RUN_AS_NODE')),
        FORGE_TEST_CRYPTO_ROOT:userRoot,
        FORGE_TEST_NODE_BLOB:nodeBlob,FORGE_TEST_ELECTRON_BLOB:electronBlob}
    });
    let stdout='',stderr='';
    child.stdout.on('data',data=>{stdout+=data.toString('utf8')});
    child.stderr.on('data',data=>{stderr+=data.toString('utf8').slice(0,120)});
    await waitFor(()=>child.exitCode!==null,20000);
    assert.equal(child.exitCode,0,'Electron probe failed; stages='+
      stdout.slice(0,240).replace(/[A-Za-z0-9_-]{90,}/g,'[redacted]')+
      '; stderr='+stderr.slice(0,170).replace(/[A-Za-z0-9_-]{90,}/g,'[redacted]'));
    assert.ok(stdout.includes('FORGE_OSCRYPT_INTEROP_OK'));
    assert.equal(secure.decryptString(fs.readFileSync(electronBlob)),
      'Electron-to-Node synthetic only');
    assert.equal(stderr.includes('synthetic-refresh-not-reusable'),false);
  }
);
