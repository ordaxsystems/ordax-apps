// One-time physical move of a former Forge-private workspace to its Owner
// workspace. No copy, backup, model-supplied paths or duplicate workspace.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const MAX_FILES=4000;
const MAX_BYTES=128*1024*1024;
const MAX_DEPTH=20;
const MAX_FILE_BYTES=16*1024*1024;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const samePath=(a,b)=>process.platform==='win32'
  ?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase()
  :path.resolve(a)===path.resolve(b);
const equalManifest=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

function manifest(root) {
  const files=[],directories=[];
  let bytes=0;
  const visit=(relative,depth)=>{
    if(depth>MAX_DEPTH)throw Error('forge_workspace_migration_tree_limit');
    const folder=path.join(root,relative);
    const physical=fs.realpathSync.native(folder);
    if(!samePath(physical,folder))
      throw Error('forge_workspace_migration_reparse_denied');
    directories.push(relative);
    const names=fs.readdirSync(folder).sort();
    for(const name of names){
      const destination=path.join(folder,name);
      const info=fs.lstatSync(destination);
      if(info.isSymbolicLink())throw Error('forge_workspace_migration_reparse_denied');
      const rel=path.join(relative,name);
      if(info.isDirectory())visit(rel,depth+1);
      else if(info.isFile()){
        if(info.size>MAX_FILE_BYTES)throw Error('forge_workspace_migration_file_limit');
        bytes+=info.size;
        if(bytes>MAX_BYTES||files.length>=MAX_FILES)
          throw Error('forge_workspace_migration_tree_limit');
        files.push({path:rel,bytes:info.size,sha256:sha(fs.readFileSync(destination))});
      }else throw Error('forge_workspace_migration_special_file_denied');
    }
  };
  visit('',0);
  return {files,directories,bytes};
}
export function inspectForgeLegacyWorkspace(root){
  if(typeof root!=='string'||!path.isAbsolute(root)||!fs.existsSync(root))
    throw Error('forge_workspace_migration_source_unavailable');
  const info=fs.lstatSync(root);
  if(!info.isDirectory()||info.isSymbolicLink()||
      !samePath(fs.realpathSync.native(root),root))
    throw Error('forge_workspace_migration_reparse_denied');
  return manifest(root);
}
export function moveForgeLegacyWorkspace({source,target,bind}={}){
  if(typeof bind!=='function'||typeof target!=='string'||!path.isAbsolute(target))
    throw Error('forge_workspace_migration_input_invalid');
  if(fs.existsSync(target))throw Error('forge_workspace_migration_destination_exists');
  const baseline=inspectForgeLegacyWorkspace(source);
  if(!baseline.files.length&&baseline.directories.length<=1)
    throw Error('forge_workspace_migration_empty_source');
  let moved=false;
  try {
    // Windows rename is atomic on the same device. Cross-volume returns
    // EXDEV and fails closed; we never create a second working copy.
    fs.renameSync(source,target);
    moved=true;
    if(!equalManifest(baseline,inspectForgeLegacyWorkspace(target)))
      throw Error('forge_workspace_migration_verification_failed');
    const binding=bind(target);
    return {...binding,migrated:true,filesMoved:baseline.files.length,
      bytesMoved:baseline.bytes,sourceRemoved:!fs.existsSync(source),
      transfer:'same_volume_atomic_rename_sha256_verified'};
  }catch(error){
    if(moved){
      try{fs.renameSync(target,source);}
      catch{
        const recovery=Error('forge_workspace_migration_reconciliation_required');
        recovery.cause=error;
        throw recovery;
      }
    }
    if(error?.code==='EXDEV')throw Error('forge_workspace_migration_cross_volume_unsupported');
    throw error;
  }
}
