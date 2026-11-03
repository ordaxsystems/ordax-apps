import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {recordProviderSubmissionProvenance} from '../src/provider-submission-provenance.mjs';
import {inspectProviderLinkedThread,reconcileProviderLinkedReply} from '../src/provider-linked-thread-recovery.mjs';

const quote='nenhuma alteração externa foi comprovada';
const response='O GPT investigou o código e propôs alterações e testes de regressão; nenhuma alteração externa foi comprovada. A validação de efeito deve ser realizada separadamente.';
const instruction='Revise o resultado observado, defina se continua na conversa ou exige outra frente, e produza provas verificáveis.';

function fixture(t,{first='continue_same_conversation',last='verify_external_effect',providerFailure=null,lateResponseAt=null,groqTruncateReviews=[],groqFilteredReviews=[],groqInvalidEvidenceReviews=[],groqInvalidNextStepReviews=[],holdAfterFirstReview=false,holdProviderBusyAfterFirstSend=false,
  holdProviderBusyAfterSecondSend=false,maxExpectedSends=2}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-semantic-mission-'));
  const store=new Store(path.join(dir,'canonical.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{force:true,recursive:true})});
  const context=Object.freeze({actorId:'owner',clientId:'lab',
    workspaceSessionId:store.getWorkspaceSession().id});
  let plans=0,reviews=0,sends=0,released=false;
  const coordinator={
    available:()=>true,
    send:async({prepareWork,analysisContext,mission,completionProfile})=>{
      if(prepareWork){
        plans++;
        assert.match(mission,/missão|MISSÃO/u);
        return {provider:'groq',proposal:{
          title:'Auditoria técnica de um aplicativo',
          content:'Examine o comportamento atual do aplicativo, identifique uma causa raiz e devolva provas ou impedimentos concretos.',
          reason:'O GPT deve realizar a análise antes da próxima decisão.'}};
      }
      reviews++;
      assert.equal(completionProfile,'technical_review');
      if(groqInvalidNextStepReviews.includes(reviews)){
        const error=Error('groq_review_invalid_next_step');
        error.orchestratorFailureCode='groq_review_invalid_next_step';
        error.orchestratorRequestOutcome='response_invalid';
        throw error;
      }
      if(groqTruncateReviews.includes(reviews)||groqFilteredReviews.includes(reviews)){
        const filtered=groqFilteredReviews.includes(reviews);
        const code=filtered?'groq_response_filtered':'groq_incomplete_response';
        const error=Error(code);
        error.orchestratorFailureCode=code;
        error.orchestratorRequestOutcome='response_invalid';
        error.orchestratorFinishReason=filtered?'content_filter':'length';
        error.orchestratorCompletionTokens=filtered?14:3599;
        error.orchestratorCompletionBudget=3600;
        throw error;
      }
      assert.equal(analysisContext.phase,'gpt_response_review');
      assert.equal(analysisContext.reviewEvidence.externalEffectsVerified,false);
      assert.match(analysisContext.reviewEvidence.answerStart,/nenhuma alteração externa foi comprovada/);
      const decision=reviews===1?first:last;
      const requiresNext=['continue_same_conversation','request_correction','new_conversation','new_work'].includes(decision);
      return {provider:'groq',content:JSON.stringify({
        runId:analysisContext.reviewEvidence.runId,
        decision,
        summary:'A resposta GPT foi observada, mas a execução externa não foi certificada.',
        reason:'O próprio GPT diz que nenhuma alteração externa foi comprovada; não tratar uma sugestão como execução.',
        observedExcerpt:groqInvalidEvidenceReviews.includes(reviews)
          ?'A saída GPT comprovou uma implantação inexistente.':quote,
        nextPrompt:requiresNext
          ?(maxExpectedSends>2&&reviews>=2
            ?instruction+' Próxima etapa independente '+reviews+': verifique a nova evidência do projeto.'
            :instruction):null
      })};
    }
  };
  const provider={
    available:()=>true,busy:()=>!released&&(
      sends===1&&(holdProviderBusyAfterFirstSend||holdAfterFirstReview&&reviews>=1)||
      sends===2&&holdProviderBusyAfterSecondSend),
    send:async({taskId,content})=>{
      sends++;
      if(lateResponseAt===sends){
        // A real provider can acknowledge the exact GPT submission, but its
        // answer may arrive only after the bounded observation deadline.
        const {runId}=store.beginProviderRun(taskId,content);
        const chatUrl='https://chatgpt.com/c/'+String(sends).padStart(8,'0')+'-2222-4333-8444-555555555555';
        store.setChatUrl(taskId,chatUrl);
        const messageId=store.db.prepare("SELECT id FROM messages WHERE task_id=? AND role='user' ORDER BY rowid DESC LIMIT 1").get(taskId).id;
        assert.equal(recordProviderSubmissionProvenance({
          store,taskId,runId,messageId,providerPrompt:content,
          chatUrl,submittedAt:Date.now()
        }).recorded,true);
        store.finishRun(taskId,runId,'await-response:response_not_observed');
        const error=Error('response_not_observed');
        error.providerDeliveryState='submitted';
        throw error;
      }
      if(providerFailure&&providerFailure.at===sends){
        const e=Error('provider_delivery_unknown');
        if(providerFailure.beforeSubmit)e.providerDeliveryState='not_submitted';
        throw e;
      }
      assert.ok(sends<=maxExpectedSends,'each authorized mission has a bounded GPT send budget');
      assert.ok(content.length>=20);
      const {runId}=store.beginProviderRun(taskId,content);
      const chatUrl='https://chatgpt.com/c/'+String(sends).padStart(8,'0')+'-2222-4333-8444-555555555555';
      // Continuing a thread must preserve the same provider URL.
      const previous=store.getTask(taskId).chat_url;
      store.setChatUrl(taskId,previous||chatUrl);
      const messageId=store.db.prepare("SELECT id FROM messages WHERE task_id=? AND role='user' ORDER BY rowid DESC LIMIT 1").get(taskId).id;
      const proof=recordProviderSubmissionProvenance({store,taskId,runId,messageId,
        providerPrompt:content,chatUrl:previous||chatUrl,submittedAt:Date.now()});
      assert.equal(proof.recorded,true);
      store.appendMessage(taskId,'assistant',response);
      store.finishRun(taskId,runId);
      return {confirmed:true,deliveryObserved:true,responseObserved:true,effectVerified:false,runId};
    }
  };
  const service=new OrchestratorService({store,coordinator,provider,
    authorize:({context:c})=>c===context});
  let seq=0;
  const call=(operation,input={})=>service.invoke(context,operation,{requestId:'req_'+(++seq),...input});
  const setup=async()=>{
    const projectId=(await call('project_create',{name:'Projeto de engenharia',objective:'Corrigir um aplicativo'})).result.projectId;
    const orchestratorId=(await call('orchestrator_create',{projectId,name:'Groq Admin',mission:'Acompanhar evidências reais'})).result.orchestratorId;
    return {projectId,orchestratorId};
  };
  const start=async(ids,requestId='technical_test')=>service.invoke(context,'autonomous_dialogue_start',{
    ...ids,requestId,mode:'technical',mission:'Audite e corrija o aplicativo conforme as evidências do GPT; não presuma commit, teste ou deploy.'
  });
  const waitFor=async(ids,states)=>{
    for(let i=0;i<240;i++){
      const m=service.autonomous.status(context,ids).mission;
      if(states.includes(m?.state))return m;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw Error('technical_mission_not_expected_'+service.autonomous.status(context,ids).mission?.state);
  };
  const wait=async(ids)=>{
    for(let i=0;i<240;i++){
      const m=service.autonomous.status(context,ids).mission;
      if(['verification_required','budget_exhausted','reconciliation_required','blocked'].includes(m?.state))return m;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw Error('technical_mission_not_terminal_'+service.autonomous.status(context,ids).mission?.state);
  };
  return {store,service,coordinator,provider,context,setup,start,wait,waitFor,release:()=>{released=true},metrics:()=>({plans,reviews,sends})};
}

test('semantic owner authorization leads Groq -> GPT -> Groq decision -> same GPT thread -> Groq verification gate',async t=>{
  const f=fixture(t),ids=await f.setup();
  const request=await f.start(ids);
  assert.equal(request.status,'succeeded');
  const m=await f.wait(ids);
  assert.equal(m.state,'verification_required');
  assert.equal(m.mode,'technical');
  assert.equal(m.decision.decision,'verify_external_effect');
  assert.equal(m.decision.externalEffectVerified,false);
  assert.equal(m.taskAId,m.taskBId,'the follow-up stays on one canonical Task');
  assert.equal(m.reviewTasks.length,1,'do not duplicate navigation for same Task');
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:2});
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM runs").get().n,2);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_autonomous_dialogues").get().n,1);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM task_conversations WHERE task_id=?").get(m.taskAId).n,1);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  assert.equal((await f.service.autonomous.tick(f.context)).state,'idle');
});

