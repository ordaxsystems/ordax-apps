/**
 * The one in-memory scheduling lane for canonical provider sends.
 * This REPLACES the old executionTail; it is not a receipt store or a
 * second executor. Provider results remain owned by the existing Store.
 */
export function createProviderExecutionScheduler({lanes}={}) {
  if(!Array.isArray(lanes)||lanes.length<1||lanes.length>32||
    lanes.some(lane=>!lane||typeof lane.id!=='string'||!lane.id||
      !lane.worker||typeof lane.worker!=='object')||
    new Set(lanes.map(lane=>lane.id)).size!==lanes.length||
    new Set(lanes.map(lane=>lane.worker)).size!==lanes.length)
    throw Error('provider_scheduler_lanes_invalid');

  const configuredLanes=Object.freeze(lanes.map(lane=>Object.freeze({...lane})));
  const queue=[];
  const waiting=new Set();
  const occupied=new Map();
  let closed=false;
  let closeReason='provider_scheduler_closed';

  const drain=()=>{
    if(closed)return;
    for(const lane of configuredLanes) {
      if(!queue.length)break;
      if(occupied.has(lane.id))continue;
      const item=queue.shift();
      // Execution is never retried. Every rejection belongs to one submission.
      occupied.set(lane.id,item.taskId);
      const settled=()=>{
        occupied.delete(lane.id);
        waiting.delete(item.taskId);
        drain();
      };
      Promise.resolve().then(()=>{
        if(closed)throw Error(closeReason);
        return item.operation(lane.worker);
      }).then(
        value=>{settled();item.resolve(value);},
        error=>{settled();item.reject(error);}
      );
    }
  };
  const enqueue=(taskId,operation)=>{
    if(typeof taskId!=='string'||!taskId||taskId.length>180||
      !/^[a-zA-Z0-9_-]+$/.test(taskId)||typeof operation!=='function')
      return Promise.reject(Error('provider_scheduler_input_invalid'));
    if(closed)return Promise.reject(Error(closeReason));
    if(waiting.has(taskId))return Promise.reject(Error('provider_task_already_scheduled'));
    return new Promise((resolve,reject)=>{
      waiting.add(taskId);
      queue.push({taskId,operation,resolve,reject});
      drain();
    });
  };
  const close=(reason='provider_scheduler_closed')=>{
    if(closed)return 0;
    closed=true;
    closeReason=reason==='provider_worker_destroyed'?'provider_worker_destroyed':'provider_scheduler_closed';
    const pending=queue.splice(0);
    for(const item of pending) {
      waiting.delete(item.taskId);
      item.reject(Error(closeReason));
    }
    // An active operation is NOT cancelled: its canonical Run is reconciled
    // by the existing host shutdown/response policy, never replayed here.
    return pending.length;
  };
  return Object.freeze({
    enqueue,close,
    snapshot:()=>Object.freeze({
      lanes:configuredLanes.length,active:occupied.size,queued:queue.length,
      pendingTasks:waiting.size,closed
    })
  });
}
