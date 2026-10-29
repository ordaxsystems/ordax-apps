// Pure DAG scheduler for a future multi-chat orchestration mode. Does not
// dispatch messages or weaken the canonical provider's single-send safeguards.
const ID=/^[a-z][a-z0-9_-]{0,63}$/;
const STATES=new Set(['pending','running','succeeded','failed','uncertain','blocked']);
export function planParallelWork({tasks,maxParallel=4}={}){
 if(!Array.isArray(tasks)||tasks.length===0||tasks.length>256||
    !Number.isSafeInteger(maxParallel)||maxParallel<1||maxParallel>32)
    throw Error('parallel_plan_invalid');
 const map=new Map();
 for(const t of tasks){
   if(!ID.test(t?.id||'')||map.has(t.id)||!STATES.has(t.state)||
      !Array.isArray(t.dependsOn)||new Set(t.dependsOn).size!==t.dependsOn.length||
      typeof t.projectId!=='string'||!t.projectId.trim())
     throw Error('parallel_task_invalid');
   map.set(t.id,t);
 }
 for(const t of tasks)if(t.dependsOn.some(d=>!map.has(d)||map.get(d).projectId!==t.projectId||d===t.id))
   throw Error('parallel_dependency_invalid');
 const visited=new Set(),active=new Set();
 function visit(id){
   if(active.has(id))throw Error('parallel_cycle_detected');
   if(visited.has(id))return;
   active.add(id);for(const d of map.get(id).dependsOn)visit(d);
   active.delete(id);visited.add(id);
 }
 for(const t of tasks)visit(t.id);
 const running=tasks.filter(t=>t.state==='running');
 const available=Math.max(0,maxParallel-running.length);
 const ready=[],blocked=[],waiting=[];
 // Propagate blocked dependencies through the whole DAG without changing
 // persistent task state or dispatching anything.
 const blockedMemo=new Map();
 function isBlocked(id){
   if(blockedMemo.has(id))return blockedMemo.get(id);
   const t=map.get(id);
   const result=['uncertain','failed','blocked'].includes(t.state)||
     t.dependsOn.some(dep=>isBlocked(dep));
   blockedMemo.set(id,result);return result;
 }
 for(const t of tasks){
   if(t.state!=='pending')continue;
   if(isBlocked(t.id))blocked.push(t.id);
   else if(t.dependsOn.every(id=>map.get(id).state==='succeeded'))ready.push(t.id);
   else waiting.push(t.id);
 }
 return Object.freeze({dispatch:Object.freeze(ready.slice(0,available)),
   blocked:Object.freeze(blocked),waiting:Object.freeze(waiting),
   capacity:available,remainingReady:Math.max(0,ready.length-available),
   inFlight:running.length});
}
export function buildContinuationEnvelope({projectId,workId,checkpointId,confirmedFacts,
  unresolved,sourceRunIds,chatId=null}={}){
 if(![projectId,workId,checkpointId].every(v=>typeof v==='string'&&v.trim())||
   !Array.isArray(confirmedFacts)||!Array.isArray(unresolved)||!Array.isArray(sourceRunIds)||
   sourceRunIds.length===0||sourceRunIds.some(v=>typeof v!=='string'||!v.trim())||
   confirmedFacts.some(v=>typeof v!=='string'||!v.trim())||
   unresolved.some(v=>typeof v!=='string'||!v.trim())||
   confirmedFacts.length>100||unresolved.length>100||
   (chatId!==null&&(typeof chatId!=='string'||!chatId.trim())))
   throw Error('continuation_envelope_invalid');
 return Object.freeze({projectId,workId,checkpointId,chatId,
   confirmedFacts:Object.freeze([...confirmedFacts]),
   unresolved:Object.freeze([...unresolved]),
   sourceRunIds:Object.freeze([...sourceRunIds]),
   verification:'requires_canonical_receipt_resolution'});
}
