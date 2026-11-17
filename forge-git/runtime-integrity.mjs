// Runtime-source integrity for the single Forge Git package, not a publisher
// signature. The manifest is built from the canonical dependency closure and
// checked before any provider or Core module is imported in packaged mode.
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync} from 'node:fs';
import path from 'node:path';

export const FORGE_GIT_RUNTIME_SCHEMA='ordax.forge-git.runtime-source/1';
const SHA=/^[a-f0-9]{64}$/;
const REQUIRED=Object.freeze([
  'forge-git/bootstrap.mjs',
  'forge-git/main.mjs',
  'forge-git/runtime-integrity.mjs',
  'forge-git/preload.cjs',
  'forge-git/renderer.mjs',
  'forge-git/index.html',
  'forge/product/desktop/worker-preload.bundle.cjs'
]);

function safeRelative(relative){
  return typeof relative==='string'&&relative.length>0&&relative.length<=300&&
    /^(?:forge-git|forge\/product)\/[A-Za-z0-9._/-]+$/.test(relative)&&
    relative.split('/').every(part=>part&&part!=='.'&&part!=='..');
}
function sha256(data){return createHash('sha256').update(data).digest('hex');}
function fileHash(root,relative){
  if(!safeRelative(relative))throw Error('forge_git_manifest_unsafe_path');
  const file=path.join(root,...relative.split('/'));
  const stats=lstatSync(file);
  if(!stats.isFile()||stats.isSymbolicLink()||stats.size>64*1024*1024)
    throw Error('forge_git_manifest_unsafe_file');
  return sha256(readFileSync(file));
}
export function makeForgeGitRuntimeManifest(root,files){
  if(typeof root!=='string'||!path.isAbsolute(root)||
     !Array.isArray(files)||files.length<REQUIRED.length||files.length>1024)
    throw Error('forge_git_manifest_invalid_input');
  const ordered=[...files].sort();
  if(ordered.some((name,i)=>!safeRelative(name)||(i>0&&name===ordered[i-1]))||
     REQUIRED.some(name=>!ordered.includes(name)))
    throw Error('forge_git_manifest_invalid_input');
  return {schema:FORGE_GIT_RUNTIME_SCHEMA,
    files:ordered.map(relative=>({path:relative,sha256:fileHash(root,relative)}))};
}
export function verifyForgeGitRuntimeManifest(root,{
  manifestPath=path.join(root,'forge-git','runtime-source.json')
}={}){
  if(typeof root!=='string'||!path.isAbsolute(root)||
     typeof manifestPath!=='string'||!path.isAbsolute(manifestPath))
    return {status:'invalid',verified:false,reason:'manifest_path_invalid'};
  if(!existsSync(manifestPath))
    return {status:'unattested',verified:false,reason:'manifest_missing'};
  try{
    const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
    if(manifest?.schema!==FORGE_GIT_RUNTIME_SCHEMA||
       !Array.isArray(manifest.files)||manifest.files.length<REQUIRED.length||
       manifest.files.length>1024)
      throw Error('manifest_invalid');
    const names=manifest.files.map(row=>row?.path);
    if(names.some((name,i)=>!safeRelative(name)||(i>0&&name<=names[i-1]))||
       REQUIRED.some(name=>!names.includes(name))||
       manifest.files.some(row=>!SHA.test(row?.sha256)))
      throw Error('manifest_invalid');
    for(const row of manifest.files){
      let digest;
      try{digest=fileHash(root,row.path);}
      catch{throw Error('content_mismatch');}
      if(digest!==row.sha256)throw Error('content_mismatch');
    }
    return {status:'verified',verified:true,fileCount:manifest.files.length};
  }catch(error){
    return {status:'invalid',verified:false,
      reason:error?.message==='content_mismatch'?'content_mismatch':'manifest_invalid'};
  }
}
