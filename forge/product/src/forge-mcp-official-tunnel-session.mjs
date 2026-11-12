import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {makeForgeOfficialTunnelLaunch} from './forge-mcp-official-tunnel.mjs';

// The official client's private ephemeral URL file is the ONLY source of its
// health port. Never guess another process's port or forward health to GPT.
export async function probeForgeTunnelReadiness({
  urlFile,readFile=fs.readFileSync,request=fetch
}={}){
  let raw;
  try{raw=readFile(urlFile,'utf8').trim();}
  catch{return 'not_observed';}
  if(typeof raw!=='string'||raw.length>512||/[\r\n]/.test(raw))
    return 'unverified';
  let url;
  try{url=new URL(raw);}catch{return 'unverified';}
  const port=Number(url.port);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||
      url.username||url.password||url.search||url.hash||
      !Number.isInteger(port)||port<1024||port>65535||
      !['/','/healthz','/readyz'].includes(url.pathname))
    return 'unverified';
  try{
    const response=await request(url.origin+'/readyz',{
      method:'GET',redirect:'error',signal:AbortSignal.timeout(4000)
    });
    if(response.status===200)return 'ready';
    if(response.status===503)return 'not_ready';
  }catch{/* Failure to inspect is never evidence of readiness. */}
  return 'unverified';
}

// One optional outbound client owned by the Forge process. Exit is required
// before replacement; readiness is independently observed, not inferred from
// successful process spawn. This is NOT proof of a ChatGPT tool call.
export function createForgeOfficialTunnelSession({
  spawnClient=spawn,launch=makeForgeOfficialTunnelLaunch,onChange=()=>{},
  readinessProbe=probeForgeTunnelReadiness,
  makeHealthDirectory=()=>fs.mkdtempSync(path.join(os.tmpdir(),'ordax-forge-tunnel-'))
}={}){
  let child=null,current=null,healthDirectory=null;
  let state='stopped',clientReadiness='not_observed',cancelStartup=null;
  const status=()=>Object.freeze({
    state,processRunning:state==='running'||state==='stopping',
    projectId:current?.projectId??null,tunnelId:current?.tunnelId??null,
    clientReady:state==='running'&&clientReadiness==='ready',
    clientReadiness:state==='running'?clientReadiness:'not_observed',
    remoteChatGptConnected:false,chatGptCallVerified:false,autostart:false
  });
  const notify=()=>{try{onChange(status());}catch{/* Optional UI. */}};
  function cleanupHealth(){
    clientReadiness='not_observed';
    if(!healthDirectory)return;
    const folder=healthDirectory;healthDirectory=null;
    try{fs.rmSync(folder,{recursive:true,force:true});}catch{/* Windows file lock. */}
  }
  async function inspectReadiness(){
    const active=child,folder=healthDirectory;
    if(state!=='running'||!active||!folder)return status();
    let observed='unverified';
    try{observed=await readinessProbe({urlFile:path.join(folder,'health.url')});}
    catch{/* Never publish exceptions or health paths to the renderer. */}
    if(child===active&&healthDirectory===folder&&state==='running'){
      if(!['ready','not_ready','not_observed','unverified'].includes(observed))
        observed='unverified';
      if(clientReadiness!==observed){clientReadiness=observed;notify();}
    }
    return status();
  }
  function stop(){
    if(!child){
      const changed=state!=='stopped'||current!==null;
      current=null;state='stopped';cleanupHealth();
      if(changed)notify();
      return status();
    }
    if(state==='stopping')return status();
    state='stopping';
    if(cancelStartup){const cancel=cancelStartup;cancelStartup=null;cancel();}
    notify();
    // Windows kill is asynchronous. Keep this child registered until exit.
    try{child.kill();}catch{/* Do not allow a duplicate yet. */}
    return status();
  }
  async function start(params){
    if(child||state!=='stopped')throw Error('forge_tunnel_already_running');
    let descriptor,folder;
    try{
      folder=makeHealthDirectory();
      descriptor=launch({...params,healthUrlFile:path.join(folder,'health.url')});
    }catch(error){
      if(folder)try{fs.rmSync(folder,{recursive:true,force:true});}catch{}
      throw error;
    }
    healthDirectory=folder;
    clientReadiness='not_observed';
    state='starting';
    current={...descriptor.publicStatus};
    notify();
    let candidate;
    try{
      candidate=spawnClient(descriptor.command,descriptor.args,{
        ...descriptor.spawnOptions,env:descriptor.env
      });
      if(!candidate||typeof candidate.once!=='function'||
          typeof candidate.kill!=='function')throw Error('forge_tunnel_process_failed');
    }catch{
      state='stopped';current=null;child=null;cleanupHealth();notify();
      throw Error('forge_tunnel_process_unavailable');
    }
    child=candidate;
    return new Promise((resolve,reject)=>{
      let settled=false;
      const rejectOnce=reason=>{
        if(settled)return;
        settled=true;cancelStartup=null;reject(Error(reason));
      };
      cancelStartup=()=>rejectOnce('forge_tunnel_start_cancelled');
      candidate.once('spawn',()=>{
        if(child!==candidate||state!=='starting')
          return rejectOnce('forge_tunnel_start_cancelled');
        state='running';cancelStartup=null;notify();
        if(!settled){settled=true;resolve(status());}
      });
      candidate.once('error',()=>{
        if(child===candidate){
          child=null;current=null;state='stopped';cleanupHealth();notify();
        }
        rejectOnce('forge_tunnel_process_unavailable');
      });
      candidate.once('exit',()=>{
        if(child===candidate){
          child=null;current=null;state='stopped';cleanupHealth();notify();
        }
        rejectOnce('forge_tunnel_start_exited');
      });
    });
  }
  return Object.freeze({start,stop,status,inspectReadiness});
}
