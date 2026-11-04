import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {latestSiteWork} from '../src/site-work-context.mjs';
import {createGroqCoordinatorConversation} from '../supervisor/groq-conversation.mjs';
import {classifyExistingSiteChange,classifyProjectStatusQuestion} from '../src/natural-site-intent.mjs';

test('natural edits resume the verified project HTML and its existing GPT Task',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-site-continuity-'));
  const store=new Store(path.join(dir,'store.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const context={actorId:'owner',clientId:'test',workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,
    authorize:({context:c})=>c===context,
    coordinator:{available:()=>true,send:async()=>({content:'fixture',delegation:'none'})},
    provider:{available:()=>true,send:async()=>{throw Error('must_not_send_from_test');}}});
  const ids=(await service.invoke(context,'mission_create',{
    name:'Café da Praça',mission:'Site da cafeteria',requestId:'new_project'
  })).result;
  const work=(await service.invoke(context,'work_create',{
    projectId:ids.projectId,orchestratorId:ids.orchestratorId,
    title:'Criar site',requestId:'new_work'
  })).result.taskId;
  assert.equal(latestSiteWork(store,ids.projectId,ids.orchestratorId),null);
  const started=store.beginProviderRun(work,'Quero um site para minha cafeteria.');
  const url='https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';
  store.setChatUrl(work,url);
  const answer=store.appendMessage(work,'assistant',
    'Aqui está o arquivo da cafeteria, com estrutura HTML válida e navegação.');
  store.finishRun(work,started.runId);
  store.recordConversationCompletion(work,started.runId);
  const file=path.join(dir,'index.html');
  fs.writeFileSync(file,'<!doctype html><html><head></head><body>Site</body></html>');
  store.addAsset(work,answer.id,{id:'asset_site',kind:'file',mimeType:'text/html',
    localPath:file,alt:'index.html',sha256:'a'.repeat(64)});
  const site=latestSiteWork(store,ids.projectId,ids.orchestratorId);
  assert.equal(site?.taskId,work);
  assert.equal(site?.latestRunId,started.runId);
  assert.equal(site?.assetId,'asset_site');
  assert.equal(service.recordSiteDelivery({taskId:work,runId:started.runId,
    verified:true,sha256:'a'.repeat(64)}),true);
  const chat=store.messages(ids.chatTaskId,{limit:20});
  assert.equal(chat.filter(m=>m.role==='assistant'&&m.content.includes('área de resultados')).length,1);
  assert.equal(service.recordSiteDelivery({taskId:work,runId:started.runId,
    verified:true,sha256:'a'.repeat(64)}),false,'no duplicate delivery bubble');
  assert.equal(store.messages(ids.chatTaskId,{limit:20}).length,chat.length);
  assert.equal(classifyExistingSiteChange('melhore o html')?.route,'existing_gpt_conversation');
  assert.equal(classifyExistingSiteChange('sugira, e mude a cores/fonte')?.route,
    'existing_gpt_conversation');
  assert.equal(classifyExistingSiteChange('Como mudo a fonte?'),null);
  assert.equal(classifyExistingSiteChange('Mude o site e publique na Internet'),null);
  assert.equal(classifyProjectStatusQuestion('e entao ?'),true);
  let groqCalls=0;
  const coordinator=createGroqCoordinatorConversation({store,getApiKey:()=> 'fixture',
    isEnabled:()=>true,fetchImpl:async()=>{groqCalls++;
      return new Response('provider rejected the schema',{status:400});}});
  const editRoute=await coordinator.send({
    taskId:ids.chatTaskId,projectId:ids.projectId,orchestratorId:ids.orchestratorId,
    mission:'Site da cafeteria',content:'melhore o html',delegateWork:true
  });
  assert.equal(editRoute.delegation,'technical');
  assert.equal(editRoute.workIntent,'edit');
  assert.equal(groqCalls,1,'a confirmed HTTP 400 does not cause provider retries');
  const statusRoute=await coordinator.send({
    taskId:ids.chatTaskId,projectId:ids.projectId,orchestratorId:ids.orchestratorId,
    mission:'Site da cafeteria',content:'e entao ?',delegateWork:true
  });
  assert.equal(statusRoute.delegation,'none');
  assert.match(statusRoute.content,/prévia/);
  assert.equal(groqCalls,1,'a read-only status asks no model or executor');
  service.autonomous.tick=async()=>null; // only inspect admission, never send.
  const mission=service.autonomous.start(context,{
    projectId:ids.projectId,orchestratorId:ids.orchestratorId,
    mission:'melhore o html',mode:'technical',directUserPrompt:true,
    resumeSiteTaskId:site.taskId,requestId:'edit_site'
  });
  assert.equal(mission.taskAId,work,'must remain on original GPT conversation');
  assert.equal(mission.maxGPTSends,1);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM runs WHERE task_id=?").get(work).n,1,
    'admission never sent any duplicate provider message');
  store.appendMessage(ids.chatTaskId,'user','melhore o html');
  const status=service.autonomous.status(context,{
    projectId:ids.projectId,orchestratorId:ids.orchestratorId});
  assert.equal(status.mission.createdAt?.length>5,true);
  assert.equal(typeof status.lastUserTurnAt==='string',true);
  assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
