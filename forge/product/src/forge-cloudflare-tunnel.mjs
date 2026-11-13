import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createForgeCloudflareBridge} from './forge-cloudflare-mcp-bridge.mjs';

export const FORGE_CLOUDFLARE_TUNNEL_ID='f785d1da-cca0-4f39-abd8-b51458c1ea62';
export const FORGE_CLOUDFLARED_VERSION='2026.11.0';
export const FORGE_CLOUDFLARED_SHA256='d5c1d82031da6253dcdcff64c944cd0fe063016edeb2e4fd088075fc9bd52d0a';
const SAFE_ENV=['PATH','Path','SYSTEMROOT','SystemRoot','TEMP','TMP',
  'USERPROFILE','LOCALAPPDATA','APPDATA','PROGRAMDATA','HOMEDRIVE','HOMEPATH'];
function verifyCloudflared(exe){
  if(typeof exe!=='string'||!path.win32.isAbsolute(exe)||
     path.win32.basename(exe).toLowerCase()!=='cloudflared.exe')
    throw Error('forge_cloudflared_executable_invalid');
  try{
    const info=fs.lstatSync(exe);
    if(!info.isFile()||info.isSymbolicLink())throw Error('invalid');
    if(createHash('sha256').update(fs.readFileSync(exe)).digest('hex')!==FORGE_CLOUDFLARED_SHA256)
      throw Error('invalid');
  }catch{throw Error('forge_cloudflared_official_binary_unverified');}
}
export function forgeCloudflaredExecutable(localAppData=process.env.LOCALAPPDATA){
  if(typeof localAppData!=='string'||!path.win32.isAbsolute(localAppData))
    throw Error('forge_cloudflare_profile_invalid');
  return path.win32.join(localAppData,'OrdaX','Forge','Components','cloudflared',
    FORGE_CLOUDFLARED_VERSION,'cloudflared.exe');
}
export function validateForgeCloudflareToken(token){
  if(typeof token!=='string'||token.length<60||token.length>8192||
     !/^[A-Za-z0-9_=-]+$/.test(token))
    throw Error('forge_cloudflare_tunnel_token_invalid');
  let claims;
  try{claims=JSON.parse(Buffer.from(token,'base64').toString('utf8'));}
  catch{throw Error('forge_cloudflare_tunnel_token_invalid');}
  if(claims?.t!==FORGE_CLOUDFLARE_TUNNEL_ID||
     typeof claims.a!=='string'||!claims.a||
     typeof claims.s!=='string'||!claims.s)
    throw Error('forge_cloudflare_tunnel_identity_mismatch');
  return token;
}
export function makeForgeCloudflareLaunch({
  token,executablePath,ownerApproved=false,platform=process.platform,
  inheritedEnv=process.env,verifyExecutable=verifyCloudflared
}={}){
  if(!ownerApproved)throw Error('forge_cloudflare_owner_approval_required');
  if(platform!=='win32')throw Error('forge_cloudflare_windows_only');
  validateForgeCloudflareToken(token);
  verifyExecutable(executablePath);
  const env={};
  for(const key of SAFE_ENV)
    if(typeof inheritedEnv?.[key]==='string')env[key]=inheritedEnv[key];
  env.TUNNEL_TOKEN=token;
  env.TUNNEL_MANAGEMENT_DIAGNOSTICS='false';
  return Object.freeze({command:executablePath,
    args:['tunnel','--no-autoupdate','run'],
    env,spawnOptions:{shell:false,windowsHide:true,stdio:'ignore',detached:false}});
}
export function createForgeCloudflareTunnelSession({
  spawnClient=spawn,createBridge=createForgeCloudflareBridge,
  launch=makeForgeCloudflareLaunch,onChange=()=>{},
  getLocalGrant,ownerTrusted,executablePath
}={}){
  if(typeof getLocalGrant!=='function'||typeof ownerTrusted!=='function')
    throw Error('forge_cloudflare_session_ports_required');
  let child=null,bridge=null,state='stopped',cancelStartup=null;
  const status=()=>Object.freeze({
    state,processRunning:state==='running'||state==='stopping',
    tunnelId:state==='stopped'?null:FORGE_CLOUDFLARE_TUNNEL_ID,
    hostname:'forge-mcp.ordax.com.br',remoteChatGptConnected:false,
    cloudflareConnected:false,chatGptCallVerified:false,autostart:false
  });
  const notify=()=>{try{onChange(status());}catch{}};
  async function cleanup(){
    if(bridge){const previous=bridge;bridge=null;
      try{await previous.stop();}catch{}}
  }
  function stop(){
    if(state==='stopped')return status();
    if(state!=='stopping'){state='stopping';notify();}
    if(cancelStartup){const cancel=cancelStartup;cancelStartup=null;cancel();}
    if(child){try{child.kill();}catch{}}
    else{void cleanup().then(()=>{state='stopped';notify();});}
    return status();
  }
  async function start({token,team,audience,ownerApproved=false,platform=process.platform}={}){
    if(state!=='stopped'||child)throw Error('forge_cloudflare_already_running');
    if(!ownerApproved||!ownerTrusted())throw Error('forge_cloudflare_owner_approval_required');
    const args=launch({token,executablePath,ownerApproved,platform});
    state='starting';notify();
    try{
      bridge=createBridge({getLocalGrant,ownerTrusted});
      await bridge.start({team,audience});
      if(!ownerTrusted())throw Error('forge_cloudflare_owner_consent_revoked');
    }catch(error){await cleanup();state='stopped';notify();throw error;}
    let candidate;
    try{
      candidate=spawnClient(args.command,args.args,{...args.spawnOptions,env:args.env});
      if(!candidate||typeof candidate.once!=='function'||typeof candidate.kill!=='function')
        throw Error('forge_cloudflare_process_invalid');
    }catch{
      await cleanup();state='stopped';notify();
      throw Error('forge_cloudflare_process_unavailable');
    }
    child=candidate;
    return new Promise((resolve,reject)=>{
      let settled=false;
      const fail=code=>{if(settled)return;settled=true;reject(Error(code));};
      cancelStartup=()=>fail('forge_cloudflare_start_cancelled');
      candidate.once('spawn',()=>{
        if(child!==candidate||state!=='starting')
          return fail('forge_cloudflare_start_cancelled');
        state='running';cancelStartup=null;notify();
        if(!settled){settled=true;resolve(status());}
      });
      function exit(code){
        if(child===candidate){
          child=null;void cleanup().then(()=>{state='stopped';notify();});
        }
        fail(code);
      }
      candidate.once('error',()=>exit('forge_cloudflare_process_unavailable'));
      candidate.once('exit',()=>exit('forge_cloudflare_start_exited'));
    });
  }
  return Object.freeze({start,stop,status});
}
