import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {AutonomousDialogue} from '../src/autonomous-dialogue.mjs';

function setup(t,{providerAvailable=true}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-jarvis-delegation-'));
  const store=new Store(path.join(dir,'store.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{force:true,recursive:true});});
  const context=Object.freeze({actorId:'operator',clientId:'windows-ui',
    workspaceSessionId:store.getWorkspaceSession().id});
  let coordinatorCalls=0,providerSends=0;
  const coordinator={
    available:()=>true,
    send:async({delegateWork,content})=>{
      coordinatorCalls++;
      if(delegateWork===true)
        return {content:content==='Olá'?'Olá!':'Vou preparar a delegação para o GPT.',
          delegation:content==='Olá'?'none':'technical',provider:'groq'};
      return {content:'Esta é uma conversa sem delegação.',provider:'groq'};
    }
  };
  const provider=providerAvailable?{
    available:()=>true,busy:()=>true,
    send:async()=>{providerSends++;throw Error('unexpected_gpt_submission');}
  }:null;
  const svc=new OrchestratorService({store,coordinator,provider,
    authorize:({context:c})=>c===context});
  let seq=0;
  const invoke=(operation,input,requestId)=>
    svc.invoke(context,operation,{...input,requestId:requestId||'jarvis_req_'+(++seq)});
  return {store,service:svc,context,invoke,get coordinatorCalls(){return coordinatorCalls;},
    get providerSends(){return providerSends;}};
}

test('legacy internal GPT instructions are reattributed without deleting receipts or treating them as user speech',async t=>{
  const f=setup(t);
  const created=await f.invoke('mission_create',{name:'Estação Café',mission:'Crie um site de cafeteria.'});
  const {projectId,orchestratorId}=created.result;
  const phrase='quero um site de página única para a cafeteria fictícia Estação Café';
  const first=await f.invoke('orchestrator_chat',{projectId,orchestratorId,
    content:phrase,delegateWork:true});
  const id=first.result.delegation.missionId;
  const row=f.store.db.prepare('SELECT task_a_id FROM lab_autonomous_dialogues WHERE id=?').get(id);
  const automaticFirst=f.store.beginProviderRun(row.task_a_id,phrase);
  const extra='Publique o site imediatamente, sem solicitação do proprietário.';
  const taskB=(await f.invoke('work_create',{projectId,orchestratorId,
    title:'Envio antigo fora do escopo'})).result.taskId;
  f.store.db.prepare('UPDATE lab_autonomous_dialogues SET task_b_id=?,question_b=? WHERE id=?')
    .run(taskB,extra,id);
  const automaticSecond=f.store.beginProviderRun(taskB,extra);
  assert.equal(f.store.messages(taskB)[0].author_source,'human',
    'legacy version did not distinguish automated prompts');
  const originalChatTask=f.store.db.prepare(
    'SELECT chat_task_id FROM lab_orchestrators WHERE id=?').get(orchestratorId).chat_task_id;
  assert.equal(f.store.messages(originalChatTask).find(x=>x.role==='user').author_source,'human');
  f.store.db.prepare("DELETE FROM store_migrations WHERE name='automatic-message-author-v1'").run();
  new AutonomousDialogue({store:f.store,service:f.service});
  assert.equal(f.store.messages(row.task_a_id).find(x=>x.id===automaticFirst.userMessage.id).author_source,'orchestrator');
  assert.equal(f.store.messages(taskB).find(x=>x.id===automaticSecond.userMessage.id).author_source,'orchestrator');
  assert.equal(f.store.messages(originalChatTask).find(x=>x.role==='user').author_source,'human',
    'human-authored request stays human');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs WHERE id IN (?,?)')
    .get(automaticFirst.runId,automaticSecond.runId).n,2,'no Run is removed');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  new AutonomousDialogue({store:f.store,service:f.service});
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM store_migrations WHERE name='automatic-message-author-v1'").get().n,1,
    'history reattribution applies once');
});

