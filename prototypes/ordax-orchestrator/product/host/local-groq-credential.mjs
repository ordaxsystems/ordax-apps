import {isValidGroqKey} from '../src/groq-key-contract.mjs';

const SERVICE='br.com.ordax.orchestrator.groq-api';
const ACCOUNT_PREFIX='host:';

/**
 * Stores the Host's Groq credential in the OS credential vault already used
 * for ChatGPT Plan credentials. The key never enters SQLite, browser storage,
 * or a plaintext profile file.
 */
export function createHostGroqCredential({hostId,credentialStore}={}){
  if(typeof hostId!=='string'||!/^urn:uuid:[0-9a-f-]{36}$/i.test(hostId))
    throw Error('supervisor_key_host_invalid');
  const account=ACCOUNT_PREFIX+hostId;
  const available=()=>Boolean(credentialStore&&
    typeof credentialStore.getPassword==='function'&&
    typeof credentialStore.setPassword==='function'&&
    typeof credentialStore.deletePassword==='function');

  async function read(){
    if(!available())return null;
    let value;
    try{value=await credentialStore.getPassword(SERVICE,account);}
    catch{throw Error('supervisor_secure_storage_unavailable');}
    if(value===null)return null;
    if(typeof value!=='string'||!isValidGroqKey(value))throw Error('supervisor_saved_key_invalid');
    return value;
  }
  async function save(value){
    if(!available())throw Error('supervisor_secure_storage_unavailable');
    const key=String(value||'').trim();
    if(!isValidGroqKey(key))throw Error('supervisor_key_invalid_format');
    try{await credentialStore.setPassword(SERVICE,account,key);}
    catch{throw Error('supervisor_key_store_failed');}
    return {saved:true,persistence:'os_credential_vault'};
  }
  async function remove(){
    if(!available())throw Error('supervisor_secure_storage_unavailable');
    try{await credentialStore.deletePassword(SERVICE,account);}
    catch{throw Error('supervisor_key_remove_failed');}
    return {saved:false,persistence:'os_credential_vault'};
  }

  return Object.freeze({secureStorageAvailable:available,read,save,remove});
}