test('Groq may select another conversation within the same Task without duplicate project',async t=>{
  const f=fixture(t,{first:'new_conversation'}),ids=await f.setup();
  await f.start(ids);
  const m=await f.wait(ids);
  assert.equal(m.state,'verification_required');
  assert.equal(m.taskAId,m.taskBId);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM task_conversations WHERE task_id=?").get(m.taskAId).n,2);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_projects").get().n,1);
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:2});
});

test('Groq may select a separate work front, still within the existing project',async t=>{
  const f=fixture(t,{first:'new_work',last:'candidate_complete'}),ids=await f.setup();
  await f.start(ids);
  const m=await f.wait(ids);
  assert.equal(m.state,'verification_required','candidate complete does not mean external effects verified');
  assert.notEqual(m.taskAId,m.taskBId);
  assert.equal(m.decision.decision,'candidate_complete');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_projects").get().n,1);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_task_bindings WHERE kind='work'").get().n,2);
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:2});
});

test('Groq may stop after first GPT reply when external proof is required',async t=>{
  const f=fixture(t,{first:'verify_external_effect'}),ids=await f.setup();
  await f.start(ids);
  const m=await f.wait(ids);
  assert.equal(m.state,'verification_required');
  assert.equal(m.decision.decision,'verify_external_effect');
  assert.equal(m.taskBId,null);
  assert.deepEqual(f.metrics(),{plans:1,reviews:1,sends:1});
});

test('Groq evidence review proceeds while the independent GPT executor is occupied',async t=>{
  const f=fixture(t,{first:'verify_external_effect',holdProviderBusyAfterFirstSend:true}),ids=await f.setup();
  await f.start(ids);
  const m=await f.wait(ids);
  assert.equal(m.state,'verification_required');
  assert.equal(m.decision.decision,'verify_external_effect');
  assert.equal(m.decision.externalEffectVerified,false);
  assert.deepEqual(f.metrics(),{plans:1,reviews:1,sends:1});
  assert.equal(f.service.executorAdmission().availableSlots,0,
    'a busy GPT provider stays unavailable even though Groq completed its review');
});

test('final Groq evidence review completes while GPT transport remains busy',async t=>{
  const f=fixture(t,{first:'continue_same_conversation',last:'verify_external_effect',
    holdProviderBusyAfterSecondSend:true}),ids=await f.setup();
  await f.start(ids);
  const m=await f.wait(ids);
  assert.equal(m.state,'verification_required');
  assert.equal(m.decision.decision,'verify_external_effect');
  assert.equal(m.decision.externalEffectVerified,false);
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:2});
  assert.equal(f.service.executorAdmission().availableSlots,0);
});

test('two-send budget is a hard stop even if Groq requests further corrections',async t=>{
  const f=fixture(t,{first:'request_correction',last:'continue_same_conversation'}),ids=await f.setup();
  await f.start(ids);
  const m=await f.wait(ids);
  assert.equal(m.state,'budget_exhausted');
  assert.equal(m.questionFinal,instruction);
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:2});
  assert.equal((await f.service.autonomous.tick(f.context)).state,'idle');
});

