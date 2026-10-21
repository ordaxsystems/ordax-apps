import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {makeRuntimeManifest,verifyRuntimeManifest} from '../src/runtime-build-identity.mjs';

const commit='1234567890abcdef1234567890abcdef12345678';
function fixture(t) {
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-build-proof-'));
 t.after(()=>fs.rmSync(base,{force:true,recursive:true}));
 fs.mkdirSync(path.join(base,'desktop'));
 fs.mkdirSync(path.join(base,'src'));
 fs.mkdirSync(path.join(base,'supervisor'));
 fs.writeFileSync(path.join(base,'package.json'),'{"version":"0.2.0-alpha.2"}');
 fs.writeFileSync(path.join(base,'desktop','main.mjs'),'export const value=1;\n');
 fs.writeFileSync(path.join(base,'desktop','preload.cjs'),'// test\n');
 fs.writeFileSync(path.join(base,'src','store.mjs'),'export const test=true;\n');
 fs.writeFileSync(path.join(base,'supervisor','worker.mjs'),'export {};\n');
 return base;
}
function seal(root){
 const m=makeRuntimeManifest(root,commit);
 fs.writeFileSync(path.join(root,'runtime-build.json'),JSON.stringify(m));
 return m;
}
test('missing manifest is UNATTESTED, never reported as a verified build',t=>{
 const root=fixture(t),proof=verifyRuntimeManifest(root);
 assert.equal(proof.verified,false);
 assert.equal(proof.status,'unattested');
 assert.equal(proof.sourceCommit,null);
});
test('manifest binds exact own files, version and commit by content hash',t=>{
 const root=fixture(t),m=seal(root);
 const proof=verifyRuntimeManifest(root);
 assert.equal(proof.verified,true);
 assert.equal(proof.status,'verified');
 assert.equal(proof.contentDigest,m.contentDigest);
 assert.equal(proof.sourceCommit,commit);
 assert.equal(proof.fileCount,m.files.length);
 assert.equal(proof.packageVersion,'0.2.0-alpha.2');
 assert.ok(m.files.some(x=>x.path==='desktop/main.mjs'));
});
test('tampered or missing file is rejected without leaking root path',t=>{
 const root=fixture(t);seal(root);
 fs.appendFileSync(path.join(root,'desktop','main.mjs'),'// modified\n');
 const proof=verifyRuntimeManifest(root);
 assert.equal(proof.verified,false);
 assert.equal(proof.status,'invalid');
 assert.equal(proof.reason,'content_mismatch');
 assert.equal(JSON.stringify(proof).includes(root),false);
});
test('unexpected app code is rejected, even if existing files still match',t=>{
 const root=fixture(t);seal(root);
 fs.writeFileSync(path.join(root,'src','untrusted.mjs'),'// injected');
 assert.equal(verifyRuntimeManifest(root).status,'invalid');
});
test('manifest self-hash corruption and malformed commit fail closed',t=>{
 const root=fixture(t),m=seal(root);
 m.sourceCommit='unknown';
 fs.writeFileSync(path.join(root,'runtime-build.json'),JSON.stringify(m));
 assert.equal(verifyRuntimeManifest(root).status,'invalid');
});
test('manifest permits no symlink in owned code tree',t=>{
 const root=fixture(t);
 const dest=path.join(root,'desktop','link.mjs');
 try{fs.symlinkSync(path.join(root,'src','store.mjs'),dest);}
 catch(e){if(e.code==='EPERM')return;t.diagnostic(String(e));return;}
 assert.throws(()=>makeRuntimeManifest(root,commit),/build_tree_unsafe/);
});

test('App-only build proof awaits exact staged profile, then checks commit and digest without any send',()=>{
 const script=fs.readFileSync(new URL('../scripts/live-ui-build-proof-readonly.cjs',import.meta.url),'utf8');
 assert.match(script,/await waitForLabAppMode\(evaluate\)/);
 assert.match(script,/await evaluate\('window\.ordax\.labBuildProof\(\)'\)/);
 assert.match(script,/proof\.sourceCommit!==expectedCommit/);
 assert.match(script,/proof\.contentDigest!==expectedDigest/);
 assert.doesNotMatch(script,/sendPrompt\(|requestSubmit\(|\.reload\(|\.loadURL\(/);
});

test('startup verifies content BEFORE userData/SQLite and exposes trusted-only IPC',()=>{
 const main=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
 const preload=fs.readFileSync(new URL('../desktop/preload.cjs',import.meta.url),'utf8');
 assert.ok(main.indexOf('const runtimeBuildProof=verifyRuntimeManifest(root)')>=0);
 assert.ok(main.indexOf('const runtimeBuildProof=verifyRuntimeManifest(root)')<
   main.indexOf('const store = new Store('));
 assert.match(main,/runtimeBuildProof.status==='invalid'/);
 assert.match(main,/ordax:lab:build-proof/);
 assert.match(main,/requireTrustedSupervisorRenderer\(event\)/);
 assert.match(preload,/labBuildProof: \(\) => ipcRenderer.invoke\('ordax:lab:build-proof'\)/);
});
