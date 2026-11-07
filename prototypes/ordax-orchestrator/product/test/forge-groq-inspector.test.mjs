import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {createGroqCoordinatorConversation} from '../supervisor/groq-conversation.mjs';

test('DEV inspection reflects exact Groq API model messages but never credentials',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-groq-inspector-'));
  const store=new Store(path.join(dir,'test.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const actor={actorId:'owner',clientId:'local',workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,authorize:({context})=>context===actor});
  const {result:project}=await service.invoke(actor,'mission_create',{
    name:'Cafeteria',mission:'Site de cafeteria',requestId:'groq_trace_fixture'
  });
  let trace=null,payload=null;
  const groq=createGroqCoordinatorConversation({
    store,getApiKey:()=> 'never-display-this-api-key',isEnabled:()=>true,
    onModelRequest:sample=>{trace=sample;},
    fetchImpl:async(_url,options)=>{
      payload=JSON.parse(options.body);
      return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{
        content:JSON.stringify({action:'delegate',reply:'Vou cuidar disso.'})
      }}]}),{status:200,headers:{'content-type':'application/json'}});
    }
  });
  const answer=await groq.send({
    taskId:project.chatTaskId,projectId:project.projectId,orchestratorId:project.orchestratorId,
    mission:'Site de cafeteria',content:'Crie um site de cafeteria',delegateWork:true
  });
  assert.equal(answer.delegation,'technical');
  assert.equal(trace.projectId,project.projectId);
  assert.equal(trace.model,payload.model);
  assert.deepEqual(trace.messages,payload.messages);
  assert.equal(trace.messages.at(-1).content,'Crie um site de cafeteria');
  assert.equal(JSON.stringify(trace).includes('never-display-this-api-key'),false);
  assert.equal(Object.hasOwn(trace,'headers'),false);
});

test('Groq inspector is visible only behind the explicit DEV disclosure',()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const html=fs.readFileSync(path.join(root,'desktop/ui.html'),'utf8');
  const main=fs.readFileSync(path.join(root,'desktop/main.mjs'),'utf8');
  const preload=fs.readFileSync(path.join(root,'desktop/preload.cjs'),'utf8');
  const ui=fs.readFileSync(path.join(root,'desktop/orchestrator-ui.mjs'),'utf8');
  assert.match(html,/<details id="forjadorGroqInspector"/);
  assert.match(html,/id="groqPromptDisplay"/);
  assert.match(main,/ordax:forjador:groq-prompt/);
  assert.match(main,/requireTrustedSupervisorRenderer\(event\)/);
  assert.match(preload,/forjadorGroqPrompt:/);
  assert.match(ui,/forjadorGroqPrompt\?\.\(selected\)/);
  assert.match(ui,/display\.textContent=/);
  assert.match(main,/lastGptDispatch=\{projectId,taskId,runId,authorSource/);
  assert.match(main,/composedPrompt:providerPrompt/);
  assert.match(main,/deliveryObserved:true/);
  assert.match(ui,/originalRequest:trace\.gpt\.originalRequest/);
  assert.match(ui,/composedPrompt:trace\.gpt\.composedPrompt/);
  assert.match(ui,/deliveryObserved:trace\.gpt\.deliveryObserved/);
});
