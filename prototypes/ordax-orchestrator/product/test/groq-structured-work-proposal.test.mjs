import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {createGroqCoordinatorConversation} from '../supervisor/groq-conversation.mjs';
import {parseStructuredModelObject} from '../src/structured-model-object.mjs';
import {GPT_REVIEW_FOLLOWUP_DECISIONS,GPT_REVIEW_TERMINAL_DECISIONS} from '../src/gpt-work-review.mjs';

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
      assert.equal(data.reasoning_format,'hidden');
      assert.equal(data.reasoning_effort,'low');
      assert.equal(data.max_completion_tokens,2400);
      assert.equal(data.tools,undefined);
      return apiResponse('Esta etapa exige prova externa, não é conclusão.');
    }});
  const {content}=await adapter.send({...args,prepareWork:false});
  assert.match(content,/exige prova externa/);
});

test('real-world ordinary Groq truncation fails closed with its expanded budget and no retry',async t=>{
  const f=setup(t),args=await f.ids();
  let calls=0;
  const groq=createGroqCoordinatorConversation({store:f.store,
    getApiKey:()=> 'fixture-secret',isEnabled:()=>true,
    fetchImpl:async(_url,options)=>{
      calls++;
      const request=JSON.parse(options.body);
      assert.equal(request.max_completion_tokens,2400);
      assert.equal(request.reasoning_effort,'low');
      assert.equal(request.reasoning_format,'hidden');
      return new Response(JSON.stringify({choices:[{finish_reason:'length',
        message:{content:'PARCIAL_NAO_E_CONCLUSAO'}}],
        usage:{completion_tokens:2400}}),{status:200,headers:{'content-type':'application/json'}});
    }});
  await assert.rejects(groq.send({...args,prepareWork:false}),error=>{
    assert.equal(error.orchestratorFailureCode,'groq_incomplete_response');
    assert.equal(error.orchestratorRequestOutcome,'response_invalid');
    assert.equal(error.orchestratorFinishReason,'length');
    assert.equal(error.orchestratorCompletionBudget,2400);
    assert.equal(error.orchestratorCompletionTokens,2400);
    assert.doesNotMatch(error.message,/PARCIAL_NAO_E_CONCLUSAO/);
    return true;
  });
  assert.equal(calls,1,'one definite partial answer must not trigger an automatic second request');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,0);
});

test('Groq finish reasons and bounded token usage are classified without leaking model output',async t=>{
  const f=setup(t),args=await f.ids();
  const reviewContext={phase:'gpt_response_review',reviewEvidence:{runId:'run_finish_1',
    answerStart:'O GPT registrou uma proposta para validar os testes sem alterar o repositório.',
    answerEnd:'Nenhum arquivo foi modificado; falta evidência de integração externa.'}};
  const cases=[
    {reason:'length',code:'groq_incomplete_response',used:3599,budget:3600},
    {reason:'content_filter',code:'groq_response_filtered',used:9,budget:3600},
    {reason:'tool_calls',code:'groq_unexpected_tool_call',used:90,budget:3600},
    {reason:'injected_secret_from_provider',code:'groq_incomplete_response',used:-5,budget:3600}
  ];
  let calls=0;
  const groq=createGroqCoordinatorConversation({store:f.store,getApiKey:()=> 'fixture-secret',
    isEnabled:()=>true,fetchImpl:async()=> {
      const scenario=cases[calls++];
      assert.ok(scenario,'at most one Groq request per explicit call');
      return new Response(JSON.stringify({choices:[{finish_reason:scenario.reason,
        message:{content:'NUNCA_PERSISTIR_TEXTO_PARCIAL'}}],
        usage:{completion_tokens:scenario.used}}),{
        status:200,headers:{'content-type':'application/json'}});
    }});
  for(const scenario of cases){
    await assert.rejects(groq.send({...args,completionProfile:'technical_review',
      prepareWork:false,analysisContext:reviewContext}),error=>{
      assert.equal(error.orchestratorFailureCode,scenario.code);
      assert.equal(error.orchestratorRequestOutcome,'response_invalid');
      assert.equal(error.orchestratorFinishReason,
        scenario.reason==='injected_secret_from_provider'?'unknown':scenario.reason);
      assert.equal(error.orchestratorCompletionBudget,scenario.budget);
      if(scenario.used>=0)assert.equal(error.orchestratorCompletionTokens,scenario.used);
      else assert.equal(error.orchestratorCompletionTokens,undefined);
      assert.doesNotMatch(String(error.message),/NUNCA_PERSISTIR|injected_secret/);
      return true;
    });
  }
  assert.equal(calls,cases.length,'no hidden retry of incomplete, filtered, or tool responses');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,0);
});

