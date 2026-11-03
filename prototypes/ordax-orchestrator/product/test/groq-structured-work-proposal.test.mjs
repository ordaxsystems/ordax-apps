import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {createGroqCoordinatorConversation} from '../supervisor/groq-conversation.mjs';
import {parseStructuredModelObject} from '../src/structured-model-object.mjs';

const proposal={title:'Revisão de leitor DOM',content:'Diagnostique o leitor de mensagens e proponha testes de regressão verificáveis.',reason:'A evidência técnica ainda está incompleta.'};
const fence=value=>String.fromCharCode(96).repeat(3)+'json\n'+value+'\n'+String.fromCharCode(96).repeat(3);
function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-groq-json-proposal-'));
  const store=new Store(path.join(dir,'store.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const ctx=Object.freeze({actorId:'owner',clientId:'unit',workspaceSessionId:store.getWorkspaceSession().id});
  const svc=new OrchestratorService({store,authorize:({context})=>context===ctx});
  let index=0;
  const invoke=(operation,input)=>svc.invoke(ctx,operation,{...input,requestId:'req_'+(++index)});
  return {store,invoke,async ids(){
    const projectId=(await invoke('project_create',{name:'OrdaX App',objective:'Testar planejamento Groq'})).result.projectId;
    const x=(await invoke('orchestrator_create',{projectId,name:'Groq',mission:'Investigar código'})).result;
    return {projectId,orchestratorId:x.orchestratorId,taskId:x.chatTaskId,mission:'Diagnostique e teste o app.',prepareWork:true};
  }};
}
function apiResponse(reply){return new Response(JSON.stringify({choices:[{
  finish_reason:'stop',message:{content:reply}
}]}),{status:200,headers:{'content-type':'application/json'}});}

test('strict structured Groq proposal uses a JSON schema and stays locally validated',async t=>{
  const f=setup(t),args=await f.ids();
  let called=0;
  const adapter=createGroqCoordinatorConversation({store:f.store,
    getApiKey:()=> 'fixture-secret',isEnabled:()=>true,
    fetchImpl:async (_url,request)=>{
      called++;
      const data=JSON.parse(request.body);
      assert.equal(data.model,'openai/gpt-oss-20b');
      assert.equal(data.response_format.type,'json_schema');
      assert.equal(data.response_format.json_schema.strict,true);
      assert.equal(data.response_format.json_schema.schema.additionalProperties,false);
      assert.deepEqual(data.response_format.json_schema.schema.required,['title','content','reason']);
      assert.equal(data.reasoning_format,'hidden');
      assert.equal(data.reasoning_effort,'low');
      assert.equal(data.max_completion_tokens,1800);
      assert.equal(data.tools,undefined);
      return apiResponse(JSON.stringify(proposal));
    }});
  const result=await adapter.send(args);
  assert.deepEqual(result.proposal,proposal);
  assert.equal(called,1);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,0);
});

test('single fenced JSON object accepted; extra commentary or blocks fail closed',()=>{
  const valid=fence(JSON.stringify(proposal));
  assert.deepEqual(parseStructuredModelObject(valid),proposal);
  assert.deepEqual(parseStructuredModelObject(JSON.stringify(proposal)),proposal);
  for(const raw of ['Proposta: '+valid,valid+'\nExecutado',valid+'\n'+valid,
    String.fromCharCode(96).repeat(3)+'javascript\n'+JSON.stringify(proposal)+'\n'+String.fromCharCode(96).repeat(3),
    '{}{}','[1,2]','null','<json>'+JSON.stringify(proposal)+'</json>']){
    assert.throws(()=>parseStructuredModelObject(raw),/structured_model_object_invalid/);
  }
});

test('non-GPT-OSS configured model uses portable JSON object mode',async t=>{
  const f=setup(t),args=await f.ids();
  const adapter=createGroqCoordinatorConversation({store:f.store,
    getApiKey:()=> 'fixture-secret',isEnabled:()=>true,model:'llama-3.3-70b-versatile',
    fetchImpl:async (_url,request)=>{
      const data=JSON.parse(request.body);
      assert.deepEqual(data.response_format,{type:'json_object'});
      assert.equal(data.reasoning_format,undefined);
      assert.equal(data.reasoning_effort,undefined);
      return apiResponse(fence(JSON.stringify(proposal)));
    }});
  assert.equal((await adapter.send(args)).proposal.title,proposal.title);
});

test('model output may not smuggle extra fields or invalid proposals',async t=>{
  const f=setup(t),args=await f.ids();
  let raw=JSON.stringify({...proposal,autoSubmit:true});
  const adapter=createGroqCoordinatorConversation({store:f.store,
    getApiKey:()=> 'fixture-secret',isEnabled:()=>true,
    fetchImpl:async()=>apiResponse(raw)});
  await assert.rejects(adapter.send(args),/groq_invalid_work_proposal/);
  raw=JSON.stringify({...proposal,content:'   '});
  await assert.rejects(adapter.send(args),/groq_invalid_work_proposal/);
});

test('ordinary Groq coordinator remains natural language without JSON format',async t=>{
  const f=setup(t),args=await f.ids();
  const adapter=createGroqCoordinatorConversation({store:f.store,
    getApiKey:()=> 'fixture-secret',isEnabled:()=>true,
    fetchImpl:async (_url,request)=>{
      const data=JSON.parse(request.body);
      assert.equal(data.response_format,undefined);
      assert.equal(data.reasoning_format,undefined);
      return apiResponse('Esta etapa exige prova externa, não é conclusão.');
    }});
  const {content}=await adapter.send({...args,prepareWork:false});
  assert.match(content,/exige prova externa/);
});

test('semantic technical review has dedicated bounded Groq reasoning budget and no hidden retry',async t=>{
  const f=setup(t),args=await f.ids();
  let requests=0;
  const groq=createGroqCoordinatorConversation({store:f.store,getApiKey:()=> 'fixture-secret',
    isEnabled:()=>true,fetchImpl:async (_url,options)=>{
      requests++;
      const body=JSON.parse(options.body);
      assert.equal(body.max_completion_tokens,2600);
      assert.equal(body.reasoning_effort,'low');
      assert.equal(body.response_format.type,'json_schema');
      assert.equal(body.response_format.json_schema.strict,true);
      const schema=body.response_format.json_schema.schema;
      assert.equal(schema.additionalProperties,false);
      assert.deepEqual(schema.required,['runId','decision','summary','reason','observedExcerpt','nextPrompt']);
      assert.ok(schema.properties.decision.enum.includes('verify_external_effect'));
      assert.deepEqual(schema.properties.nextPrompt.type,['string','null']);
      assert.equal(body.reasoning_format,'hidden');
      assert.equal(body.tools,undefined);
      return apiResponse('A resposta técnica está observada; sem recibos Git não há conclusão.');
    }});
  const result=await groq.send({...args,prepareWork:false,completionProfile:'technical_review',
    analysisContext:{phase:'gpt_response_review',reviewEvidence:{answerStart:'Trecho técnico real'}}});
  assert.match(result.content,/sem recibos Git/);
  assert.equal(requests,1);
  await assert.rejects(groq.send({...args,completionProfile:'unbounded'}),/orchestrator_completion_profile_invalid/);
});
