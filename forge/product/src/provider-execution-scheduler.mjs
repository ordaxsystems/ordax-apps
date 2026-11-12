/**
 * A bounded in-memory scheduling lane for canonical provider sends.
 * This is NOT a receipt store or a second executor. Never cancel or retry an
 * already started external effect; the existing Store reconciles those Runs.
 */
export function createProviderExecutionScheduler({
  lanes,maxQueued=64,maxQueueWaitMs=10*60_000,clock=Date.now
}={}) {
  if(!Array.isArray(lanes)||lanes.length<1||lanes.length>32||
    lanes.some(lane=>!lane||typeof lane.id!=='string'||!lane.id||
      !lane.worker||typeof lane.worker!=='object')||
    new Set(lanes.map(lane=>lane.id)).size!==lanes.length||
    new Set(lanes.map(lane=>lane.worker)).size!==lanes.length)
    throw Error('provider_scheduler_lanes_invalid');
  if(!Number.isSafeInteger(maxQueued)||maxQueued<1||maxQueued>4096||
    !Number.isSafeInteger(maxQueueWaitMs)||maxQueueWaitMs<1||
    maxQueueWaitMs>60*60_000||typeof clock!=='function')
    throw Error('provider_scheduler_bounds_invalid');

  const configuredLanes=Object.freeze(lanes.map(lane=>Object.freeze({...lane})));
  const queue=[],waiting=new Set(),occupied=new Map();
  let closed=false,closeReason='provider_scheduler_closed';
  const counters={accepted:0,started:0,settled:0,rejectedFull:0,
    expired:0,cancelled:0,peakQueued:0,maxObservedWaitMs:0};

  const clearQueueHooks=item=>{
    if(item.timer!==null){clearTimeout(item.timer);item.timer=null;}
    if(item.signal&&item.onAbort){
      item.signal.removeEventListener('abort',item.onAbort);
      item.onAbort=null;
    }
  };
  // Only queued items can be cancelled or expire. Active provider effects
  // remain owned by their existing Run, even when shutdown is requested.
  const rejectQueued=(item,reason)=>{
    const index=queue.indexOf(item);
    if(index<0)return false; // already dispatched: cannot cancel a send.
    queue.splice(index,1);
    clearQueueHooks(item);
    waiting.delete(item.taskId);
    item.reject(Error(reason));
    return true;
  };
  const drain=()=>{
    if(closed)return;
    for(const lane of configuredLanes) {
      if(!queue.length)break;
      if(occupied.has(lane.id))continue;
      const item=queue.shift();
      clearQueueHooks(item);
      counters.started++;
      counters.maxObservedWaitMs=Math.max(
        counters.maxObservedWaitMs,Math.max(0,clock()-item.enqueuedAt));
      // Execution is never retried; resolving a late external response cannot
      // release a different operation or make an uncertain send "successful".
      occupied.set(lane.id,item.taskId);
      const settled=()=>{
        occupied.delete(lane.id);
        waiting.delete(item.taskId);
        counters.settled++;
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
  const enqueue=(taskId,operation,{signal}={})=>{
    if(typeof taskId!=='string'||!taskId||taskId.length>180||
      !/^[a-zA-Z0-9_-]+$/.test(taskId)||typeof operation!=='function'||
      (signal!==undefined&&(!signal||typeof signal.aborted!=='boolean'||
        typeof signal.addEventListener!=='function'||
        typeof signal.removeEventListener!=='function')))
      return Promise.reject(Error('provider_scheduler_input_invalid'));
    if(closed)return Promise.reject(Error(closeReason));
    if(waiting.has(taskId))return Promise.reject(Error('provider_task_already_scheduled'));
    if(signal?.aborted){
      counters.cancelled++;
      return Promise.reject(Error('provider_scheduler_queued_cancelled'));
    }
    // Capacity only counts queued requests; busy lanes are not displaced.
    if(queue.length>=maxQueued){
      counters.rejectedFull++;
      return Promise.reject(Error('provider_scheduler_queue_full'));
    }
    return new Promise((resolve,reject)=>{
      const item={taskId,operation,resolve,reject,enqueuedAt:clock(),
        timer:null,signal:signal??null,onAbort:null};
      waiting.add(taskId);
      counters.accepted++;
      queue.push(item);
      counters.peakQueued=Math.max(counters.peakQueued,queue.length);
      // When a lane is free, dispatch immediately instead of setting a timer.
      drain();
      if(!queue.includes(item))return;
      item.timer=setTimeout(()=>{
        if(rejectQueued(item,'provider_scheduler_queue_wait_timeout'))counters.expired++;
      },maxQueueWaitMs);
      if(signal){
        item.onAbort=()=>{
          if(rejectQueued(item,'provider_scheduler_queued_cancelled'))counters.cancelled++;
        };
        signal.addEventListener('abort',item.onAbort,{once:true});
        if(signal.aborted)item.onAbort();
      }
    });
  };
  const close=(reason='provider_scheduler_closed')=>{
    if(closed)return 0;
    closed=true;
    closeReason=reason==='provider_worker_destroyed'
      ?'provider_worker_destroyed':'provider_scheduler_closed';
    const pending=queue.splice(0);
    for(const item of pending){
      clearQueueHooks(item);
      waiting.delete(item.taskId);
      item.reject(Error(closeReason));
    }
    // Do not abort in-flight Runs, even if their network response is late.
    return pending.length;
  };
  return Object.freeze({
    enqueue,close,
    snapshot:()=>Object.freeze({
      lanes:configuredLanes.length,active:occupied.size,queued:queue.length,
      pendingTasks:waiting.size,closed
    }),
    metrics:()=>Object.freeze({...counters,maxQueued,maxQueueWaitMs})
  });
}
