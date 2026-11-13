import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  inspectForgeOfficialTunnelClient,officialTunnelComponentDirectory,
  FORGE_TUNNEL_VERSION,FORGE_TUNNEL_EXE_SHA256
} from './forge-mcp-tunnel-readiness.mjs';

// Pinned upstream release; no separate downloader service, user-supplied URLs,
// silent installation, credentials or executable execution during installation.
export const FORGE_TUNNEL_ZIP_NAME='tunnel-client-'+FORGE_TUNNEL_VERSION+'-windows-amd64.zip';
export const FORGE_TUNNEL_ZIP_URL='https://github.com/openai/tunnel-client/releases/download/'+
  FORGE_TUNNEL_VERSION+'/'+FORGE_TUNNEL_ZIP_NAME;
export const FORGE_TUNNEL_ZIP_SHA256='99474aaa62ece303d7b661f2f46f932dcd560b489b540f817355da25be71bcf3';
const MAX_ZIP_BYTES=40*1024*1024;
const runFile=promisify(execFile);
const digest=data=>createHash('sha256').update(data).digest('hex');

export async function downloadForgeOfficialTunnelArchive(url,destination,{
  request=fetch
}={}){
  if(url!==FORGE_TUNNEL_ZIP_URL)throw Error('forge_tunnel_download_source_invalid');
  let response;
  try{
    response=await request(url,{redirect:'follow',signal:AbortSignal.timeout(120000)});
  }catch{throw Error('forge_tunnel_download_unavailable');}
  let source;
  try{source=new URL(response.url);}catch{throw Error('forge_tunnel_download_source_unverified');}
  if(response.status!==200||source.protocol!=='https:'||
    !['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(source.hostname)||
    !response.body)throw Error('forge_tunnel_download_source_unverified');
  let length=0;
  const chunks=[];
  try{
    for await(const chunk of response.body){
      const part=Buffer.from(chunk);
      length+=part.length;
      if(length>MAX_ZIP_BYTES)throw Error('forge_tunnel_download_too_large');
      chunks.push(part);
    }
  }catch(error){
    if(error?.message==='forge_tunnel_download_too_large')throw error;
    throw Error('forge_tunnel_download_incomplete');
  }
  if(length===0)throw Error('forge_tunnel_download_incomplete');
  fs.writeFileSync(destination,Buffer.concat(chunks),{flag:'wx',mode:0o600});
}

// Windows ships Expand-Archive. Only a byte-verified official archive reaches
// this function. The paths are generated in an Owner-local private directory.
export async function extractForgeOfficialTunnelArchive(archive,destination,{
  execute=runFile
}={}){
  const quote=value=>String(value).replaceAll("'","''");
  const script="$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath '"+
    quote(archive)+"' -DestinationPath '"+quote(destination)+"' -Force";
  try{
    await execute('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{
      windowsHide:true,timeout:120000,maxBuffer:1024*1024
    });
  }catch{throw Error('forge_tunnel_extract_failed');}
}

function locateOfficialClientFolder(root){
  const matches=[];
  function walk(folder,depth){
    if(depth>2)return;
    for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
      const candidate=path.join(folder,entry.name);
      if(entry.isSymbolicLink())throw Error('forge_tunnel_archive_untrusted');
      if(entry.isDirectory()){walk(candidate,depth+1);continue;}
      if(entry.name.toLowerCase()==='tunnel-client.exe'&&entry.isFile())
        matches.push(folder);
    }
  }
  walk(root,0);
  if(matches.length!==1)throw Error('forge_tunnel_archive_layout_invalid');
  return matches[0];
}

// Testable, transaction-like local installation. A failed candidate is
// discarded; an existing installation is NEVER overwritten or downgraded.
export async function installPinnedForgeTunnelArchive({
  targetDirectory,download=downloadForgeOfficialTunnelArchive,
  extract=extractForgeOfficialTunnelArchive,
  expectedZipSha256=FORGE_TUNNEL_ZIP_SHA256,
  expectedExeSha256=FORGE_TUNNEL_EXE_SHA256
}={}){
  if(typeof targetDirectory!=='string'||!path.isAbsolute(targetDirectory))
    throw Error('forge_tunnel_install_directory_invalid');
  if(fs.existsSync(targetDirectory))
    throw Error('forge_tunnel_existing_install_requires_review');
  const parent=path.dirname(targetDirectory);
  fs.mkdirSync(parent,{recursive:true});
  const scratch=fs.mkdtempSync(path.join(parent,'.forge-tunnel-install-'));
  const archive=path.join(scratch,'release.zip');
  const unpacked=path.join(scratch,'unpacked');
  fs.mkdirSync(unpacked);
  try{
    await download(FORGE_TUNNEL_ZIP_URL,archive);
    const stat=fs.lstatSync(archive);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_ZIP_BYTES||
       digest(fs.readFileSync(archive))!==expectedZipSha256)
      throw Error('forge_tunnel_archive_sha256_invalid');
    await extract(archive,unpacked);
    const folder=locateOfficialClientFolder(unpacked);
    const executable=path.join(folder,'tunnel-client.exe');
    const info=fs.lstatSync(executable);
    if(!info.isFile()||info.isSymbolicLink()||
       digest(fs.readFileSync(executable))!==expectedExeSha256)
      throw Error('forge_tunnel_executable_sha256_invalid');
    fs.writeFileSync(path.join(folder,'release-info.json'),JSON.stringify({
      tag:FORGE_TUNNEL_VERSION,source:'openai/tunnel-client official GitHub release',
      verified:true,archiveSha256:expectedZipSha256,executableSha256:expectedExeSha256
    },null,2)+'\n',{flag:'wx'});
    fs.renameSync(folder,targetDirectory);
    return Object.freeze({installed:true,clientVersion:FORGE_TUNNEL_VERSION,
      verified:true,alreadyInstalled:false});
  }finally{
    fs.rmSync(scratch,{recursive:true,force:true});
  }
}

export async function installForgeOfficialTunnelClient({
  ownerApproved=false,platform=process.platform,arch=process.arch,
  localAppData=process.env.LOCALAPPDATA
}={}){
  if(!ownerApproved)throw Error('forge_tunnel_owner_approval_required');
  if(platform!=='win32'||arch!=='x64')
    throw Error('forge_tunnel_windows_x64_required');
  const targetDirectory=officialTunnelComponentDirectory(localAppData);
  const existing=inspectForgeOfficialTunnelClient({platform,arch,localAppData});
  if(existing.installed)return Object.freeze({
    installed:true,clientVersion:FORGE_TUNNEL_VERSION,verified:true,alreadyInstalled:true
  });
  await installPinnedForgeTunnelArchive({targetDirectory});
  const check=inspectForgeOfficialTunnelClient({platform,arch,localAppData});
  if(!check.installed)throw Error('forge_tunnel_install_readback_failed');
  return Object.freeze({
    installed:true,clientVersion:FORGE_TUNNEL_VERSION,verified:true,alreadyInstalled:false
  });
}
