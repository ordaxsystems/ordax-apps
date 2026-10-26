import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {evaluateProviderReadOnlyDom} from '../src/provider-readonly-cdp-evaluator.mjs';

function fakeDebugger({preAttached=false,reply={result:{value:{observed:true}}},
  pending=false,throwOnSend=null}={}) {
  const state={attached:preAttached,attaches:0,detaches:0,calls:[]};
  const debuggerApi={
    isAttached:()=>state.attached,
    attach(version){assert.equal(version,'1.3');state.attaches++;state.attached=true;},
    detach(){state.detaches++;state.attached=false;},
    sendCommand(method,args){
      state.calls.push({method,args});
      if(throwOnSend)throw Error(throwOnSend);
      if(pending)return new Promise(()=>{});
      return Promise.resolve(reply);
    }
  };
  return {state,debuggerApi};
}
const input=debuggerApi=>({
  debugger:debuggerApi,expression:'(() => ({safe:true}))()',
  timeoutMs:20,timeoutCode:'provider_health_observation_timeout'
});

test('canonical evaluator sends one bounded CDP read and detaches only its own debugger',async()=>{
  const a=fakeDebugger();
  assert.deepEqual(await evaluateProviderReadOnlyDom(input(a.debuggerApi)),{observed:true});
  assert.equal(a.state.attaches,1);assert.equal(a.state.detaches,1);
  assert.deepEqual(a.state.calls,[{method:'Runtime.evaluate',
    args:{expression:'(() => ({safe:true}))()',awaitPromise:false,returnByValue:true}}]);
  const owned=fakeDebugger({preAttached:true});
  await evaluateProviderReadOnlyDom(input(owned.debuggerApi));
  assert.equal(owned.state.attaches,0);
  assert.equal(owned.state.detaches,0,'Runtime Network observer must remain attached');
  assert.equal(owned.state.attached,true);
});

test('CDP exceptions cannot leak provider content or credentials',async()=>{
  const d=fakeDebugger({reply:{exceptionDetails:{text:'secret token / chat contents'}}});
  await assert.rejects(evaluateProviderReadOnlyDom(input(d.debuggerApi)),
    error=>error.message==='provider_readonly_dom_evaluation_rejected');
  assert.equal(d.state.detaches,1);
  const thrown=fakeDebugger({throwOnSend:'https://chatgpt.com/c/private?token=secret'});
  await assert.rejects(evaluateProviderReadOnlyDom(input(thrown.debuggerApi)),
    error=>error.message==='provider_readonly_dom_evaluation_rejected');
  assert.equal(thrown.state.calls.length,1);
});

test('a hung read never retries, claims success, or leaves its own debugger attached',async()=>{
  const d=fakeDebugger({pending:true});
  await assert.rejects(evaluateProviderReadOnlyDom(input(d.debuggerApi)),
    error=>error.message==='provider_health_observation_timeout');
  assert.equal(d.state.calls.length,1);
  assert.equal(d.state.detaches,1);
});

test('missing CDP value fails closed; health and W3 share no executeJavaScript alternate',async()=>{
  const d=fakeDebugger({reply:{result:{}}});
  await assert.rejects(evaluateProviderReadOnlyDom(input(d.debuggerApi)),
    error=>error.message==='provider_readonly_dom_evaluation_rejected');
  const code=await readFile(new URL('../desktop/embedded-worker.mjs',import.meta.url),'utf8');
  const health=code.split('  async health() {')[1].split('  enqueue(fn) {')[0];
  const w3=code.split('  async #readHistoricalThreadDOM() {')[1]
    .split('  // Explicit, read-only inspection')[0];
  assert.ok(health.includes('evaluateProviderReadOnlyDom({'));
  assert.ok(w3.includes('evaluateProviderReadOnlyDom({'));
  const diagnostic=code.split('  async inspectDiagnosticReadOnly() {')[1]
    .split('  async #readHistoricalThreadDOM()')[0];
  assert.ok(diagnostic.includes('evaluateProviderReadOnlyDom({'));
  assert.ok(!diagnostic.includes('webContents.executeJavaScript') && !diagnostic.includes('node.innerText'));
  assert.ok(!(health+w3).includes('webContents.executeJavaScript'));
});
