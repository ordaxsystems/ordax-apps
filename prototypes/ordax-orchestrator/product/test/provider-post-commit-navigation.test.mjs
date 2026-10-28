import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {observePostCommitNavigation} from '../src/provider-post-commit-navigation.mjs';

const url='https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';
test('confirmed reply is not undone by a successful navigation',async()=>{
  let count=0;
  assert.deepEqual(await observePostCommitNavigation({
    worker:{showConversation:async actual=>{count++;assert.equal(actual,url);return {navigated:true};}},
    chatUrl:url
  }),{navigated:true});
  assert.equal(count,1);
});
test('visible draft refusal is reported without a second navigation or a send',async()=>{
  let count=0;
  const outcome=await observePostCommitNavigation({
    worker:{showConversation:async()=>{count++;return {navigated:false,reason:'visible_draft_present'};}},
    chatUrl:url
  });
  assert.deepEqual(outcome,{navigated:false,reason:'visible_draft_present'});
  assert.equal(count,1);
});
test('untrusted provider reason or thrown exception stays bounded and does not retry',async()=>{
  let calls=0;
  const worker={showConversation:async()=>{calls++;throw new Error('token=private key; C:/user/path');}};
  assert.deepEqual(await observePostCommitNavigation({worker,chatUrl:url}),{
    navigated:false,reason:'provider_navigation_failed'
  });
  assert.equal(calls,1);
  assert.deepEqual(await observePostCommitNavigation({
    worker:{showConversation:async()=>({navigated:false,reason:'private_provider_error'})},chatUrl:url
  }),{navigated:false,reason:'provider_navigation_not_confirmed'});
  assert.equal(JSON.stringify(await observePostCommitNavigation({worker,chatUrl:null})),
    JSON.stringify({navigated:null}));
});
test('Electron records post-commit diagnostic only after atomic observed reply commit',()=>{
  const main=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
  const commit=main.indexOf('store.commitObservedProviderReply(taskId, runId, {');
  const diagnostics=main.indexOf('const postCommitNavigation=await observePostCommitNavigation(');
  assert.ok(commit>=0&&diagnostics>commit);
  assert.match(main.slice(diagnostics,diagnostics+400),/postCommitNavigation\.navigated===false/);
  assert.doesNotMatch(main.slice(diagnostics,diagnostics+400),/sendPrompt|requestSubmit|\.reload\(/);
  assert.doesNotMatch(main,/if \(confirmedChatUrl\) await worker\.showConversation\(confirmedChatUrl\)\.catch\(\(\) => \{\}\)/);
});
