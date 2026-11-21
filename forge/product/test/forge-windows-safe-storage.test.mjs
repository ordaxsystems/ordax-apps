import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {createForgeWindowsSafeStorage} from '../src/forge-windows-safe-storage.mjs';
import {createForgeProductSession,FORGE_NATIVE_OAUTH_CLIENT_ID}
  from '../src/forge-product-session.mjs';

const root=path.join(os.tmpdir(),'forge-oscrypt-mock');
function fixture(){
  const key=randomBytes(32);
  return createForgeWindowsSafeStorage({userRoot:root,platform:'win32',
    unwrapProfileKey:()=>key});
}
test('one Windows OSCrypt v10 facade round-trips UTF-8 and never exposes a clear token',()=>{
  const secure=fixture();
  assert.equal(secure.isEncryptionAvailable(),true);
  const plain='synthetic test only · 🔐';
  const sealed=secure.encryptString(plain);
  assert.equal(sealed.subarray(0,3).toString('utf8'),'v10');
  assert.notEqual(sealed.toString('utf8'),plain);
  assert.equal(sealed.includes(Buffer.from(plain)),false);
  assert.equal(secure.decryptString(sealed),plain);
  assert.notDeepEqual(secure.encryptString(plain),sealed,'random nonce');
});
test('OSCrypt rejects modification and ciphertext from another Windows profile',()=>{
  const first=fixture(),second=fixture();
  const sealed=first.encryptString('isolated');
  assert.throws(()=>second.decryptString(sealed),/forge_windows_oscrypt_authentication_failed/);
  const mutated=Buffer.from(sealed);mutated[19]^=0x1;
  assert.throws(()=>first.decryptString(mutated),/forge_windows_oscrypt_authentication_failed/);
  assert.throws(()=>first.decryptString(Buffer.from('plaintext')),
    /forge_windows_oscrypt_ciphertext_invalid/);
});
test('unavailable platform, invalid user path or profile key all fail closed',()=>{
  assert.throws(()=>createForgeWindowsSafeStorage({userRoot:'relative'}),
    /forge_windows_oscrypt_user_root_required/);
  const blocked=createForgeWindowsSafeStorage({userRoot:root,platform:'linux',
    unwrapProfileKey:()=>randomBytes(32)});
  assert.equal(blocked.isEncryptionAvailable(),false);
  assert.throws(()=>blocked.encryptString('secret'),/forge_windows_oscrypt_platform_required/);
  const corrupted=createForgeWindowsSafeStorage({userRoot:root,platform:'win32',
    unwrapProfileKey:()=>Buffer.from('too short')});
  assert.equal(corrupted.isEncryptionAvailable(),false);
  assert.throws(()=>corrupted.encryptString('secret'),/forge_windows_oscrypt_profile_key_invalid/);
});
test('real existing Windows Electron session can be inspected by Node read-only when explicitly requested',
  {skip:process.platform!=='win32'||process.env.ORDAX_FORGE_TEST_REAL_WIN_SESSION!=='1'},()=>{
    const root=path.join(process.env.LOCALAPPDATA||'','OrdaX','Forge');
    const secure=createForgeWindowsSafeStorage({userRoot:root});
    assert.equal(secure.isEncryptionAvailable(),true,
      'must unwrap current Windows profile key, not create another');
    const session=createForgeProductSession({userRoot:root,safeStorage:secure});
    const status=session.status();
    assert.equal(status.connected,true,'must decrypt the existing sealed session');
    assert.equal(status.clientId,FORGE_NATIVE_OAUTH_CLIENT_ID);
    assert.equal(status.mode,'oauth');
    // Never output, refresh, rewrite or serialize token values.
  }
);
