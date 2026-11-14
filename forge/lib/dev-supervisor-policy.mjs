export const FORGE_DEV_RESTART_DELAYS_MS=Object.freeze([
  2_000,5_000,15_000,30_000,60_000,120_000
]);
export const FORGE_DEV_STABLE_RUNTIME_MS=60_000;
export const FORGE_DEV_HEARTBEAT_GRACE_MS=60_000;
export const FORGE_DEV_HEARTBEAT_STALE_MS=45_000;

export function nextSupervisorFailureCount(previous,runtimeMs){
  if(!Number.isSafeInteger(previous)||previous<0||
     !Number.isSafeInteger(runtimeMs)||runtimeMs<0)
    throw Error('forge_dev_supervisor_policy_invalid');
  return runtimeMs>=FORGE_DEV_STABLE_RUNTIME_MS?1:Math.min(previous+1,1000);
}

export function supervisorRestartDelayMs(failureCount){
  if(!Number.isSafeInteger(failureCount)||failureCount<1)
    throw Error('forge_dev_supervisor_failure_count_invalid');
  return FORGE_DEV_RESTART_DELAYS_MS[
    Math.min(failureCount-1,FORGE_DEV_RESTART_DELAYS_MS.length-1)
  ];
}

export function forgeDevHeartbeatStale({now,launchedAt,heartbeatAt}={}){
  if(!Number.isSafeInteger(now)||now<0||
     !Number.isSafeInteger(launchedAt)||launchedAt<0||now<launchedAt||
     (heartbeatAt!==null&&heartbeatAt!==undefined&&
       (!Number.isSafeInteger(heartbeatAt)||heartbeatAt<0)))
    throw Error('forge_dev_supervisor_heartbeat_invalid');
  if(now-launchedAt<FORGE_DEV_HEARTBEAT_GRACE_MS)return false;
  return !Number.isSafeInteger(heartbeatAt)||heartbeatAt<launchedAt||
    now-heartbeatAt>FORGE_DEV_HEARTBEAT_STALE_MS;
}