test('explicit second consent continues the same project through four GPT Runs',async t=>{
  const f=fixture(t,{first:'continue_same_conversation',last:'continue_same_conversation',
    maxExpectedSends:4}),ids=await f.setup();
  await f.start(ids);
  const first=await f.wait(ids);
  assert.equal(first.state,'budget_exhausted');
  assert.equal(first.canContinue,true);
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:2});
  const next=await f.service.invoke(f.context,'autonomous_dialogue_continue',{
    ...ids,sourceMissionId:first.missionId,requestId:'consent_2'});
  assert.equal(next.status,'succeeded');
  assert.equal(next.result.originMissionId,first.missionId);
  assert.equal(next.result.maxGPTSends,2,'each explicit authorization remains bounded');
  const finished=await f.wait(ids);
  assert.equal(finished.state,'budget_exhausted');
  assert.equal(finished.taskAId,first.taskBId);
  assert.deepEqual(f.metrics(),{plans:1,reviews:4,sends:4});
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_projects').get().n,1);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_autonomous_dialogues').get().n,2);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_task_bindings WHERE kind='work'").get().n,1);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,4);
  const idempotent=await f.service.invoke(f.context,'autonomous_dialogue_continue',{
    ...ids,sourceMissionId:first.missionId,requestId:'consent_2'});
  assert.equal(idempotent.result.missionId,finished.missionId);
  assert.deepEqual(f.metrics(),{plans:1,reviews:4,sends:4});
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('a renewed technical consent may open a fresh GPT conversation',async t=>{
  const f=fixture(t,{first:'continue_same_conversation',last:'new_conversation',
    maxExpectedSends:4}),ids=await f.setup();
  await f.start(ids);
  const first=await f.wait(ids);
  assert.equal(first.state,'budget_exhausted');
  const originalSegments=f.store.db.prepare(
    'SELECT COUNT(*) n FROM task_conversations WHERE task_id=?').get(first.taskBId).n;
  await f.service.invoke(f.context,'autonomous_dialogue_continue',{
    ...ids,sourceMissionId:first.missionId,requestId:'consent_new_segment'});
  const second=await f.wait(ids);
  assert.equal(second.state,'budget_exhausted');
  assert.equal(second.taskAId,first.taskBId);
  assert.ok(f.store.db.prepare('SELECT COUNT(*) n FROM task_conversations WHERE task_id=?')
    .get(first.taskBId).n>originalSegments);
  assert.deepEqual(f.metrics(),{plans:1,reviews:4,sends:4});
});

test('Groq new-work decision continues under existing project without duplicate provider',async t=>{
  const f=fixture(t,{first:'continue_same_conversation',last:'new_work',
    maxExpectedSends:4}),ids=await f.setup();
  await f.start(ids);
  const first=await f.wait(ids);
  assert.equal(first.state,'budget_exhausted');
  const consent=await f.service.invoke(f.context,'autonomous_dialogue_continue',{
    ...ids,sourceMissionId:first.missionId,requestId:'consent_new_work'});
  assert.notEqual(consent.result.taskAId,first.taskBId);
  const finished=await f.wait(ids);
  assert.equal(finished.state,'budget_exhausted');
  assert.equal(finished.taskAId,consent.result.taskAId);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_projects').get().n,1);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_autonomous_dialogues').get().n,2);
  assert.deepEqual(f.metrics(),{plans:1,reviews:4,sends:4});
});

test('manual draft entered after consent prevents its next GPT submission',async t=>{
  const f=fixture(t,{first:'continue_same_conversation',last:'continue_same_conversation',
    maxExpectedSends:4,holdProviderBusyAfterSecondSend:true}),ids=await f.setup();
  await f.start(ids);
  const first=await f.wait(ids);
  assert.equal(first.state,'budget_exhausted');
  await f.service.invoke(f.context,'autonomous_dialogue_continue',{
    ...ids,sourceMissionId:first.missionId,requestId:'consent_held'});
  const ready=await f.waitFor(ids,['ready_a']);
  const draft='Uma revisão manual nova impede qualquer envio automático desta etapa.';
  f.store.setDraft(ready.taskAId,draft,1);
  f.release();
  assert.equal((await f.service.autonomous.tick(f.context)).state,'blocked');
  assert.equal(f.service.autonomous.status(f.context,ids).mission.state,'blocked');
  assert.equal(f.store.getTaskDraft(ready.taskAId).draft,draft);
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:2});
});

test('manual GPT Run after consent supersedes the pending third send',async t=>{
  const f=fixture(t,{first:'continue_same_conversation',last:'continue_same_conversation',
    maxExpectedSends:4,holdProviderBusyAfterSecondSend:true}),ids=await f.setup();
  await f.start(ids);
  const source=await f.wait(ids);
  await f.service.invoke(f.context,'autonomous_dialogue_continue',{
    ...ids,sourceMissionId:source.missionId,requestId:'consent_superseded'});
  const pending=await f.waitFor(ids,['ready_a']);
  const other=f.store.beginProviderRun(source.taskBId,
    'Mensagem humana inserida depois da autorização para continuar a missão.');
  f.store.appendMessage(source.taskBId,'assistant',
    'Resposta nova e posterior, desvinculada da decisão Groq anterior.');
  f.store.finishRun(source.taskBId,other.runId);
  f.release();
  assert.equal((await f.service.autonomous.tick(f.context)).state,'blocked');
  assert.equal(f.service.autonomous.status(f.context,ids).mission.state,'blocked');
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:2});
});

