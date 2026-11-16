import test from 'node:test';
import assert from 'node:assert/strict';
import {routeForConversation,providerMessage} from '../provider-routing.mjs';

test('Forjador seleciona Forge MCP apenas para coordenação',()=>{
 assert.deepEqual(routeForConversation('forjador'),{requiresMcp:true,mcpApp:'forge-mcp',purpose:'coordination'});
});
test('Agentes usam GPT Web com ferramentas do próprio chat, sem seleção forçada',()=>{
 for(const id of ['agent-1','agent-2']){
   assert.deepEqual(routeForConversation(id),{requiresMcp:false,purpose:'github-work'});
   const prompt=providerMessage({
     agentId:id,task:'Crie um site de pizzaria funcional.',
     repo:'ordaxos-admin/TESTES-FORGE-GIT',branch:'forge-git/'+id+'-f77c7f9f',
     context:'GitHub verificado: main abc',fresh:true
   });
   assert.match(prompt,/Trabalhe no repositório https:\/\/github.com\/ordaxos-admin\/TESTES-FORGE-GIT/);
   assert.match(prompt,/Crie um site de pizzaria funcional/);
   assert.doesNotMatch(prompt,/(JSON|\{"path"|ETAPA ATUAL|Forge MCP)/);
 }
});
test('Agente não envia missão sem branch autorizada',()=>{
 assert.throws(()=>providerMessage({agentId:'agent-1',task:'Crie teste.',repo:'ordaxos-admin/TESTES-FORGE-GIT',branch:'main',context:'',fresh:true}));
 assert.throws(()=>routeForConversation('agent-root'));
});
