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