test('renewed consent can advance across three bounded cycles without duplicate project',async t=>{
  const f=fixture(t,{first:'continue_same_conversation',last:'continue_same_conversation',
    maxExpectedSends:6}),ids=await f.setup();
  await f.start(ids);
  let current=await f.wait(ids);
  for(let i=2;i<=3;i++){
    assert.equal(current.state,'budget_exhausted');
    assert.equal(current.canContinue,true);
    assert.equal((await f.service.autonomous.tick(f.context)).state,'idle');
    const receipt=await f.service.invoke(f.context,'autonomous_dialogue_continue',{
      ...ids,sourceMissionId:current.missionId,requestId:'consent_cycle_'+i});
    assert.equal(receipt.result.originMissionId,current.missionId);
    current=await f.wait(ids);
  }
  assert.deepEqual(f.metrics(),{plans:1,reviews:6,sends:6});
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_projects').get().n,1);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_autonomous_dialogues').get().n,3);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,6);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('identical Groq prompt cannot be re-sent as a new consent cycle',async t=>{
  const f=fixture(t,{first:'continue_same_conversation',last:'continue_same_conversation'}),ids=await f.setup();
  await f.start(ids);
  const source=await f.wait(ids);
  assert.equal(source.state,'budget_exhausted');
  assert.equal(source.canContinue,false,'the exact last GPT prompt may not be repeated');
  await assert.rejects(f.service.invoke(f.context,'autonomous_dialogue_continue',{
    ...ids,sourceMissionId:source.missionId,requestId:'duplicate_prompt'
  }),/autonomous_continuation_decision_invalid/);
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:2});
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_autonomous_dialogues').get().n,1);
});

test('third GPT reply recovered after restart never repeats its submission',async t=>{
  const f=fixture(t,{first:'continue_same_conversation',last:'continue_same_conversation',
    maxExpectedSends:4,lateResponseAt:3}),ids=await f.setup();
  await f.start(ids);
  const source=await f.wait(ids);
  await f.service.invoke(f.context,'autonomous_dialogue_continue',{
    ...ids,sourceMissionId:source.missionId,requestId:'consent_late_third'});
  const pending=await f.waitFor(ids,['reconciliation_required']);
  assert.equal(pending.lastError,'response_not_observed');
  assert.equal(pending.taskAId,source.taskBId);
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:3});
  await reconcileLateTechnicalAnswer(f,pending.taskAId);
  const restored=new OrchestratorService({store:f.store,coordinator:f.coordinator,provider:f.provider,
    authorize:({context:c})=>c===f.context});
  await restored.autonomous.tick(f.context);
  const result=restored.autonomous.status(f.context,ids).mission;
  assert.equal(result.state,'budget_exhausted');
  assert.deepEqual(f.metrics(),{plans:1,reviews:4,sends:4});
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,4);
});

test('a newer human GPT Run rejects a proposed extra authorization',async t=>{
  const f=fixture(t,{first:'continue_same_conversation',last:'continue_same_conversation',
    maxExpectedSends:4}),
    ids=await f.setup();
  await f.start(ids);
  const first=await f.wait(ids);
  const human=f.store.beginProviderRun(first.taskBId,
    'Uma intervenção posterior supersede a decisão Groq anterior.');
  f.store.appendMessage(first.taskBId,'assistant',
    'A intervenção posterior concluiu um Run diferente, sem autorização da missão.');
  f.store.finishRun(first.taskBId,human.runId);
  await assert.rejects(f.service.invoke(f.context,'autonomous_dialogue_continue',{
    ...ids,sourceMissionId:first.missionId,requestId:'stale_consent'
  }),/autonomous_continuation_source_superseded/);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_autonomous_dialogues').get().n,1);
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:2});
});

test('unknown second-send outcome never retries after an app restart',async t=>{
  const f=fixture(t,{first:'continue_same_conversation',providerFailure:{at:2}}),ids=await f.setup();
  await f.start(ids);
  const m=await f.wait(ids);
  assert.equal(m.state,'reconciliation_required');
  assert.deepEqual(f.metrics(),{plans:1,reviews:1,sends:2});
  const restored=new OrchestratorService({store:f.store,
    authorize:({context:c})=>c===f.context,
    coordinator:{available:()=>true,send:async()=>{throw Error('should_not_replay')}},
    provider:{available:()=>true,busy:()=>false,send:async()=>{throw Error('should_not_replay')}}});
  assert.equal(restored.autonomous.status(f.context,ids).mission.state,'reconciliation_required');
  assert.equal((await restored.autonomous.tick(f.context)).state,'idle');
});

test('generic opt-in review never duplicates Groq interpretation owned by the technical mission',async t=>{
  const f=fixture(t,{first:'candidate_complete'}),ids=await f.setup();
  await f.service.invoke(f.context,'continuity_set',{...ids,requestId:'analysis_optin',enabled:true});
  await f.start(ids);
  const m=await f.wait(ids);
  assert.equal(m.state,'verification_required');
  assert.equal(f.service.continuation.scan(),0);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_continuation_reviews').get().n,0);
  assert.deepEqual(f.metrics(),{plans:1,reviews:1,sends:1});
});

test('human draft added between Groq review and next send blocks automatic GPT without overwriting',async t=>{
  const f=fixture(t,{holdAfterFirstReview:true}),ids=await f.setup();
  await f.start(ids);
  const ready=await f.waitFor(ids,['ready_final']);
  const draft='Minha mensagem manual deve ser preservada, sem envio.';
  f.store.setDraft(ready.taskAId,draft,1);
  f.release();
  assert.equal((await f.service.autonomous.tick(f.context)).state,'blocked');
  assert.equal(f.service.autonomous.status(f.context,ids).mission.state,'blocked');
  assert.equal(f.store.getTaskDraft(ready.taskAId).draft,draft);
  assert.deepEqual(f.metrics(),{plans:1,reviews:1,sends:1});
});

test('a newer Run after Groq decision supersedes the decision and blocks next automatic send',async t=>{
  const f=fixture(t,{holdAfterFirstReview:true}),ids=await f.setup();
  await f.start(ids);
  const ready=await f.waitFor(ids,['ready_final']);
  const extra=f.store.beginProviderRun(ready.taskAId,'Intervenção humana entre etapas');
  f.store.appendMessage(ready.taskAId,'assistant','A intervenção humana alterou o estado da conversa antes do segundo envio.');
  f.store.finishRun(ready.taskAId,extra.runId);
  f.release();
  assert.equal((await f.service.autonomous.tick(f.context)).state,'blocked');
  assert.deepEqual(f.metrics(),{plans:1,reviews:1,sends:1});
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,2);
});

