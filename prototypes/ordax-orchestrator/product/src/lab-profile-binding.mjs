import path from 'node:path';
import {createHash} from 'node:crypto';

const stagedPrefix='--ordax-lab-staged-localappdata=';
const approvalFlag='--ordax-lab-staged-approved';
const altDebugFlag='--remote-debugging-port=9446';
const stagedName=/^candidate-userdata-v\d+\.\d+\.\d+-alpha\.\d+$/;

// The portable launcher may not forward an environment override reliably.
// Staged testing MUST bind the intended userData by an explicit verified CLI
// argument; otherwise it must fail closed before opening any SQLite profile.
export function resolveLabUserRoot({
  argv=process.argv,
  localAppData=process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE||process.cwd(),'AppData','Local')
}={}) {
  const candidates=argv.filter(v=>typeof v==='string'&&v.startsWith(stagedPrefix));
  const debug=argv.includes(altDebugFlag);
  const approved=argv.includes(approvalFlag);
  if(candidates.length>1 || (debug && (!approved || candidates.length!==1)) ||
     (approved && (!debug || candidates.length!==1)) ||
     (candidates.length!==0 && (!debug || !approved)))
    throw new Error('lab_staged_profile_explicit_binding_required');
  if(candidates.length===1) {
    const candidate=candidates[0].slice(stagedPrefix.length);
    if(!path.isAbsolute(candidate) || !stagedName.test(path.basename(path.resolve(candidate))))
      throw new Error('lab_staged_profile_invalid_path');
    return {userRoot:path.join(path.resolve(candidate),'OrdaX','OrchestratorLab'),staged:true};
  }
  return {userRoot:path.join(localAppData,'OrdaX','OrchestratorLab'),staged:false};
}

export function labProfileFingerprint(userRoot,{platform=process.platform}={}){
  if(typeof userRoot!=='string'||!path.isAbsolute(userRoot))
    throw new Error('lab_profile_root_invalid');
  const canonical=path.normalize(path.resolve(userRoot));
  const comparable=platform==='win32'?canonical.toLowerCase():canonical;
  return createHash('sha256').update(comparable,'utf8').digest('hex');
}
