// Windows-only adapter for the SAME Chromium OSCrypt/DPAPI profile already
// used by Electron.safeStorage. No second credential store or token migration.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomBytes,createDecipheriv,createCipheriv} from 'node:crypto';

const V10=Buffer.from('v10','ascii');
const DPAPI=Buffer.from('DPAPI','ascii');
const MAX_BLOB=65536;
function requireRoot(userRoot){
  if(typeof userRoot!=='string'||!path.isAbsolute(userRoot))
    throw Error('forge_windows_oscrypt_user_root_required');
  return path.resolve(userRoot);
}
function decryptProfileKey(userRoot){
  // The key remains Windows-user-bound in Chromium Local State, just as in
  // Electron. The child process returns ONLY the 32-byte profile key over a
  // private inherited pipe. Neither bearer nor refresh token is passed to it.
  // No shell interpolation, env or argv ever contains a credential.
  const localState=path.join(userRoot,'Local State');
  const script=[
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.Security",
    "$state=Get-Content -LiteralPath '"+localState.replace(/'/g,"''")+"' -Raw -Encoding UTF8 | ConvertFrom-Json",
    "$enc=[Convert]::FromBase64String($state.os_crypt.encrypted_key)",
    "if($enc.Length -lt 6 -or [Text.Encoding]::ASCII.GetString($enc,0,5) -ne 'DPAPI'){throw 'invalid_profile_key'}",
    "$inputKey=New-Object byte[] ($enc.Length-5)",
    "[Array]::Copy($enc,5,$inputKey,0,$inputKey.Length)",
    "$key=[System.Security.Cryptography.ProtectedData]::Unprotect($inputKey,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "if($key.Length -ne 32){throw 'invalid_key_size'}",
    "[Console]::Out.Write([Convert]::ToBase64String($key))",
    "[Array]::Clear($key,0,$key.Length)",
    "[Array]::Clear($inputKey,0,$inputKey.Length)"
  ].join(';');
  const encoded=Buffer.from(script,'utf16le').toString('base64');
  const result=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive',
    '-EncodedCommand',encoded],{windowsHide:true,encoding:'utf8',timeout:10000,
    maxBuffer:2048,stdio:['ignore','pipe','pipe']});
  if(result.status!==0||result.error)
    throw Error('forge_windows_oscrypt_dpapi_unavailable');
  const output=String(result.stdout||'').trim();
  if(!/^[A-Za-z0-9+/]{43}=$/.test(output))
    throw Error('forge_windows_oscrypt_profile_key_invalid');
  const key=Buffer.from(output,'base64');
  if(key.length!==32)throw Error('forge_windows_oscrypt_profile_key_invalid');
  return key;
}

/**
 * Compatible with Electron.safeStorage on Windows for AES-GCM v10 ciphertexts.
 * Uses the EXISTING Local State and existing forge-product-session.enc, without
 * writing any other token location or exposing the key to callers.
 */
export function createForgeWindowsSafeStorage({userRoot,platform=process.platform,
  unwrapProfileKey=null}={}){
  const root=requireRoot(userRoot);
  let profileKey=null;
  const key=()=>{
    if(platform!=='win32')throw Error('forge_windows_oscrypt_platform_required');
    if(!profileKey){
      const value=unwrapProfileKey===null?decryptProfileKey(root):unwrapProfileKey(root);
      if(!Buffer.isBuffer(value)||value.length!==32)
        throw Error('forge_windows_oscrypt_profile_key_invalid');
      profileKey=Buffer.from(value);
    }
    return profileKey;
  };
  const valid=value=>Buffer.isBuffer(value)&&value.length>=V10.length+12+16&&
    value.length<=MAX_BLOB&&value.subarray(0,3).equals(V10);
  return Object.freeze({
    isEncryptionAvailable(){
      try{key();return true;}catch{return false;}
    },
    encryptString(value){
      if(typeof value!=='string'||Buffer.byteLength(value,'utf8')>MAX_BLOB-32)
        throw Error('forge_windows_oscrypt_plaintext_invalid');
      const nonce=randomBytes(12);
      const cipher=createCipheriv('aes-256-gcm',key(),nonce);
      const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
      return Buffer.concat([V10,nonce,ciphertext,cipher.getAuthTag()]);
    },
    decryptString(value){
      if(!valid(value))throw Error('forge_windows_oscrypt_ciphertext_invalid');
      const nonce=value.subarray(3,15),authTag=value.subarray(value.length-16);
      const ciphertext=value.subarray(15,value.length-16);
      const cipher=createDecipheriv('aes-256-gcm',key(),nonce);
      cipher.setAuthTag(authTag);
      try{return Buffer.concat([cipher.update(ciphertext),cipher.final()]).toString('utf8');}
      catch{throw Error('forge_windows_oscrypt_authentication_failed');}
    }
  });
}
