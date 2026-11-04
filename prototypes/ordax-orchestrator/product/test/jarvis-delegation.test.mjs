import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';

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
  return {store,invoke,get coordinatorCalls(){return coordinatorCalls;},
    get providerSends(){return providerSends;}};
}

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