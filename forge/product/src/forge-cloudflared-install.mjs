import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {forgeCloudflaredExecutable,FORGE_CLOUDFLARED_VERSION,
  FORGE_CLOUDFLARED_SHA256} from './forge-cloudflare-tunnel.mjs';

export const FORGE_CLOUDFLARED_URL='https://github.com/cloudflare/cloudflared/releases/download/'+
  FORGE_CLOUDFLARED_VERSION+'/cloudflared-windows-amd64.exe';
const MAX_DOWNLOAD=65*1024*1024;
export async function downloadForgeCloudflared(destination,{request=fetch}={}){
  let response;
  try{response=await request(FORGE_CLOUDFLARED_URL,{
    redirect:'follow',signal:AbortSignal.timeout(120_000)
  });}
  catch{throw Error('forge_cloudflared_download_unavailable');}
  let final;
  try{final=new URL(response.url);}catch{throw Error('forge_cloudflared_download_source_rejected');}
  if(response.status!==200||final.protocol!=='https:'||
     !['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(final.hostname)||
     !response.body)throw Error('forge_cloudflared_download_source_rejected');
  const chunks=[];let length=0;
  try{
    for await(const chunk of response.body){
      const bytes=Buffer.from(chunk);
      length+=bytes.length;
      if(length>MAX_DOWNLOAD)throw Error('forge_cloudflared_download_too_large');
      chunks.push(bytes);
    }
  }catch(error){
    if(error?.message==='forge_cloudflared_download_too_large')throw error;
    throw Error('forge_cloudflared_download_incomplete');
  }
  if(length<1)throw Error('forge_cloudflared_download_incomplete');
  fs.writeFileSync(destination,Buffer.concat(chunks),{flag:'wx',mode:0o600});
}
export async function installPinnedForgeCloudflared({
  target,download=downloadForgeCloudflared,expectedSha=FORGE_CLOUDFLARED_SHA256
}={}){
  if(typeof target!=='string'||!path.isAbsolute(target))
    throw Error('forge_cloudflared_install_target_invalid');
  const parent=path.dirname(path.dirname(target));
  if(fs.existsSync(target))throw Error('forge_cloudflared_existing_binary_requires_review');
  fs.mkdirSync(parent,{recursive:true});
  const scratch=fs.mkdtempSync(path.join(parent,'.forge-cloudflared-'));
  try{
    const candidate=path.join(scratch,'cloudflared.exe');
    await download(candidate);
    const info=fs.lstatSync(candidate);
    if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_DOWNLOAD||
       createHash('sha256').update(fs.readFileSync(candidate)).digest('hex')!==expectedSha)
      throw Error('forge_cloudflared_official_sha256_invalid');
    const destination=path.dirname(target);
    if(fs.existsSync(destination))throw Error('forge_cloudflared_destination_requires_review');
    fs.mkdirSync(destination);
    fs.renameSync(candidate,target);
    return {installed:true,version:FORGE_CLOUDFLARED_VERSION,verified:true};
  }finally{fs.rmSync(scratch,{recursive:true,force:true});}
}
export async function installForgeCloudflared({
  ownerApproved=false,platform=process.platform,arch=process.arch,
  localAppData=process.env.LOCALAPPDATA
}={}){
  if(!ownerApproved)throw Error('forge_cloudflare_owner_approval_required');
  if(platform!=='win32'||arch!=='x64')
    throw Error('forge_cloudflare_windows_x64_required');
  const target=forgeCloudflaredExecutable(localAppData);
  if(fs.existsSync(target)){
    const sha=createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    if(sha!==FORGE_CLOUDFLARED_SHA256)
      throw Error('forge_cloudflared_official_sha256_invalid');
    return {installed:true,version:FORGE_CLOUDFLARED_VERSION,verified:true,
      alreadyInstalled:true};
  }
  return {...await installPinnedForgeCloudflared({target}),alreadyInstalled:false};
}
