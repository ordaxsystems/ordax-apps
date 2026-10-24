import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProviderAwareTaskOpener,createTaskUiHandlers} from '../src/task-ui-handlers.mjs';
import {safeTaskNavigationReason} from '../src/task-navigation-status.mjs';

const task={id:'local_1',title:'Local',chat_url:'https://chatgpt.com/c/11111111-2222-4333-8444-555555555555'};
function mount({visible=false,showConversation=async()=>({navigated:true}),currentTask=task}={}) {
  let navigations=0;
  const store={getTask:id=>id===currentTask?.id?currentTask:null,listTasks:()=>[]};
  const handlers=createTaskUiHandlers({
    store,
    onOpenTask:createProviderAwareTaskOpener({
      isChatVisible:()=>visible,
      showConversation:async url=>{navigations++;assert.equal(url,currentTask?.chat_url);return showConversation(url);},
      safeTaskNavigationReason
    })
  });
  return {run:id=>handlers.get('ordax:tasks:open')(null,id),navigations:()=>navigations};
}

test('shared task handler loads local task without provider navigation in Host mode',async()=>{
  const app=mount({visible:false,showConversation:()=>{throw Error('unexpected_navigation');}});
  assert.equal(await app.run('local_1'),task);
  assert.equal(app.navigations(),0);
});

test('shared task handler retains task and classifies provider navigation timeout',async()=>{
  const app=mount({visible:true,showConversation:async()=>{throw Error('provider_navigation_timeout');}});
  const result=await app.run('local_1');
  assert.equal(result.id,'local_1');
  assert.equal(result.provider_navigation,'failed');
  assert.equal(result.provider_navigation_reason,'provider_navigation_timeout');
  assert.equal(app.navigations(),1);
});

test('provider navigation failures never return raw exception or account data',async()=>{
  const secret='secret_token_hidden_user_account';
  const app=mount({visible:true,showConversation:async()=>{throw Error(secret);}});
  const result=await app.run('local_1');
  assert.equal(result.provider_navigation,'failed');
  assert.equal(result.provider_navigation_reason,'provider_navigation_unavailable');
  assert.equal(JSON.stringify(result).includes(secret),false);
  assert.equal('provider_navigation_error' in result,false);
});

test('provider draft blockage remains a safe non-navigation state',async()=>{
  const app=mount({visible:true,showConversation:async()=>({navigated:false,reason:'visible_draft_present'})});
  const result=await app.run('local_1');
  assert.equal(result.provider_navigation,'not_navigated');
  assert.equal(result.provider_navigation_reason,'visible_draft_present');
  assert.equal(app.navigations(),1);
});

test('missing task never navigates to a provider URL',async()=>{
  const app=mount({visible:true});
  assert.equal(await app.run('nonexistent'),null);
  assert.equal(app.navigations(),0);
});

test('Electron main composes the tested shared provider-aware opener',()=>{
  const main=readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
  assert.match(main,/import \{ createProviderAwareTaskOpener, createTaskUiHandlers \} from '\.\.\/src\/task-ui-handlers\.mjs'/);
  assert.match(main,/onOpenTask:createProviderAwareTaskOpener\(\{[\s\S]*?safeTaskNavigationReason[\s\S]*?\}\)/);
});
