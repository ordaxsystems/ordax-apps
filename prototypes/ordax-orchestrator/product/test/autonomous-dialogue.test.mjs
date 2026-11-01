import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';

const questionA='Quanto é 7 × 6? Justifique em uma frase.';
const questionB='A primeira resposta confirmou 42. Quanto é 42 × 2 - 5? Justifique.';
const questionC='A segunda resposta confirmou 79. Quanto é 79 + 21? Justifique.';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(t,{failure=null}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-autonomous-dialogue-'));
  const store=new Store(path.join(dir,'one.sqlite'));
  let sends=0,plans=0,allowed=true;
  const context=Object.freeze({actorId:'test-owner',clientId:'one-app',workspaceSessionId:store.getWorkspaceSession().id});
  const coordinator={
    available:()=>true,
    send:async ({analysisContext,prepareWork,mission})=>{
      assert.equal(prepareWork,true,'all coordinator steps are advisory structured plans');
      plans++;
      assert.ok(plans<=6,'no unbounded Groq calls across two distinct missions');
      const phase=mission.includes('Crie apenas UMA pergunta')?'a':mission.includes('Leia a resposta confirmada do GPT A')?'b':'final';
      if(phase==='b'){
        assert.ok(analysisContext.works.some(w=>w.messages.some(m=>m.role==='assistant'&&m.content.includes('42'))),
          'the confirmed GPT A reply, not a guessed answer, must reach Groq');
        assert.match(mission,/resposta confirmada/i);
      }
      if(phase==='final'){
        assert.ok(analysisContext.works.some(w=>w.messages.some(m=>m.role==='assistant'&&m.content.includes('79'))),
          'Groq must read the confirmed GPT B reply');
      }
      const index=phase==='a'?0:phase==='b'?1:2;
      const content=[questionA,questionB,questionC][index];
      return {provider:'groq',content:'Somente proposta',
        proposal:{title:['Pergunta A','Pergunta B','Pergunta C somente proposta'][index],
          content,reason:'Raciocínio contextual limitado ao histórico confirmado'}};
    }
  };
  const provider={
    available:()=>true,busy:()=>false,
    send:async({taskId,content})=>{
      sends++;
      if(failure&&sends===failure.at){
        const error=Error(failure.code);
        if(failure.notSubmitted)error.providerDeliveryState='not_submitted';
        throw error;
      }
      assert.ok(sends<=3,'one failed pre-submit and at most two confirmed sends');
      assert.ok([questionA,questionB].includes(content),'never send GPT C');
      const {runId}=store.beginProviderRun(taskId,content);
      store.event(taskId,'provider.submission.intent',{run_id:runId});
      store.event(taskId,'provider.submission.provenance',{run_id:runId});
      const isFirst=content===questionA;
      const ticket=sends.toString(16).padStart(8,'0');
      store.setChatUrl(taskId,'https://chatgpt.com/c/'+ticket+'-2222-4333-8444-555555555555');
      store.appendMessage(taskId,'assistant',isFirst
        ?'42. O produto de sete por seis é quarenta e dois.'
        :'79. O dobro de quarenta e dois é oitenta e quatro, menos cinco.');
      store.finishRun(taskId,runId);
      return {confirmed:true,deliveryObserved:true,responseObserved:true,effectVerified:false,runId};
    }
  };
  const service=new OrchestratorService({store,coordinator,provider,authorize:({context:c})=>allowed&&c===context});
  t.after(()=>{try{store.close()}catch{}fs.rmSync(dir,{recursive:true,force:true})});
  let n=0;
  const invoke=(operation,input)=>service.invoke(context,operation,{requestId:'r'+(++n),...input});
  const current=()=>({sends,plans});
  const wait=async(final)=>{
    for(let i=0;i<90;i++){
      const m=service.autonomous.status(context,{projectId:ids.projectId,orchestratorId:ids.orchestratorId}).mission;
      if(final.includes(m?.state))return m;
      await sleep(20);
    }
    throw Error('autonomous_test_did_not_finish');
  };
  let ids={};
  const setup=async()=>{
    const p=await invoke('project_create',{name:'Projeto de teste isolado',objective:'Perguntas encadeadas'});
    const o=await invoke('orchestrator_create',{projectId:p.result.projectId,name:'Coordenador Groq',mission:'Analisar respostas reais'});
    ids={projectId:p.result.projectId,orchestratorId:o.result.orchestratorId};
    return ids;
  };
  const start=async(requestId='one_mission',mission='Conduza automaticamente duas perguntas encadeadas; entregue uma proposta final, sem enviar a terceira.')=>
    service.invoke(context,'autonomous_dialogue_start',{...ids,requestId,mission});
  return {store,service,context,invoke,setup,start,wait,current,setAllowed:v=>allowed=v,ids:()=>ids};
}

