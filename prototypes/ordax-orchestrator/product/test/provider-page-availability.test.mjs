import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {classifyProviderPageAvailability} from '../src/provider-page-availability.mjs';
import {waitForHistoricalThreadDom} from '../src/provider-historical-thread-observation.mjs';
import {assertProviderSendReadiness,safeHistoricalThreadFailure} from '../src/provider-observation-policy.mjs';
import {assessHistoricalThreadPreflight} from '../src/provider-historical-thread-preflight.mjs';
import {providerComposeAvailability} from '../src/provider-compose-availability.mjs';
const url='https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';
const screenshotCopy='Não foi possível carregar esta conversa do ChatGPT\nTentar novamente\nNão foi possível carregar o histórico\nNovo chat';
const baseHealth={connected:true,health_observed:true,auth_state:'session_present',
  composer_ready:true,provider_access_problem:null,url};
test('screenshot: explicit conversation error and sidebar history outage are separate observations',()=>{
 const result=classifyProviderPageAvailability({body:screenshotCopy,messageNodes:0,composerPresent:false});
 assert.deepEqual(result,{page_state:'conversation_load_failed',history_unavailable:true});
});
test('sidebar may be unavailable while a usable conversation stays loaded',()=>{
 const status=classifyProviderPageAvailability({body:'Não foi possível carregar o histórico',
   messageNodes:3,composerPresent:true});
 assert.deepEqual(status,{page_state:'unknown',history_unavailable:true});
 assert.equal(providerComposeAvailability({...baseHealth,...status}).allowed,true);
});
test('quoted error text inside a real assistant message cannot make a loaded thread fail',()=>{
 for(const state of [{messageNodes:2,composerPresent:false},{messageNodes:0,composerPresent:true}]) {
  assert.equal(classifyProviderPageAvailability({body:screenshotCopy,...state}).page_state,'unknown');
 }
});
test('English unavailable conversation is recognized without guessing from generic error or retry button',()=>{
 for(const copy of ["Couldn't load this conversation","Unable to load the conversation",
   "Could not load this conversation"]) {
  assert.equal(classifyProviderPageAvailability({body:copy,messageNodes:0}).page_state,
    'conversation_load_failed');
 }
 for(const copy of ['Something went wrong','Try again','New chat','Please wait','403']) {
  assert.equal(classifyProviderPageAvailability({body:copy,messageNodes:0}).page_state,'unknown');
 }
});
test('provider send and renderer are both blocked before creating a Run',()=>{
 const health={...baseHealth,page_state:'conversation_load_failed'};
 assert.throws(()=>assertProviderSendReadiness(health),/chatgpt_conversation_load_failed/);
 assert.deepEqual(providerComposeAvailability(health),{allowed:false,reason:'conversation_unavailable'});
 assert.equal(providerComposeAvailability({...baseHealth,history_unavailable:true}).allowed,true);
});
test('W3 refuses navigation when page visibly failed; history sidebar alone is not blocker',()=>{
 const health={...baseHealth,page_state:'conversation_load_failed'};
 assert.deepEqual(assessHistoricalThreadPreflight({expectedUrl:url,health}),{
  allowed:false,reason:'provider_conversation_load_failed'
 });
 assert.equal(assessHistoricalThreadPreflight({expectedUrl:url,
   health:{...baseHealth,history_unavailable:true}}).allowed,true);
 assert.equal(safeHistoricalThreadFailure('provider_conversation_load_failed'),
   'provider_conversation_load_failed');
});
test('W3 read-only DOM observation terminates on explicit page failure without polling or certifying',async()=>{
 let attempts=0;
 const result=await waitForHistoricalThreadDom({expectedUrl:url,
   read:async()=>{attempts++;return {available:true,url,domReliable:false,messages:[],
     page_state:'conversation_load_failed'}},
   timeoutMs:8000,pollMs:250
 });
 assert.equal(attempts,1);
 assert.deepEqual(result,{available:false,url,reason:'provider_conversation_load_failed'});
});
test('real worker obtains only bounded diagnostic text and strips it before IPC',()=>{
 const worker=fs.readFileSync(new URL('../desktop/embedded-worker.mjs',import.meta.url),'utf8');
 const start=worker.indexOf('  async #readHistoricalThreadDOM()');
 const end=worker.indexOf('  async inspectConversationReadOnly(',start);
 const method=worker.slice(start,end);
 assert.match(method,/loadFailureText=entries\.length===0 && !hasComposer/);
 assert.match(method,/const \{loadFailureText, \.\.\.safeSnapshot\}=result\.result\.value/);
 assert.match(method,/classifyProviderPageAvailability\(/);
 assert.match(method,/return \{\.\.\.safeSnapshot,page_state:availability\.page_state\}/);
 assert.doesNotMatch(method,/sendPrompt\(|requestSubmit\(|\.reload\(/);
 const ui=fs.readFileSync(new URL('../desktop/ui.js',import.meta.url),'utf8');
 assert.match(ui,/provider_conversation_load_failed:/);
 assert.match(ui,/status\.history_unavailable === true/);
});

test('same-url provider navigation never implicitly calls loadURL on missing composer',()=>{
 const worker=fs.readFileSync(new URL('../desktop/embedded-worker.mjs',import.meta.url),'utf8');
 const start=worker.indexOf('  async #safeLoad(');
 const end=worker.indexOf('  async #assistantSnapshot()',start);
 assert.ok(start>=0&&end>start);
 const method=worker.slice(start,end);
 const reuse=method.slice(method.indexOf('if (alreadyAtTarget && !forceReload) {'),
   method.indexOf('    try {\n      await observeWithin(() => wc.loadURL(url)',method.indexOf('if (alreadyAtTarget && !forceReload) {')));
 assert.match(reuse,/await this\.health\(\)/);
 assert.match(reuse,/await this\.#waitForComposer\(\)/);
 assert.match(reuse,/chatgpt_conversation_load_failed/);
 assert.match(reuse,/\n      return;\n    }/);
 assert.doesNotMatch(reuse,/\.loadURL\(|\.reload\(/);
});
test('manual provider reload is rejected while a Run or worker is active',()=>{
 const main=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
 const start=main.indexOf("ipcMain.handle('ordax:provider:reload'");
 const end=main.indexOf("ipcMain.handle('ordax:chat:visible'",start);
 assert.ok(start>=0&&end>start);
 const route=main.slice(start,end);
 assert.match(route,/if \(liveRun \|\| worker\.active\) throw new Error\('provider_reload_during_run_blocked'\)/);
 assert.match(route,/worker\.view\.webContents\.reload\(\)/);
 assert.ok(route.indexOf('provider_reload_during_run_blocked')<route.indexOf('webContents.reload()'));
});
