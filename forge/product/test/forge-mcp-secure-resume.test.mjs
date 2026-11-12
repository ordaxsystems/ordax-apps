import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {ForgeMcpOwnerTrust} from '../src/forge-mcp-owner-trust.mjs';
import {ForgeMcpSecureResume} from '../src/forge-mcp-secure-resume.mjs';

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-secure-resume-'));
  const db=path.join(dir,'forge.sqlite');
  let store=new Store(db);
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true,maxRetries:3});});
  const context={actorId:'owner',clientId:'desktop',workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,authorize:({context:who})=>who===context});
  const scope=new Map();
  const signature=id=>scope.get(id)||null;
  const storage={
    isEncryptionAvailable:()=>true,
    encryptString:token=>Buffer.concat([Buffer.from('dpapi-fixture:'),Buffer.from(token.split('').reverse().join(''))]),
    decryptString:bytes=>bytes.subarray('dpapi-fixture:'.length).toString().split('').reverse().join('')
  };
  let trust=new ForgeMcpOwnerTrust({store,scopeSignature:signature,appIdentity:'Forge DEV app profile'});
  let resume=new ForgeMcpSecureResume({store,ownerTrust:trust,secureStorage:storage,platform:'win32'});
  const project=async name=>{
    const id=(await service.invoke(context,'project_quick_create',
      {creationNonce:name,requestId:'secure-resume-'+name})).result.projectId;
    scope.set(id,'verified-owner-workspace-'+name);
    return id;
  };
  const reopen=()=>{
    store.close();store=new Store(db);
    trust=new ForgeMcpOwnerTrust({store,scopeSignature:signature,appIdentity:'Forge DEV app profile'});
    resume=new ForgeMcpSecureResume({store,ownerTrust:trust,secureStorage:storage,platform:'win32'});
    return {trust,resume};
  };
  return {project,scope,storage,reopen,trust:()=>trust,resume:()=>resume,store:()=>store};
}

test('MCP reconnect is explicit, Windows-sealed, durable, scope bound and revocable',async t=>{
  const f=fixture(t),a=await f.project('alpha'),b=await f.project('beta');
  const tokenA=randomBytes(32).toString('base64url');
  const tokenB=randomBytes(32).toString('base64url');
  assert.deepEqual(f.resume().recover(),[]);
  assert.throws(()=>f.resume().enable({projectId:a,token:tokenA,port:46000}),
    /owner_trust_required/);
  f.trust().trust(a);f.trust().trust(b);
  assert.equal(f.resume().enable({projectId:a,token:tokenA,port:46000}).secretEncrypted,true);
  assert.equal(f.resume().enable({projectId:b,token:tokenB,port:46000}).autoResume,true);
  assert.deepEqual(f.resume().enabledProjects(),[a,b].sort());
  const row=f.store().db.prepare('SELECT sealed_bearer FROM forge_mcp_secure_resume WHERE project_id=?').get(a);
  assert.equal(row.sealed_bearer instanceof Uint8Array,true);
  assert.equal(Buffer.from(row.sealed_bearer).includes(Buffer.from(tokenA)),false);
  let credentials=f.resume().recover();
  assert.deepEqual(credentials.map(item=>item.projectId),[a,b].sort());
  assert.equal(credentials.find(x=>x.projectId===a)?.token,tokenA);
  assert.equal(credentials.find(x=>x.projectId===b)?.port,46000);
  ({resume:credentials}=f.reopen());
  credentials=credentials.recover();
  assert.equal(credentials.length,2,'restart preserves encrypted, explicitly opted-in credentials');
  assert.equal(credentials.find(x=>x.projectId===a).token,tokenA);
  f.scope.set(a,'different-verified-folder');
  assert.deepEqual(f.resume().enabledProjects(),[b]);
  assert.deepEqual(f.resume().recover().map(x=>x.projectId),[b]);
  f.trust().trust(a);
  assert.equal(f.resume().enabledProjects().includes(a),false,'new scope requires new connect approval');
  assert.throws(()=>f.resume().enable({projectId:a,token:tokenA,port:46001}),
    /port_mismatch/);
  assert.equal(f.resume().disable(a).removed,true);
  assert.equal(f.trust().revoke(b).trustRevoked,true);
  assert.deepEqual(f.resume().recover(),[],'revocation cascades and disables auto connect');
});
test('Windows encryption failure and corrupt ciphertext fail closed without exposing secrets',async t=>{
  const f=fixture(t),a=await f.project('failclosed');
  f.trust().trust(a);
  const token=randomBytes(32).toString('base64url');
  f.resume().enable({projectId:a,token,port:46020});
  f.store().db.prepare('UPDATE forge_mcp_secure_resume SET sealed_bearer=? WHERE project_id=?')
    .run(Buffer.from('corrupt'),a);
  assert.deepEqual(f.resume().recover(),[],'invalid protected credential blocks startup');
  f.storage.isEncryptionAvailable=()=>false;
  assert.deepEqual(f.resume().recover(),[]);
  assert.throws(()=>f.resume().enable({projectId:a,token,port:46020}),/protection_unavailable/);
});

test('one app MCP token is Windows-sealed across restart without per-project grants',async t=>{
  const f=fixture(t),token=randomBytes(32).toString('base64url');
  assert.equal(f.resume().enabledApp(),false);
  assert.equal(f.resume().recoverApp(),null);
  assert.throws(()=>f.resume().enableApp({projectId:'forge_app',token,port:47041}),
    /app_trust_required/);
  f.trust().trustApp();
  const saved=f.resume().enableApp({projectId:'forge_app',token,port:47041});
  assert.equal(saved.autoResume,true);
  assert.equal(saved.secretEncrypted,true);
  assert.equal(f.resume().enabledApp(),true);
  const blob=f.store().db.prepare('SELECT sealed_bearer FROM forge_mcp_app_secure_resume').get();
  assert.equal(blob.sealed_bearer instanceof Uint8Array,true);
  assert.equal(Buffer.from(blob.sealed_bearer).includes(Buffer.from(token)),false);
  assert.deepEqual(f.resume().recoverApp(),{projectId:'forge_app',token,port:47041});
  f.reopen();
  assert.deepEqual(f.resume().recoverApp(),{projectId:'forge_app',token,port:47041});
  // Another app profile and revoked owner consent must each fail closed.
  f.trust().appIdentity='Other Forge profile';
  assert.equal(f.resume().enabledApp(),false);
  assert.equal(f.resume().recoverApp(),null);
  f.trust().appIdentity='Forge DEV app profile';
  assert.equal(f.resume().enabledApp(),true);
  f.store().db.prepare('UPDATE forge_mcp_app_secure_resume SET sealed_bearer=?')
    .run(Buffer.from('bad'));
  assert.equal(f.resume().recoverApp(),null);
  assert.equal(f.resume().disableApp().removed,1);
  f.resume().enableApp({projectId:'forge_app',token,port:47041});
  f.trust().revokeApp();
  assert.equal(f.resume().recoverApp(),null);
  assert.equal(f.resume().enabledApp(),false);
  assert.equal(f.store().db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