test('an autonomous mission stays queued while the coordinator is occupied, then resumes without replay',async t=>{
  const f=fixture(t),ids=await f.setup();
  const chat=f.service.orchestrator(ids.projectId,ids.orchestratorId).chat_task_id;
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const occupied=f.service.withCoordinatorTurn(chat,()=>pending);
  assert.equal(f.service.coordinatorTurnBusy(chat),true);
  const accepted=await f.start('queued_while_groq_busy');
  assert.equal(accepted.status,'succeeded');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.service.autonomous.status(f.context,ids).mission.state,'queued');
  assert.deepEqual(f.current(),{sends:0,plans:0});
  release();await occupied;
  await f.service.autonomous.tick(f.context);
  const done=await f.wait(['succeeded','blocked','reconciliation_required']);
  assert.equal(done.state,'succeeded');
  assert.deepEqual(f.current(),{sends:2,plans:3});
});

test('one mission command autonomously runs Groq -> GPT A -> Groq -> GPT B -> Groq, then stops',async t=>{
  const f=fixture(t);await f.setup();
  const accepted=await f.start();
  assert.equal(accepted.status,'succeeded');
  assert.equal(accepted.result.maxGPTSends,2);
  // There are NO follow-up commands, dialog approvals, clicks or step invocations.
  const final=await f.wait(['succeeded','blocked','reconciliation_required']);
  assert.equal(final.state,'succeeded',JSON.stringify(final));
  assert.equal(final.questionFinal,questionC);
  assert.equal(final.distinctConfirmedConversations,true);
  assert.deepEqual(f.current(),{sends:2,plans:3});
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM runs WHERE status='succeeded'").get().n,2);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_task_bindings WHERE kind='work'").get().n,2);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  const again=await f.start();
  assert.equal(again.result.missionId,accepted.result.missionId);
  await f.service.autonomous.tick(f.context);
  assert.deepEqual(f.current(),{sends:2,plans:3},'same request or tick cannot duplicate sends');
});

test('pre-submit failure is blocked with no automatic retry; a distinct new mission starts from zero',async t=>{
  const f=fixture(t,{failure:{at:1,code:'composer_not_found',notSubmitted:true}});await f.setup();
  await f.start();
  const failed=await f.wait(['blocked','reconciliation_required','succeeded']);
  assert.equal(failed.state,'blocked');
  assert.equal(f.current().sends,1);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_autonomous_dialogues WHERE state='blocked'").get().n,1);
  await f.service.autonomous.tick(f.context);
  assert.equal(f.current().sends,1,'not even a failed pre-submit attempt is auto-replayed');
  // New explicit mission scope; its own bound questions and Tasks.
  const fresh=await f.start('new_mission','Refaça do zero duas perguntas em novas conversas.');
  assert.notEqual(fresh.result.missionId,failed.missionId);
  const completed=await f.wait(['succeeded']);
  assert.equal(completed.state,'succeeded');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('unknown transport outcome is quarantined, and process ticks cannot re-send',async t=>{
  const f=fixture(t,{failure:{at:1,code:'provider_dispatch_unknown',notSubmitted:false}});await f.setup();
  await f.start();
  const uncertain=await f.wait(['reconciliation_required','blocked','succeeded']);
  assert.equal(uncertain.state,'reconciliation_required');
  assert.equal(uncertain.requiresReconciliation,true);
  await f.service.autonomous.tick(f.context);
  assert.equal(f.current().sends,1);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('restart quarantines any previously claimed planning or submitting step',async t=>{
  const f=fixture(t);const ids=await f.setup();
  await f.start('crashed_mission');
  await f.wait(['succeeded']);
  const id=f.store.db.prepare('SELECT id FROM lab_autonomous_dialogues ORDER BY rowid DESC LIMIT 1').get().id;
  f.store.db.prepare("UPDATE lab_autonomous_dialogues SET state='sending_b' WHERE id=?").run(id);
  const next=new OrchestratorService({store:f.store,provider:{send:async()=>{throw Error('must_never_replay')}},
    coordinator:{available:()=>true,send:async()=>{throw Error('must_never_replan')}},
    authorize:({context})=>context===f.context});
  assert.equal(next.autonomous.get(id).state,'reconciliation_required');
  assert.equal(next.autonomous.status(f.context,ids).mission.requiresReconciliation,true);
});
