import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import providerDomSelectors from '../src/provider-dom-selectors.cjs';

const workerPreload = fs.readFileSync(
  fileURLToPath(new URL('../desktop/worker-preload.cjs', import.meta.url)), 'utf8'
);

function observe({ generating, previous = true, wrapped = false, expandableUser = false }) {
  const markdown = { innerText:'RESPOSTA_NOVA_PARCIAL', querySelectorAll:() => [], querySelector:() => null,
    getAttribute:() => null, hasAttribute:() => false, contains:node=>node===markdown };
  const previousNode = {
    innerText:'RESPOSTA_ANTERIOR',
    contains:node => wrapped && node === markdown,
    getAttribute:name => name === 'data-chatgpt-selection-message-id' ? 'message_previous' : null,
    querySelector:() => null, querySelectorAll:() => [],
    hasAttribute:() => false
  };
  const expandButton = { innerText:'Mostrar mais', textContent:'Mostrar mais', getAttribute:() => null };
  const userNode = {
    innerText:expandableUser ? 'Pergunta atual\n…\nMostrar mais' : 'Pergunta atual',
    querySelectorAll:selector => selector.includes('button') && expandableUser ? [expandButton] : []
  };
  const document = {
    readyState:'loading',
    querySelectorAll:selector => {
      if (selector.includes('[data-chatgpt-selection-message-id]')) return previous ? [previousNode] : [];
      if (selector.includes('[data-message-author-role="user"]')) return [userNode];
      if (selector === '[data-markdown-text-style="assistant-message"]') return [markdown];
      return [];
    },
    querySelector:selector => selector.includes('stop-button') ? (generating ? {} : null) : null
  };
  const sandbox = {
    document,
    location:{ href:'https://chatgpt.com/c/test' },
    window:{ addEventListener:() => {} },
    require:name => {
      if (name === 'electron') return { ipcRenderer:{ send() {} } };
      if (name === '../src/provider-dom-selectors.cjs') return providerDomSelectors;
      throw new Error('unexpected_dependency');
    },
    setTimeout:() => 0, clearTimeout() {},
    MutationObserver:class { observe() {} disconnect() {} },
    Date
  };
  vm.runInNewContext(workerPreload + '\n;globalThis.testSnapshot=snapshot;', sandbox);
  return sandbox.testSnapshot();
}

test('Beta uses current provisional assistant Markdown instead of an older completed message', () => {
  const state = observe({ generating:true });
  assert.equal(state.mode, 'direct');
  assert.equal(state.assistantCount, 2);
  assert.equal(state.messageId, '');
  assert.equal(state.latestUserText, 'Pergunta atual');
  assert.equal(state.text, 'RESPOSTA_NOVA_PARCIAL');
  assert.equal(state.generating, true);
  assert.equal(state.complete, false);
});

test('Beta respects the message wrapper once provisional markdown belongs to that message', () => {
  const state = observe({ generating:true, wrapped:true });
  assert.equal(state.mode, 'direct');
  assert.equal(state.assistantCount, 1);
  assert.equal(state.messageId, 'message_previous');
  assert.equal(state.text, 'RESPOSTA_ANTERIOR');
});

test('Beta never replaces completed assistant output with detached markdown outside generation', () => {
  const state = observe({ generating:false });
  assert.equal(state.messageId, 'message_previous');
  assert.equal(state.text, 'RESPOSTA_ANTERIOR');
  assert.equal(state.generating, false);
});

test('Beta observes provisional markdown even before the first final assistant wrapper exists', () => {
  const state = observe({ generating:true, previous:false });
  assert.equal(state.assistantCount, 1);
  assert.equal(state.text, 'RESPOSTA_NOVA_PARCIAL');
  assert.equal(state.messageId, '');
});

test('Beta identifies the provider expand control without changing the submitted user text', () => {
  const state = observe({ generating:false, expandableUser:true });
  assert.equal(state.latestUserText, 'Pergunta atual\n…\nMostrar mais');
  assert.equal(state.latestUserExpandControlPresent, true);
});

test('Beta observes current ChatGPT role-marked user bubbles and assistant Markdown nodes',()=>{
  const markdown={innerText:'RESPOSTA_NOVA',querySelectorAll:()=>[],querySelector:()=>null,
    getAttribute:()=>null,hasAttribute:()=>false,contains:node=>node===markdown};
  const user={innerText:'PERGUNTA_ATUAL',querySelectorAll:()=>[]};
  const document={readyState:'complete',querySelectorAll:selector=>{
    if(selector==='[data-markdown-text-style="assistant-message"]')return [markdown];
    if(selector==='[class~="bg-user-message"]')return [user];
    return [];
  },querySelector:()=>null};
  const sandbox={document,location:{href:'https://chatgpt.com/c/current'},window:{addEventListener(){}},
    require:name=>name==='electron'?{ipcRenderer:{send(){}}}:name==='../src/provider-dom-selectors.cjs'?providerDomSelectors:(()=>{throw new Error('unexpected_dependency')})(),
    setTimeout:()=>0,clearTimeout(){},MutationObserver:class{observe(){}disconnect(){}},Date};
  vm.runInNewContext(workerPreload+'\n;globalThis.testSnapshot=snapshot;',sandbox);
  const state=sandbox.testSnapshot();
  assert.equal(state.mode,'direct');
  assert.equal(state.text,'RESPOSTA_NOVA');
  assert.equal(state.latestUserText,'PERGUNTA_ATUAL');
});
