// Compatibility reader for the historical Forge Git display record.
// This file is not a project store, scheduler, Git evidence, or Task authority.
// Only the single observed GPT conversation URL and its navigation health may
// change here; Forge Core is the sole owner of project/Task/Run continuity.
import {mkdirSync,existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import path from 'node:path';
import {canonicalProviderChatUrl} from '../forge/product/src/conversation-policy.mjs';

export const REPO='ordaxos-admin/TESTES-FORGE-GIT'; // Historical schema discriminator, not active repository.
export const ROLES=Object.freeze([
  {id:'forjador',name:'Forjador',role:'coordinator'},
  {id:'agent-1',name:'Agente 1',role:'executor'},
  {id:'agent-2',name:'Agente 2',role:'executor'}
]);
const makeAgent=role=>({...role,chatUrl:null,branch:null,task:'',status:'idle',
  lastResponse:'',lastHead:null,turnStartHead:null,lastError:null,
  awaitingSince:null,autoContinue:false,autoRounds:0,autoPending:false,autoGoal:''});
const fresh=()=>({
  version:1,repository:REPO,revision:0,observed:{base:null,sha:null,at:null},
  agents:ROLES.map(makeAgent),events:[],inbox:[],updatedAt:new Date().toISOString()
});
const clone=value=>JSON.parse(JSON.stringify(value));
function validate(snapshot){
  if(!snapshot||snapshot.version!==1||snapshot.repository!==REPO||
     !Array.isArray(snapshot.agents)||snapshot.agents.length!==ROLES.length||
     !ROLES.every((role,i)=>snapshot.agents[i]?.id===role.id)||
     !Array.isArray(snapshot.events)||!Array.isArray(snapshot.inbox))
    throw Error('memoria_invalida');
}
export function memoryFile(dir){return path.join(dir,'forge-git-project.json');}
export function openProjectMemory(dir){
  const file=memoryFile(dir);
  let exists=existsSync(file);
  const state=exists?JSON.parse(readFileSync(file,'utf8')):fresh();
  validate(state);
  // Do not create a legacy project database during startup or compact old
  // evidence. A historical file is retained byte-for-byte until an observed
  // provider URL/navigation-health change explicitly requires a write.
  function persist(){
    validate(state);
    state.revision++;
    state.updatedAt=new Date().toISOString();
    mkdirSync(dir,{recursive:true});
    const temp=file+'.tmp';
    writeFileSync(temp,JSON.stringify(state,null,2)+'\n',{mode:0o600});
    renameSync(temp,file);
    exists=true;
  }
  return Object.freeze({
    snapshot:()=>clone(state),
    agent:id=>{
      const found=state.agents.find(a=>a.id===id);
      if(!found)throw Error('agente_desconhecido');
      return clone(found);
    },
    patch:(id,values)=>{
      // Only the actual displayed worker can update its *transport* state.
      // Historical agent records remain readable for migration, not runnable.
      if(id!=='forjador')throw Error('forge_core_owns_historical_agent');
      if(!values||typeof values!=='object'||Array.isArray(values)||
         Object.keys(values).some(key=>!['chatUrl','status','lastError'].includes(key)))
        throw Error('forge_core_owns_project_memory');
      if(Object.hasOwn(values,'chatUrl')&&values.chatUrl!==null&&
         canonicalProviderChatUrl(values.chatUrl)!==values.chatUrl)
        throw Error('forge_git_chat_url_invalid');
      if(Object.hasOwn(values,'status')&&
         !['idle','blocked'].includes(values.status))
        throw Error('forge_core_owns_work_runs');
      if(Object.hasOwn(values,'lastError')&&values.lastError!==null&&
         (typeof values.lastError!=='string'||values.lastError.length>200))
        throw Error('forge_git_navigation_error_invalid');
      const agent=state.agents[0];
      for(const [key,value] of Object.entries(values))agent[key]=value;
      // New installations do not need a legacy project file merely because
      // the browser health changed before a conversation URL was observed.
      if(exists||agent.chatUrl!==null)persist();
      return clone(agent);
    }
  });
}
