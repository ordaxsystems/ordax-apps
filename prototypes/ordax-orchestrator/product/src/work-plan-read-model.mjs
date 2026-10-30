import {planParallelWork} from './parallel-work-plan.mjs';

// A read-only scheduling recommendation over the EXISTING Store's Task/Run
// records. A candidate is not a dispatch authorization or a quality verdict.
export function projectWorkPlan({projectId,works,edges,maxParallel=4}={}){
  if(typeof projectId!=='string'||!projectId.trim()||
    !Array.isArray(works)||!Array.isArray(edges)||works.length>256)
    throw Error('work_plan_input_invalid');
  const byId=new Map();
  for(const work of works){
    if(!work||typeof work.id!=='string'||byId.has(work.id)||
      !Number.isSafeInteger(work.running_runs)||work.running_runs<0)
      throw Error('work_plan_input_invalid');
    byId.set(work.id,work);
  }
  const dependencies=new Map(works.map(work=>[work.id,[]]));
  for(const edge of edges){
    if(edge?.project_id!==projectId||!byId.has(edge.task_id)||
      !byId.has(edge.prerequisite_id))
      throw Error('work_plan_dependency_invalid');
    dependencies.get(edge.task_id).push(edge.prerequisite_id);
  }
  const tasks=works.map(work=>{
    const monitor=work.monitor?.state;
    const latest=work.latest_run_status;
    let state='blocked';
    if(work.running_runs>0||monitor==='running')state='running';
    else if(['reconciliation_required','execution_unresponsive'].includes(monitor)||
      ['interrupted','indeterminate','uncertain'].includes(latest))state='uncertain';
    else if(monitor==='failed'||latest==='failed'||work.status==='error')state='failed';
    else if(latest==='succeeded'&&monitor!=='running')state='succeeded';
    else if(latest==null&&['ready','pending'].includes(work.status)&&
      (monitor==null||monitor==='awaiting_instruction'))state='pending';
    return {id:work.id,projectId,state,dependsOn:dependencies.get(work.id)};
  });
  const result=tasks.length?planParallelWork({tasks,maxParallel}):{
    dispatch:[],blocked:[],waiting:[],capacity:maxParallel,remainingReady:0,inFlight:0
  };
  return Object.freeze({
    projectId,workCount:tasks.length,
    candidates:Object.freeze([...result.dispatch]),
    waiting:Object.freeze([...result.waiting]),
    blocked:Object.freeze([...result.blocked]),
    inFlight:result.inFlight,availableSlots:result.capacity,
    remainingCandidates:result.remainingReady,
    workers:Object.freeze(tasks.map(t=>Object.freeze({taskId:t.id,state:t.state,
      dependsOn:Object.freeze([...t.dependsOn])}))),
    automaticDispatchAllowed:false,
    qualityCertified:false,
    basis:'canonical_run_and_monitor_states_only'
  });
}
