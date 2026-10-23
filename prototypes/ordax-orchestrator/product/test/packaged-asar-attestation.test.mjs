import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {finished} from 'node:stream/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {verifyRuntimeManifest} from '../src/runtime-build-identity.mjs';

const require=createRequire(import.meta.url);
const asar=require('@electron/asar');
const {attestPackagedAsar,sourceCommitFromGit}=require('../scripts/attest-packaged-asar.cjs');
const commit='1234567890abcdef1234567890abcdef12345678';

function fixture(t,entry='desktop/bootstrap.mjs') {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-packaged-attest-'));
  t.after(()=>fs.rmSync(root,{force:true,recursive:true}));
  const source=path.join(root,'source');
  for(const dir of ['desktop','src','supervisor'])
    fs.mkdirSync(path.join(source,dir),{recursive:true});
  fs.writeFileSync(path.join(source,'package.json'),
    JSON.stringify({name:'ordax-orchestrator-lab',version:'0.2.0-alpha.2',main:entry}));
  fs.writeFileSync(path.join(source,'desktop','bootstrap.mjs'),'await import("./main.mjs");\n');
  fs.writeFileSync(path.join(source,'desktop','main.mjs'),'export const main=true;\n');
  fs.writeFileSync(path.join(source,'src','runtime-build-identity.mjs'),'export {};\n');
  fs.writeFileSync(path.join(source,'supervisor','coordinator.mjs'),'export {};\n');
  return {root,source,archive:path.join(root,'app.asar')};
}
test('packaging source identity is captured only from a clean checkout',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-clean-source-'));
  t.after(()=>fs.rmSync(root,{force:true,recursive:true}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{stdio:'ignore'});
  git('init');
  git('config','user.name','OrdaX test');
  git('config','user.email','ordax-test@example.invalid');
  fs.writeFileSync(path.join(root,'source.txt'),'canonical source\n');
  git('add','source.txt');
  git('commit','-m','test source');
  const commit=sourceCommitFromGit(root);
  assert.match(commit,/^[a-f0-9]{40}$/);
  fs.writeFileSync(path.join(root,'unexpected-output.txt'),'untracked');
  assert.throws(()=>sourceCommitFromGit(root),/packaged_build_source_dirty/);
});
// @electron/asar v3.4.1 returns the WritableStream before its 'finish' event.
// A complete header may already exist while file bodies are still unwritten.
// Never hand a partial test archive to the integrity attestor.
async function createCompleteFixtureArchive(f) {
  const output=await asar.createPackage(f.source,f.archive);
  await finished(output);
}
test('afterPack seals actual ASAR bytes and produces a self-consistent runtime identity',async t=>{
  const f=fixture(t);
  await createCompleteFixtureArchive(f);
  const beforeSha=createHash('sha256').update(fs.readFileSync(f.archive)).digest('hex');
  const proof=await attestPackagedAsar({archive:f.archive,sourceCommit:commit});
  const afterSha=createHash('sha256').update(fs.readFileSync(f.archive)).digest('hex');
  assert.equal(afterSha,beforeSha,'Electron ASAR must never be rewritten');
  assert.equal(proof.status,'verified');
  assert.equal(proof.sourceCommit,commit);
  assert.match(proof.asarSha256,/^[a-f0-9]{64}$/);
  assert.equal(proof.profileCopied,false);
  assert.equal(proof.providerMessagesSent,0);
  const extracted=path.join(f.root,'verified');
  // Emulate a new Electron process: avoid the in-process ASAR header cache
  // for the original archive path before it was replaced by the hook.
  const newlyOpened=path.join(f.root,'packaged-final-copy.asar');
  fs.copyFileSync(f.archive,newlyOpened,fs.constants.COPYFILE_EXCL);
  asar.extractAll(newlyOpened,extracted);
  const packagedManifest=path.join(f.root,'runtime-build.json');
  assert.equal(fs.existsSync(packagedManifest),true);
  const verified=verifyRuntimeManifest(extracted,{manifestPath:packagedManifest});
  assert.equal(verified.verified,true);
  assert.equal(verified.contentDigest,proof.contentDigest);
  assert.equal(verified.fileCount,proof.fileCount);
  assert.equal(fs.existsSync(f.archive+'.ordax-pre-attestation'),false);
  fs.appendFileSync(path.join(extracted,'desktop','main.mjs'),'// tamper\n');
  assert.equal(verifyRuntimeManifest(extracted,{manifestPath:packagedManifest}).verified,false);
});
test('packager rejects an archive with a non-bootstrap entrypoint',async t=>{
  const f=fixture(t,'desktop/main.mjs');
  await createCompleteFixtureArchive(f);
  await assert.rejects(
    attestPackagedAsar({archive:f.archive,sourceCommit:commit}),
    /packaged_entrypoint_not_bootstrap/);
  assert.ok(fs.existsSync(f.archive));
  assert.equal(fs.existsSync(f.archive+'.ordax-pre-attestation'),false);
});
