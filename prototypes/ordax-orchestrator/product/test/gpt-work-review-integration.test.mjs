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
