import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
function fixture(env='0'){
  let key=null,notifications=0;
  const handlers=new Map(),trusted={};
  const context={process:{env:{ORDAX_LAB_SUPERVISOR_ENABLE:env}},
    currentGroqKey:()=>key,notifyOrchestratorChanged:()=>notifications++,
    requireTrustedSupervisorRenderer:event=>{if(event!==trusted)throw Error('denied');},
    registerUiHandler:(name,fn)=>handlers.set(name,fn)};
  const state=source.slice(source.indexOf('let localCoordinatorChatEnabled='),source.indexOf('function requireLabSupervisor()'));
  const ipc=source.slice(source.indexOf("registerUiHandler('ordax:orchestrator:chat-status'"),source.indexOf("registerUiHandler('ordax:supervisor:status'"));
  vm.runInNewContext(state+'\n'+ipc,context);
  return {trusted,setKey:v=>key=v,get notices(){return notifications;},
    status:()=>handlers.get('ordax:orchestrator:chat-status')(trusted),
    enable:(v,event=trusted)=>handlers.get('ordax:orchestrator:chat-enable')(event,v)};
}
test('local API chat requires a key and trusted renderer; enabling sends no request',()=>{
  const f=fixture();assert.equal(f.status().enabled,false);
  assert.throws(()=>f.enable(true),/key_missing/);
  f.setKey('fixture-secret');assert.throws(()=>f.enable(true,{}),/denied/);
  assert.throws(()=>f.enable('true'),/setting_invalid/);
  f.enable(true);assert.equal(f.status().enabled,true);assert.equal(f.notices,1);
  assert.equal(JSON.stringify(f.status()).includes('fixture-secret'),false);
  f.enable(false);assert.equal(f.status().enabled,false);
  assert.equal(fixture().status().enabled,false,'a new App process starts disabled');
});
test('local disable overrides the inherited Dev opt-in for chat only',()=>{
  const f=fixture('1');assert.equal(f.status().enabled,true);
  f.enable(false);assert.equal(f.status().enabled,false);
});
