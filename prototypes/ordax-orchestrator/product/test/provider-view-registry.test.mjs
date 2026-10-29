import test from 'node:test';
import assert from 'node:assert/strict';
import {createProviderViewRegistry} from '../src/provider-view-registry.mjs';

const fixture=id=>{
  let destroyed=false;
  const webContents={id,isDestroyed:()=>destroyed};
  return {worker:{view:{webContents}},webContents,destroy:()=>{destroyed=true;}};
};

test('independent browser views retain isolated channel ownership',()=>{
  const registry=createProviderViewRegistry();
  const a=fixture(11),b=fixture(12),c=fixture(13);
  registry.register(a.worker);registry.register(b.worker);registry.register(c.worker);
  assert.equal(registry.size,3);
  assert.equal(registry.resolve(a.webContents),a.worker);
  assert.equal(registry.resolve(b.webContents),b.worker);
  assert.equal(registry.resolve(c.webContents),c.worker);
  // Forged numeric IDs cannot impersonate any other renderer.
  assert.equal(registry.resolve({id:11}),null);
  assert.equal(registry.resolve({id:12}),null);
  assert.equal(registry.resolve({id:13}),null);
  assert.equal(registry.resolve({id:14}),null);
  assert.equal(registry.resolve(null),null);
});

test('duplicate worker or WebContents ID cannot register a second owner',()=>{
  const registry=createProviderViewRegistry();
  const a=fixture(19),b=fixture(19);
  registry.register(a.worker);
  assert.throws(()=>registry.register(a.worker),/provider_view_registration_conflict/);
  assert.throws(()=>registry.register(b.worker),/provider_view_registration_conflict/);
  assert.equal(registry.size,1);
  assert.equal(registry.resolve(b.webContents),null);
  assert.equal(registry.resolve(a.webContents),a.worker);
});

test('destruction and unregister revoke channel authority without reviving old renderers',()=>{
  const registry=createProviderViewRegistry();
  const a=fixture(21);
  registry.register(a.worker);
  a.destroy();
  assert.equal(registry.resolve(a.webContents),null);
  assert.equal(registry.unregister(a.worker),true);
  assert.equal(registry.unregister(a.worker),false);
  const replacement=fixture(21);
  registry.register(replacement.worker);
  assert.equal(registry.resolve(a.webContents),null);
  assert.equal(registry.resolve(replacement.webContents),replacement.worker);
  assert.equal(registry.size,1);
});

test('invalid or destroyed view fails closed at registration',()=>{
  const registry=createProviderViewRegistry();
  for(const candidate of [null,{}, {view:{}},{view:{webContents:{id:0}}},
    {view:{webContents:{id:1.5}}},{view:{webContents:{id:'4'}}}]){
    assert.throws(()=>registry.register(candidate),/provider_view_registration_invalid/);
  }
  const destroyed=fixture(25);
  destroyed.destroy();
  assert.throws(()=>registry.register(destroyed.worker),/provider_view_registration_invalid/);
  assert.equal(registry.size,0);
});

test('registry only routes browser instances; it has no Run, Task, or send authority',()=>{
  const registry=createProviderViewRegistry();
  assert.equal('dispatch' in registry,false);
  assert.equal('send' in registry,false);
  assert.equal('startRun' in registry,false);
  assert.equal('store' in registry,false);
  assert.ok(Object.isFrozen(registry));
});