import {spawn} from 'node:child_process';
import {makeForgeOfficialTunnelLaunch} from './forge-mcp-official-tunnel.mjs';

// One optional outbound connector process owned by the existing Forge app.
// Never exposes secrets in status, exceptions, argv or logs. No auto-start.
export function createForgeOfficialTunnelSession({
  spawnClient=spawn,launch=makeForgeOfficialTunnelLaunch
}={}){
  let child=null;
  let current=null;
  let state='stopped';
  const status=()=>Object.freeze({
    state,processRunning:state==='running',projectId:current?.projectId??null,
    tunnelId:current?.tunnelId??null,remoteChatGptConnected:false,
    chatGptCallVerified:false,autostart:false
  });
  function stop(){
    const prior=child;
    child=null;
    current=null;
    state='stopped';
    if(prior){
      try{prior.kill();}catch{}
    }
    return status();
  }
  async function start(params){
    if(child||state==='starting')throw Error('forge_tunnel_already_running');
    const descriptor=launch(params); // validates owner consent and exact scope
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
    const outcome=await new Promise((resolve,reject)=>{
      candidate.once('spawn',()=>{
        if(child!==candidate)return reject(Error('forge_tunnel_start_cancelled'));
        state='running';
        resolve(status());
      });
      candidate.once('error',()=>{
        if(child===candidate){child=null;current=null;state='stopped';}
        reject(Error('forge_tunnel_process_unavailable'));
      });
      candidate.once('exit',()=>{
        if(child===candidate){child=null;current=null;state='stopped';}
      });
    });
    return outcome;
  }
  return Object.freeze({start,stop,status});
}
