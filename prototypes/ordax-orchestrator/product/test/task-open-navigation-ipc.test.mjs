import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProviderAwareTaskOpener,createTaskUiHandlers} from '../src/task-ui-handlers.mjs';
import {safeTaskNavigationReason,taskNavigationStatus} from '../src/task-navigation-status.mjs';

const task={id:'local_1',title:'Local',chat_url:'https://chatgpt.com/c/11111111-2222-4333-8444-555555555555'};
function deferred() {
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
function mount({visible=false,showConversation=async()=>({navigated:true}),currentTask=task}={}) {
  let navigations=0;
  const navigationResults=[];
  const store={getTask:id=>id===currentTask?.id?currentTask:null,listTasks:()=>[]};
  const handlers=createTaskUiHandlers({
    store,
    onOpenTask:createProviderAwareTaskOpener({
      isChatVisible:()=>visible,
      showConversation:async url=>{navigations++;assert.equal(url,currentTask?.chat_url);return showConversation(url);},
      safeTaskNavigationReason,
      onNavigationResult:result=>navigationResults.push(result)
    })
  });
  return {run:id=>handlers.get('ordax:tasks:open')(null,id),navigations:()=>navigations,navigationResults};
}

test('shared task handler loads local task without provider navigation in Host mode',async()=>{
  const app=mount({visible:false,showConversation:()=>{throw Error('unexpected_navigation');}});
  assert.equal(await app.run('local_1'),task);
  assert.equal(app.navigations(),0);
});

test('local task opens immediately while provider navigation is still pending',async()=>{
  const navigation=deferred();
  const app=mount({visible:true,showConversation:()=>navigation.promise});
  const opened=await app.run('local_1');
  assert.equal(opened.id,'local_1');
  assert.equal(opened.provider_navigation,'pending');
  assert.equal(taskNavigationStatus(opened).state,'pending');
  assert.equal(app.navigations(),1);
  navigation.resolve({navigated:true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(app.navigationResults,[{taskId:'local_1',provider_navigation:'navigated'}]);
});

test('provider navigation failure is delivered asynchronously without delaying local history',async()=>{
  const app=mount({visible:true,showConversation:async()=>{throw Error('provider_navigation_timeout');}});
  const opened=await app.run('local_1');
  assert.equal(opened.id,'local_1');
  assert.equal(opened.provider_navigation,'pending');
  for(let attempt=0;attempt<10&&!app.navigationResults.length;attempt++)
    await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(app.navigationResults,[{
    taskId:'local_1',provider_navigation:'failed',provider_navigation_reason:'provider_navigation_timeout'
  }]);
  assert.equal(taskNavigationStatus(app.navigationResults[0]).reason,'provider_navigation_timeout');
});

test('provider navigation failures never return raw exception or account data',async()=>{
  const secret='secret_token_hidden_user_account';
  const app=mount({visible:true,showConversation:async()=>{throw Error(secret);}});
  const opened=await app.run('local_1');
  for(let attempt=0;attempt<10&&!app.navigationResults.length;attempt++)
    await new Promise(resolve=>setImmediate(resolve));
  assert.equal(opened.provider_navigation,'pending');
  assert.equal(app.navigationResults[0].provider_navigation,'failed');
  assert.equal(app.navigationResults[0].provider_navigation_reason,'provider_navigation_unavailable');
  assert.equal(JSON.stringify(app.navigationResults).includes(secret),false);
});

test('provider draft blockage remains a safe non-navigation state',async()=>{
  const app=mount({visible:true,showConversation:async()=>({navigated:false,reason:'visible_draft_present'})});
  const opened=await app.run('local_1');
  for(let attempt=0;attempt<10&&!app.navigationResults.length;attempt++)
    await new Promise(resolve=>setImmediate(resolve));
  assert.equal(opened.id,'local_1');
  assert.equal(app.navigationResults[0].provider_navigation,'not_navigated');
  assert.equal(app.navigationResults[0].provider_navigation_reason,'visible_draft_present');
  assert.equal(app.navigations(),1);
});

test('rapid task selection coalesces stale provider navigation and keeps the latest selection',async()=>{
  const first={...task,id:'first',chat_url:'https://chatgpt.com/c/11111111-2222-4333-8444-555555555555'};
  const second={...task,id:'second',chat_url:'https://chatgpt.com/c/22222222-3333-4444-8555-666666666666'};
  const results=[],started=[];
  const delayed=deferred();
  const open=createProviderAwareTaskOpener({
    isChatVisible:()=>true,
    showConversation:async url=>{started.push(url);if(url===second.chat_url)return delayed.promise;return {navigated:true};},
    safeTaskNavigationReason,
    onNavigationResult:result=>results.push(result)
  });
  assert.equal(open(first).id,'first');
  assert.equal(open(second).id,'second');
  for(let attempt=0;attempt<10&&!started.length;attempt++)await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(started,[second.chat_url]);
  delayed.resolve({navigated:true});
  for(let attempt=0;attempt<10&&!results.length;attempt++)await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(results,[{taskId:'second',provider_navigation:'navigated'}]);
});

test('missing task never navigates to a provider URL',async()=>{
  const app=mount({visible:true});
  assert.equal(await app.run('nonexistent'),null);
  assert.equal(app.navigations(),0);
});

test('Electron main composes the tested safe asynchronous provider-aware opener',()=>{
  const main=readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
  const preload=readFileSync(new URL('../desktop/preload.cjs',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../desktop/ui.js',import.meta.url),'utf8');
  const bridge=readFileSync(new URL('../desktop/host-browser-bridge.js',import.meta.url),'utf8');
  const server=readFileSync(new URL('../host/host-browser-server.mjs',import.meta.url),'utf8');
  assert.match(main,/import \{ createProviderAwareTaskOpener, createTaskUiHandlers \} from '\.\.\/src\/task-ui-handlers\.mjs'/);
  assert.match(main,/onOpenTask:createProviderAwareTaskOpener\(\{[\s\S]*?onNavigationResult:result=>emitRendererEvent\('ordax:task:provider-navigation',result\)[\s\S]*?\}\)/);
  assert.match(preload,/onTaskProviderNavigation: callback => ipcRenderer\.on\('ordax:task:provider-navigation'/);
  assert.match(ui,/window\.ordax\.onTaskProviderNavigation\(payload=>/);
  assert.match(bridge,/api\.onTaskProviderNavigation=callback=>subscribe\('task-provider-navigation',callback\)/);
  assert.match(server,/task-provider-navigation/);
});
