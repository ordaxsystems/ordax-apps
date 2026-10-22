import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
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
test('externally stored packaged manifest verifies exact extracted code',t=>{
 const root=fixture(t);
 const manifest=makeRuntimeManifest(root,commit);
 const outside=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-external-proof-'));
 t.after(()=>fs.rmSync(outside,{force:true,recursive:true}));
 const manifestPath=path.join(outside,'runtime-build.json');
 fs.writeFileSync(manifestPath,JSON.stringify(manifest));
 const proof=verifyRuntimeManifest(root,{manifestPath});
 assert.equal(proof.status,'verified');
 assert.equal(proof.contentDigest,manifest.contentDigest);
 fs.appendFileSync(path.join(root,'desktop','main.mjs'),'// altered\n');
 assert.equal(verifyRuntimeManifest(root,{manifestPath}).status,'invalid');
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

test('Electron bootstrap attests code before any application module is evaluated',t=>{
 const root=fixture(t);
 fs.copyFileSync(new URL('../desktop/bootstrap.mjs',import.meta.url),path.join(root,'desktop','bootstrap.mjs'));
 fs.copyFileSync(new URL('../src/runtime-build-identity.mjs',import.meta.url),
   path.join(root,'src','runtime-build-identity.mjs'));
 // This main module has an observable side effect; unverified code must never run.
 fs.writeFileSync(path.join(root,'desktop','main.mjs'),
   "import fs from 'node:fs'; fs.writeFileSync(process.env.ORDAX_TEST_MAIN_MARKER,'loaded');\n");
 const marker=path.join(os.tmpdir(),'ordax-bootstrap-test-'+process.pid+'-'+Date.now());
 t.after(()=>fs.rmSync(marker,{force:true}));
 const run=()=>spawnSync(process.execPath,[path.join(root,'desktop','bootstrap.mjs')],{
   encoding:'utf8',timeout:10000,env:{...process.env,ORDAX_TEST_MAIN_MARKER:marker}
 });
 const manifest=seal(root);
 assert.ok(manifest.files.some(file=>file.path==='desktop/bootstrap.mjs'));
 assert.equal(run().status,0);
 assert.equal(fs.readFileSync(marker,'utf8'),'loaded');
 fs.rmSync(marker);
 fs.appendFileSync(path.join(root,'desktop','main.mjs'),'// tampered\n');
 const blocked=run();
 assert.notEqual(blocked.status,0);
 assert.match(blocked.stderr,/lab_runtime_build_integrity_failed/);
 assert.equal(fs.existsSync(marker),false);
});

test('App-only build proof awaits exact staged profile, then checks commit and digest without any send',()=>{
 const script=fs.readFileSync(new URL('../scripts/live-ui-build-proof-readonly.cjs',import.meta.url),'utf8');
 assert.match(script,/await waitForLabAppMode\(evaluate\)/);
 assert.match(script,/await evaluate\('window\.ordax\.labBuildProof\(\)'\)/);
 assert.match(script,/proof\.sourceCommit!==expectedCommit/);
 assert.match(script,/proof\.contentDigest!==expectedDigest/);
 assert.doesNotMatch(script,/sendPrompt\(|requestSubmit\(|\.reload\(|\.loadURL\(/);
});

test('bootstrap gates module loading and main verifies again before userData/SQLite',()=>{
 const bootstrap=fs.readFileSync(new URL('../desktop/bootstrap.mjs',import.meta.url),'utf8');
 const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(pkg.main,'desktop/bootstrap.mjs');
 assert.match(bootstrap,/verifyRuntimeManifest\(root,manifestOptions\)/);
 assert.ok(bootstrap.indexOf('verifyRuntimeManifest(root)')<bootstrap.indexOf("await import('./main.mjs')"));
 assert.doesNotMatch(bootstrap,/^import.*(?:main|store|supervisor)/m);
 const main=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
 const preload=fs.readFileSync(new URL('../desktop/preload.cjs',import.meta.url),'utf8');
 assert.ok(main.indexOf('const runtimeBuildProof=verifyRuntimeManifest(root,')>=0);
 assert.ok(main.indexOf('const runtimeBuildProof=verifyRuntimeManifest(root)')<
   main.indexOf('const store = new Store('));
 assert.match(main,/runtimeBuildProof.status==='invalid'/);
 assert.match(main,/ordax:lab:build-proof/);
 assert.match(main,/requireTrustedSupervisorRenderer\(event\)/);
 assert.match(preload,/labBuildProof: \(\) => ipcRenderer.invoke\('ordax:lab:build-proof'\)/);
});