test('a previously accepted technical mission request is idempotent and cannot change its mode',async t=>{
  const f=fixture(t,{first:'blocked'}),ids=await f.setup();
  const a=await f.start(ids,'once');
  const b=await f.start(ids,'once');
  assert.equal(a.result.missionId,b.result.missionId);
  await assert.rejects(f.service.invoke(f.context,'autonomous_dialogue_start',{
    ...ids,requestId:'once',mode:'dialogue',
    mission:'Audite e corrija o aplicativo conforme as evidências do GPT; não presuma commit, teste ou deploy.'
  }),/autonomous_request_conflict/);
  const m=await f.wait(ids);
  assert.equal(m.state,'blocked');
  assert.deepEqual(f.metrics(),{plans:1,reviews:1,sends:1});
});

async function reconcileLateTechnicalAnswer(f,taskId) {
  const run=f.store.db.prepare('SELECT id,status FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 1').get(taskId);
  assert.equal(run.status,'failed');
  const chatUrl=f.store.db.prepare('SELECT chat_url FROM tasks WHERE id=?').get(taskId).chat_url;
  const question=f.store.db.prepare("SELECT content FROM messages WHERE task_id=? AND role='user' ORDER BY rowid DESC LIMIT 1").get(taskId).content;
  let reads=0;
  const worker={
    inspectConversationReadOnly:async requested=>{
      reads++;
      assert.equal(requested,chatUrl);
      return {available:true,domReliable:true,truncated:false,url:chatUrl,
        responseCompletionObserved:true,generationStopVisible:false,
        messages:[{role:'user',text:question},{role:'assistant',text:response}]};
    },
    sendPrompt:async()=>{throw Error('late_recovery_must_never_send')}
  };
  const inspected=await inspectProviderLinkedThread({store:f.store,worker,taskId});
  assert.equal(inspected.threadRendered,true);
  assert.ok(inspected.recoveryPreview?.responseSha256);
  assert.equal((await reconcileProviderLinkedReply({store:f.store,worker,taskId,
    responseSha256:inspected.recoveryPreview.responseSha256})).reconciled,true);
  assert.ok(reads>=2,'reconciliation independently re-observes the completed reply');
  assert.equal(f.store.db.prepare('SELECT status FROM runs WHERE id=?').get(run.id).status,'succeeded');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM events WHERE task_id=? AND kind='provider.response.reconciled'").get(taskId).n,1);
  return run.id;
}

test('late GPT reply resumes a quarantined technical mission after physical-style Store reconciliation',async t=>{
  const f=fixture(t,{first:'verify_external_effect',lateResponseAt:1}),ids=await f.setup();
  await f.start(ids);
  const blocked=await f.waitFor(ids,['reconciliation_required']);
  assert.equal(blocked.lastError,'response_not_observed');
  assert.equal((await f.service.autonomous.tick(f.context)).state,'idle','unreconciled response never triggers Groq');
  assert.deepEqual(f.metrics(),{plans:1,reviews:0,sends:1});
  const originalRun=await reconcileLateTechnicalAnswer(f,blocked.taskAId);
  const restored=new OrchestratorService({store:f.store,coordinator:f.coordinator,provider:f.provider,
    authorize:({context:c})=>c===f.context});
  await restored.autonomous.tick(f.context);
  const resumed=restored.autonomous.status(f.context,ids).mission;
  assert.equal(resumed.state,'verification_required');
  assert.equal(resumed.decision.decision,'verify_external_effect');
  assert.equal(resumed.decision.sourceRunId,originalRun);
  assert.equal(resumed.decision.externalEffectVerified,false);
  assert.deepEqual(f.metrics(),{plans:1,reviews:1,sends:1},'no GPT resend and exactly one Groq review');
  assert.equal((await restored.autonomous.tick(f.context)).state,'idle');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_command_receipts WHERE operation='orchestrator_analyze'").get().n,1);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('reconciled GPT reply can authorize one new Groq-selected question, never repeat the first send',async t=>{
  const f=fixture(t,{first:'continue_same_conversation',last:'candidate_complete',lateResponseAt:1}),ids=await f.setup();
  await f.start(ids);
  const blocked=await f.waitFor(ids,['reconciliation_required']);
  await reconcileLateTechnicalAnswer(f,blocked.taskAId);
  const restored=new OrchestratorService({store:f.store,coordinator:f.coordinator,provider:f.provider,
    authorize:({context:c})=>c===f.context});
  await restored.autonomous.tick(f.context);
  const resumed=restored.autonomous.status(f.context,ids).mission;
  assert.equal(resumed.state,'verification_required');
  assert.equal(resumed.taskAId,resumed.taskBId,'second GPT question continues in the same Task');
  assert.equal(resumed.decision.decision,'candidate_complete');
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:2});
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs WHERE task_id=?').get(blocked.taskAId).n,2);
  assert.equal((await restored.autonomous.tick(f.context)).state,'idle');
});

test('a late answer cannot revive its mission after a newer human Run supersedes that Task',async t=>{
  const f=fixture(t,{first:'verify_external_effect',lateResponseAt:1}),ids=await f.setup();
  await f.start(ids);
  const blocked=await f.waitFor(ids,['reconciliation_required']);
  await reconcileLateTechnicalAnswer(f,blocked.taskAId);
  const human=f.store.beginProviderRun(blocked.taskAId,'Pedido humano posterior, separado da missão.');
  f.store.appendMessage(blocked.taskAId,'assistant','Resposta posterior da intervenção humana, sem revisão Groq da missão.');
  f.store.finishRun(blocked.taskAId,human.runId);
  const restored=new OrchestratorService({store:f.store,coordinator:f.coordinator,provider:f.provider,
    authorize:({context:c})=>c===f.context});
  assert.equal(restored.autonomous.resumeReconciledTechnical(f.context),false);
  assert.equal((await restored.autonomous.tick(f.context)).state,'idle');
  assert.equal(restored.autonomous.status(f.context,ids).mission.state,'reconciliation_required');
  assert.deepEqual(f.metrics(),{plans:1,reviews:0,sends:1});
});

