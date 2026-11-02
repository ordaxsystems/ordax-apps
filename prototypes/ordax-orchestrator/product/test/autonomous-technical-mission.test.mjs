import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {recordProviderSubmissionProvenance} from '../src/provider-submission-provenance.mjs';

const quote='nenhuma alteração externa foi comprovada';
const response='O GPT investigou o código e propôs alterações e testes de regressão; nenhuma alteração externa foi comprovada. A validação de efeito deve ser realizada separadamente.';
const instruction='Revise o resultado observado, defina se continua na conversa ou exige outra frente, e produza provas verificáveis.';

function fixture(t,{first='continue_same_conversation',last='verify_external_effect',providerFailure=null}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-semantic-mission-'));
  const store=new Store(path.join(dir,'canonical.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{force:true,recursive:true})});
  const context=Object.freeze({actorId:'owner',clientId:'lab',
    workspaceSessionId:store.getWorkspaceSession().id});
  let plans=0,reviews=0,sends=0;
  const coordinator={
    available:()=>true,
    send:async({prepareWork,analysisContext,mission})=>{
      if(prepareWork){
        plans++;
        assert.match(mission,/missão|MISSÃO/u);
        return {provider:'groq',proposal:{
          title:'Auditoria técnica de um aplicativo',
          content:'Examine o comportamento atual do aplicativo, identifique uma causa raiz e devolva provas ou impedimentos concretos.',
          reason:'O GPT deve realizar a análise antes da próxima decisão.'}};
      }
      reviews++;
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
        observedExcerpt:quote,
        nextPrompt:requiresNext?instruction:null
      })};
    }
  };
  const provider={
    available:()=>true,busy:()=>false,
    send:async({taskId,content})=>{
      sends++;
      if(providerFailure&&providerFailure.at===sends){
        const e=Error('provider_delivery_unknown');
        if(providerFailure.beforeSubmit)e.providerDeliveryState='not_submitted';
        throw e;
      }
      assert.ok(sends<=2,'bounded consent never grants a third GPT send');
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
  const wait=async(ids)=>{
    for(let i=0;i<240;i++){
      const m=service.autonomous.status(context,ids).mission;
      if(['verification_required','budget_exhausted','reconciliation_required','blocked'].includes(m?.state))return m;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw Error('technical_mission_not_terminal_'+service.autonomous.status(context,ids).mission?.state);
  };
  return {store,service,context,setup,start,wait,metrics:()=>({plans,reviews,sends})};
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

test('two-send budget is a hard stop even if Groq requests further corrections',async t=>{
  const f=fixture(t,{first:'request_correction',last:'continue_same_conversation'}),ids=await f.setup();
  await f.start(ids);
  const m=await f.wait(ids);
  assert.equal(m.state,'budget_exhausted');
  assert.equal(m.questionFinal,instruction);
  assert.deepEqual(f.metrics(),{plans:1,reviews:2,sends:2});
  assert.equal((await f.service.autonomous.tick(f.context)).state,'idle');
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