test('one authorized Jarvis turn classifies and durably starts ONE existing technical mission',async t=>{
  const f=setup(t);
  const created=await f.invoke('mission_create',{name:'Jarvis E2E',
    mission:'Groq coordena; o GPT executa e deve trazer evidências.'});
  assert.equal(created.status,'succeeded');
  const {projectId,orchestratorId}=created.result;
  const greeting=await f.invoke('orchestrator_chat',{
    projectId,orchestratorId,content:'Olá',delegateWork:true});
  assert.equal(greeting.result.delegation.status,'not_needed');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_autonomous_dialogues').get().n,0);
  const input={projectId,orchestratorId,
    content:'Quero um site de página única para a cafeteria fictícia Estação Café',delegateWork:true};
  const first=await f.invoke('orchestrator_chat',input,'single_ui_turn_01');
  assert.equal(first.status,'succeeded');
  assert.equal(first.result.delegation.status,'accepted');
  assert.match(first.result.delegation.missionId,/^autonomous_/);
  const replay=await f.invoke('orchestrator_chat',input,'single_ui_turn_01');
  assert.deepEqual(replay,first);
  const jobs=f.store.db.prepare('SELECT mission,state,strategy,followup_policy,question_a,task_a_id FROM lab_autonomous_dialogues').all();
  assert.equal(jobs.length,1);
  assert.equal(jobs[0].mission,input.content);
  assert.equal(jobs[0].strategy,'semantic');
  assert.equal(jobs[0].followup_policy,'review_only');
  assert.equal(jobs[0].state,'ready_a');
  assert.equal(jobs[0].question_a,input.content,
    'first GPT prompt must be the exact user message, without Groq-added instructions');
  assert.ok(jobs[0].task_a_id,'reuse the canonical work Task for the first send');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_task_bindings WHERE kind='work'").get().n,2,
    'reuse the existing mission-created work and create only one execution Task');
  const coordinatorTask=f.store.db.prepare("SELECT chat_task_id FROM lab_orchestrators WHERE id=?").get(orchestratorId).chat_task_id;
  const last=f.store.messages(coordinatorTask).at(-1);
  assert.deepEqual(last,{...last,role:'assistant',content:'Vou cuidar disso.'});
  assert.doesNotMatch(last.content,/Groq|GPT|executor|modelo|delegar/i);
  assert.equal(f.coordinatorCalls,2,'one Groq call per distinct user turn');
  assert.equal(f.providerSends,0,'busy GPT executor cannot be bypassed');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,0);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('result navigation binds to a succeeded Run, never a newer interrupted Task',async t=>{
  const f=setup(t);
  const created=await f.invoke('mission_create',{name:'Result binding',
    mission:'Crie um site e verifique apenas o que foi realmente entregue.'});
  const {projectId,orchestratorId}=created.result;
  const receipt=await f.invoke('orchestrator_chat',{projectId,orchestratorId,
    content:'quero um site de página única para a cafeteria fictícia Estação Café',delegateWork:true});
  const missionId=receipt.result.delegation.missionId;
  const missionRow=f.store.db.prepare('SELECT task_a_id FROM lab_autonomous_dialogues WHERE id=?').get(missionId);
  const taskA=missionRow.task_a_id;
  const {runId:runA}=f.store.beginProviderRun(taskA,'pedido original');
  f.store.appendMessage(taskA,'assistant','Resposta textual para o site.');
  f.store.finishRun(taskA,runA);
  const taskB=(await f.invoke('work_create',{projectId,orchestratorId,title:'Ação posterior não concluída'})).result.taskId;
  const {runId:runB}=f.store.beginProviderRun(taskB,'publicação não solicitada');
  const change=f.store.db.prepare(
    'UPDATE lab_autonomous_dialogues SET task_b_id=?,state=?,review_a_json=? WHERE id=?');
  change.run(taskB,'reconciliation_required',
    JSON.stringify({decision:'new_work',sourceRunId:runA}),missionId);
  const correct=f.service.autonomous.status(f.context,{projectId,orchestratorId}).mission;
  assert.equal(correct.reviewedTaskId,taskA,'only the confirmed first Run owns the result');
  assert.equal(correct.taskBId,taskB);
  change.run(taskB,'reconciliation_required',
    JSON.stringify({decision:'new_work',sourceRunId:runB}),missionId);
  const unconfirmed=f.service.autonomous.status(f.context,{projectId,orchestratorId}).mission;
  assert.equal(unconfirmed.reviewedTaskId,null,'running Run cannot be promoted as a result');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('Jarvis does not claim delegation or create a mission without an executor',async t=>{
  const f=setup(t,{providerAvailable:false});
  const c=await f.invoke('mission_create',{name:'Blocked Jarvis',
    mission:'Groq deve delegar ao GPT autorizado.'});
  const {projectId,orchestratorId}=c.result;
  const receipt=await f.invoke('orchestrator_chat',{projectId,orchestratorId,
    content:'Desenvolva um index.html.',delegateWork:true});
  assert.equal(receipt.status,'succeeded');
  assert.equal(receipt.result.delegation.status,'blocked');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_autonomous_dialogues').get().n,0);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,0);
  assert.equal(f.providerSends,0);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('without explicit delegation consent, Groq cannot start the GPT executor',async t=>{
  const f=setup(t);
  const c=await f.invoke('mission_create',{name:'Chat-only',
    mission:'Perguntas e respostas, sem delegação.'});
  const {projectId,orchestratorId}=c.result;
  const receipt=await f.invoke('orchestrator_chat',{projectId,orchestratorId,
    content:'Crie um arquivo HTML.',delegateWork:false});
  assert.equal(receipt.status,'succeeded');
  assert.equal(receipt.result.delegation,undefined);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_autonomous_dialogues').get().n,0);
  assert.equal(f.providerSends,0);
});