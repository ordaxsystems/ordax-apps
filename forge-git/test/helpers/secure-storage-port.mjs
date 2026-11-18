// Test-only cryptographic stand-in for Electron.safeStorage on non-Windows CI.
// Production always uses Electron.safeStorage/Windows DPAPI, never this port.
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';

export function createTestSecureStoragePort(){
  const key=randomBytes(32);
  return {
    isEncryptionAvailable:()=>true,
    encryptString(value){
      const iv=randomBytes(12);
      const cipher=createCipheriv('aes-256-gcm',key,iv);
      const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
      return Buffer.concat([iv,cipher.getAuthTag(),encrypted]);
    },
    decryptString(buffer){
      const iv=buffer.subarray(0,12),tag=buffer.subarray(12,28),bytes=buffer.subarray(28);
      const decipher=createDecipheriv('aes-256-gcm',key,iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(bytes),decipher.final()]).toString('utf8');
    }
  };
}
