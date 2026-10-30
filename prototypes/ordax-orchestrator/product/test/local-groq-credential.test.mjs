import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostGroqCredential} from '../host/local-groq-credential.mjs';

const hostId='urn:uuid:11111111-2222-4333-8444-555555555555';
function vault(){
  const values=new Map();
  return {values,
    async getPassword(service,account){return values.get(`${service}:${account}`)??null;},
    async setPassword(service,account,value){values.set(`${service}:${account}`,value);},
    async deletePassword(service,account){return values.delete(`${service}:${account}`);}
  };
}

test('Groq key is namespaced to the Host identity and remains available to a new process instance',async()=>{
  const osVault=vault();
  const key='gsk_'+('a'.repeat(40));
  const first=createHostGroqCredential({hostId,credentialStore:osVault});
  assert.equal(first.secureStorageAvailable(),true);
  assert.equal(await first.read(),null);
  assert.deepEqual(await first.save(` ${key} `),{saved:true,persistence:'os_credential_vault'});
  assert.deepEqual([...osVault.values.keys()],['br.com.ordax.orchestrator.groq-api:host:'+hostId]);

  const reopened=createHostGroqCredential({hostId,credentialStore:osVault});
  assert.equal(await reopened.read(),key);
  assert.deepEqual(await reopened.remove(),{saved:false,persistence:'os_credential_vault'});
  assert.equal(await reopened.read(),null);
});

test('Host refuses API-key persistence when the OS credential vault is unavailable',async()=>{
  const credential=createHostGroqCredential({hostId,credentialStore:null});
  assert.equal(credential.secureStorageAvailable(),false);
  assert.equal(await credential.read(),null);
  await assert.rejects(credential.save('gsk_'+('b'.repeat(40))),/supervisor_secure_storage_unavailable/);
  await assert.rejects(credential.remove(),/supervisor_secure_storage_unavailable/);
});

test('Host rejects malformed values and sanitizes OS vault failures',async()=>{
  const credential=createHostGroqCredential({hostId,credentialStore:{
    async getPassword(){throw Error('private OS vault details');},
    async setPassword(){throw Error('private OS vault details');},
    async deletePassword(){throw Error('private OS vault details');}
  }});
  await assert.rejects(credential.save('not-a-groq-key'),/supervisor_key_invalid_format/);
  await assert.rejects(credential.save('gsk_'+('c'.repeat(40))),/supervisor_key_store_failed/);
  await assert.rejects(credential.read(),/supervisor_secure_storage_unavailable/);
  await assert.rejects(credential.remove(),/supervisor_key_remove_failed/);
});
