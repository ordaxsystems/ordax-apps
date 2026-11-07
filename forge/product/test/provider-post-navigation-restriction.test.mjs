import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyHistoricalThreadPostNavigation } from '../src/provider-historical-thread-preflight.mjs';
const url='https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';
const missing={available:false,url,reason:'thread_dom_not_ready'};
test('W3 post-navigation check reports observed backend 403 instead of generic DOM missing',()=>{
  const result=classifyHistoricalThreadPostNavigation({
    observation:missing,health:{auth_state:'unknown',composer_ready:false,
      provider_access_problem:'backend_http_403_observed',backend_api_403_count:9}
  });
  assert.equal(result.available,false);
  assert.equal(result.reason,'provider_access_restricted_observed');
  assert.equal(result.url,url);
});
test('W3 post-navigation check preserves observed 429 without retries',()=>{
  const result=classifyHistoricalThreadPostNavigation({
    observation:missing,health:{provider_access_problem:'backend_http_429_observed'}
  });
  assert.equal(result.reason,'provider_rate_limited_observed');
});
test('W3 does not infer 403 from absence of DOM, auth state or health timeout alone',()=>{
  for(const health of [undefined,null,{}, {auth_state:'unknown',composer_ready:false},
      {provider_access_problem:null},{backend_api_403_count:9}]) {
    const result=classifyHistoricalThreadPostNavigation({observation:missing,health});
    assert.deepEqual(result,missing);
  }
});
test('W3 successful or unrelated observations must not be reclassified',()=>{
  const restricted={provider_access_problem:'backend_http_403_observed'};
  for(const observation of [
    {available:true,url,domReliable:true,messages:[{role:'assistant',text:'Synthetic'}]},
    {available:false,url,reason:'provider_readonly_dom_evaluation_timeout'},
    {available:false,url,reason:'thread_navigation_changed'}
  ]) {
    assert.equal(classifyHistoricalThreadPostNavigation({observation,health:restricted}),observation);
  }
});
test('W3 actual worker postchecks once only after already authorized single navigation',()=>{
  const worker=fs.readFileSync(new URL('../desktop/embedded-worker.mjs',import.meta.url),'utf8');
  const start=worker.indexOf('  async inspectConversationReadOnly(');
  const end=worker.indexOf('  async #composerState(',start);
  assert.ok(start>=0&&end>start);
  const handler=worker.slice(start,end);
  assert.equal((handler.match(/this\.showConversation\(/g)||[]).length,1);
  assert.equal((handler.match(/waitForHistoricalThreadDom\(/g)||[]).length,1);
  assert.equal((handler.match(/const postHealth=await this\.health\(/g)||[]).length,1);
  assert.match(handler,/if\(observation\?\.reason!==['"]thread_dom_not_ready['"]\) return observation/);
  assert.match(handler,/classifyHistoricalThreadPostNavigation\(\{observation,health:postHealth\}\)/);
  assert.doesNotMatch(handler,/sendPrompt\(|requestSubmit\(|\.reload\(/);
  const ui=fs.readFileSync(new URL('../desktop/ui.js',import.meta.url),'utf8');
  assert.match(ui,/provider_access_restricted_observed:/);
  assert.match(ui,/sem nova navegação nem reenvio/);
});
