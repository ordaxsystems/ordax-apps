import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {recordProviderSubmissionProvenance} from '../src/provider-submission-provenance.mjs';
import {buildCoordinatorRequestContext} from '../supervisor/coordinator-request-context.mjs';

test('a completed, provenance-backed GPT answer is read and classified by Groq as evidence, not as execution',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-real-answer-review-'));
  const store=new Store(path.join(dir,'canonical.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const context=Object.freeze({actorId:'owner',clientId:'lab',workspaceSessionId:store.getWorkspaceSession().id});
  let reviews=0;let observed=null;
  const coordinator={available:()=>true,send:async ({analysisContext,prepareWork})=>{
    if(prepareWork)throw Error('unexpected_proposal');
    reviews++;
    observed=analysisContext;
    assert.equal(analysisContext.phase,'gpt_response_review');
    assert.equal(analysisContext.reviewEvidence.runStatus,'succeeded');
    assert.equal(analysisContext.reviewEvidence.externalEffectsVerified,false);
    const modelText=analysisContext.reviewEvidence.answerStart;
    assert.match(modelText,/nenhum arquivo de producao foi alterado/i);
    const quote='nenhum arquivo de producao foi alterado';
    assert.ok(modelText.includes(quote));
    return {provider:'groq',content:JSON.stringify({
      runId:analysisContext.reviewEvidence.runId,
      decision:'verify_external_effect',
      summary:'O GPT explicou a hipótese e sugeriu um patch, mas não realizou a alteração.',
      reason:'A resposta diz explicitamente que o código continua sem modificação, exigindo prova independente.',
      observedExcerpt:quote,nextPrompt:null
    })};
  }};
  const provider={available:()=>true,busy:()=>false,send:async()=>{throw Error('gpt_send_must_not_run')}};
  const service=new OrchestratorService({store,authorize:({context:c})=>c===context,coordinator,provider});
  let n=0;
  const call=(operation,input={})=>service.invoke(context,operation,{requestId:'r'+(++n),...input});
  const projectId=(await call('project_create',{name:'App Windows',objective:'Consertar a leitura do GPT'})).result.projectId;
  const orchestratorId=(await call('orchestrator_create',{projectId,name:'Admin Groq',mission:'Analisar resultados de engenharia'})).result.orchestratorId;
  const taskId=(await call('work_create',{projectId,orchestratorId,title:'Correcao da leitura DOM'})).result.taskId;
  await call('continuity_set',{projectId,orchestratorId,enabled:true});
  await call('continuity_proposals_set',{projectId,orchestratorId,enabled:true});
  const question='Reveja o erro de captura da mensagem e proponha a alteracao necessaria.';
  const answer='O GPT analisou as causas da divergencia entre innerText e textContent. Um patch foi proposto, mas nenhum arquivo de producao foi alterado e nenhum teste foi executado.';
  const started=store.beginProviderRun(taskId,question);
  const chatUrl='https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';
  store.setChatUrl(taskId,chatUrl);
  const messageId=store.db.prepare("SELECT id FROM messages WHERE task_id=? AND role='user' ORDER BY rowid DESC LIMIT 1").get(taskId)?.id;
  assert.equal(recordProviderSubmissionProvenance({store,taskId,runId:started.runId,
    messageId,providerPrompt:question,chatUrl,submittedAt:Date.now()}).recorded,true);
  store.appendMessage(taskId,'assistant',answer);
  store.finishRun(taskId,started.runId);
  const source=service.reviewableGPTResult(projectId,orchestratorId,started.runId);
  assert.equal(source?.runId,started.runId);
  assert.ok(source.observedAnswer.includes('nenhum arquivo de producao foi alterado'));
  const prompt=buildCoordinatorRequestContext({store,taskId:service.orchestrator(projectId,orchestratorId).chat_task_id,
    mission:'Interprete o resultado, sem inventar execucao',projectId,orchestratorId,
    analysisContext:{phase:'gpt_response_review',works:[],reviewEvidence:{answerStart:source.head}}});
  assert.deepEqual(prompt.history,[],'old Groq turns cannot displace the actual GPT answer');
  assert.deepEqual(await service.continuation.tick(context),{state:'analyzed',runId:started.runId});
  assert.equal(reviews,1);
  const status=service.continuation.status(projectId,orchestratorId);
  assert.equal(status.latest.reviewDecision.decision,'verify_external_effect');
  assert.equal(status.latest.reviewDecision.automaticGPTSendAuthorized,false);
  assert.equal(status.latest.reviewDecision.externalEffectVerified,false);
  assert.equal((await service.continuation.tick(context)).state,'idle');
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM lab_next_proposals').get().n,0);
  assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  assert.equal(observed.works.length,1);
});

test('a Run-specific Groq review is at-most-once across new request IDs, Store restart and independent work',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-run-review-once-'));
  const file=path.join(dir,'canonical.sqlite');
  let store=new Store(file);
  t.after(()=>{try{store.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});});
  let sends=0;
  let holdNext=null;
  const coordinator={available:()=>true,send:async ({analysisContext})=>{
    sends++;
    if(holdNext)await holdNext;
    assert.equal(analysisContext.phase,'gpt_response_review');
    const evidence=analysisContext.reviewEvidence;
    return {provider:'groq',content:JSON.stringify({
      runId:evidence.runId,decision:'verify_external_effect',
      summary:'Resposta GPT observada, efeitos externos ainda nao verificados.',
      reason:'Um recibo de resposta nao prova modificacao de recurso externo.',
      observedExcerpt:'nenhum arquivo de producao foi alterado',nextPrompt:null
    })};
  }};
  const provider={available:()=>true,busy:()=>false,send:async()=>{throw Error('unexpected_gpt_send')}};
  let context={actorId:'owner',clientId:'lab',workspaceSessionId:store.getWorkspaceSession().id};
  const newService=()=>new OrchestratorService({store,authorize:({context:c})=>
    c.actorId===context.actorId&&c.clientId===context.clientId&&
    c.workspaceSessionId===context.workspaceSessionId,coordinator,provider});
  let service=newService();
  let serial=0;
  const call=(operation,input={})=>service.invoke(context,operation,{requestId:'review-once-'+(++serial),...input});
  const projectId=(await call('project_create',{name:'Projeto',objective:'E2E de revisao'})).result.projectId;
  const orchestratorId=(await call('orchestrator_create',{projectId,name:'Groq',mission:'Revisar GPT'})).result.orchestratorId;
  let chatSerial=0;
  const attach=async title=>{
    const taskId=(await call('work_create',{projectId,orchestratorId,title})).result.taskId;
    const question='Explique um caso de seguranca com recibos incertos sem executar comandos.';
    const started=store.beginProviderRun(taskId,question);
    const chatUrl='https://chatgpt.com/c/11111111-2222-4333-8444-'+String(++chatSerial).padStart(12,'0');
    store.setChatUrl(taskId,chatUrl);
    const messageId=store.db.prepare("SELECT id FROM messages WHERE task_id=? AND role='user' ORDER BY rowid DESC LIMIT 1").get(taskId).id;
    assert.equal(recordProviderSubmissionProvenance({store,taskId,runId:started.runId,
      messageId,providerPrompt:question,chatUrl,submittedAt:Date.now()}).recorded,true);
    store.appendMessage(taskId,'assistant','O GPT concluiu a hipotese mas nenhum arquivo de producao foi alterado; verificar evidencia externa.');
    store.finishRun(taskId,started.runId);
    return started.runId;
  };
  const runId=await attach('Primeira frente');
  const input={projectId,orchestratorId,reviewRunId:runId};
  const first=await call('orchestrator_analyze',input);
  assert.equal(first.status,'succeeded');
  assert.equal(first.result.reviewDecision.sourceRunId,runId);
  assert.equal(sends,1);
  const same=await service.invoke(context,'orchestrator_analyze',{...input,requestId:'review-once-'+serial});
  assert.deepEqual(same,first,'repeated exact request returns the existing receipt');
  await assert.rejects(call('orchestrator_analyze',input),/orchestrator_run_review_already_attempted/);
  assert.equal(sends,1);
  store.close();
  store=new Store(file);
  context={...context,workspaceSessionId:store.getWorkspaceSession().id};
  service=newService();
  await assert.rejects(call('orchestrator_analyze',input),/orchestrator_run_review_already_attempted/);
  assert.equal(sends,1,'restart cannot trigger a second Groq call');
  const independentRunId=await attach('Segunda frente');
  const second=await call('orchestrator_analyze',{projectId,orchestratorId,reviewRunId:independentRunId});
  assert.equal(second.status,'succeeded');
  assert.equal(second.result.reviewDecision.sourceRunId,independentRunId);
  assert.equal(sends,2,'distinct verified work remains eligible');
  // Crash after reserve, with a lost Groq acknowledgement: the receipt keeps
  // the Run identity. Another UI and a subsequent restart cannot replay it.
  const interruptedRunId=await attach('Terceira frente');
  let releaseInterrupted;
  holdNext=new Promise(resolve=>{releaseInterrupted=resolve;});
  const interruptedInput={projectId,orchestratorId,reviewRunId:interruptedRunId};
  const pending=call('orchestrator_analyze',interruptedInput);
  await new Promise(resolve=>setImmediate(resolve));
  const inflightReceipt=store.db.prepare("SELECT id,status,result FROM lab_command_receipts WHERE operation='orchestrator_analyze' ORDER BY rowid DESC LIMIT 1").get();
  assert.equal(inflightReceipt.status,'running');
  assert.equal(JSON.parse(inflightReceipt.result).reviewRunId,interruptedRunId);
  await assert.rejects(call('orchestrator_analyze',interruptedInput),
    /orchestrator_run_review_already_attempted|orchestrator_coordinator_busy/);
  assert.equal(sends,3);
  service.recoverInterruptedCommands();
  assert.equal(store.db.prepare('SELECT status FROM lab_command_receipts WHERE id=?').get(inflightReceipt.id).status,'uncertain');
  releaseInterrupted();
  holdNext=null;
  const unreconciled=await pending;
  assert.equal(unreconciled.status,'uncertain');
  await assert.rejects(call('orchestrator_analyze',interruptedInput),/orchestrator_run_review_already_attempted/);
  store.close();
  store=new Store(file);
  context={...context,workspaceSessionId:store.getWorkspaceSession().id};
  service=newService();
  await assert.rejects(call('orchestrator_analyze',interruptedInput),/orchestrator_run_review_already_attempted/);
  assert.equal(sends,3,'lost acknowledgement never causes a fourth Groq request');

  // Revoke/pause during a fourth in-flight review; fast resume must not
  // discard the Run marker or certify a delayed model response.
  const pausedRunId=await attach('Quarta frente');
  let releasePaused;
  holdNext=new Promise(resolve=>{releasePaused=resolve;});
  const pausedInput={projectId,orchestratorId,reviewRunId:pausedRunId};
  const pausedPromise=call('orchestrator_analyze',pausedInput);
  await new Promise(resolve=>setImmediate(resolve));
  const pausedReceipt=store.db.prepare("SELECT id,result FROM lab_command_receipts WHERE operation='orchestrator_analyze' ORDER BY rowid DESC LIMIT 1").get();
  assert.equal(JSON.parse(pausedReceipt.result).reviewRunId,pausedRunId);
  await call('orchestrator_pause',{projectId,orchestratorId,paused:true});
  const quarantined=store.db.prepare('SELECT status,result FROM lab_command_receipts WHERE id=?').get(pausedReceipt.id);
  assert.equal(quarantined.status,'uncertain');
  assert.equal(JSON.parse(quarantined.result).reviewRunId,pausedRunId);
  await call('orchestrator_pause',{projectId,orchestratorId,paused:false});
  releasePaused();
  holdNext=null;
  assert.equal((await pausedPromise).status,'uncertain');
  await assert.rejects(call('orchestrator_analyze',pausedInput),/orchestrator_run_review_already_attempted/);
  assert.equal(sends,4,'rapid pause and resume did not duplicate Groq');
  assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