test('strict review binds the next step to the decision and rejects contradictory data',async t=>{
  const f=setup(t),args=await f.ids();
  const ctx={phase:'gpt_response_review',reviewEvidence:{runId:'run_step',answerStart:
    'O GPT elaborou uma analise e nao executou alteracoes externas no repositorio.',
    answerEnd:'Uma segunda pergunta precisa exigir provas de idempotencia verificaveis.'}};
  const quote='O GPT elaborou uma analise e nao executou alteracoes externas no repositorio.';
  const valid={runId:'run_step',summary:'O GPT descreveu uma estrategia, sem executar comandos de sistema.',
    reason:'Ainda ha falta de evidencia material e a proxima tarefa deve validar falhas de concorrencia.',
    observedExcerpt:quote,step:{decision:'request_correction',
      nextPrompt:'Corrija a analise e demonstre o caso de crash entre envio e recibo, com testes de concorrencia.'}};
  const invalid=[
    {...valid,step:{decision:'verify_external_effect',nextPrompt:'Envie automaticamente outra mensagem para concluir a tarefa.'}},
    {...valid,step:{decision:'continue_same_conversation',nextPrompt:null}},
    {...valid,step:{decision:'blocked',nextPrompt:null,automaticGPTSendAuthorized:true}},
    {...valid,automaticGPTSendAuthorized:true}
  ];
  let calls=0;
  const groq=createGroqCoordinatorConversation({store:f.store,getApiKey:()=> 'fixture-secret',
    isEnabled:()=>true,fetchImpl:async()=>{
      const payload=calls++===0?valid:invalid[calls-2];
      return apiResponse(JSON.stringify(payload));
    }});
  const result=JSON.parse((await groq.send({...args,completionProfile:'technical_review',
    prepareWork:false,analysisContext:ctx})).content);
  assert.equal(result.decision,'request_correction');
  assert.equal(result.nextPrompt,valid.step.nextPrompt);
  assert.equal(result.step,undefined);
  for(let i=0;i<invalid.length;i++)await assert.rejects(
    groq.send({...args,completionProfile:'technical_review',prepareWork:false,analysisContext:ctx}),
    /groq_review_invalid_next_step|groq_review_invalid_evidence/
  );
  assert.equal(calls,1+invalid.length,'no hidden Groq retry after invalid strict JSON');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,0);
});

test('portable Groq JSON mode preserves the flat review contract',async t=>{
  const f=setup(t),args=await f.ids();
  const ctx={phase:'gpt_response_review',reviewEvidence:{runId:'run_portable',
    answerStart:'A observacao GPT nao comprova efeitos externos sobre os arquivos.',
    answerEnd:'A revisao precisa indicar que o codigo ainda nao foi verificado.'}};
  const flat={runId:'run_portable',decision:'verify_external_effect',
    summary:'A resposta fornece uma proposta tecnica e nao comprova edicao de arquivos.',
    reason:'Sem recibos de alteracao ou testes fisicos, o trabalho permanece pendente de verificacao.',
    observedExcerpt:'A observacao GPT nao comprova efeitos externos sobre os arquivos.',nextPrompt:null};
  const groq=createGroqCoordinatorConversation({store:f.store,getApiKey:()=> 'fixture-secret',
    isEnabled:()=>true,model:'llama-3.3-70b-versatile',fetchImpl:async(_url,options)=>{
      const body=JSON.parse(options.body);
      assert.deepEqual(body.response_format,{type:'json_object'});
      assert.match(body.messages[0].content,/FORMATO JSON: devolva exatamente/);
      return apiResponse(JSON.stringify(flat));
    }});
  const result=JSON.parse((await groq.send({...args,completionProfile:'technical_review',
    prepareWork:false,analysisContext:ctx})).content);
  assert.deepEqual(result,flat,'non-strict configured model remains backward compatible');
});

