import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {buildCoordinatorRequestContext} from '../supervisor/coordinator-request-context.mjs';
import {createGroqCoordinatorConversation} from '../supervisor/groq-conversation.mjs';

test('OrdaX coordinator identifies the Groq model as a coordinator, not as ChatGPT',async t=>{
  const store=new Store(':memory:');t.after(()=>store.close());
  const service=new OrchestratorService({store,authorize:()=>true});
  const ctx={actorId:'test',clientId:'test',workspaceSessionId:store.getWorkspaceSession().id};
  const mission='Trabalhar no OrdaX Desktop Windows Dev. '+ 'SSOT e ownership do projeto. '.repeat(48)+ 'Não alterar Stable sem autorização.';
  const creation=await service.invoke(ctx,'mission_create',{requestId:'mission-identity',name:'OrdaX Desktop',
    mission,repositoryUrl:'https://github.com/ordaxsystems/ordax-os'});
  assert.equal(creation.status,'succeeded');
  const {projectId,orchestratorId,chatTaskId}=creation.result;
  store.upsertProjectMemory(chatTaskId,{category:'decision',key:'modelo_coordenador',
    content:'Groq coordena, GPT Web responde na conversa; Runtime executa somente com grants.'});
  const work=(await service.invoke(ctx,'work_create',{requestId:'work-identity',projectId,orchestratorId,
    title:'Auditar ordax-apps'})).result.taskId;
  store.upsertProjectMemory(work,{category:'fact',key:'work_memory_proof',
    content:'Memória da frente Auditar ordax-apps, não da telemetria do workspace.'});
  const context=buildCoordinatorRequestContext({store,taskId:chatTaskId,mission,projectId,orchestratorId,
    workspaceObservation:{state:'capability_unavailable',filesRead:0,snapshotObserved:false}});
  assert.match(context.system,/OrdaX Orchestrator Lab/);
  assert.match(context.system,/via API Groq/);
  assert.match(context.system,/não envia mensagens ao GPT/);
  assert.match(context.system,/não se apresente como ChatGPT/);
  assert.match(context.system,/Não alterar Stable sem autorização/);
  assert.match(context.system,/modelo_coordenador/);
  assert.match(context.system,/work_memory_proof/);
  assert.match(context.system,/Groq coordena, GPT Web responde/);
  assert.match(context.system,/workspaceObservation não é memória/);
  let actual;
  const model=createGroqCoordinatorConversation({store,getApiKey:()=> 'fixture-key',
    isEnabled:()=>true,fetchImpl:async(_url,options)=>{
      actual=JSON.parse(options.body);
      return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{
        content:'Sou OrdaX Orchestrator, coordenador do projeto via API Groq, distinto do GPT Web.'}}]}));
    }});
  const result=await model.send({taskId:chatTaskId,mission,projectId,orchestratorId});
  assert.match(result.content,/OrdaX Orchestrator/);
  assert.match(actual.messages[0].content,/projectMemory/);
  assert.equal(actual.messages[0].role,'system');
});
test('archived and unrelated memory never enter the Groq coordinator context',async t=>{
  const store=new Store(':memory:');t.after(()=>store.close());
  const service=new OrchestratorService({store,authorize:()=>true});
  const ctx={actorId:'test',clientId:'test',workspaceSessionId:store.getWorkspaceSession().id};
  let r=await service.invoke(ctx,'mission_create',{requestId:'m1',name:'A',mission:'A'});
  const a=r.result;
  r=await service.invoke(ctx,'mission_create',{requestId:'m2',name:'B',mission:'B'});
  const b=r.result;
  store.upsertProjectMemory(b.chatTaskId,{category:'fact',key:'private_b',content:'UNRELATED_MEMORY_TEXT'});
  const archived=store.upsertProjectMemory(a.chatTaskId,{category:'fact',key:'old_fact',content:'ARCHIVED_MEMORY_TEXT'});
  store.archiveProjectMemory(a.chatTaskId,archived.id);
  const request=buildCoordinatorRequestContext({store,taskId:a.chatTaskId,mission:'A',
    projectId:a.projectId,orchestratorId:a.orchestratorId});
  assert.doesNotMatch(request.system,/ARCHIVED_MEMORY_TEXT|UNRELATED_MEMORY_TEXT/);
});
