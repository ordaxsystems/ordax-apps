import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync,symlinkSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createProtectedForgeConnection} from '../protected-connection.mjs';
import {createTestSecureStoragePort} from './helpers/secure-storage-port.mjs';

const endpoint='http://127.0.0.1:25687/mcp';
const token='Q'.repeat(48);
function fixture(t,opts={}){
  const dir=mkdtempSync(path.join(os.tmpdir(),'fg-dpapi-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  return {dir,cache:createProtectedForgeConnection({
    directory:dir,secureStorage:createTestSecureStoragePort(),platform:'win32',...opts
  })};
}

test('Windows-sealed credential reconnects to same Core without plaintext or project store',t=>{
  const {dir,cache}=fixture(t);
  assert.equal(cache.exists(),false);
  assert.equal(cache.supported(),true);
  assert.deepEqual(cache.save({endpoint,token}),{
    remembered:true,protection:'windows_dpapi'
  });
  const files=readdirSync(dir);
  assert.deepEqual(files,['forge-git-mcp-connection.sealed.json'],
    'no second database or project state may be created');
  const raw=readFileSync(path.join(dir,files[0]),'utf8');
  assert.doesNotMatch(raw,/QQQQQQQQ|forge-git-project|draft|runId/);
  const restored=cache.recover();
  assert.deepEqual(restored,{endpoint,token});
  assert(Object.isFrozen(restored));
  assert.equal(cache.clear(),true);
  assert.equal(cache.recover(),null);
  assert.equal(cache.exists(),false);
  assert.equal(cache.clear(),false);
});

test('revoked, malformed, moved or forged credentials cannot silently reconnect',t=>{
  const {dir,cache}=fixture(t);
  assert.throws(()=>cache.save({endpoint:'http://evil.local:25687/mcp',token}),
    /forge_mcp_local_endpoint_invalid/);
  assert.throws(()=>cache.save({endpoint,token:'bad'}),
    /forge_mcp_local_token_invalid/);
  assert.equal(cache.exists(),false);
  cache.save({endpoint,token});
  const file=path.join(dir,'forge-git-mcp-connection.sealed.json');
  const parsed=JSON.parse(readFileSync(file,'utf8'));
  parsed.sealedBearer='A'.repeat(parsed.sealedBearer.length);
  writeFileSync(file,JSON.stringify(parsed));
  assert.throws(()=>cache.recover(),/forge_git_protected_connection_/);
  cache.clear();
  writeFileSync(file,JSON.stringify({schema:'invalid',endpoint,token}));
  assert.throws(()=>cache.recover(),/forge_git_protected_connection_file_invalid|corrupt/);
  cache.clear();
  const target=path.join(dir,'target.txt');
  writeFileSync(target,'do-not-overwrite');
  try{
    symlinkSync(target,file);
  }catch(error){
    // Standard Windows accounts can forbid creating symlinks entirely.
    // Keep the production lstat/symlink guard and exercise the path where
    // the OS permits link creation; never elevate permissions for tests.
    if(error?.code!=='EPERM')throw error;
    t.diagnostic('Windows policy does not allow creating a test symlink');
  }
  if(cache.exists()){
    assert.throws(()=>cache.recover(),/forge_git_protected_connection_file_invalid/);
    assert.throws(()=>cache.save({endpoint,token}),/forge_git_protected_connection_file_invalid/);
    cache.clear();
  }
  assert.equal(readFileSync(target,'utf8'),'do-not-overwrite');
});

test('non-Windows or unavailable secure storage fails closed, without plaintext fallback',t=>{
  const {dir,cache}=fixture(t,{platform:'linux'});
  assert.equal(cache.supported(),false);
  assert.throws(()=>cache.save({endpoint,token}),/forge_git_windows_dpapi_unavailable/);
  assert.equal(cache.recover(),null);
  assert.deepEqual(readdirSync(dir),[]);
  const unavailable=createProtectedForgeConnection({
    directory:dir,platform:'win32',secureStorage:{
      ...cryptoPort(),isEncryptionAvailable:()=>false
    }
  });
  assert.equal(unavailable.supported(),false);
  assert.throws(()=>unavailable.save({endpoint,token}),
    /forge_git_windows_dpapi_unavailable/);
});

test('Forge Git reuses the existing Core grant and native confirmation once',()=>{
  const main=readFileSync(new URL('../main.mjs',import.meta.url),'utf8');
  const renderer=readFileSync(new URL('../renderer.mjs',import.meta.url),'utf8');
  const native=readFileSync(new URL('../../forge/product/desktop/main.mjs',import.meta.url),'utf8');
  assert.match(main,/createProtectedForgeConnection/);
  assert.match(main,/protectedConnection\.recover\(\)/);
  assert.match(main,/protectedConnection\.clear\(\)/);
  assert.match(main,/void connectExistingCore\(null,\{automatic:true\}\)/);
  assert.match(main,/if\(!explicitlyDisconnected&&protectedConnection\.exists\(\)\)/);
  assert.match(renderer,/remember:\$\('core-remember'\)\.checked===true/);
  assert.doesNotMatch(renderer,/if\(!confirm\('Solicitar ao Forge Core/);
  assert.match(native,/title:'Forge Core — autorizar execução'/);
  assert.match(native,/requireFreshDraft\(\);\s*return orchestratorService\.invoke/);
});
