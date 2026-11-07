import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {recordProviderSubmissionProvenance} from '../src/provider-submission-provenance.mjs';

async function reviewed(t,decision='continue_same_conversation') {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-semantic-followup-'));
  const store=new Store(path.join(dir,'canonical.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true})});
  const context=Object.freeze({actorId:'owner',clientId:'windows-lab',
    workspaceSessionId:store.getWorkspaceSession().id});
  const response='O GPT examinou a divergencia de serializacao do DOM e sugeriu testes de regressao, mas nenhum arquivo foi modificado.';
  const nextPrompt='Continue a revisao da causa raiz, preserve o hash exato e apresente testes reproduziveis.';
  let sends=0,seq=0;
  const coordinator={available:()=>true,send:async ({analysisContext})=>{
    assert.equal(analysisContext.phase,'gpt_response_review');
    return {provider:'groq',content:JSON.stringify({
      runId:analysisContext.reviewEvidence.runId,decision,
      summary:'Revisao tecnica recebida, com implementacao e provas ainda pendentes.',
      reason:'A resposta registrada diz que nenhum arquivo foi modificado ou testado.',
      observedExcerpt:'nenhum arquivo foi modificado',
      nextPrompt:['continue_same_conversation','request_correction','new_conversation','new_work'].includes(decision)?nextPrompt:null
    })};
  }};
  const service=new OrchestratorService({store,authorize:({context:c})=>c===context,
    coordinator,provider:{available:()=>true,busy:()=>false,send:async()=>{sends++;throw Error('unexpected_gpt_send')}}});
  const call=(operation,input={},id='req_'+(++seq))=>
    service.invoke(context,operation,{...input,requestId:id});
  const projectId=(await call('project_create',{name:'Projeto de engenharia',objective:'Concluir o app'})).result.projectId;
  const orchestratorId=(await call('orchestrator_create',{projectId,name:'Admin',mission:'Interpretar engenharia real'})).result.orchestratorId;
  const taskId=(await call('work_create',{projectId,orchestratorId,title:'Inspecao W3'})).result.taskId;
  await call('continuity_set',{projectId,orchestratorId,enabled:true});
  const question='Reveja o leitor de mensagens GPT e descreva a causa raiz com evidencias.';
  const started=store.beginProviderRun(taskId,question);
  const chatUrl='https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';
  store.setChatUrl(taskId,chatUrl);
  const messageId=store.db.prepare("SELECT id FROM messages WHERE task_id=? AND role='user' ORDER BY rowid DESC LIMIT 1").get(taskId).id;
  assert.equal(recordProviderSubmissionProvenance({store,taskId,runId:started.runId,
    messageId,providerPrompt:question,chatUrl,submittedAt:Date.now()}).recorded,true);
  store.appendMessage(taskId,'assistant',response);
  store.finishRun(taskId,started.runId);
  assert.deepEqual(await service.continuation.tick(context),{state:'analyzed',runId:started.runId});
  const args={projectId,orchestratorId,reviewRunId:started.runId};
  return {store,service,context,call,args,taskId,runId:started.runId,chatUrl,nextPrompt,
    countSends:()=>sends};
}

test('reviewed GPT response becomes one unsent draft in its original conversation',async t=>{
  const f=await reviewed(t);
  const first=await f.call('continuity_followup_prepare',f.args,'same-request');
  assert.equal(first.status,'succeeded');
  assert.equal(first.result.providerMessagesSent,0);
  assert.equal(first.result.conversationRotated,false);
  assert.equal(first.result.requiresUserSend,true);
  assert.equal(first.result.sourceRunId,f.runId);
  assert.equal(f.store.getTaskDraft(f.taskId).draft,f.nextPrompt);
  assert.equal(f.store.getTask(f.taskId).chat_url,f.chatUrl);
  assert.equal(f.service.continuation.status(f.args.projectId,f.args.orchestratorId).latest.followupPrepared,true);
  const replay=await f.call('continuity_followup_prepare',f.args,'same-request');
  assert.equal(replay.commandId,first.commandId);
  await assert.rejects(f.call('continuity_followup_prepare',f.args,'different-request'),
    /orchestrator_followup_already_prepared/);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM events WHERE kind='orchestrator.followup.prepared'").get().n,1);
  const reopenedService=new OrchestratorService({store:f.store,authorize:({context:c})=>c===f.context});
  assert.equal(reopenedService.continuation.status(f.args.projectId,f.args.orchestratorId).latest.followupPrepared,true);
  await assert.rejects(reopenedService.invoke(f.context,'continuity_followup_prepare',{...f.args,requestId:'after-service-reinitialization'}),
    /orchestrator_followup_already_prepared/);
  assert.equal(f.countSends(),0);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('new conversation archives the previous segment exactly once',async t=>{
  const f=await reviewed(t,'new_conversation');
  const first=await f.call('continuity_followup_prepare',f.args);
  assert.equal(first.result.conversationRotated,true);
  assert.equal(f.store.getTask(f.taskId).chat_url,null);
  assert.equal(f.store.getTaskDraft(f.taskId).draft,f.nextPrompt);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM task_conversations WHERE task_id=? AND status='active'").get(f.taskId).n,0);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM task_conversations WHERE task_id=? AND status='archived'").get(f.taskId).n,1);
  await assert.rejects(f.call('continuity_followup_prepare',f.args),/orchestrator_followup_source_stale/);
  assert.equal(f.countSends(),0);
});

test('human draft is never overwritten by a model decision',async t=>{
  const f=await reviewed(t,'request_correction');
  const original='Texto manual que o operador ainda precisa enviar.';
  f.store.setDraft(f.taskId,original,1);
  await assert.rejects(f.call('continuity_followup_prepare',f.args),/orchestrator_followup_draft_not_empty/);
  assert.equal(f.store.getTaskDraft(f.taskId).draft,original);
  assert.equal(f.store.getTask(f.taskId).chat_url,f.chatUrl);
  assert.equal(f.countSends(),0);
});

test('a verification decision cannot create a new GPT draft',async t=>{
  const f=await reviewed(t,'verify_external_effect');
  await assert.rejects(f.call('continuity_followup_prepare',f.args),/orchestrator_followup_decision_unavailable/);
  assert.equal(f.store.getTaskDraft(f.taskId).draft,'');
  assert.equal(f.countSends(),0);
});

test('paused administrator or foreign Run cannot prepare a follow-up',async t=>{
  const f=await reviewed(t);
  await assert.rejects(f.call('continuity_followup_prepare',{...f.args,reviewRunId:'run_other'}),
    /orchestrator_followup_decision_unavailable/);
  await f.call('orchestrator_pause',{projectId:f.args.projectId,orchestratorId:f.args.orchestratorId,paused:true});
  await assert.rejects(f.call('continuity_followup_prepare',f.args),/orchestrator_paused/);
  assert.equal(f.store.getTaskDraft(f.taskId).draft,'');
});

test('uncertain work receipt quarantines next route without retry',async t=>{
  const f=await reviewed(t);
  const now=f.store.now();
  const statement="INSERT INTO lab_command_receipts "+
    "(id,workspace_session_id,actor_id,client_id,request_id,project_id,operation,input_hash,status,result,created_at,updated_at) "+
    "VALUES(?,?,?,?,?,?,?,?,'uncertain',?,?,?)";
  f.store.db.prepare(statement).run('command_followup_uncertain',f.context.workspaceSessionId,
    f.context.actorId,f.context.clientId,'previous_unknown',f.args.projectId,
    'work_send','digest',JSON.stringify({taskId:f.taskId}),now,now);
  await assert.rejects(f.call('continuity_followup_prepare',f.args),/orchestrator_reconciliation_required/);
  assert.equal(f.store.getTaskDraft(f.taskId).draft,'');
  assert.equal(f.countSends(),0);
});
