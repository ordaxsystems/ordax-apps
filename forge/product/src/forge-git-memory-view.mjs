import {lstatSync,readFileSync} from 'node:fs';
import path from 'node:path';
const REPO_ID=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ROLE_ID=/^[A-Za-z0-9_-]{1,48}$/;

// Read the same App-owned checkpoint; never instantiate a second Store,
// alter inbox receipts, or treat a historic HEAD as a live GitHub response.
export function readForgeGitMemory(appDataRoot) {
  if(typeof appDataRoot!=='string'||!path.isAbsolute(appDataRoot))
    throw Error('forge_git_profile_invalid');
  const file=path.join(appDataRoot,'OrdaX','ForgeGit','forge-git-project.json');
  let raw;
  try {
    const stat=lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)
      throw Error('forge_git_memory_file_invalid');
    raw=JSON.parse(readFileSync(file,'utf8'));
  } catch(error) {
    if(error?.code==='ENOENT')return {schema:'ordax.forge-git.memory-view/1',
      available:false,reason:'forge_git_not_initialized'};
    throw Error('forge_git_memory_unavailable');
  }
  if(raw?.version!==1||typeof raw.repository!=='string'||
    !REPO_ID.test(raw.repository)||!Number.isSafeInteger(raw.revision)||
    !Array.isArray(raw.agents)||raw.agents.length<1||raw.agents.length>16||
    raw.agents.some(a=>!a||!ROLE_ID.test(a.id||''))||
    !Array.isArray(raw.events)||!Array.isArray(raw.inbox))
    throw Error('forge_git_memory_invalid');
  const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/i.test(value)?value:null;
  const agent=a=>({
    id:a.id,status:String(a.status||'unknown').slice(0,40),
    branch:typeof a.branch==='string'?a.branch.slice(0,160):null,
    lastHead:sha(a.lastHead),autoContinue:a.autoContinue===true,
    autoRounds:Number.isSafeInteger(a.autoRounds)?a.autoRounds:0
  });
  const event=e=>({
    at:typeof e.at==='string'?e.at.slice(0,40):null,
    agent:raw.agents.some(a=>a.id===e.agent)?e.agent:null,
    kind:String(e.kind||'').slice(0,80),sha:sha(e.sha),
    detail:String(e.detail||'').slice(0,240)
  });
  return {
    schema:'ordax.forge-git.memory-view/1',available:true,
    source:'forge_git_app_persisted_checkpoint',liveGithubChecked:false,
    repository:raw.repository,revision:raw.revision,
    updatedAt:typeof raw.updatedAt==='string'?raw.updatedAt:null,
    observed: {
      branch:typeof raw.observed?.base==='string'?raw.observed.base:null,
      head:sha(raw.observed?.sha),
      at:typeof raw.observed?.at==='string'?raw.observed.at:null
    },
    agents:raw.agents.map(agent),
    events:raw.events.slice(-10).map(event),
    pendingForCoordinator:raw.inbox.filter(e=>e.delivered!==true).length
  };
}