test('a human draft written during late-response recovery prevents autonomous continuation',async t=>{
  const f=fixture(t,{first:'verify_external_effect',lateResponseAt:1}),ids=await f.setup();
  await f.start(ids);
  const blocked=await f.waitFor(ids,['reconciliation_required']);
  await reconcileLateTechnicalAnswer(f,blocked.taskAId);
  const draft='Revisão humana: nenhuma mensagem pode continuar até minha verificação.';
  f.store.setDraft(blocked.taskAId,draft,1);
  const restored=new OrchestratorService({store:f.store,coordinator:f.coordinator,provider:f.provider,
    authorize:({context:c})=>c===f.context});
  assert.equal(restored.autonomous.resumeReconciledTechnical(f.context),false);
  assert.equal((await restored.autonomous.tick(f.context)).state,'idle');
  assert.equal(restored.autonomous.status(f.context,ids).mission.state,'reconciliation_required');
  assert.equal(f.store.getTaskDraft(blocked.taskAId).draft,draft);
  assert.deepEqual(f.metrics(),{plans:1,reviews:0,sends:1});
});

test('invalid-evidence Groq review recovers once against the same confirmed GPT Run',async t=>{
  const f=fixture(t,{first:'verify_external_effect',groqInvalidEvidenceReviews:[1]}),ids=await f.setup();
  await f.start(ids);
  const blocked=await f.waitFor(ids,['reconciliation_required']);
  assert.equal(blocked.lastError,'autonomous_semantic_review_unconfirmed');
  assert.deepEqual(f.metrics(),{plans:1,reviews:1,sends:1});
  const base='technical_'+blocked.missionId+'_a';
  const first=f.store.db.prepare('SELECT status,result FROM lab_command_receipts WHERE request_id=?').get(base);
  assert.equal(first.status,'failed');
  assert.equal(JSON.parse(first.result).failureCode,'groq_review_invalid_evidence');
  const restored=new OrchestratorService({store:f.store,coordinator:f.coordinator,provider:f.provider,
    authorize:({context:c})=>c===f.context});
  await restored.autonomous.tick(f.context);
  const resumed=restored.autonomous.status(f.context,ids).mission;
  assert.equal(resumed.state,'verification_required');
  assert.equal(resumed.decision.decision,'verify_external_effect');
  assert.equal(resumed.decision.externalEffectVerified,false);
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:1},'no GPT replay');
  assert.equal(f.store.db.prepare('SELECT status FROM lab_command_receipts WHERE request_id=?')
    .get(base+'_recovery').status,'succeeded');
  await restored.autonomous.tick(f.context);
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:1});
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('two invalid-evidence Groq reviews quarantine the mission without GPT replay',async t=>{
  const f=fixture(t,{first:'verify_external_effect',groqInvalidEvidenceReviews:[1,2]}),ids=await f.setup();
  await f.start(ids);
  const blocked=await f.waitFor(ids,['reconciliation_required']);
  const restored=new OrchestratorService({store:f.store,coordinator:f.coordinator,provider:f.provider,
    authorize:({context:c})=>c===f.context});
  await restored.autonomous.tick(f.context);
  assert.equal(restored.autonomous.status(f.context,ids).mission.state,'reconciliation_required');
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:1});
  const receipt=f.store.db.prepare('SELECT status,result FROM lab_command_receipts WHERE request_id=?')
    .get('technical_'+blocked.missionId+'_a_recovery');
  assert.equal(receipt.status,'failed');
  assert.equal(JSON.parse(receipt.result).failureCode,'groq_review_invalid_evidence');
  const restarted=new OrchestratorService({store:f.store,coordinator:f.coordinator,provider:f.provider,
    authorize:({context:c})=>c===f.context});
  await restarted.autonomous.tick(f.context);
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:1});
});

test('late second GPT response resumes only final Groq review without third send',async t=>{
  const f=fixture(t,{first:'continue_same_conversation',last:'verify_external_effect',
    lateResponseAt:2}),ids=await f.setup();
  await f.start(ids);
  const pending=await f.waitFor(ids,['reconciliation_required']);
  assert.equal(pending.lastError,'response_not_observed');
  assert.equal(pending.taskAId,pending.taskBId);
  assert.deepEqual(f.metrics(),{plans:1,reviews:1,sends:2});
  const runId=await reconcileLateTechnicalAnswer(f,pending.taskBId);
  const restored=new OrchestratorService({store:f.store,coordinator:f.coordinator,provider:f.provider,
    authorize:({context:c})=>c===f.context});
  await restored.autonomous.tick(f.context);
  const result=restored.autonomous.status(f.context,ids).mission;
  assert.equal(result.state,'verification_required');
  assert.equal(result.decision.sourceRunId,runId);
  assert.equal(result.decision.decision,'verify_external_effect');
  assert.equal(result.decision.externalEffectVerified,false);
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:2});
  assert.equal((await restored.autonomous.tick(f.context)).state,'idle');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('late second GPT reply in new work resumes review without duplicating tasks',async t=>{
  const f=fixture(t,{first:'new_work',last:'candidate_complete',lateResponseAt:2}),ids=await f.setup();
  await f.start(ids);
  const pending=await f.waitFor(ids,['reconciliation_required']);
  assert.notEqual(pending.taskAId,pending.taskBId);
  const runId=await reconcileLateTechnicalAnswer(f,pending.taskBId);
  const restored=new OrchestratorService({store:f.store,coordinator:f.coordinator,provider:f.provider,
    authorize:({context:c})=>c===f.context});
  await restored.autonomous.tick(f.context);
  const m=restored.autonomous.status(f.context,ids).mission;
  assert.equal(m.state,'verification_required');
  assert.equal(m.decision.sourceRunId,runId);
  assert.equal(m.decision.decision,'candidate_complete');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_task_bindings WHERE kind='work'").get().n,2);
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:2});
});

