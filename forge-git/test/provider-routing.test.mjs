import test from 'node:test';
import assert from 'node:assert/strict';
import {routeForConversation,providerMessage,chatSessionReadiness,matchesStoredConversation,providerIsSettled} from '../provider-routing.mjs';

const repo='ordaxos-admin/TESTES-FORGE-GIT';
const branch='forge-git/agent-2-2b64f1cd';
const sha='a'.repeat(40);

test('missão simples sem histórico, avisos, JSON ou instruções duplicadas',()=>{
 const actual=providerMessage({
   agentId:'agent-2',repo,branch,task:'Crie um site funcional.',
   fresh:true,context:'EVENTOS / AVISOS / duplicação'
 });
 assert.equal(actual,'Trabalhe no repositório https://github.com/'+repo+
   ' na branch '+branch+'. Crie um site funcional.');
 assert.doesNotMatch(actual,/EVENTOS|AVISOS|JSON|Perfil desta conversa/);
});
test('continuação em nova conversa usa um único checkpoint GitHub',()=>{
 const actual=providerMessage({
   agentId:'agent-2',repo,branch,task:'Continue a missão.',
   continuation:true,headSha:sha,goal:'Crie um site funcional.',
   context:'LIXO DO HISTÓRICO'
 });
 assert.equal(actual,'Continue no repositório https://github.com/'+repo+
   ' na branch '+branch+', a partir do commit '+sha.slice(0,12)+
   '. Objetivo: Crie um site funcional. Confira o que já foi feito no GitHub e prossiga sem repetir trabalho.');
 assert.doesNotMatch(actual,/LIXO|JSON|Agentes:|Avisos/);
});
test('Forjador mantém MCP próprio sem log anexado',()=>{
 assert.equal(routeForConversation('forjador').mcpApp,'forge-mcp');
 assert.equal(routeForConversation('agent-2').requiresMcp,false);
 assert.equal(providerMessage({agentId:'forjador',task:'Atualize a memória.',context:'HISTÓRICO'}),'Atualize a memória.');
});
test('continuação sem checkpoint é bloqueada',()=>{
 assert.throws(()=>providerMessage({agentId:'agent-2',repo,branch,task:'Continue.',continuation:true,headSha:null,goal:'Site'}));
 assert.throws(()=>providerMessage({agentId:'agent-2',repo,branch:'main',task:'Faça algo.'}));
 assert.throws(()=>routeForConversation('desconhecido'));
});
test('sessão ChatGPT só aparece pronta com composer e autenticação observados',()=>{
  const healthy={
    auth_state:'session_present',health_observed:true,composer_ready:true,
    verification_required:false,provider_access_problem:null
  };
  assert.equal(chatSessionReadiness(healthy),'ready');
  assert.equal(chatSessionReadiness({...healthy,auth_state:'anonymous'}),'login-required');
  assert.equal(chatSessionReadiness({...healthy,auth_state:'authenticating'}),'authenticating');
  assert.equal(chatSessionReadiness({...healthy,auth_state:'unknown'}),'unavailable');
  assert.equal(chatSessionReadiness({...healthy,composer_ready:false}),'unavailable');
  assert.equal(chatSessionReadiness({...healthy,health_observed:false}),'unavailable');
  assert.equal(chatSessionReadiness({...healthy,verification_required:true}),'unavailable');
  assert.equal(chatSessionReadiness(null),'unavailable');
});
test('reconciliação exige a conversa salva, não a home nem outra conversa',()=>{
 const url='https://chatgpt.com/c/6afad00d-a524-83e8-9108-3a09dd560d3f';
 assert.equal(matchesStoredConversation(url,url),true);
 assert.equal(matchesStoredConversation(url,url+'?utm=anything'),true);
 assert.equal(matchesStoredConversation(url,'https://chatgpt.com/'),false);
 assert.equal(matchesStoredConversation(null,url),false);
 assert.equal(matchesStoredConversation(url,'https://chatgpt.com/c/other'),false);
 assert.equal(matchesStoredConversation(url,'https://example.com/c/other'),false);
});
test('commit remoto não libera continuação enquanto GPT ainda responde',()=>{
 const settled={auth_state:'session_present',health_observed:true,
   composer_ready:true,verification_required:false,provider_access_problem:null,
   response_generation_active:false};
 assert.equal(providerIsSettled(settled),true);
 assert.equal(providerIsSettled({...settled,response_generation_active:true}),false);
 assert.equal(providerIsSettled({...settled,response_generation_active:undefined}),false);
 assert.equal(providerIsSettled({...settled,auth_state:'anonymous'}),false);
 assert.equal(providerIsSettled({...settled,composer_ready:false}),false);
 assert.equal(providerIsSettled({...settled,health_observed:false}),false);
 assert.equal(providerIsSettled(null),false);
});
