import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function forgeDevSupervisorPaths({localAppData=process.env.LOCALAPPDATA||
  path.join(os.homedir(),'AppData','Local')}={}) {
  if(typeof localAppData!=='string'||!path.isAbsolute(localAppData))
    throw Error('forge_dev_supervisor_local_app_data_invalid');
  const stateDir=path.join(localAppData,'OrdaX','Forge','supervisor');
  return Object.freeze({
    stateDir,
    lockPath:path.join(stateDir,'forge-dev-supervisor.lock.json'),
    statePath:path.join(stateDir,'forge-dev-supervisor-state.json'),
    heartbeatPath:path.join(stateDir,'forge-heartbeat.json')
  });
}

export function forgeDevSupervisorPidAlive(pid) {
  if(!Number.isSafeInteger(pid)||pid<1)return false;
  try{process.kill(pid,0);return true;}catch{return false;}
}

export function readLiveForgeDevSupervisorLock(lockPath) {
  if(typeof lockPath!=='string'||!path.isAbsolute(lockPath))
    throw Error('forge_dev_supervisor_lock_path_invalid');
  let lock=null;
  try{lock=JSON.parse(fs.readFileSync(lockPath,'utf8'));}catch{return null;}
  const pid=Number(lock?.pid);
  if(!forgeDevSupervisorPidAlive(pid))return null;
  return Object.freeze({...lock,pid});
}

export function forgeDevSupervisorBlocksIndependentLaunch({
  lockPath=forgeDevSupervisorPaths().lockPath,
  supervisorChild=process.env.ORDAX_FORGE_SUPERVISOR_CHILD==='1',
  parentPid=process.ppid
}={}) {
  if(typeof supervisorChild!=='boolean'||!Number.isSafeInteger(parentPid)||parentPid<1)
    throw Error('forge_dev_supervisor_launcher_identity_invalid');
  if(supervisorChild)return false;
  const lock=readLiveForgeDevSupervisorLock(lockPath);
  if(!lock)return false;
  // Backward-compatible with a supervisor process that was already running
  // before ORDAX_FORGE_SUPERVISOR_CHILD existed: its direct child is owned.
  return lock.pid!==parentPid;
}
