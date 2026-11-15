import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';

test('app-owned proposals and GPT work conversations stay separate, durable and replay-safe',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-cross-chat-'));
  const filename=path.join(dir,'store.sqlite');
  const store=new Store(filename);
  t.after(()=>{try{store.close()}catch{}fs.rmSync(dir,{recursive:true,force:true})});
  const context=Object.freeze({actorId:'local-test-owner',clientId:'one-app',workspaceSessionId:store.getWorkspaceSession().id});
  let sends=0;
  const provider={available:()=>true,busy:()=>false,send:async({taskId,content})=>{
    sends++;
    const {runId}=store.beginProviderRun(taskId,content);
    store.setChatUrl(taskId,'https://chatgpt.com/c/'+String(sends).padStart(36,'1'));
    store.appendMessage(taskId,'assistant','Resposta observada para: '+content);
    store.finishRun(taskId,runId);
    return {confirmed:true,deliveryObserved:true,responseObserved:true,effectVerified:false,runId};
  }};
  const service=new OrchestratorService({store,provider,authorize:({context:c})=>c===context});
  let sequence=0;
  const call=(operation,input={})=>service.invoke(context,operation,{requestId:'cycle_'+(++sequence),...input});
  const projectId=(await call('project_create',{name:'Teste encadeado',objective:'Validar conversas GPT'})).result.projectId;
  const orch=(await call('orchestrator_create',{projectId,name:'Forjador',mission:'Coordenar com política local'})).result;
  const workA=(await call('work_create',{projectId,orchestratorId:orch.orchestratorId,title:'Conversa GPT A'})).result.taskId;
  const workB=(await call('work_create',{projectId,orchestratorId:orch.orchestratorId,title:'Conversa GPT B'})).result.taskId;

  const proposal=await call('orchestrator_prepare',{projectId,orchestratorId:orch.orchestratorId,
    content:'Pesquisar a primeira hipótese.'});
  assert.equal(proposal.status,'succeeded');
  assert.equal(proposal.result.provider,'ordax_app_policy');
  assert.equal(sends,0,'local proposal must not invoke GPT');

  const sendA={projectId,taskId:workA,content:'Pergunta A',requestId:'question_A'};
  const first=await call('work_send',sendA);
  assert.equal(first.status,'succeeded');
  assert.deepEqual(await call('work_send',sendA),first);
  const review=await call('orchestrator_analyze',{projectId,orchestratorId:orch.orchestratorId});
  assert.equal(review.status,'succeeded');
  assert.equal(review.result.provider,'ordax_app_policy');
  assert.equal(review.result.analysisObserved,true);
  assert.equal(sends,1,'analysis must not invoke GPT');

  const sendB={projectId,taskId:workB,content:'Pergunta B',requestId:'question_B'};
  assert.equal((await call('work_send',sendB)).status,'succeeded');
  assert.equal(sends,2);
  assert.deepEqual(store.messages(workA).map(m=>m.role),['user','assistant']);
  assert.deepEqual(store.messages(workB).map(m=>m.role),['user','assistant']);
  assert.notEqual(store.getTask(workA).chat_url,store.getTask(workB).chat_url);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE status='succeeded'").get().n,2);
  assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
