import test from 'node:test';
import assert from 'node:assert/strict';
import { providerGenerationStopProbeExpression, providerHasObservedCompletion, providerResponseControlStateExpression } from '../src/provider-generation-stop-probe.mjs';
import { responseObservationComplete } from '../src/provider-response-completion.mjs';

function element({testId='',label='',style={},rect={width:24,height:24},hidden=false,parent=null}={}) {
  const attrs={'data-testid':testId,'aria-label':label};
  return {
    nodeType:1,
    parentElement:parent,
    hidden,
    inert:false,
    style,
    getAttribute(name){return attrs[name] || null;},
    getBoundingClientRect(){return rect;},
    getClientRects(){return rect.width>0&&rect.height>0?[rect]:[];}
  };
}

function probe(candidates) {
  const document={querySelectorAll:()=>candidates};
  const window={getComputedStyle:node=>({display:'block',visibility:'visible',opacity:'1',...node.style})};
  return new Function('document','window',`return ${providerGenerationStopProbeExpression}`)(document,window);
}

test('visible canonical ChatGPT stop control means generation is active',()=>{
  assert.equal(probe([element({testId:'stop-button'})]),true);
});

test('hidden or zero-size controls do not keep an observed reply running',()=>{
  const generating=probe([element({testId:'stop-button',style:{display:'none'}})]);
  assert.equal(generating,false);
  assert.equal(responseObservationComplete({
    candidate:{text:'A complete answer',complete:true},stable:2,transient:false,generating
  }),true);
  assert.equal(probe([element({testId:'stop-button',rect:{width:0,height:0}})]),false);
  assert.equal(probe([element({testId:'stop-button',hidden:true})]),false);
  assert.equal(probe([element({testId:'stop-button',parent:element({hidden:true})})]),false);
});

test('accessible labels are precise and ignore unrelated stop controls',()=>{
  assert.equal(probe([element({label:'Stop generating'})]),true);
  assert.equal(probe([element({label:'Parar de gerar'})]),true);
  assert.equal(probe([element({label:'Stop speaking'})]),false);
  assert.equal(probe([element({label:'Stop sharing'})]),false);
  assert.equal(probe([element({label:'Parar gravação'})]),false);
});

test('no visible Stop button alone is not positive completion evidence',()=>{
  assert.equal(providerHasObservedCompletion({generationStopVisible:false}),false);
  assert.equal(providerHasObservedCompletion({generationStopVisible:null}),false);
  assert.match(providerResponseControlStateExpression,/latestAssistant/);
  assert.match(providerResponseControlStateExpression,/depth<8/);
});

test('visible final response control or explicit marker confirms only when generation is not active',()=>{
  assert.equal(providerHasObservedCompletion({generationStopVisible:false,
    completionControlLabels:['Gerar resposta novamente']}),true);
  assert.equal(providerHasObservedCompletion({generationStopVisible:null,
    completionControlLabels:['Regenerate response']}),true);
  assert.equal(providerHasObservedCompletion({generationStopVisible:false,
    explicitCompletionMarker:true}),true);
  assert.equal(providerHasObservedCompletion({generationStopVisible:true,
    explicitCompletionMarker:true,completionControlLabels:['Gerar resposta novamente']}),false);
  assert.equal(providerHasObservedCompletion({generationStopVisible:false,
    completionControlLabels:['Parar de gerar']}),false);
});

function observedAssistantTurn({actions=[],stop=false,scoped=true}={}) {
  const turn={
    parentElement:null,
    querySelectorAll(selector){return selector==='button,[role="button"]'||selector==='button'?actions:[];}
  };
  const assistant={
    parentElement:turn,
    hasAttribute:()=>false,
    querySelector:()=>null,
    querySelectorAll:()=>[],
    closest:()=>scoped?turn:null
  };
  const document={querySelectorAll(selector) {
    if(selector.includes('stop-button'))return stop?[element({testId:'stop-button'})]:[];
    if(selector.includes('[data-message-role="assistant"]'))return [assistant];
    return [];
  }};
  const window={getComputedStyle:node=>({display:'block',visibility:'visible',opacity:'1',...node.style})};
  return new Function('document','window',
    `return ${providerResponseControlStateExpression}`)(document,window);
}

const finishedToolbar=()=>[
  element({testId:'copy-turn-action-button'}),
  element({testId:'good-response-turn-action-button'}),
  element({testId:'bad-response-turn-action-button'})
];

