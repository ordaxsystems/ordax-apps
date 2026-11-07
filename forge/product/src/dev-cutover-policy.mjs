// Pure pre-cutover gate: never starts, stops or modifies the Dev App.
export function assessDevCutover({currentBuild,candidateBuild,recovery,activeRuns}={}){
 const base={schema:'ordax.lab.dev-cutover-gate.v1',ready:false,
  restartPerformed:false,rollbackPerformed:false};
 if(!Number.isSafeInteger(activeRuns)||activeRuns!==0)
  return {...base,reason:'active_or_unknown_runs'};
 if(recovery?.dataBackupReady!==true || recovery?.hashVerified!==true)
  return {...base,reason:'recovery_not_verified'};
 if(candidateBuild?.verified!==true || candidateBuild?.status!=='verified' ||
    !/^[a-f0-9]{64}$/.test(candidateBuild?.contentDigest||''))
  return {...base,reason:'candidate_not_verified'};
 if(currentBuild?.verified!==true || currentBuild?.status!=='verified' ||
    !/^[a-f0-9]{64}$/.test(currentBuild?.contentDigest||''))
  return {...base,reason:'current_runtime_unattested'};
 if(recovery?.rollbackRuntimeDigest !== currentBuild.contentDigest)
  return {...base,reason:'previous_code_not_preserved'};
 return {...base,ready:true,reason:'reversible_cutover_preconditions_met'};
}