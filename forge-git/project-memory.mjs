import {mkdirSync,existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import path from 'node:path';

export const REPO='ordaxos-admin/TESTES-FORGE-GIT';
export const ROLES=Object.freeze([
 {id:'forjador',name:'Forjador',role:'coordinator'},
 {id:'agent-1',name:'Agente 1',role:'executor'},
 {id:'agent-2',name:'Agente 2',role:'executor'}
]);
const makeAgent=role=>({...role,chatUrl:null,branch:null,task:'',status:'idle',lastResponse:'',lastHead:null,lastError:null});
const fresh=()=>({
 version:1,repository:REPO,revision:0,observed:{base:null,sha:null,at:null},
 agents:ROLES.map(makeAgent),events:[],inbox:[],updatedAt:new Date().toISOString()
});
function validate(snapshot){
 if(!snapshot||snapshot.version!==1||snapshot.repository!==REPO||!Array.isArray(snapshot.agents)||
   snapshot.agents.length!==ROLES.length||!ROLES.every((role,i)=>snapshot.agents[i]?.id===role.id)||
   !Array.isArray(snapshot.events)||!Array.isArray(snapshot.inbox))throw Error('memoria_invalida');
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
     const allowed=['chatUrl','branch','task','status','lastResponse','lastHead','lastError'];
     for(const [key,value] of Object.entries(values)){
       if(!allowed.includes(key))throw Error('campo_nao_autorizado');
       agent[key]=value;
     }
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
     state.events.push(item);
     state.events=state.events.slice(-80);
     if(entry.forCoordinator===true){
       state.inbox.push({...item,delivered:false});
       state.inbox=state.inbox.slice(-40);
     }
     persist();
     return item;
   },
   acknowledge:(count)=>{
     const n=Math.max(0,Math.min(40,Number(count)||0));
     for(let i=0;i<n&&i<state.inbox.length;i++)state.inbox[i].delivered=true;
     persist();
   },
   context:()=>{
     const o=state.observed;
     const facts=state.events.slice(-10).map(e=>e.at+' '+e.kind+' '+(e.sha||'')+' '+e.detail);
     const agents=state.agents.map(a=>a.name+': '+a.status+(a.branch?' / '+a.branch:''));
     return [
       'Projeto: https://github.com/'+REPO,
       'GitHub verificado: '+(o.base||'sem base')+' '+(o.sha||'sem revisão')+' '+(o.at||''),
       'Agentes: '+agents.join(' | '),
       'Eventos confirmados: '+(facts.join('\n')||'nenhum'),
       'Avisos pendentes para o Forjador: '+state.inbox.filter(e=>!e.delivered).map(e=>e.detail).join(' | ')
     ].join('\n');
   }
 };
}