test('current ChatGPT completed feedback toolbar positively confirms the last assistant turn',()=>{
  assert.deepEqual(observedAssistantTurn({actions:finishedToolbar()}),
    {generationStopVisible:false,responseCompletionObserved:true});
  assert.equal(providerHasObservedCompletion({
    generationStopVisible:false,finishedAssistantToolbar:true
  }),true);
  assert.equal(responseObservationComplete({
    candidate:{text:'FORGE_LINK_OK_20261107',complete:true},
    stable:2,transient:false,generating:false
  }),true);
});

test('localized visible action labels also recognize a finished assistant turn',()=>{
  const actions=[
    element({label:'Copiar'}),
    element({label:'Boa resposta'}),
    element({label:'Resposta ruim'})
  ];
  assert.equal(observedAssistantTurn({actions}).responseCompletionObserved,true);
});

test('feedback completion cannot be inferred from absent Stop, partial, hidden or unrelated toolbars',()=>{
  assert.equal(observedAssistantTurn({actions:[]}).responseCompletionObserved,false);
  assert.equal(observedAssistantTurn({actions:finishedToolbar().slice(0,2)}).responseCompletionObserved,false);
  assert.equal(observedAssistantTurn({actions:finishedToolbar(),scoped:false}).responseCompletionObserved,false);
  assert.equal(observedAssistantTurn({
    actions:[...finishedToolbar().slice(0,2),element({
      testId:'bad-response-turn-action-button',hidden:true
    })]
  }).responseCompletionObserved,false);
  assert.equal(observedAssistantTurn({
    actions:finishedToolbar(),stop:true
  }).responseCompletionObserved,false);
});

function observedCurrentChatGPTToolbar({actions=[],markerCount=1,stop=false}={}) {
  // The physical November 7 ChatGPT DOM has a MarkdownRoot, sibling
  // selection-message marker and a shared ancestor toolbar without turn IDs.
  const group={
    parentElement:null,
    querySelectorAll(selector) {
      if(selector==='[data-chatgpt-selection-message-id]')
        return Array.from({length:markerCount},()=>({}));
      if(selector==='button,[role="button"]')return actions;
      return [];
    }
  };
  const assistant={
    parentElement:group,closest:()=>null,
    hasAttribute:()=>false,querySelector:()=>null,querySelectorAll:()=>[]
  };
  const document={querySelectorAll(selector) {
    if(selector.includes('stop-button'))return stop?[element({testId:'stop-button'})]:[];
    if(selector.includes('[data-message-role="assistant"]'))return [assistant];
    return [];
  }};
  const window={getComputedStyle:node=>({display:'block',visibility:'visible',opacity:'1',...node.style})};
  return new Function('document','window',
    `return ${providerResponseControlStateExpression}`)(document,window);
}

const currentChatGPTToolbar=()=>[
  element({label:'Copiar'}),
  element({label:'Avaliar resposta'}),
  element({label:'Ler em voz alta'}),
  element({label:'Compartilhar'})
];

test('physical ChatGPT toolbar completes one uniquely marked last assistant answer',()=>{
  assert.deepEqual(observedCurrentChatGPTToolbar({actions:currentChatGPTToolbar()}),
    {generationStopVisible:false,responseCompletionObserved:true});
});

test('physical toolbar fallback rejects unmarked, multiple, partial, hidden or still generating answers',()=>{
  const actions=currentChatGPTToolbar();
  assert.equal(observedCurrentChatGPTToolbar({actions,markerCount:0}).responseCompletionObserved,false);
  assert.equal(observedCurrentChatGPTToolbar({actions,markerCount:2}).responseCompletionObserved,false);
  assert.equal(observedCurrentChatGPTToolbar({actions:actions.slice(0,3)}).responseCompletionObserved,false);
  assert.equal(observedCurrentChatGPTToolbar({
    actions:[actions[0],actions[1],element({label:'Ler em voz alta',hidden:true}),actions[3]]
  }).responseCompletionObserved,false);
  assert.equal(observedCurrentChatGPTToolbar({
    actions:[element({label:'Copiar mensagem'}),...actions.slice(1)]
  }).responseCompletionObserved,false);
  assert.equal(observedCurrentChatGPTToolbar({actions,stop:true}).responseCompletionObserved,false);
});
