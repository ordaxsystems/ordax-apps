import {mkdirSync,existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import path from 'node:path';

export const REPO='ordaxos-admin/TESTES-FORGE-GIT';
export const ROLES=Object.freeze([
 {id:'forjador',name:'Forjador',role:'coordinator'},
 {id:'agent-1',name:'Agente 1',role:'executor'},
 {id:'agent-2',name:'Agente 2',role:'executor'}
]);
const makeAgent=role=>({...role,chatUrl:null,branch:null,task:'',status:'idle',lastResponse:'',lastHead:null,turnStartHead:null,lastError:null,awaitingSince:null,autoContinue:false,autoRounds:0,autoPending:false,autoGoal:''});
const fresh=()=>({
 version:1,repository:REPO,revision:0,observed:{base:null,sha:null,at:null},
 agents:ROLES.map(makeAgent),events:[],inbox:[],updatedAt:new Date().toISOString()
});
function validate(snapshot){
 if(!snapshot||snapshot.version!==1||snapshot.repository!==REPO||!Array.isArray(snapshot.agents)||
   snapshot.agents.length!==ROLES.length||!ROLES.every((role,i)=>snapshot.agents[i]?.id===role.id)||
   !Array.isArray(snapshot.events)||!Array.isArray(snapshot.inbox))throw Error('memoria_invalida');
}
function compactInbox(items){
  const newest=new Map();
  items.forEach((item,index)=>{
    if(!item.delivered)newest.set(item.agent??'project',index);
  });
  return items.filter((item,index)=>item.delivered||
    newest.get(item.agent??'project')===index).slice(-40);
}
export function nextAutonomousCheckpoint(agent,{limit=6}={}){
 if(!agent?.autoContinue||agent.autoPending)return null;
 const rounds=Math.max(0,Math.floor(Number(agent.autoRounds)||0))+1;
 const continueAllowed=rounds<limit;
 return {autoRounds:rounds,autoContinue:continueAllowed,autoPending:continueAllowed};
}
const alertKey=item=>JSON.stringify([
  item.agent,item.kind,item.sha,item.detail,item.at
]);

// Only a confirmed finished turn from an explicitly authorized automatic
// mission is eligible for unattended notification of the GPT coordinator.
export function coordinatorAutoAlerts(snapshot){
  const agents=new Map((snapshot?.agents||[]).map(a=>[a.id,a]));
  return (snapshot?.inbox||[]).filter(item=>{
    if(item.delivered===true||item.autoNotified===true)return false;
    const agent=agents.get(item.agent);
    if(!agent||agent.status!=='idle')return false;
    if(['autonomous_mission_finished','autonomous_limit_reached'].includes(item.kind))
      return true;
    return item.kind==='github_revision'&&agent.autoContinue===true&&
      typeof item.sha==='string'&&/^[a-f0-9]{40}$/i.test(item.sha)&&
      item.sha===agent.lastHead&&agent.turnStartHead!==agent.lastHead;
  });
}
export function memoryFile(dir){return path.join(dir,'forge-git-project.json')}
export function openProjectMemory(dir){
 mkdirSync(dir,{recursive:true});
 const file=memoryFile(dir);
 let state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):fresh();
 validate(state);
 const persist=()=>{
   validate(state);
   state.revision++;
   state.updatedAt=new Date().toISOString();
   const temp=file+'.tmp';
   writeFileSync(temp,JSON.stringify(state,null,2)+'\n',{mode:0o600});
   renameSync(temp,file);
 };
 if(!existsSync(file))persist();
 const compacted=compactInbox(state.inbox);
 if(compacted.length!==state.inbox.length){
   state.inbox=compacted;
   persist();
 }
 return {
   snapshot:()=>JSON.parse(JSON.stringify(state)),
   agent:id=>{
     const found=state.agents.find(a=>a.id===id);
     if(!found)throw Error('agente_desconhecido');
     return {...found};
   },
   patch:(id,values)=>{
     const agent=state.agents.find(a=>a.id===id);
     if(!agent)throw Error('agente_desconhecido');
     const allowed=['chatUrl','branch','task','status','lastResponse','lastHead','turnStartHead','lastError','awaitingSince','autoContinue','autoRounds','autoPending','autoGoal'];
     for(const [key,value] of Object.entries(values)){
       if(!allowed.includes(key))throw Error('campo_nao_autorizado');
       agent[key]=value;
     }
     persist();
     return {...agent};
   },
   beginTurn:(id,task,{continuation=false,newSession=false}={})=>{
     const agent=state.agents.find(a=>a.id===id);
     if(!agent)throw Error('agente_desconhecido');
     if(continuation&&(!agent.autoContinue||!agent.autoPending))
       throw Error('continuacao_nao_autorizada');
     agent.status='running';
     agent.lastError=null;
     agent.task=task;
     agent.turnStartHead=agent.lastHead;
     if(newSession)agent.chatUrl=null;
     if(continuation)agent.autoPending=false;
     persist();
     return {...agent};
   },
   observe:({base,sha,at})=>{
     if(typeof base!=='string'||!sha||!/^[0-9a-f]{40}$/i.test(sha))throw Error('github_revision_invalida');
     state.observed={base,sha,at};
     persist();
   },
   event:(entry)=>{
     if(typeof entry?.kind!=='string')throw Error('evento_invalido');
     const item={kind:entry.kind,agent:entry.agent??null,sha:entry.sha??null,detail:String(entry.detail??'').slice(0,240),at:new Date().toISOString()};
     const repeated=state.events.find(e=>e.agent===item.agent&&e.kind===item.kind&&
       e.sha===item.sha&&e.detail===item.detail);
     if(repeated)return repeated;
     state.events.push(item);
     state.events=state.events.slice(-80);
     if(entry.forCoordinator===true){
       const exists=state.inbox.some(e=>!e.delivered&&e.agent===item.agent&&
         e.kind===item.kind&&e.sha===item.sha&&e.detail===item.detail);
       if(!exists)state.inbox.push({...item,delivered:false});
       state.inbox=compactInbox(state.inbox);
     }
     persist();
     return item;
   },
   // Claim before sending to GPT. If the process exits mid-send, the
   // unconfirmed alert remains visible, but is never sent twice unattended.
   reserveCoordinatorAuto:(receipts)=>{
     if(!Array.isArray(receipts)||receipts.length>40)
       throw Error('avisos_a_confirmar_invalidos');
     const selected=new Set(receipts.map(alertKey));
     const reserved=[];
     for(const item of state.inbox){
       if(!item.delivered&&!item.autoNotified&&selected.has(alertKey(item))){
         item.autoNotified=true;
         reserved.push({...item});
       }
     }
     if(reserved.length)persist();
     return reserved;
   },
   acknowledge:(receipts)=>{
     if(!Array.isArray(receipts)||receipts.length>40)
       throw Error('avisos_a_confirmar_invalidos');
     // Only acknowledge the exact alerts observed before the GPT send.
     // A new GitHub event during an awaited reply must remain unread.
     const selected=new Set(receipts.map(alertKey));
     let changed=false;
     for(const item of state.inbox){
       if(!item.delivered&&selected.has(alertKey(item))){
         item.delivered=true;
         changed=true;
       }
     }
     if(changed)persist();
     return changed;
   },
   context:()=>{
     const branches=state.agents.filter(a=>a.branch).map(a=>a.name+': '+a.branch+
       (a.lastHead?' @'+a.lastHead.slice(0,12):''));
     return 'GitHub: https://github.com/'+REPO+
       (branches.length?' | '+branches.join(' | '):'');
   }
 };
}