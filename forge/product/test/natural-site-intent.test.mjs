import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyUnambiguousSiteCreation,appOwnedSiteDecision,
  ORDAX_CAPABILITY_MANIFEST} from '../src/natural-site-intent.mjs';

const siteRequest='Quero um site para minha cafeteria.';

test('um pedido leigo de site é suficiente; não precisa mencionar HTML, preview ou GPT',()=>{
  for(const phrase of [siteRequest,'Preciso de uma página web para meu negócio.',
    'Crie um site para a pizzaria.','Faz uma landing page bonita para minha loja.']){
    const route=classifyUnambiguousSiteCreation(phrase);
    assert.equal(route?.kind,'site_creation',phrase);
    assert.equal(route?.publication,'never_implicit');
    const decision=appOwnedSiteDecision({delegateWork:true,currentRequest:phrase});
    assert.equal(decision?.delegation,'technical');
    assert.equal(decision?.workIntent,'create');
  }
  for(const phrase of ['Como criar um site?','Não quero um site.',
    'Explique a estrutura de uma landing page.','Quero apagar todos os meus arquivos',
    'O que é um website?','Quero uma receita de bolo.',
    'Crie um site e publique na Internet agora.'])
    assert.equal(classifyUnambiguousSiteCreation(phrase),null,phrase);
  assert.equal(ORDAX_CAPABILITY_MANIFEST.presentation.includes('preview'),true);
  assert.equal(appOwnedSiteDecision({delegateWork:false,currentRequest:siteRequest}),null);
});

test('a política local não transforma explicação, autenticação ou publicação em trabalho implícito',()=>{
  for(const phrase of ['Como criar um site?','Faça login para mim','Publique meu site agora'])
    assert.equal(appOwnedSiteDecision({delegateWork:true,currentRequest:phrase}),null);
});
