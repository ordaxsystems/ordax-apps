import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateProviderContextAttachment} from './provider-context-attachment.mjs';

const filenamePattern=/^ordax-handoff-task_[a-z0-9_-]+-c\d+-[a-f0-9]{12}\.txt$/i;
const maxWindowsPathLength=240;
const maxHandoffFilenameLength=96;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

export function resolveTaskHandoffRoot({tempRoot,userRoot}={}) {
  if(typeof tempRoot!=='string'||!path.isAbsolute(tempRoot)||
     typeof userRoot!=='string'||!path.isAbsolute(userRoot))
    throw new Error('task_handoff_root_invalid');
  const profileKey=createHash('sha256').update(path.resolve(userRoot).toLowerCase(),'utf8').digest('hex').slice(0,20);
  const root=path.join(path.resolve(tempRoot),'OrdaX','OrchestratorLab','handoffs',profileKey);
  if(root.length+1+maxHandoffFilenameLength>maxWindowsPathLength)
    throw new Error('task_handoff_path_too_long');
  return root;
}

function checkedRoot(handoffRoot) {
  if(typeof handoffRoot!=='string'||!path.isAbsolute(handoffRoot))
    throw new Error('task_handoff_root_invalid');
  fs.mkdirSync(handoffRoot,{recursive:true});
  const stat=fs.lstatSync(handoffRoot);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('task_handoff_root_invalid');
  return path.resolve(handoffRoot)+path.sep;
}

function scopedPath(handoffRoot,filename) {
  if(typeof filename!=='string'||!filenamePattern.test(filename))throw new Error('task_handoff_filename_invalid');
  const safeRoot=checkedRoot(handoffRoot);
  const filePath=path.resolve(handoffRoot,filename);
  if(!filePath.startsWith(safeRoot))throw new Error('task_handoff_path_scope_invalid');
  return filePath;
}

export function writeTaskHandoffFile(handoffRoot,snapshot) {
  if(!snapshot||typeof snapshot.content!=='string'||!snapshot.manifest||snapshot.manifest.deliveryState!=='not_attached')
    throw new Error('task_handoff_snapshot_invalid');
  const filePath=scopedPath(handoffRoot,snapshot.filename);
  const bytes=Buffer.from(snapshot.content,'utf8');
  const sha256=digest(bytes);
  if(bytes.byteLength!==snapshot.manifest.byteLength||sha256!==snapshot.manifest.sha256||bytes.byteLength>1_000_000)
    throw new Error('task_handoff_integrity_failed');
  let fd;
  let created=false;
  try {
    fd=fs.openSync(filePath,'wx',0o600);
    created=true;
    fs.writeFileSync(fd,bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);fd=undefined;
    const persisted=fs.readFileSync(filePath);
    if(persisted.byteLength!==bytes.byteLength||digest(persisted)!==sha256)
      throw new Error('task_handoff_integrity_failed');
  } catch(error) {
    if(fd!==undefined)try{fs.closeSync(fd);}catch{}
    if(created)try{fs.unlinkSync(filePath);}catch{}
    throw error;
  }
  return validateProviderContextAttachment({
    filename:snapshot.filename,filePath,sha256,taskId:snapshot.manifest.taskId,
    checkpointVersion:snapshot.manifest.checkpointVersion,byteLength:bytes.byteLength
  });
}

export function removeTaskHandoffFile(handoffRoot,filePath) {
  const safeRoot=checkedRoot(handoffRoot);
  if(typeof filePath!=='string'||!filePath)throw new Error('task_handoff_path_scope_invalid');
  const resolved=path.resolve(filePath);
  if(!resolved.startsWith(safeRoot)||!filenamePattern.test(path.basename(resolved)))
    throw new Error('task_handoff_path_scope_invalid');
  try { fs.unlinkSync(resolved); return true; }
  catch(error) { if(error?.code==='ENOENT')return false; throw error; }
}

export function removeStaleTaskHandoffFiles(handoffRoot) {
  const safeRoot=checkedRoot(handoffRoot);
  let removed=0;
  for(const name of fs.readdirSync(handoffRoot)){
    if(!filenamePattern.test(name))continue;
    const filePath=path.resolve(handoffRoot,name);
    if(!filePath.startsWith(safeRoot))throw new Error('task_handoff_path_scope_invalid');
    const stat=fs.lstatSync(filePath);
    if(stat.isFile()&&!stat.isSymbolicLink()&&removeTaskHandoffFile(handoffRoot,filePath))removed++;
  }
  return removed;
}
