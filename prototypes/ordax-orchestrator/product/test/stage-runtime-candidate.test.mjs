import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyRuntimeManifest} from '../src/runtime-build-identity.mjs';
const sourceScript=fileURLToPath(new URL('../scripts/stage-runtime-candidate.cjs',import.meta.url));
const identitySource=fileURLToPath(new URL('../src/runtime-build-identity.mjs',import.meta.url));
function git(cwd,...args){
 const r=spawnSync('git',args,{cwd,encoding:'utf8',timeout:20000});
 assert.equal(r.status,0,r.stderr);
 return r.stdout.trim();
}
function prepare(t){
 const repo=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-runtime-fixture-'));
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-runtime-output-'));
 t.after(()=>{fs.rmSync(repo,{recursive:true,force:true});fs.rmSync(out,{recursive:true,force:true});});
 const product=path.join(repo,'product');
 for(const sub of ['desktop','src','supervisor','scripts'])fs.mkdirSync(path.join(product,sub),{recursive:true});
 fs.writeFileSync(path.join(product,'package.json'),'{"version":"0.2.0-alpha.2","type":"module"}');
 fs.writeFileSync(path.join(product,'desktop','main.mjs'),'export const boot = true;\n');
 fs.writeFileSync(path.join(product,'desktop','ui.html'),'<title>test</title>');
 fs.writeFileSync(path.join(product,'supervisor','index.mjs'),'export {};\n');
 fs.copyFileSync(identitySource,path.join(product,'src','runtime-build-identity.mjs'));
 fs.copyFileSync(sourceScript,path.join(product,'scripts','stage-runtime-candidate.cjs'));
 git(repo,'init','-q');
 git(repo,'add','.');
 git(repo,'-c','user.name=OrdaX Test','-c','user.email=test@example.invalid','commit','-qm','fixture');
 return {repo,product,out,target:path.join(out,'candidate-app-v0.2.0-alpha.2')};
}
function stage(product,target){
 return spawnSync(process.execPath,[path.join(product,'scripts','stage-runtime-candidate.cjs'),target],{
  encoding:'utf8',timeout:25000
 });
}
test('Git-clean candidate uses a NEW directory, attests the commit and never copies profiles',t=>{
 const f=prepare(t);
 const run=stage(f.product,f.target);
 assert.equal(run.status,0,run.stderr);
 const receipt=JSON.parse(run.stdout.trim());
 assert.equal(receipt.status,'verified');
 assert.equal(receipt.sourceCommit,git(f.repo,'rev-parse','HEAD'));
 assert.equal(receipt.profileCopied,false);
 assert.equal(receipt.cutoverPerformed,false);
 assert.equal(receipt.providerMessagesSent,0);
 const proof=verifyRuntimeManifest(f.target);
 assert.equal(proof.verified,true);
 assert.equal(proof.contentDigest,receipt.contentDigest);
 assert.equal(fs.existsSync(path.join(f.target,'scripts')),false);
 assert.equal(fs.existsSync(path.join(f.target,'node_modules')),false);
 assert.equal(stage(f.product,f.target).status,2);
});
test('candidate refuses dirty checkout rather than falsely attributing working files to HEAD',t=>{
 const f=prepare(t);
 fs.appendFileSync(path.join(f.product,'desktop','main.mjs'),'// dirty\n');
 const run=stage(f.product,f.target);
 assert.equal(run.status,2);
 assert.match(run.stderr,/candidate_source_not_clean/);
 assert.equal(fs.existsSync(f.target),false);
});
test('candidate detects unexpected modified code after sealing',t=>{
 const f=prepare(t);
 assert.equal(stage(f.product,f.target).status,0);
 fs.appendFileSync(path.join(f.target,'desktop','main.mjs'),'// tampered\n');
 const result=verifyRuntimeManifest(f.target);
 assert.equal(result.verified,false);
 assert.equal(result.status,'invalid');
});
