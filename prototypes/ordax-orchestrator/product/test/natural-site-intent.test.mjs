import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {createGroqCoordinatorConversation} from '../supervisor/groq-conversation.mjs';
import {classifyUnambiguousSiteCreation,appOwnedSiteDecision,
  ORDAX_CAPABILITY_MANIFEST} from '../src/natural-site-intent.mjs';

const siteRequest='Quero um site para minha cafeteria.';
const api=body=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:body}}]}),{
  status:200,headers:{'content-type':'application/json'}
});
async function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-natural-site-'));
  const store=new Store(path.join(dir,'store.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{force:true,recursive:true});});
  const actor={actorId:'lab-owner',clientId:'test',workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,authorize:({context})=>context===actor});
  const result=await service.invoke(actor,'mission_create',{name:'Cafeteria',mission:'Site de cafeteria',
    requestId:'site_req_1'});
  assert.equal(result.status,'succeeded');
  return {store,projectId:result.result.projectId,orchestratorId:result.result.orchestratorId,
    taskId:result.result.chatTaskId,mission:'Site de cafeteria'};
}
test('um pedido leigo de site é suficiente; não precisa mencionar HTML, preview ou GPT',()=>{
  for(const phrase of [siteRequest,'Preciso de uma página web para meu negócio.',
    'Crie um site para a pizzaria.','Faz uma landing page bonita para minha loja.']){
    const route=classifyUnambiguousSiteCreation(phrase);
    assert.equal(route?.kind,'site_creation',phrase);
    assert.equal(route?.publication,'never_implicit');
  }
  for(const phrase of ['Como criar um site?','Não quero um site.',
    'Explique a estrutura de uma landing page.', 'Quero apagar todos os meus arquivos',
    'O que é um website?', 'Quero uma receita de bolo.',
    'Crie um site e publique na Internet agora.']){
    assert.equal(classifyUnambiguousSiteCreation(phrase),null,phrase);
  }
  assert.equal(ORDAX_CAPABILITY_MANIFEST.presentation.includes('preview'),true);
  assert.equal(appOwnedSiteDecision({delegateWork:false,currentRequest:siteRequest}),null);
});
test('uma resposta malformada do Groq não bloqueia pedido claro de criação; sem novo envio Groq',async t=>{
  const f=await fixture(t);
  let calls=0;
  const groq=createGroqCoordinatorConversation({store:f.store,getApiKey:()=> 'fixture',
    isEnabled:()=>true,fetchImpl:async(_url,request)=>{
      calls++;
      const post=JSON.parse(request.body);
      assert.equal(post.response_format.type,'json_schema');
      assert.equal(post.messages.at(-1).content,siteRequest);
      assert.match(post.messages[0].content,/preview visual e interativo isolado/i);
      assert.equal(post.messages.some(m=>m.role==='user'&&m.content.includes('index.html')),false);
      return api('texto inválido, não é JSON');
    }});
  const result=await groq.send({...f,content:siteRequest,delegateWork:true});
  assert.equal(calls,1,'a chamada ao Groq não é repetida');
  assert.equal(result.delegation,'technical');
  assert.equal(result.provider,'ordax_app_intent_policy');
  assert.match(result.content,/mostrar o resultado/i);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,0);
});
test('se o Groq apenas responde a criação clara, o OrdaX mantém execução explícita',async t=>{
  const f=await fixture(t);
  const groq=createGroqCoordinatorConversation({store:f.store,getApiKey:()=> 'fixture',
    isEnabled:()=>true,fetchImpl:async()=>api(JSON.stringify({action:'respond',reply:'Aqui estão algumas dicas.'}))});
  const r=await groq.send({...f,content:siteRequest,delegateWork:true});
  assert.equal(r.delegation,'technical');
  assert.equal(r.provider,'ordax_app_intent_policy');
});
test('bloqueios de autenticação não viram criação automática',async t=>{
  const f=await fixture(t);
  const groq=createGroqCoordinatorConversation({store:f.store,getApiKey:()=> 'fixture',
    isEnabled:()=>true,fetchImpl:async()=>new Response('denied',{status:401})});
  await assert.rejects(groq.send({...f,content:siteRequest,delegateWork:true}),
    /groq_auth_rejected/);
});
test('pedidos de explicação sem trabalho não recebem delegação artificial',async t=>{
  const f=await fixture(t);
  const groq=createGroqCoordinatorConversation({store:f.store,getApiKey:()=> 'fixture',
    isEnabled:()=>true,fetchImpl:async()=>api('texto inválido')});
  await assert.rejects(groq.send({...f,content:'Como criar um site?',delegateWork:true}),
    /groq_invalid_jarvis_decision/);
});
