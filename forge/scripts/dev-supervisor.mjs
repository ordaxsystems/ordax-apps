import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  nextSupervisorFailureCount,supervisorRestartDelayMs,forgeDevHeartbeatStale
} from '../lib/dev-supervisor-policy.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const localAppData=process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local');
const stateDir=path.join(localAppData,'OrdaX','Forge','supervisor');
const lockPath=path.join(stateDir,'forge-dev-supervisor.lock.json');
const statePath=path.join(stateDir,'forge-dev-supervisor-state.json');
const heartbeatPath=path.join(stateDir,'forge-heartbeat.json');
const launcher=path.join(root,'scripts','start-lab.mjs');
fs.mkdirSync(stateDir,{recursive:true});

function pidAlive(pid){
  if(!Number.isSafeInteger(pid)||pid<1)return false;
  try{process.kill(pid,0);return true;}catch{return false;}
}
function readJson(file){
  try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}
}
function atomicJson(file,value){
  const temp=file+'.tmp-'+process.pid;
  fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{encoding:'utf8'});
  fs.renameSync(temp,file);
}
function acquire(){
  const existing=readJson(lockPath);
  if(existing?.pid&&pidAlive(existing.pid))
    throw Error('forge_dev_supervisor_already_running');
  try{fs.unlinkSync(lockPath);}catch{}
  const fd=fs.openSync(lockPath,'wx');
  try{fs.writeFileSync(fd,JSON.stringify({pid:process.pid,startedAt:Date.now()})+'\n');}
  finally{fs.closeSync(fd);}
}
function release(){
  const current=readJson(lockPath);
  if(current?.pid===process.pid)try{fs.unlinkSync(lockPath);}catch{}
}
function killTree(pid){
  if(!Number.isSafeInteger(pid)||pid<1)return;
  if(process.platform==='win32'){
    spawnSync('taskkill',['/PID',String(pid),'/T','/F'],{
      stdio:'ignore',windowsHide:true
    });
  }else{
    try{process.kill(pid,'SIGTERM');}catch{}
  }
}

acquire();
let child=null,stopping=false,failureCount=0,restartCount=0;
let timer=null,heartbeatTimer=null,launchStartedAt=0,hangTerminationPending=false;

function state(status,extra={}){
  atomicJson(statePath,{
    schema:'ordax.forge.dev-supervisor/1',
    status,supervisorPid:process.pid,childPid:child?.pid||null,
    failureCount,restartCount,updatedAt:Date.now(),...extra
  });
}
function launch(){
  if(stopping)return;
  launchStartedAt=Date.now();
  hangTerminationPending=false;
  const env={...process.env,ORDAX_FORGE_DEV_AUTONOMY:'1'};
  child=spawn(process.execPath,[launcher],{
    cwd:root,env,stdio:'inherit',windowsHide:false
  });
  state('running',{launchedAt:launchStartedAt});
  child.once('error',error=>{
    state('child_error',{error:String(error?.message||error).slice(0,160)});
  });
  child.once('exit',(code,signal)=>{
    const runtimeMs=Math.max(0,Date.now()-launchStartedAt);
    child=null;
    if(stopping){state('stopped',{code,signal,runtimeMs});return;}
    restartCount++;
    failureCount=nextSupervisorFailureCount(failureCount,runtimeMs);
    const delayMs=supervisorRestartDelayMs(failureCount);
    state('restart_scheduled',{code,signal,runtimeMs,delayMs});
    // The restart timer is intentionally ref'ed: after a Forge crash it
    // is the supervisor's sole reason to remain alive until relaunch.
    timer=setTimeout(()=>{timer=null;launch();},delayMs);
  });
}
function checkHeartbeat(){
  if(stopping||!child?.pid||hangTerminationPending)return;
  const now=Date.now();
  const heartbeat=readJson(heartbeatPath);
  const heartbeatAt=Number.isSafeInteger(heartbeat?.at)?heartbeat.at:null;
  let stale=false;
  try{stale=forgeDevHeartbeatStale({now,launchedAt:launchStartedAt,heartbeatAt});}
  catch{return;}
  if(!stale)return;
  hangTerminationPending=true;
  state('hang_detected',{
    heartbeatAt,heartbeatAgeMs:heartbeatAt===null?null:Math.max(0,now-heartbeatAt)
  });
  killTree(child.pid);
}
function shutdown(signal){
  if(stopping)return;
  stopping=true;
  if(timer){clearTimeout(timer);timer=null;}
  if(heartbeatTimer){clearInterval(heartbeatTimer);heartbeatTimer=null;}
  state('stopping',{signal});
  if(child?.pid)killTree(child.pid);
  child=null;
  release();
}
for(const signal of ['SIGINT','SIGTERM','SIGHUP'])
  process.on(signal,()=>{shutdown(signal);process.exit(0);});
process.on('exit',()=>{release();});

state('starting');
heartbeatTimer=setInterval(checkHeartbeat,10_000);
launch();
