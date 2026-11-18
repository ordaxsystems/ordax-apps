// Optional reconnect-only credential cache for the existing Forge MCP grant.
// The Core's revocable owner approval and SQLite remain the sole authority.
// No project/Task/Run state and no plaintext bearer are persisted here.
import {randomUUID} from 'node:crypto';
import {
  existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync
} from 'node:fs';
import path from 'node:path';
import {validateForgeEndpoint} from './forge-core-read-client.mjs';

const SCHEMA='ordax.forge-git.protected-connection/1';
const NAME='forge-git-mcp-connection.sealed.json';
const BASE64=/^[A-Za-z0-9+/]+={0,2}$/;

export function createProtectedForgeConnection({
  directory,secureStorage,platform=process.platform
}={}){
  if(typeof directory!=='string'||!path.isAbsolute(directory)||
     !secureStorage||typeof secureStorage.isEncryptionAvailable!=='function'||
     typeof secureStorage.encryptString!=='function'||
     typeof secureStorage.decryptString!=='function')
    throw Error('forge_git_protected_connection_ports_required');
  const file=path.join(directory,NAME);
  const supported=()=>platform==='win32'&&secureStorage.isEncryptionAvailable()===true;
  const exists=()=>existsSync(file);
  function assertRegularFile(){
    if(!exists())return false;
    const stat=lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096||stat.size<50)
      throw Error('forge_git_protected_connection_file_invalid');
    return true;
  }
  function recover(){
    if(!supported()||!assertRegularFile())return null;
    let data;
    try{data=JSON.parse(readFileSync(file,'utf8'));}
    catch{throw Error('forge_git_protected_connection_corrupt');}
    if(!data||data.schema!==SCHEMA||
       Object.keys(data).sort().join(',')!=='endpoint,schema,sealedBearer'||
       typeof data.sealedBearer!=='string'||
       data.sealedBearer.length<44||data.sealedBearer.length>3000||
       !BASE64.test(data.sealedBearer)||
       Buffer.from(data.sealedBearer,'base64').toString('base64')!==data.sealedBearer)
      throw Error('forge_git_protected_connection_corrupt');
    try{
      const bearer=secureStorage.decryptString(Buffer.from(data.sealedBearer,'base64'));
      return validateForgeEndpoint(data.endpoint,bearer);
    }catch{throw Error('forge_git_protected_connection_unseal_failed');}
  }
  function save(raw){
    if(!supported())throw Error('forge_git_windows_dpapi_unavailable');
    const validated=validateForgeEndpoint(raw?.endpoint,raw?.token);
    const sealed=secureStorage.encryptString(validated.token);
    if(!Buffer.isBuffer(sealed)||sealed.length<32||
       sealed.includes(Buffer.from(validated.token)))
      throw Error('forge_git_protected_connection_seal_failed');
    const body=JSON.stringify({schema:SCHEMA,endpoint:validated.endpoint,
      sealedBearer:sealed.toString('base64')})+'\n';
    if(Buffer.byteLength(body)>4096)
      throw Error('forge_git_protected_connection_seal_failed');
    mkdirSync(directory,{recursive:true});
    // Refuse a redirected credential destination. The temporary file is
    // created exclusively and replaced atomically in the existing userData.
    if(exists())assertRegularFile();
    const temp=file+'.'+randomUUID()+'.tmp';
    try{
      writeFileSync(temp,body,{encoding:'utf8',flag:'wx',mode:0o600});
      renameSync(temp,file);
    }finally{
      if(existsSync(temp))unlinkSync(temp);
    }
    return Object.freeze({remembered:true,protection:'windows_dpapi'});
  }
  function clear(){
    if(!exists())return false;
    // unlink does not follow a symbolic link. Revocation must be possible
    // even if a cache file has become malformed.
    unlinkSync(file);
    return true;
  }
  return Object.freeze({supported,exists,recover,save,clear});
}
