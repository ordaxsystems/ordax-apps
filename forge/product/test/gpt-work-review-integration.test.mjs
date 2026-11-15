import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {recordProviderSubmissionProvenance} from '../src/provider-submission-provenance.mjs';

function attachVerifiedRun(store,taskId,{question,answer,serial=1}={}) {
  const started=store.beginProviderRun(taskId,question);
  const chatUrl='https://chatgpt.com/c/11111111-2222-4333-8444-'+String(serial).padStart(12,'0');
  store.setChatUrl(taskId,chatUrl);
  const messageId=store.db.prepare("SELECT id FROM messages WHERE task_id=? AND role='user' ORDER BY rowid DESC LIMIT 1").get(taskId).id;
  assert.equal(recordProviderSubmissionProvenance({store,taskId,runId:started.runId,
    messageId,providerPrompt:question,chatUrl,submittedAt:Date.now()}).recorded,true);
  store.appendMessage(taskId,'assistant',answer);
  store.finishRun(taskId,started.runId);
  return started.runId;
}

test('a completed provenance-backed GPT answer is classified by the app-owned policy without another model call',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-app-review-'));
  const store=new Store(path.join(dir,'canonical.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const context=Object.freeze({actorId:'owner',clientId:'lab',workspaceSessionId:store.getWorkspaceSession().id});
  let providerCalls=0;
  const service=new OrchestratorService({store,authorize:({context:c})=>c===context,
    provider:{send:async()=>{providerCalls++;throw Error('must_not_send');}}});
  let n=0;
  const call=(operation,input={})=>service.invoke(context,operation,{requestId:'r'+(++n),...input});
  const projectId=(await call('project_create',{name:'App Windows',objective:'Revisar resposta GPT'})).result.projectId;
  const orchestratorId=(await call('orchestrator_create',{projectId,name:'Forjador',mission:'Revisar resultados'})).result.orchestratorId;
  const taskId=(await call('work_create',{projectId,orchestratorId,title:'Captura DOM'})).result.taskId;
  await call('continuity_set',{projectId,orchestratorId,enabled:true});
  const answer='O GPT analisou a causa, mas nenhum arquivo de producao foi alterado e nenhum teste foi executado.';
  const runId=attachVerifiedRun(store,taskId,{question:'Analise a falha.',answer});
  const source=service.reviewableGPTResult(projectId,orchestratorId,runId);
  assert.equal(source.runId,runId);
  assert.deepEqual(await service.continuation.tick(context),{state:'analyzed',runId});
  assert.equal(providerCalls,0);
  const status=service.continuation.status(projectId,orchestratorId);
  assert.equal(status.latest.reviewDecision.sourceRunId,runId);
  assert.equal(status.latest.reviewDecision.decision,'verify_external_effect');
  assert.equal(status.latest.reviewDecision.reviewProvider,'ordax_app_policy');
  assert.equal(status.latest.reviewDecision.automaticGPTSendAuthorized,false);
  assert.equal(status.latest.reviewDecision.externalEffectVerified,false);
  assert.equal(store.messages(service.orchestrator(projectId,orchestratorId).chat_task_id).length,0,
    'Run review is internal evidence, not a synthetic human conversation turn');
  assert.equal((await service.continuation.tick(context)).state,'idle');
  assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('a Run-specific app-owned review is at-most-once across request IDs, restart and independent work',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-run-review-once-'));
  const file=path.join(dir,'canonical.sqlite');
  let store=new Store(file);
  t.after(()=>{try{store.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});});
  let context={actorId:'owner',clientId:'lab',workspaceSessionId:store.getWorkspaceSession().id};
  const makeService=()=>new OrchestratorService({store,authorize:({context:c})=>
    c.actorId===context.actorId&&c.clientId===context.clientId&&c.workspaceSessionId===context.workspaceSessionId});
  let service=makeService(),serial=0,chatSerial=0;
  const call=(operation,input={})=>service.invoke(context,operation,{requestId:'review-'+(++serial),...input});
  const projectId=(await call('project_create',{name:'Projeto',objective:'Revisao'})).result.projectId;
  const orchestratorId=(await call('orchestrator_create',{projectId,name:'Forjador',mission:'Revisar GPT'})).result.orchestratorId;
  const attach=async title=>{
    const taskId=(await call('work_create',{projectId,orchestratorId,title})).result.taskId;
    return attachVerifiedRun(store,taskId,{serial:++chatSerial,
      question:'Explique o estado sem executar comandos.',
      answer:'Resposta GPT observada; nenhum arquivo de producao foi alterado, portanto efeitos externos precisam de verificacao.'});
  };
  const runId=await attach('Primeira frente');
  const input={projectId,orchestratorId,reviewRunId:runId};
  const first=await call('orchestrator_analyze',input);
  assert.equal(first.status,'succeeded');
  assert.equal(first.result.provider,'ordax_app_policy');
  assert.equal(first.result.reviewDecision.sourceRunId,runId);
  await assert.rejects(call('orchestrator_analyze',input),/orchestrator_run_review_already_attempted/);

  store.close();
  store=new Store(file);
  context={...context,workspaceSessionId:store.getWorkspaceSession().id};
  service=makeService();
  await assert.rejects(call('orchestrator_analyze',input),/orchestrator_run_review_already_attempted/);

  const independentRunId=await attach('Segunda frente');
  const second=await call('orchestrator_analyze',{projectId,orchestratorId,reviewRunId:independentRunId});
  assert.equal(second.status,'succeeded');
  assert.equal(second.result.reviewDecision.sourceRunId,independentRunId);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM lab_command_receipts WHERE operation='orchestrator_analyze' AND status='succeeded'").get().n,2);
  assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
