import path from 'node:path';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

import {resolveLabUserRoot} from '../src/lab-profile-binding.mjs';
import {resolveHostProfileRoot} from './host-profile-lock.mjs';

const OWNER='--forge-owner-core',APPROVED='--forge-owner-core-approved';

/**
 * Switch the existing Node Host from its isolated test profile to the
 * canonical Windows Owner profile. Never derive authority from environment
 * variables or a browser request. Owner's consent and the active Windows
 * session are checked again by the SQLite trust and sealed OAuth ports.
 */

/** Ask Windows for the actual Documents known folder, not USERPROFILE/Documents:
 * the Owner may have redirected it to OneDrive or another authorized volume. */
export function resolveForgeNodeOwnerDocumentsDirectory({
  platform=process.platform,run=spawnSync
}={}){
  if(platform!=='win32')throw Error('forge_node_documents_windows_required');
  const result=run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive',
    '-Command',"[Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments)"],
    {windowsHide:true,timeout:10000,encoding:'utf8',maxBuffer:4096,
      stdio:['ignore','pipe','pipe']});
  const value=String(result?.stdout||'').trim();
  if(result?.status!==0||result?.error||!value||value.includes('\n')||
    value.includes('\r')||value.includes('\0')||!path.isAbsolute(value))
    throw Error('forge_node_documents_known_folder_unavailable');
  const root=path.resolve(value);
  try{
    const stat=fs.lstatSync(root);
    if(!stat.isDirectory()||stat.isSymbolicLink())
      throw Error('forge_node_documents_known_folder_unavailable');
  }catch{throw Error('forge_node_documents_known_folder_unavailable');}
  return root;
}

export function resolveForgeNodeHostMode({
  argv=process.argv,environment=process.env,productRoot,platform=process.platform
}={}){
  if(!Array.isArray(argv)||typeof productRoot!=='string'||!path.isAbsolute(productRoot))
    throw Error('forge_node_host_mode_invalid');
  const selected=argv.filter(arg=>arg===OWNER).length;
  const approved=argv.filter(arg=>arg===APPROVED).length;
  if(selected===0&&approved===0)
    return Object.freeze({owner:false,
      dataRoot:resolveHostProfileRoot(productRoot,
        environment.ORDAX_ORCHESTRATOR_HOST_PROFILE_DIR),userRoot:null});
  if(platform!=='win32'||selected!==1||approved!==1||
     environment.ORDAX_ORCHESTRATOR_HOST_PROFILE_DIR||
     argv.some(arg=>typeof arg==='string'&&(
       arg.startsWith('--ordax-lab-staged-')||
       arg.startsWith('--remote-debugging-port='))))
    throw Error('forge_node_owner_explicit_windows_profile_required');
  const localAppData=environment.LOCALAPPDATA;
  if(typeof localAppData!=='string'||!path.isAbsolute(localAppData))
    throw Error('forge_node_owner_localappdata_unavailable');
  const {userRoot,staged}=resolveLabUserRoot({argv:[],localAppData});
  if(staged)throw Error('forge_node_owner_staged_profile_forbidden');
  return Object.freeze({owner:true,userRoot,dataRoot:path.join(userRoot,'data')});
}
