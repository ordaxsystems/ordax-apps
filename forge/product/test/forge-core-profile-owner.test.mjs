import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {acquireHostProfileLock} from '../src/forge-core-profile-lock.mjs';
import {acquireHostProfileLock as hostLock} from '../host/host-profile-lock.mjs';

async function temporaryProfile(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ordax-forge-core-owner-'));
  t.after(async()=>{await fs.rm(root,{recursive:true,force:true})});
  return root;
}
function spawnOwner(profile) {
  const moduleUrl=new URL('../src/forge-core-profile-lock.mjs',import.meta.url).href;
  const code=`import {acquireHostProfileLock} from ${JSON.stringify(moduleUrl)};
    const release=await acquireHostProfileLock(process.argv[1]);
    process.stdout.write('OWNER_READY\\n');
    process.stdin.resume();
    process.stdin.once('end',async()=>{await release();process.exit(0)});
  `;
  return spawn(process.execPath,['--input-type=module','-e',code,profile],{
    stdio:['pipe','pipe','pipe'],windowsHide:true
  });
}
async function awaitReady(child) {
  let data='';
  for await(const chunk of child.stdout){
    data+=chunk.toString('utf8');
    if(data.includes('OWNER_READY'))return;
  }
  throw Error('forge_core_child_failed_before_ready');
}

test('the Node Host and packaged Electron import the same canonical owner gate',()=>{
  assert.equal(hostLock,acquireHostProfileLock);
  const desktopSource=fileURLToPath(new URL('../desktop/main.mjs',import.meta.url));
  return fs.readFile(desktopSource,'utf8').then(source=>{
    assert.match(source,/acquireHostProfileLock\(dataRoot\)/);
    assert.match(source,/const store = new Store\(path.join\(dataRoot, 'ordax-forge.sqlite'\)\)/);
    assert.ok(source.indexOf('await acquireHostProfileLock(dataRoot)')<
      source.indexOf('const store = new Store('),'lock must precede SQLite');
    assert.ok(source.indexOf('store.close();')<
      source.lastIndexOf('await releaseForgeProfileLock()'),'Core must close before unlocking');
  });
});

test('same profile cannot be acquired twice and owner releases idempotently',async t=>{
  const root=await temporaryProfile(t);
  const release=await acquireHostProfileLock(root);
  await assert.rejects(acquireHostProfileLock(root),/host_profile_already_running/);
  await release();
  await release();
  const next=await acquireHostProfileLock(root);
  await next();
});

test('a separate Node process cannot claim a live owner SQLite profile',async t=>{
  const root=await temporaryProfile(t);
  const child=spawnOwner(root);
  t.after(()=>{if(!child.killed)child.kill()});
  await awaitReady(child);
  await assert.rejects(acquireHostProfileLock(root),/host_profile_already_running/);
  child.stdin.end();
  const [code]=await once(child,'exit');
  assert.equal(code,0);
  const release=await acquireHostProfileLock(root);
  await release();
});

test('crashed child owner permits verified dead-PID recovery',async t=>{
  const root=await temporaryProfile(t);
  const child=spawnOwner(root);
  t.after(()=>{if(!child.killed)child.kill()});
  await awaitReady(child);
  child.kill();
  await once(child,'exit');
  const release=await acquireHostProfileLock(root);
  await release();
});

test('malformed lock stays fail-closed and never silently overwrites ownership',async t=>{
  const root=await temporaryProfile(t);
  const file=path.join(root,'host-process.lock');
  await fs.writeFile(file,'{"pid":"unknown","token":"invalid"}','utf8');
  await assert.rejects(acquireHostProfileLock(root),/host_profile_lock_unverifiable/);
  assert.equal(await fs.readFile(file,'utf8'),'{"pid":"unknown","token":"invalid"}');
});

test('different profiles remain independently usable without a global singleton',async t=>{
  const a=await temporaryProfile(t),b=await temporaryProfile(t);
  const releaseA=await acquireHostProfileLock(a);
  const releaseB=await acquireHostProfileLock(b);
  await releaseB();
  await releaseA();
});
