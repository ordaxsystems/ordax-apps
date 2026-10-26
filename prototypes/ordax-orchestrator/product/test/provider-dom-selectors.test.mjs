import test from 'node:test';
import assert from 'node:assert/strict';
import providerDomSelectors from '../src/provider-dom-selectors.cjs';

const {providerMessageSelectors,queryProviderMessageNodes,providerMessageQueryBootstrap}=providerDomSelectors;

test('current ChatGPT Web user bubbles and assistant Markdown use shared fallback selectors',()=>{
  const user={id:'user-bubble'},assistant={id:'assistant-markdown'};
  const root={querySelectorAll(selector){
    if(selector===providerMessageSelectors.user.semantic||selector===providerMessageSelectors.assistant.semantic)return [];
    if(selector===providerMessageSelectors.user.fallback)return [user];
    if(selector===providerMessageSelectors.assistant.fallback)return [assistant];
    return [];
  }};
  assert.deepEqual(queryProviderMessageNodes(root,'user',providerMessageSelectors),[user]);
  assert.deepEqual(queryProviderMessageNodes(root,'assistant',providerMessageSelectors),[assistant]);
});

test('semantic message attributes take precedence and do not mix fallback containers',()=>{
  const semanticUser={id:'semantic-user'},fallbackUser={id:'fallback-user'};
  const root={querySelectorAll(selector){
    if(selector===providerMessageSelectors.user.semantic)return [semanticUser];
    if(selector===providerMessageSelectors.user.fallback)return [fallbackUser];
    return [];
  }};
  assert.deepEqual(queryProviderMessageNodes(root,'user',providerMessageSelectors),[semanticUser]);
});

test('shared browser bootstrap compiles and includes the provider selectors',()=>{
  assert.match(providerMessageQueryBootstrap,/bg-user-message/);
  assert.match(providerMessageQueryBootstrap,/data-markdown-text-style/);
  assert.doesNotThrow(()=>new Function(providerMessageQueryBootstrap+'return queryProviderMessageNodes;'));
  assert.deepEqual(queryProviderMessageNodes(null,'user',providerMessageSelectors),[]);
  assert.deepEqual(queryProviderMessageNodes({querySelectorAll:()=>[]},'unknown',providerMessageSelectors),[]);
});
