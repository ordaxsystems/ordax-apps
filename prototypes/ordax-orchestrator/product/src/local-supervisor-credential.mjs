// Groq credential belongs to the private, staged/installed Lab userData root.
// Never return it via IPC, commit it, store it in SQLite, or echo it in logs.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isValidGroqKey} from './groq-key-contract.mjs';

export function createLocalGroqCredential({userRoot,safeStorage,fsImpl=fs,platform=process.platform}={}){
  if(typeof userRoot!=='string'||!path.isAbsolute(userRoot))throw Error('supervisor_key_root_invalid');
  const file=path.join(userRoot,'config','groq-key.enc');
  const isAvailable=()=>platform==='win32' && safeStorage?.isEncryptionAvailable?.()===true;
  function read(){
    if(!isAvailable()||!fsImpl.existsSync(file))return null;
    try{
      const value=safeStorage.decryptString(fsImpl.readFileSync(file));
      return isValidGroqKey(value)?value:null;
    }catch{return null;}
  }
  function save(value){
    if(!isAvailable())throw Error('supervisor_secure_storage_unavailable');
    if(!isValidGroqKey(value))throw Error('supervisor_key_invalid_format');
    const dir=path.dirname(file);
    const tmp=file+'.'+randomUUID()+'.tmp';
    try{
      fsImpl.mkdirSync(dir,{recursive:true});
      const encrypted=safeStorage.encryptString(value);
      if(!Buffer.isBuffer(encrypted)||!encrypted.length)throw Error('encryption_failed');
      fsImpl.writeFileSync(tmp,encrypted,{flag:'wx',mode:0o600});
      fsImpl.renameSync(tmp,file);
    }catch{
      try{fsImpl.rmSync(tmp,{force:true})}catch{}
      throw Error('supervisor_key_store_failed');
    }
    return {saved:true};
  }
  function remove(){
    try{fsImpl.rmSync(file,{force:true});return {saved:false}}
    catch{throw Error('supervisor_key_remove_failed')}
  }
  return Object.freeze({isAvailable,hasSaved:()=>read()!==null,read,save,remove});
}
