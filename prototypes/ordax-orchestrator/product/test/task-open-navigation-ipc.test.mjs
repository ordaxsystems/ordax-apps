import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {safeTaskNavigationReason} from '../src/task-navigation-status.mjs';

const main=readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
const start=main.indexOf("registerUiHandler('ordax:tasks:open'");
const end=main.indexOf("// A first-party OrdaX App action",start);
assert.ok(start>=0 && end>start,'task_open_handler_not_found');
const actualHandler=main.slice(start,end);

function mount({visible=false, showConversation=async()=>({navigated:true}), task={id:'local_1',title:'Local',chat_url:'https://chatgpt.com/c/11111111-2222-4333-8444-555555555555'}}={}) {
  let handler=null;let navigations=0;
  const context={
    chatVisible:visible,
    getTaskView:id=>id===task?.id?task:null,
    worker:{showConversation:async url=>{navigations++;return showConversation(url);}},
    safeTaskNavigationReason,
    registerUiHandler:(name,fn)=>{assert.equal(name,'ordax:tasks:open');handler=fn;}
  };
  vm.runInNewContext(actualHandler,context,{timeout:1500});
  assert.equal(typeof handler,'function');
  return {run:id=>handler({},id), navigations:()=>navigations};
}

test('W3 actual IPC loads local task without provider navigation in App mode',async()=>{
  const app=mount({visible:false,showConversation:()=>{throw Error('unexpected_navigation');}});
  const result=await app.run('local_1');
  assert.equal(result.title,'Local');
  assert.equal(app.navigations(),0);
  assert.equal(result.provider_navigation,undefined);
});

test('W3 actual IPC retains local task and classifies timeout',async()=>{
  const app=mount({visible:true,showConversation:async()=>{throw Error('provider_navigation_timeout');}});
  const result=await app.run('local_1');
  assert.equal(result.id,'local_1');
  assert.equal(result.provider_navigation,'failed');
  assert.equal(result.provider_navigation_reason,'provider_navigation_timeout');
  assert.equal(app.navigations(),1);
});

test('W3 actual IPC never returns raw exception or account data',async()=>{
  const secret='secret_token_hidden_user_account';
  const app=mount({visible:true,showConversation:async()=>{throw Error(secret);}});
  const result=await app.run('local_1');
  assert.equal(result.provider_navigation,'failed');
  assert.equal(result.provider_navigation_reason,'provider_navigation_unavailable');
  assert.equal(JSON.stringify(result).includes(secret),false);
  assert.equal('provider_navigation_error' in result,false);
});

test('W3 actual IPC preserves draft-blocked navigation state',async()=>{
  const app=mount({visible:true,showConversation:async()=>({navigated:false,reason:'visible_draft_present'})});
  const result=await app.run('local_1');
  assert.equal(result.provider_navigation,'not_navigated');
  assert.equal(result.provider_navigation_reason,'visible_draft_present');
  assert.equal(app.navigations(),1);
});

test('W3 actual IPC does not navigate missing tasks',async()=>{
  const app=mount({visible:true});
  const result=await app.run('nonexistent');
  assert.equal(result,null);
  assert.equal(app.navigations(),0);
});