test('human draft blocks late final-response recovery before any Groq replay',async t=>{
  const f=fixture(t,{first:'continue_same_conversation',lateResponseAt:2}),ids=await f.setup();
  await f.start(ids);
  const pending=await f.waitFor(ids,['reconciliation_required']);
  await reconcileLateTechnicalAnswer(f,pending.taskBId);
  const draft='Intervenção humana depois da resposta GPT, sem nova revisão automatizada.';
  f.store.setDraft(pending.taskBId,draft,1);
  const restored=new OrchestratorService({store:f.store,coordinator:f.coordinator,provider:f.provider,
    authorize:({context:c})=>c===f.context});
  assert.equal(restored.autonomous.resumeReconciledTechnical(f.context),false);
  assert.equal((await restored.autonomous.tick(f.context)).state,'idle');
  assert.equal(restored.autonomous.status(f.context,ids).mission.state,'reconciliation_required');
  assert.equal(f.store.getTaskDraft(pending.taskBId).draft,draft);
  assert.deepEqual(f.metrics(),{plans:1,reviews:1,sends:2});
});

test('newer human GPT Run cannot revive an obsolete final Groq review',async t=>{
  const f=fixture(t,{first:'continue_same_conversation',lateResponseAt:2}),ids=await f.setup();
  await f.start(ids);
  const pending=await f.waitFor(ids,['reconciliation_required']);
  await reconcileLateTechnicalAnswer(f,pending.taskBId);
  const extra=f.store.beginProviderRun(pending.taskBId,
    'Pedido posterior do usuário deve invalidar o contexto da revisão anterior.');
  f.store.appendMessage(pending.taskBId,'assistant',
    'Resposta posterior do trabalho humano; nenhuma revisão antiga pode continuar.');
  f.store.finishRun(pending.taskBId,extra.runId);
  const restored=new OrchestratorService({store:f.store,coordinator:f.coordinator,provider:f.provider,
    authorize:({context:c})=>c===f.context});
  assert.equal(restored.autonomous.resumeReconciledTechnical(f.context),false);
  assert.equal((await restored.autonomous.tick(f.context)).state,'idle');
  assert.deepEqual(f.metrics(),{plans:1,reviews:1,sends:2});
});

test('terminal invalid final Groq citation retries final review only once',async t=>{
  const f=fixture(t,{first:'continue_same_conversation',last:'verify_external_effect',
    groqInvalidEvidenceReviews:[2]}),ids=await f.setup();
  await f.start(ids);
  const pending=await f.waitFor(ids,['reconciliation_required']);
  assert.equal(pending.lastError,'autonomous_semantic_review_unconfirmed');
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:2});
  const original=f.store.db.prepare('SELECT status,result FROM lab_command_receipts WHERE request_id=?')
    .get('technical_'+pending.missionId+'_final');
  assert.equal(original.status,'failed');
  assert.equal(JSON.parse(original.result).failureCode,'groq_review_invalid_evidence');
  const restored=new OrchestratorService({store:f.store,coordinator:f.coordinator,provider:f.provider,
    authorize:({context:c})=>c===f.context});
  await restored.autonomous.tick(f.context);
  const m=restored.autonomous.status(f.context,ids).mission;
  assert.equal(m.state,'verification_required');
  assert.equal(m.decision.decision,'verify_external_effect');
  assert.deepEqual(f.metrics(),{plans:1,reviews:3,sends:2});
  assert.equal(f.store.db.prepare('SELECT status FROM lab_command_receipts WHERE request_id=?')
    .get('technical_'+pending.missionId+'_final_recovery').status,'succeeded');
  await restored.autonomous.tick(f.context);
  assert.deepEqual(f.metrics(),{plans:1,reviews:3,sends:2});
});

test('repeated invalid final Groq citation stays quarantined after restart',async t=>{
  const f=fixture(t,{first:'continue_same_conversation',
    groqInvalidEvidenceReviews:[2,3]}),ids=await f.setup();
  await f.start(ids);
  const pending=await f.waitFor(ids,['reconciliation_required']);
  const restored=new OrchestratorService({store:f.store,coordinator:f.coordinator,provider:f.provider,
    authorize:({context:c})=>c===f.context});
  await restored.autonomous.tick(f.context);
  assert.equal(restored.autonomous.status(f.context,ids).mission.state,'reconciliation_required');
  const again=new OrchestratorService({store:f.store,coordinator:f.coordinator,provider:f.provider,
    authorize:({context:c})=>c===f.context});
  await again.autonomous.tick(f.context);
  assert.deepEqual(f.metrics(),{plans:1,reviews:3,sends:2});
  assert.equal(f.store.db.prepare('SELECT status FROM lab_command_receipts WHERE request_id=?')
    .get('technical_'+pending.missionId+'_final_recovery').status,'failed');
});

