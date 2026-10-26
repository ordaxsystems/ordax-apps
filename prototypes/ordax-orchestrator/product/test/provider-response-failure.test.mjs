import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {classifyProviderResponseFailure,providerResponseFailureSignalsExpression} from '../src/provider-response-failure.mjs';

test('visible explicit retry controls are classified without exposing provider text',()=>{
  assert.equal(classifyProviderResponseFailure({retryInLatestAssistant:true}),
    'chatgpt_response_retry_required');
  assert.equal(classifyProviderResponseFailure({retryWithErrorContext:true}),
    'chatgpt_response_retry_required');
  assert.equal(classifyProviderResponseFailure({retryInLatestAssistant:false,
    retryWithErrorContext:false,visibleErrorAlert:true}), 'chatgpt_response_error_observed');
  assert.equal(classifyProviderResponseFailure({retryInLatestAssistant:false,
    retryWithErrorContext:false,visibleErrorAlert:false,standaloneError:true}),
    'chatgpt_response_error_observed');
  assert.equal(classifyProviderResponseFailure({retryInLatestAssistant:false,
    retryWithErrorContext:false,visibleErrorAlert:false,standaloneError:false}),null);
  assert.equal(classifyProviderResponseFailure(null),null);
});

test('DOM probe is limited to visible explicit error/retry signals and returns booleans only',()=>{
  assert.match(providerResponseFailureSignalsExpression,/getBoundingClientRect/);
  assert.match(providerResponseFailureSignalsExpression,/tente novamente/);
  assert.match(providerResponseFailureSignalsExpression,/something went wrong/);
  assert.match(providerResponseFailureSignalsExpression,/visibleErrorAlert/);
  assert.match(providerResponseFailureSignalsExpression,/return \{ retryInLatestAssistant, retryWithErrorContext, visibleErrorAlert, standaloneError \}/);
  assert.doesNotMatch(providerResponseFailureSignalsExpression,/return \{[^}]*text:/s);
});

function observeDom({assistantText='',buttonText=null,buttonHidden=false,alertText=null}={}) {
  const node=(text='',attrs={})=>({
    nodeType:1,innerText:text,textContent:text,hidden:false,inert:false,parentElement:null,
    getAttribute:name=>attrs[name]??null,
    getBoundingClientRect:()=>({width:1,height:1}),getClientRects:()=>[{}],
    contains(target){for(let current=target;current;current=current.parentElement)if(current===this)return true;return false;}
  });
  const assistant=node(assistantText,{'data-message-author-role':'assistant'});
  const buttons=[];
  if(buttonText!==null){
    const button=node(buttonText);button.parentElement=assistant;button.hidden=buttonHidden;buttons.push(button);
  }
  const alerts=alertText===null?[]:[node(alertText,{'role':'alert'})];
  const document={querySelectorAll(selector){
    if(selector.includes('data-message-author-role="assistant"'))return [assistant];
    if(selector==='button,[role="button"]')return buttons;
    if(selector.includes('[role="alert"]'))return alerts;
    return [];
  }};
  return vm.runInNewContext(providerResponseFailureSignalsExpression,{
    document,window:{getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})}
  });
}

test('DOM probe distinguishes visible retry, hidden control, ordinary regenerate, and error alert',()=>{
  assert.equal(classifyProviderResponseFailure(observeDom({
    assistantText:'A resposta não pôde ser gerada.',buttonText:'Tente novamente'
  })),'chatgpt_response_retry_required');
  assert.equal(classifyProviderResponseFailure(observeDom({
    assistantText:'Uma resposta normal.',buttonText:'Tente novamente',buttonHidden:true
  })),null);
  assert.equal(classifyProviderResponseFailure(observeDom({
    assistantText:'Resposta normal.',buttonText:'Regenerar resposta'
  })),null);
  assert.equal(classifyProviderResponseFailure(observeDom({
    alertText:'Ocorreu um erro ao gerar resposta.'
  })),'chatgpt_response_error_observed');
  assert.equal(classifyProviderResponseFailure(observeDom({
    assistantText:'Uma explicação longa sobre como a frase “Something went wrong” pode aparecer em uma mensagem comum.'
  })),null);
});

test('worker observes provider failure before treating a response as complete and records confirmed delivery',()=>{
  const worker=fs.readFileSync(new URL('../desktop/embedded-worker.mjs',import.meta.url),'utf8');
  const ui=fs.readFileSync(new URL('../desktop/ui.js',import.meta.url),'utf8');
  const loopStart=worker.indexOf('let latest = null, latestSignature');
  const loopEnd=worker.indexOf('return { text:String(latest.text',loopStart);
  const loop=worker.slice(loopStart,loopEnd);
  assert.ok(loopStart>=0&&loopEnd>loopStart);
  assert.ok(loop.indexOf('classifyProviderResponseFailure(snap.responseFailureSignals)')<
    loop.indexOf('responseObservationComplete('));
  assert.match(worker,/response_generation_active:page\?\.generationStopVisible===true/);
  assert.match(worker,/provider_response_failure:classifyProviderResponseFailure/);
  assert.match(worker,/providerDeliveryState:ctx\.submittedAt\?'submitted':ctx\.submitAttemptAt\|\|ctx\.contextAttachmentAttemptAt\?'uncertain':'not_submitted'/);
  assert.match(worker,/submissionConfirmedAt:ctx\?\.submittedAt\?\?null/);
  assert.match(ui,/task\.latest_run\?\.status === 'failed'/);
  assert.match(ui,/run\.provider_delivery_state==='submitted'/);
  assert.doesNotMatch(loop,/sendPrompt\(|requestSubmit\(/);
});
