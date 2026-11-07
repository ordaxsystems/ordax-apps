import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// Published OpenAI tunnel-client v0.0.20 Windows/amd64 executable, extracted
// ONLY from the verified release ZIP (SHA-256: 99474aaa62ece303d7b661f2f46f932dcd560b489b540f817355da25be71bcf3).
export const FORGE_TUNNEL_VERSION='v0.0.20';
export const FORGE_TUNNEL_EXE_SHA256='92812d43cbbf030f2bee30d9ad1bef26884dcf12d2ccaefc60c40fa8122501db';
const NOT_CONNECTED='forge_gpt_web_not_connected';

function publicStatus(installed,reason){
  return Object.freeze({
    installed,clientVersion:installed?FORGE_TUNNEL_VERSION:null,
    origin:'openai/tunnel-client',remoteConnected:false,
    connectionVerified:false,connectionState:NOT_CONNECTED,
    workspaceEligibility:'unverified',blocker:reason
  });
}
export function officialTunnelComponentDirectory(localAppData){
  if(typeof localAppData!=='string'||!path.win32.isAbsolute(localAppData))
    throw Error('forge_tunnel_windows_profile_unavailable');
  return path.win32.join(localAppData,'OrdaX','Forge','Components','openai-tunnel',FORGE_TUNNEL_VERSION);
}
export function inspectForgeOfficialTunnelClient({
  localAppData=process.env.LOCALAPPDATA,
  platform=process.platform,arch=process.arch
}={}){
  if(platform!=='win32'||arch!=='x64')return publicStatus(false,'unsupported_windows_architecture');
  let folder;
  try{folder=officialTunnelComponentDirectory(localAppData);}
  catch{return publicStatus(false,'windows_profile_unavailable');}
  const exe=path.win32.join(folder,'tunnel-client.exe');
  const manifest=path.win32.join(folder,'release-info.json');
  try{
    if(!fs.lstatSync(exe).isFile()||fs.lstatSync(exe).isSymbolicLink())
      return publicStatus(false,'client_file_not_trusted');
    const record=JSON.parse(fs.readFileSync(manifest,'utf8'));
    if(record?.tag!==FORGE_TUNNEL_VERSION||
       record?.executableSha256!==FORGE_TUNNEL_EXE_SHA256||
       record?.verified!==true||
       record?.source!=='openai/tunnel-client official GitHub release')
      return publicStatus(false,'client_release_unverified');
    const sha=createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
    if(sha!==FORGE_TUNNEL_EXE_SHA256)
      return publicStatus(false,'client_hash_invalid');
    return publicStatus(true,'platform_tunnel_and_chatgpt_workspace_authorization_required');
  }catch{return publicStatus(false,'official_client_not_installed');}
}
