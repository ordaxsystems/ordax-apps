import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import providerDomSelectors from '../src/provider-dom-selectors.cjs';

const {providerMessageSelectors,queryProviderMessageNodes,readProviderHistoricalUserText,providerMessageQueryBootstrap}=providerDomSelectors;

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

test('physical ChatGPT bubble extracts authored user content only, not copy-button UI',()=>{
  const original=['OrdaX USB Dev','  deadline: 30000'].join(String.fromCharCode(10));
  const authored={innerText:original};
  const button={innerText:'Copiar codigo'};
  const bubble={
    innerText:original+String.fromCharCode(10)+button.innerText,
    matches:s=>s.includes('data-user-message-bubble'),
    querySelectorAll:s=>s==='.whitespace-pre-wrap'?[authored]:[]
  };
  const extraction=readProviderHistoricalUserText(bubble);
  assert.deepEqual(extraction,{text:original,complete:true});
  assert.notEqual(extraction.text,bubble.innerText);
  const browser=new Function(providerMessageQueryBootstrap+'return readProviderHistoricalUserText;')();
  assert.deepEqual(browser(bubble),extraction);
});

test('W3 user attribution fails closed if ChatGPT markup has no unique authored content',()=>{
  const mock=matches=>({
    innerText:'User text with controls',
    matches:()=>true,
    querySelectorAll:()=>matches
  });
  assert.deepEqual(readProviderHistoricalUserText(mock([])),{text:'',complete:false});
  assert.deepEqual(readProviderHistoricalUserText(mock([{innerText:'first'},{innerText:'second'}])),{text:'',complete:false});
  assert.deepEqual(readProviderHistoricalUserText(null),{text:'',complete:false});
  assert.deepEqual(readProviderHistoricalUserText({matches:()=>false,querySelector:()=>null}),{text:'',complete:false});
});

test('historical CDP reader rejects incomplete user markup rather than trimming or guessing text',()=>{
  const here=path.dirname(fileURLToPath(import.meta.url));
  const worker=fs.readFileSync(path.resolve(here,'../desktop/embedded-worker.mjs'),'utf8');
  const section=worker.split('  async #readHistoricalThreadDOM() {')[1].split('  async inspectConversationReadOnly(')[0];
  assert.ok(section.includes('readProviderHistoricalUserText(node)'));
  assert.ok(section.includes('user.complete!==true'));
  assert.match(section,/textTruncated:/);
  assert.equal(section.includes(".replace('Copiar'"),false);
});