test('semantic technical review has dedicated bounded Groq reasoning budget and no hidden retry',async t=>{
  const f=setup(t),args=await f.ids();
  const reviewContext={phase:'gpt_response_review',reviewEvidence:{runId:'run_direct',
    answerStart:'O GPT investigou o DOM e sugeriu testes sem modificar arquivos.',
    answerEnd:'O próprio GPT confirmou que nenhuma alteração foi aplicada ou testada.'}};
  let requests=0;
  const groq=createGroqCoordinatorConversation({store:f.store,getApiKey:()=> 'fixture-secret',
    isEnabled:()=>true,fetchImpl:async (_url,options)=>{
      requests++;
      const body=JSON.parse(options.body);
      assert.equal(body.max_completion_tokens,3600);
      assert.equal(body.reasoning_effort,'low');
      assert.equal(body.response_format.type,'json_schema');
      assert.equal(body.response_format.json_schema.strict,true);
      const schema=body.response_format.json_schema.schema;
      assert.equal(schema.additionalProperties,false);
      assert.deepEqual(schema.required,['runId','step','summary','reason','observedExcerpt']);
      assert.equal(schema.properties.decision,undefined);
      assert.equal(schema.properties.nextPrompt,undefined);
      const [followup,terminal]=schema.properties.step.anyOf;
      assert.deepEqual(followup.required,['decision','nextPrompt']);
      assert.deepEqual(terminal.required,['decision','nextPrompt']);
      assert.equal(followup.additionalProperties,false);
      assert.equal(terminal.additionalProperties,false);
      assert.deepEqual(followup.properties.decision.enum,GPT_REVIEW_FOLLOWUP_DECISIONS);
      assert.deepEqual(terminal.properties.decision.enum,GPT_REVIEW_TERMINAL_DECISIONS);
      assert.equal(followup.properties.nextPrompt.type,'string');
      assert.equal(terminal.properties.nextPrompt.type,'null');
      assert.deepEqual(schema.properties.runId.enum,['run_direct']);
      assert.ok(schema.properties.observedExcerpt.enum.length>=2);
      assert.ok(schema.properties.observedExcerpt.enum.every(q=>
        [reviewContext.reviewEvidence.answerStart,reviewContext.reviewEvidence.answerEnd].some(text=>text.includes(q))));
      assert.equal(body.reasoning_format,'hidden');
      assert.equal(body.tools,undefined);
      assert.match(body.messages[0].content,/step e \{decision,nextPrompt\}/);
      return apiResponse(JSON.stringify({
        runId:'run_direct',step:{decision:'verify_external_effect',nextPrompt:null},
        summary:'A resposta tecnica esta observada; sem recibos Git nao ha conclusao comprovada.',
        reason:'Somente o texto GPT esta comprovado; faltam recibos externos de modificacao.',
        observedExcerpt:schema.properties.observedExcerpt.enum[0]
      }));
    }});
  const result=await groq.send({...args,prepareWork:false,completionProfile:'technical_review',
    analysisContext:reviewContext});
  assert.match(result.content,/sem recibos Git/);
  const normalized=JSON.parse(result.content);
  assert.equal(normalized.runId,'run_direct');
  assert.equal(normalized.decision,'verify_external_effect');
  assert.equal(normalized.nextPrompt,null);
  assert.equal(normalized.step,undefined,'the service receives only the canonical flat review');
  assert.equal(requests,1);
  await assert.rejects(groq.send({...args,prepareWork:false,completionProfile:'technical_review',analysisContext:{
    phase:'gpt_response_review',reviewEvidence:{runId:'run_direct',answerStart:'sem citação'}}}),
    /groq_review_context_invalid/);
  assert.equal(requests,1,'missing evidence cannot reach the API');
  await assert.rejects(groq.send({...args,completionProfile:'unbounded'}),/orchestrator_completion_profile_invalid/);
});
