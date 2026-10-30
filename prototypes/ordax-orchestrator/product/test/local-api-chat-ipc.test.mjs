import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
function fixture(env='0'){
  let key=null;
  const handlers=new Map(),trusted={};
  const context={
    process:{env:{ORDAX_LAB_SUPERVISOR_ENABLE:env}},
    currentGroqKey:()=>key,
    requireTrustedSupervisorRenderer:event=>{if(event!==trusted)throw Error('denied');},
    registerUiHandler:(name,fn)=>handlers.set(name,fn)
  };
  const state=source.slice(source.indexOf('const coordinatorChatEnabled='),source.indexOf('function requireLabSupervisor()'));
  const ipc=source.slice(source.indexOf("registerUiHandler('ordax:orchestrator:chat-status'"),
    source.indexOf("registerUiHandler('ordax:supervisor:status'"));
  vm.runInNewContext(state+'\n'+ipc,context);
  return {trusted,setKey:value=>key=value,
    status:(event=trusted)=>handlers.get('ordax:orchestrator:chat-status')(event),
    hasEnableHandler:handlers.has('ordax:orchestrator:chat-enable')};
}
test('Groq advisory availability follows saved credential without a volatile enable IPC',()=>{
  const f=fixture();assert.equal(f.status().enabled,false);
  assert.equal(f.hasEnableHandler,false);
  f.setKey('gsk_'+'x'.repeat(40));
  assert.equal(f.status().enabled,true);
  assert.equal(f.status().configured,true);
  assert.throws(()=>f.status({}),/denied/);
  assert.equal(JSON.stringify(f.status()).includes('gsk_'),false);
  f.setKey(null);assert.equal(f.status().enabled,false);
});
test('the Dev supervisor flag cannot invent an unconfigured Groq coordinator',()=>{
  const f=fixture('1');assert.equal(f.status().enabled,false);
  f.setKey('gsk_'+'x'.repeat(40));assert.equal(f.status().enabled,true);
  f.setKey(null);assert.equal(f.status().enabled,false);
});