test('filtered Groq review is quarantined and never repeated after restart',async t=>{
  const f=fixture(t,{first:'verify_external_effect',groqFilteredReviews:[1]}),ids=await f.setup();
  await f.start(ids);
  const pending=await f.waitFor(ids,['reconciliation_required']);
  assert.equal(pending.lastError,'autonomous_semantic_review_unconfirmed');
  assert.deepEqual(f.metrics(),{plans:1,reviews:1,sends:1});
  const requestId='technical_'+pending.missionId+'_a';
  const first=f.store.db.prepare('SELECT status,result FROM lab_command_receipts WHERE request_id=?')
    .get(requestId);
  assert.equal(first.status,'failed');
  const result=JSON.parse(first.result);
  assert.equal(result.failureCode,'groq_response_filtered');
  assert.equal(result.finishReason,'content_filter');
  assert.equal(result.completionTokens,14);
  assert.equal(result.completionBudget,3600);
  const restored=new OrchestratorService({store:f.store,coordinator:f.coordinator,provider:f.provider,
    authorize:({context:c})=>c===f.context});
  await restored.autonomous.tick(f.context);
  assert.equal(restored.autonomous.status(f.context,ids).mission.state,'reconciliation_required');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_command_receipts WHERE request_id=?')
    .get(requestId+'_recovery').n,0);
  assert.deepEqual(f.metrics(),{plans:1,reviews:1,sends:1});
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('real-world incompatible Groq next step is recovered once against the confirmed GPT Run',async t=>{
  const f=fixture(t,{first:'verify_external_effect',last:'verify_external_effect',
    groqInvalidNextStepReviews:[1]}),ids=await f.setup();
  await f.start(ids);
  const pending=await f.waitFor(ids,['reconciliation_required']);
  assert.equal(pending.lastError,'autonomous_semantic_review_unconfirmed');
  assert.deepEqual(f.metrics(),{plans:1,reviews:1,sends:1});
  const firstId='technical_'+pending.missionId+'_a';
  const firstReceipt=f.store.db.prepare('SELECT status,result FROM lab_command_receipts WHERE request_id=?').get(firstId);
  assert.equal(firstReceipt.status,'failed');
  assert.equal(JSON.parse(firstReceipt.result).failureCode,'groq_review_invalid_next_step');
  const originalRun=f.store.db.prepare('SELECT id,status FROM runs ORDER BY rowid DESC LIMIT 1').get();
  assert.equal(originalRun.status,'succeeded');
  const restarted=new OrchestratorService({store:f.store,coordinator:f.coordinator,provider:f.provider,
    authorize:({context:c})=>c===f.context});
  await restarted.autonomous.tick(f.context);
  const recovered=restarted.autonomous.status(f.context,ids).mission;
  assert.equal(recovered.state,'verification_required');
  assert.equal(recovered.decision.sourceRunId,originalRun.id);
  assert.equal(recovered.decision.externalEffectVerified,false);
  const recoveryReceipt=f.store.db.prepare('SELECT status,result FROM lab_command_receipts WHERE request_id=?')
    .get(firstId+'_recovery');
  assert.equal(recoveryReceipt.status,'succeeded');
  assert.equal(JSON.parse(recoveryReceipt.result).reviewDecision.sourceRunId,originalRun.id);
  await restarted.autonomous.tick(f.context);
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:1},
    'the successful GPT send is never duplicated during strict review recovery');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('two incompatible Groq decisions quarantine the mission without a third retry or GPT replay',async t=>{
  const f=fixture(t,{first:'verify_external_effect',last:'verify_external_effect',
    groqInvalidNextStepReviews:[1,2]}),ids=await f.setup();
  await f.start(ids);
  const pending=await f.waitFor(ids,['reconciliation_required']);
  const firstId='technical_'+pending.missionId+'_a';
  const restarted=new OrchestratorService({store:f.store,coordinator:f.coordinator,provider:f.provider,
    authorize:({context:c})=>c===f.context});
  await restarted.autonomous.tick(f.context);
  assert.equal(restarted.autonomous.status(f.context,ids).mission.state,'reconciliation_required');
  const once=f.store.db.prepare('SELECT status,result FROM lab_command_receipts WHERE request_id=?')
    .get(firstId+'_recovery');
  assert.equal(once.status,'failed');
  assert.equal(JSON.parse(once.result).failureCode,'groq_review_invalid_next_step');
  const other=new OrchestratorService({store:f.store,coordinator:f.coordinator,provider:f.provider,
    authorize:({context:c})=>c===f.context});
  await other.autonomous.tick(f.context);
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:1});
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('terminal truncated Groq review can recover once without replaying the GPT Run',async t=>{
  const f=fixture(t,{first:'verify_external_effect',groqTruncateReviews:[1]}),ids=await f.setup();
  await f.start(ids);
  const blocked=await f.waitFor(ids,['reconciliation_required']);
  assert.equal(blocked.lastError,'autonomous_semantic_review_unconfirmed');
  assert.deepEqual(f.metrics(),{plans:1,reviews:1,sends:1});
  const firstId='technical_'+blocked.missionId+'_a';
  const failed=f.store.db.prepare('SELECT status,result FROM lab_command_receipts WHERE request_id=?').get(firstId);
  assert.equal(failed.status,'failed');
  assert.equal(JSON.parse(failed.result).failureCode,'groq_incomplete_response');
  const restored=new OrchestratorService({store:f.store,coordinator:f.coordinator,provider:f.provider,
    authorize:({context:c})=>c===f.context});
  await restored.autonomous.tick(f.context);
  const resumed=restored.autonomous.status(f.context,ids).mission;
  assert.equal(resumed.state,'verification_required');
  assert.equal(resumed.decision.decision,'verify_external_effect');
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:1},'only the Groq review is repeated');
  const retry=f.store.db.prepare('SELECT status,result FROM lab_command_receipts WHERE request_id=?')
    .get(firstId+'_recovery');
  assert.equal(retry.status,'succeeded');
  assert.equal(JSON.parse(retry.result).reviewDecision.externalEffectVerified,false);
  await restored.autonomous.tick(f.context);
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:1});
});

test('second truncated review exhausts the Groq recovery with zero GPT replay',async t=>{
  const f=fixture(t,{first:'verify_external_effect',groqTruncateReviews:[1,2]}),ids=await f.setup();
  await f.start(ids);
  const blocked=await f.waitFor(ids,['reconciliation_required']);
  const restored=new OrchestratorService({store:f.store,coordinator:f.coordinator,provider:f.provider,
    authorize:({context:c})=>c===f.context});
  await restored.autonomous.tick(f.context);
  assert.equal(restored.autonomous.status(f.context,ids).mission.state,'reconciliation_required');
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:1});
  await restored.autonomous.tick(f.context);
  const newer=new OrchestratorService({store:f.store,coordinator:f.coordinator,provider:f.provider,
    authorize:({context:c})=>c===f.context});
  await newer.autonomous.tick(f.context);
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:1});
  const retry=f.store.db.prepare('SELECT status FROM lab_command_receipts WHERE request_id=?')
    .get('technical_'+blocked.missionId+'_a_recovery');
  assert.equal(retry.status,'failed');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
