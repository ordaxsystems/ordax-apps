import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';

// Contract-level E2E using the real OrchestratorService + durable SQLite,
// with explicit simulated Groq/GPT transport. It does NOT claim live GPT Web.
test('Groq question -> GPT conversation A -> Groq interpretation -> GPT conversation B -> next question, without replay',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-cross-chat-dialogue-'));
  const filename=path.join(dir,'store.sqlite');
  let store=new Store(filename);
  t.after(()=>{try{store?.close()}catch{}fs.rmSync(dir,{recursive:true,force:true})});
  const context=Object.freeze({actorId:'local-test-owner',clientId:'one-app',workspaceSessionId:store.getWorkspaceSession().id});
  let count=0, sends=0;
  const questions=[
    'Quanto é 3 + 4? Responda com o número e explique em uma frase.',
    'A resposta anterior foi 7. Qual é o dobro de 7?',
    'Agora explique por que o dobro de 7 é 14, sem mudar as respostas anteriores.'
  ];
  const answers=['7. Somamos três unidades a quatro.', '14. O dobro de sete é quatorze.'];
  const urls=[
    'https://chatgpt.com/c/11111111-2222-4333-8444-555555555555',
    'https://chatgpt.com/c/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  ];
  const coordinator={
    available:()=>true,
    send:async({prepareWork,analysisContext})=>{
      assert.equal(prepareWork,true);
      const previous=analysisContext.works.flatMap(w=>w.messages).filter(m=>m.role==='assistant').map(m=>m.content);
      if(count===1)assert.ok(previous.some(m=>m.includes(answers[0])),'Groq must see the first GPT answer before its next question');
      if(count===2)assert.ok(previous.some(m=>m.includes(answers[1])),'Groq must see GPT B answer before proposing a third turn');
      const question=questions[count++];
      if(!question)throw Error('bounded_three_questions_only');
      return {content:'Análise baseada apenas no histórico recebido: '+question,
        proposal:{title:'Pergunta '+count,content:question,reason:'Validar interpretação de respostas entre conversas'}};
    }
  };
  const provider={
    available:()=>true,busy:()=>false,
    send:async({taskId,content})=>{
      const index=sends++;
      assert.ok(index<2,'no automatic unbounded GPT dispatch');
      assert.equal(content,questions[index]);
      const {runId}=store.beginProviderRun(taskId,content);
      store.setChatUrl(taskId,urls[index]);
      store.appendMessage(taskId,'assistant',answers[index]);
      store.finishRun(taskId,runId);
      return {confirmed:true,deliveryObserved:true,responseObserved:true,effectVerified:false,runId};
    }
  };
  const service=new OrchestratorService({store,coordinator,provider,authorize:({context:c})=>c===context});
  let sequence=0;
  const call=(operation,input)=>service.invoke(context,operation,{requestId:'cycle_'+(++sequence),...input});
  const projectId=(await call('project_create',{name:'Teste encadeado',objective:'Validar duas conversas GPT'})).result.projectId;
  const orch=(await call('orchestrator_create',{projectId,name:'Groq coordenador',mission:'Analisar somente respostas verificadas'})).result;
  const workA=(await call('work_create',{projectId,orchestratorId:orch.orchestratorId,title:'Conversa GPT A'})).result.taskId;
  const workB=(await call('work_create',{projectId,orchestratorId:orch.orchestratorId,title:'Conversa GPT B'})).result.taskId;
  const generated=async ()=>{
    const cmd=await call('orchestrator_prepare',{projectId,orchestratorId:orch.orchestratorId,content:'Elabore a próxima pergunta usando as respostas persistidas.'});
    assert.equal(cmd.status,'succeeded');
    const payload=JSON.parse(store.db.prepare('SELECT payload FROM action_ledger WHERE id=?').get(cmd.result.proposalActionId).payload);
    return payload.proposal.content;
  };
  assert.equal(await generated(),questions[0]);
  const sendA={projectId,taskId:workA,content:questions[0],requestId:'question_to_gpt_A'};
  const first=await call('work_send',sendA);
  assert.equal(first.status,'succeeded');
  assert.deepEqual(await call('work_send',sendA),first,'command receipt blocks duplicate GPT send');
  assert.equal(sends,1);
  assert.equal(await generated(),questions[1]);
  const sendB={projectId,taskId:workB,content:questions[1],requestId:'question_to_gpt_B'};
  const second=await call('work_send',sendB);
  assert.equal(second.status,'succeeded');
  assert.equal(await generated(),questions[2]);
  assert.equal(sends,2,'third Groq proposal is advisory; no implicit GPT send');
  assert.equal(count,3);
  assert.deepEqual(store.messages(workA).map(m=>[m.role,m.content]),[['user',questions[0]],['assistant',answers[0]]]);
  assert.deepEqual(store.messages(workB).map(m=>[m.role,m.content]),[['user',questions[1]],['assistant',answers[1]]]);
  assert.equal(store.getTask(workA).chat_url,urls[0]);
  assert.equal(store.getTask(workB).chat_url,urls[1]);
  assert.notEqual(store.getTask(workA).chat_url,store.getTask(workB).chat_url);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE status='succeeded'").get().n,2);
  assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  store.close();
  store=new Store(filename);
  assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  assert.equal(store.messages(workA).length,2);
  assert.equal(store.messages(workB).length,2);
  assert.equal(store.getTask(workA).chat_url,urls[0]);
  assert.equal(store.getTask(workB).chat_url,urls[1]);
});
