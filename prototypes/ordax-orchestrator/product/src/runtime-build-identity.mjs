// Local content attestation for an isolated Lab code candidate.
// SHA-256 detects drift, but does NOT constitute a trusted publisher signature.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const BUILD_SCHEMA='ordax.lab.runtime-build.v1';
export const OWNED_ROOTS=['desktop','src','supervisor'];
function hash(data){return createHash('sha256').update(data).digest('hex');}
function invariant(condition,code){if(!condition)throw Error(code);}
function safeName(name){return typeof name==='string' && /^[a-zA-Z0-9._-]+$/.test(name) && name!=='.' && name!=='..';}
export function listOwnedFiles(root){
 invariant(path.isAbsolute(root),'build_root_not_absolute');
 const files=['package.json'];
 for(const dir of OWNED_ROOTS){
  const base=path.join(root,dir);
  invariant(fs.existsSync(base)&&fs.lstatSync(base).isDirectory(),'build_tree_missing');
  function visit(folder,rel){
   for(const ent of fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
    invariant(safeName(ent.name)&&!ent.isSymbolicLink(),'build_tree_unsafe');
    const sub=rel+'/'+ent.name;
    if(ent.isDirectory())visit(path.join(folder,ent.name),sub);
    else {
      invariant(ent.isFile(),'build_tree_unsafe');
      files.push(sub);
    }
   }
  }
  visit(base,dir);
 }
 const result=files.sort().map(rel=>{
  const file=path.join(root,...rel.split('/'));
  const st=fs.lstatSync(file);
  invariant(st.isFile()&&!st.isSymbolicLink(),'build_tree_unsafe');
  invariant(st.size<=64*1024*1024,'build_file_too_large');
  return {path:rel,bytes:st.size,sha256:hash(fs.readFileSync(file))};
 });
 return result;
}
function canonical(manifest) {
 return JSON.stringify({schema:BUILD_SCHEMA,
  sourceCommit:manifest.sourceCommit,packageVersion:manifest.packageVersion,
  files:manifest.files});
}
export function makeRuntimeManifest(root,sourceCommit) {
 invariant(/^[0-9a-f]{40}$/.test(sourceCommit||''),'build_commit_invalid');
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 const manifest={schema:BUILD_SCHEMA,sourceCommit,packageVersion:pkg.version,
  files:listOwnedFiles(root)};
 manifest.contentDigest=hash(canonical(manifest));
 return manifest;
}
export function verifyRuntimeManifest(root){
 const file=path.join(root,'runtime-build.json');
 if(!fs.existsSync(file))return {schema:BUILD_SCHEMA,status:'unattested',
  verified:false,reason:'manifest_missing',sourceCommit:null,contentDigest:null};
 try{
  const m=JSON.parse(fs.readFileSync(file,'utf8'));
  invariant(m?.schema===BUILD_SCHEMA&&/^[0-9a-f]{40}$/.test(m.sourceCommit||''),
   'manifest_invalid');
  invariant(Array.isArray(m.files)&&m.files.length>0&&m.files.length<2000,
   'manifest_invalid');
  const rebuilt=makeRuntimeManifest(root,m.sourceCommit);
  invariant(m.packageVersion===rebuilt.packageVersion&&
    JSON.stringify(m.files)===JSON.stringify(rebuilt.files)&&
    m.contentDigest===rebuilt.contentDigest,'content_mismatch');
  return {schema:BUILD_SCHEMA,status:'verified',verified:true,
    sourceCommit:m.sourceCommit,contentDigest:m.contentDigest,
    packageVersion:m.packageVersion,fileCount:m.files.length};
 }catch(error){
  const allowed=new Set(['manifest_invalid','content_mismatch','build_tree_missing',
    'build_tree_unsafe','build_file_too_large']);
  return {schema:BUILD_SCHEMA,status:'invalid',verified:false,
    reason:allowed.has(error?.message)?error.message:'manifest_validation_failed',
    sourceCommit:null,contentDigest:null};
 }
}
