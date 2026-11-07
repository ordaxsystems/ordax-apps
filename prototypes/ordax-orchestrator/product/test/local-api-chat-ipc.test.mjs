import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
function fixture(env='0'){
  let key=null;
  const handlers=new Map(),trusted={};
  const context={
    worker:null, // Simulate the optional real GPT Web executor without browser automation.
    process:{env:{ORDAX_LAB_SUPERVISOR_ENABLE:env}},
    currentGroqKey:()=>key,
    requireTrustedSupervisorRenderer:event=>{if(event!==trusted)throw Error('denied');},
    registerUiHandler:(name,fn)=>handlers.set(name,fn)
  };
  const state=source.slice(source.indexOf('const coordinatorChatEnabled='),source.indexOf('function requireLabSupervisor()'));
  const ipc=source.slice(source.indexOf("registerUiHandler('ordax:orchestrator:chat-status'"),
    source.indexOf("registerUiHandler('ordax:supervisor:status'"));
  vm.runInNewContext(state+'\n'+ipc,context);
  return {trusted,setKey:value=>key=value,setWebWorker:present=>{context.worker=present?{}:null;},
    status:(event=trusted)=>handlers.get('ordax:orchestrator:chat-status')(event),
    hasEnableHandler:handlers.has('ordax:orchestrator:chat-enable')};
}
test('GPT-first chat readiness is independent from the optional Groq advisory credential',()=>{
  const f=fixture();assert.equal(f.status().enabled,false);
  assert.equal(f.status().provider,'chatgpt_web');
  assert.equal(f.hasEnableHandler,false);
  f.setKey('gsk_'+'x'.repeat(40));
  assert.equal(f.status().groqConfigured,true);
  assert.equal(f.status().enabled,false,'a Groq key does not create a GPT Web worker');
  f.setWebWorker(true);
  assert.equal(f.status().enabled,true);
  assert.equal(f.status().configured,true);
  assert.throws(()=>f.status({}),/denied/);
  assert.equal(JSON.stringify(f.status()).includes('gsk_'),false);
  f.setKey(null);
  assert.equal(f.status().groqConfigured,false);
  assert.equal(f.status().enabled,true,'no Groq key is needed for GPT-first');
  f.setWebWorker(false);assert.equal(f.status().enabled,false);
});
test('the Dev supervisor flag cannot invent a GPT worker or Groq credential',()=>{
  const f=fixture('1');assert.equal(f.status().enabled,false);
  assert.equal(f.status().groqConfigured,false);
  f.setKey('gsk_'+'x'.repeat(40));
  assert.equal(f.status().groqConfigured,true);
  assert.equal(f.status().enabled,false);
  f.setWebWorker(true);assert.equal(f.status().enabled,true);
  f.setKey(null);assert.equal(f.status().enabled,true);
  f.setWebWorker(false);assert.equal(f.status().enabled,false);
});
