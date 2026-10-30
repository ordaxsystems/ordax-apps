import test from 'node:test';
import assert from 'node:assert/strict';
import {providerAuthControlProbeExpression,isProviderAuthActionLabel} from '../src/provider-auth-control-probe.mjs';
import {classifyProviderAuthObservation} from '../src/provider-observation-policy.mjs';

function control({text='',aria='',title='',hidden=false,parent=null,rect={width:80,height:24}}={}) {
  const attributes={'aria-label':aria,title};
  return {
    nodeType:1,parentElement:parent,hidden,inert:false,value:'',innerText:text,textContent:text,
    getAttribute(name){return attributes[name]||null;},
    getBoundingClientRect(){return rect;},
    getClientRects(){return rect.width&&rect.height?[rect]:[];}
  };
}

function observeAuthControls(controls) {
  const document={querySelectorAll(){return controls;}};
  const window={getComputedStyle(element){return element.style||{
    display:'block',visibility:'visible',opacity:'1'
  };}};
  return new Function('document','window',`return ${providerAuthControlProbeExpression}`)(document,window);
}

test('visible login and registration controls are detected by exact accessible labels',()=>{
  assert.deepEqual(observeAuthControls([
    control({aria:'Sign in to ChatGPT'}),control({text:'Create account'})
  ]),{hasLogin:true,hasSignup:true});
  assert.equal(isProviderAuthActionLabel(' Entrar '),true);
  assert.equal(isProviderAuthActionLabel('Fazer login'),true);
  assert.equal(isProviderAuthActionLabel('Cadastre-se','signup'),true);
});

test('conversation prose such as “concentrar” is never treated as a login control',()=>{
  const controls=observeAuthControls([control({text:'A memória precisa concentrar fatos e decisões.'})]);
  const auth=classifyProviderAuthObservation({url:'https://chatgpt.com/c/test',page:{
    composer:true,hasLogin:controls.hasLogin,hasSignup:controls.hasSignup
  }});
  assert.deepEqual(controls,{hasLogin:false,hasSignup:false});
  assert.equal(auth,'session_present');
  assert.equal(isProviderAuthActionLabel('concentrar'),false);
  assert.equal(isProviderAuthActionLabel('How to sign in'),false);
});

test('hidden and non-semantic prose controls cannot classify a signed-in page as anonymous',()=>{
  const controls=observeAuthControls([
    control({aria:'Log in',hidden:true}),
    control({text:'Sign up',rect:{width:0,height:0}}),
    control({text:'Sign in instructions for agents'})
  ]);
  assert.deepEqual(controls,{hasLogin:false,hasSignup:false});
});

test('auth probe source inspects actionable controls instead of scanning response text',()=>{
  assert.match(providerAuthControlProbeExpression,/button,a\[href\],\[role="button"\]/);
  assert.match(providerAuthControlProbeExpression,/getBoundingClientRect/);
  assert.doesNotMatch(providerAuthControlProbeExpression,/body\.innerText|Entrar\|Log in\|Sign in/);
});
