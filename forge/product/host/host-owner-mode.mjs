import path from 'node:path';
import {resolveLabUserRoot} from '../src/lab-profile-binding.mjs';
import {resolveHostProfileRoot} from './host-profile-lock.mjs';

const OWNER='--forge-owner-core',APPROVED='--forge-owner-core-approved';

/**
 * Switch the existing Node Host from its isolated test profile to the
 * canonical Windows Owner profile. Never derive authority from environment
 * variables or a browser request. Owner's consent and the active Windows
 * session are checked again by the SQLite trust and sealed OAuth ports.
 */
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
