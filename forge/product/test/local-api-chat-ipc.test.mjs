import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
function fixture(){
  const handlers=new Map(),trusted={},context={
    worker:null,
    requireTrustedSupervisorRenderer:event=>{if(event!==trusted)throw Error('denied');},
    registerUiHandler:(name,fn)=>handlers.set(name,fn)
  };
  const start=source.indexOf('const coordinatorChatStatus=');
  const state=source.slice(start,source.indexOf(';',start)+1);
  const from=source.indexOf("registerUiHandler('ordax:orchestrator:chat-status'");
  const until=source.indexOf("registerUiHandler('ordax:supervisor:status'",from);
  assert.ok(start>=0&&from>=0&&until>from);
  vm.runInNewContext(state+'\n'+source.slice(from,until),context);
  return {trusted,
    setWebWorker:present=>{context.worker=present?{}:null;},
    status:(event=trusted)=>handlers.get('ordax:orchestrator:chat-status')(event),
    hasModelEnableHandler:handlers.has('ordax:orchestrator:chat-enable')
  };
}

test('GPT Web readiness is independent of removed model API credentials',()=>{
  const f=fixture();
  assert.equal(f.status().enabled,false);
  assert.equal(f.status().provider,'chatgpt_web');
  assert.equal(f.hasModelEnableHandler,false);
  assert.equal(Object.hasOwn(f.status(),'groqConfigured'),false);
  f.setWebWorker(true);
  assert.equal(f.status().enabled,true);
  assert.equal(f.status().configured,true);
  assert.equal(f.status().executionSurface,'electron');
  assert.throws(()=>f.status({}),/denied/);
  f.setWebWorker(false);
  assert.equal(f.status().enabled,false);
});

test('desktop has no external-model key or alternate coordinator execution path',()=>{
  assert.doesNotMatch(source,/currentGroqKey|testGroqApiKey|createGroqCoordinatorConversation/);
  assert.doesNotMatch(source,/ordax:supervisor:key:save|ordax:supervisor:key:test/);
  assert.match(source,/coordinator:null/);
  assert.match(source,/const mcpApp='forge-mcp'/);
});
