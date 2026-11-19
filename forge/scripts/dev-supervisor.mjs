import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  nextSupervisorFailureCount,supervisorRestartDelayMs,forgeDevHeartbeatStale
} from '../lib/dev-supervisor-policy.mjs';
import {
  forgeDevSupervisorPaths,readLiveForgeDevSupervisorLock
} from '../lib/dev-supervisor-lifecycle.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const supervisorArgs=process.argv.slice(2);
const backgroundStart=supervisorArgs.includes('--background-start');
const packageIndex=supervisorArgs.indexOf('--core-executable');
if(supervisorArgs.filter(arg=>arg==='--background-start').length>1||
  supervisorArgs.filter(arg=>arg==='--core-executable').length>1||
  (packageIndex!==-1&&(packageIndex+1>=supervisorArgs.length||
  supervisorArgs[packageIndex+1].startsWith('--')))||
  supervisorArgs.length!==(backgroundStart?1:0)+(packageIndex!==-1?2:0))
  throw Error('forge_dev_supervisor_arguments_invalid');
const packagedCore=packageIndex===-1?null:path.resolve(supervisorArgs[packageIndex+1]);
if(packagedCore){
  if(process.platform!=='win32')throw Error('forge_dev_packaged_windows_only');
  const base=path.resolve(process.env.LOCALAPPDATA||'', 'Programs')+path.sep;
  if(!packagedCore.toLowerCase().startsWith(base.toLowerCase())||
    path.basename(packagedCore)!=='OrdaX Forge.exe'||
    !fs.statSync(packagedCore,{throwIfNoEntry:false})?.isFile())
    throw Error('forge_dev_supervisor_core_executable_invalid');
}
const {stateDir,lockPath,statePath,heartbeatPath}=forgeDevSupervisorPaths();
const launcher=path.join(root,'scripts','start-lab.mjs');
fs.mkdirSync(stateDir,{recursive:true});

function readJson(file){
  try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}
}
function atomicJson(file,value){
  const temp=file+'.tmp-'+process.pid;
  fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{encoding:'utf8'});
  fs.renameSync(temp,file);
}
function acquire(){
  const existing=readLiveForgeDevSupervisorLock(lockPath);
  if(existing)throw Error('forge_dev_supervisor_already_running');
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
    failureCount,restartCount,updatedAt:Date.now(),
    coreMode:packagedCore?'packaged':'checkout',...extra
  });
}
function launch(){
  if(stopping)return;
  launchStartedAt=Date.now();
  hangTerminationPending=false;
  const env={...process.env,ORDAX_FORGE_DEV_AUTONOMY:'1',ORDAX_FORGE_SUPERVISOR_CHILD:'1',
    ORDAX_FORGE_SUPERVISOR_NODE:process.execPath};
  if(packagedCore){
    // A single existing supervisor manages either checkout Electron or the
    // packaged DEV Core. The canonical Store, GPT workers and heartbeat remain
    // inside the one child process; this supervisor owns NO Task scheduler.
    child=spawn(packagedCore,backgroundStart?['--ordax-background-start']:[],{
      cwd:path.dirname(packagedCore),env,stdio:'ignore',windowsHide:false
    });
  }else{
    child=spawn(process.execPath,[launcher,...(backgroundStart?['--background-start']:[])],{
      cwd:root,env,stdio:'inherit',windowsHide:false
    });
  }
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
