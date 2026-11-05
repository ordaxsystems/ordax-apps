import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {HTML_ARTIFACT_LIMIT_BYTES,validateHtmlArtifactName,
  verifyLocalHtmlArtifact,readVerifiedLocalHtmlArtifact,
  assertLocalArtifactPath} from '../src/provider-html-artifact.mjs';

test('verified HTML delivery requires real bytes, simple HTML structure and SHA-256',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-html-proof-'));
  t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
  const file=path.join(dir,'index.html');
  const html='<!DOCTYPE html><html lang="pt-BR"><head><title>Estação Café</title></head><body><h1>Estação Café</h1></body></html>';
  fs.writeFileSync(file,html);
  const result=verifyLocalHtmlArtifact(file);
  assert.equal(result.filename,'index.html');
  assert.equal(result.bytes,Buffer.byteLength(html));
  assert.match(result.sha256,/^[a-f0-9]{64}$/);
  assert.equal(result.verification,'local_bytes_and_structure');
  assert.equal(assertLocalArtifactPath(dir,file),path.resolve(file));
  assert.throws(()=>assertLocalArtifactPath(dir,path.join(dir,'..','another','index.html')),
    /provider_html_path_outside_store/);
});
test('preview HTML bytes match the exact SHA-256 verification read',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-html-single-read-'));
  t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
  const file=path.join(dir,'index.html');
  const original='<!doctype html><html><body><h1>Original</h1></body></html>';
  fs.writeFileSync(file,original);
  const initial=readVerifiedLocalHtmlArtifact(file);
  assert.equal(initial.html,original);
  assert.equal(initial.bytes,Buffer.byteLength(original));
  assert.equal(initial.sha256,verifyLocalHtmlArtifact(file).sha256);
  assert.equal(verifyLocalHtmlArtifact(file).html,undefined);
  const changed='<!doctype html><html><body><h1>Changed!</h1></body></html>';
  fs.writeFileSync(file,changed);
  assert.equal(initial.html,original);
  const updated=readVerifiedLocalHtmlArtifact(file);
  assert.equal(updated.html,changed);
  assert.notEqual(updated.sha256,initial.sha256);
  fs.writeFileSync(file,'not HTML');
  assert.throws(()=>readVerifiedLocalHtmlArtifact(file),/provider_html_file_invalid|provider_html_structure_unverified/);
});

test('reject download filename spoofing, scripts masquerading as HTML and oversized files',t=>{
  for(const name of ['../index.html','folder\\index.html','.html','index.html.exe',
    'index..html','index.html/','C:\\Windows\\index.html'])
    assert.throws(()=>validateHtmlArtifactName(name),/provider_html_filename_invalid/);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-html-reject-'));
  t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
  const file=path.join(dir,'index.html');
  fs.writeFileSync(file,'O GPT disse que criou o arquivo index.html; baixe aqui.');
  assert.throws(()=>verifyLocalHtmlArtifact(file),/provider_html_structure_unverified/);
  fs.writeFileSync(file,'<script>alert("x")</script>');
  assert.throws(()=>verifyLocalHtmlArtifact(file),/provider_html_file_invalid|provider_html_structure_unverified/);
  fs.writeFileSync(file,Buffer.alloc(HTML_ARTIFACT_LIMIT_BYTES+1,65));
  assert.throws(()=>verifyLocalHtmlArtifact(file),/provider_html_file_invalid/);
  const target=path.join(dir,'real.html');
  fs.writeFileSync(target,'<!DOCTYPE html><html><body>Texto de teste</body></html>');
  fs.unlinkSync(file);
  try {
    fs.symlinkSync(target,file);
    assert.throws(()=>verifyLocalHtmlArtifact(file),/provider_html_file_invalid/);
  }catch(error){
    // Standard Windows users may lack the privilege to create symlinks.
    // The production lstat guard remains enforced on supported platforms.
    if(error.code!=='EPERM')throw error;
  }
});
