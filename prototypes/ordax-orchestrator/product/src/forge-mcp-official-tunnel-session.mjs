import {spawn} from 'node:child_process';
import {makeForgeOfficialTunnelLaunch} from './forge-mcp-official-tunnel.mjs';

// One optional outbound client owned by the Forge process. A terminated
// process must confirm its exit before any replacement is allowed.
export function createForgeOfficialTunnelSession({
  spawnClient=spawn,launch=makeForgeOfficialTunnelLaunch
}={}){
  let child=null;
  let current=null;
  let state='stopped';
  let cancelStartup=null;
  const status=()=>Object.freeze({
    state,processRunning:state==='running'||state==='stopping',
    projectId:current?.projectId??null,tunnelId:current?.tunnelId??null,
    remoteChatGptConnected:false,chatGptCallVerified:false,autostart:false
  });
  function stop(){
    if(!child){current=null;state='stopped';return status();}
    if(state==='stopping')return status();
    state='stopping';
    if(cancelStartup){const cancel=cancelStartup;cancelStartup=null;cancel();}
    // Keep the old process registered until exit/error. A Windows kill is
    // asynchronous, and accepting another start here could duplicate a tunnel.
    try{child.kill();}catch{ /* Stay blocked until process exit. */ }
    return status();
  }
  async function start(params){
    if(child||state!=='stopped')throw Error('forge_tunnel_already_running');
    const descriptor=launch(params);
    state='starting';
    current={...descriptor.publicStatus};
    let candidate;
    try{
      candidate=spawnClient(descriptor.command,descriptor.args,{
        ...descriptor.spawnOptions,env:descriptor.env
      });
      if(!candidate||typeof candidate.once!=='function'||
          typeof candidate.kill!=='function')throw Error('forge_tunnel_process_failed');
    }catch{
      state='stopped';current=null;child=null;
      throw Error('forge_tunnel_process_unavailable');
    }
    child=candidate;
    return new Promise((resolve,reject)=>{
      let settled=false;
      const rejectOnce=reason=>{
        if(settled)return;
        settled=true;cancelStartup=null;
        reject(Error(reason));
      };
      cancelStartup=()=>rejectOnce('forge_tunnel_start_cancelled');
      candidate.once('spawn',()=>{
        if(child!==candidate||state!=='starting')
          return rejectOnce('forge_tunnel_start_cancelled');
        state='running';cancelStartup=null;
        if(!settled){settled=true;resolve(status());}
      });
      candidate.once('error',()=>{
        if(child===candidate){child=null;current=null;state='stopped';}
        rejectOnce('forge_tunnel_process_unavailable');
      });
      candidate.once('exit',()=>{
        if(child===candidate){child=null;current=null;state='stopped';}
        rejectOnce('forge_tunnel_start_exited');
      });
    });
  }
  return Object.freeze({start,stop,status});
}
