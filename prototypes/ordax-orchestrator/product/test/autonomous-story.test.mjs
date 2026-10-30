import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {storyContinuityEvidence} from '../src/autonomous-story.mjs';
import {storyWordCount,assessStoryQuality} from '../src/story-quality.mjs';
import {diagnoseAgentFailure,describeAgentDiagnosticForGroq} from '../src/agent-failure-diagnosis.mjs';

const padStory=(text,target)=>{let out=text,step=0;const additions=[
 'A guardiã insistiu que a promessa permaneceria viva enquanto a chama iluminasse o caminho dos viajantes.',
 'O mapa mudou lentamente, mas Caio recusou esquecer os passageiros e manteve a chave guardada junto da lâmpada.',
 'Amara repetiu que cada escolha teria consequências e que nem o passado nem as memórias deveriam ser apagados.'
];while(storyWordCount(out)<target)out+=' '+additions[(step++)%additions.length];return out;};
const scene=[
 'Caio descobriu uma lâmpada dourada na estação deserta. A guardiã Amara pediu que jamais apagasse a última chama antes de devolver a chave de cobre. Enquanto a chuva batia no telhado, um trem sem passageiros parou na plataforma esquecida. Caio guardou a lâmpada no casaco, ouviu passos vindos do túnel e prometeu a Amara proteger a chama. A promessa custaria sua liberdade, mas ele ainda não sabia disso.',
 'Amara encontrou Caio na plataforma da estação e viu a lâmpada dourada quase apagada. A chave de cobre fazia um ruído estranho dentro do casaco. Ao abrir uma porta do trem, perceberam que a cidade inteira estava desenhada no vidro e que cada estação correspondia a uma memória perdida. Caio recusou apagar a chama, mesmo quando uma sombra ofereceu devolver sua infância em troca. Amara compreendeu que a promessa começava a mudar o mapa.',
 'Caio e Amara desceram do trem levando a lâmpada dourada e a chave de cobre. O mapa das memórias perdidas apontava agora para uma torre inundada, onde a chama poderia libertar os passageiros presos no tempo. Amara contou que o pai de Caio havia construído a torre e desaparecido lá. Caio decidiu entrar na água sem apagar a lâmpada, apesar do vento e das vozes que pediam silêncio. A promessa sobreviveu à travessia.',
 'Na torre inundada, Amara encontrou uma fechadura que reconheceu a chave de cobre. Caio ergueu a lâmpada dourada e a chama revelou os rostos dos passageiros esquecidos. Em vez de apagar a luz, Caio abriu as janelas da torre; o vento espalhou pequenos reflexos que guiaram todos de volta à estação. Amara finalmente contou a verdade: ela era a guardiã daquela última memória. A promessa ficou cumprida sem sacrifício.'
].map(text=>padStory(text,80));
const prompts=[
 'Groq inicia: Na estação deserta, Caio recebeu de Amara uma lâmpada dourada e uma chave de cobre. A promessa era nunca apagar a chama. GPT A, continue a cena original de Caio, Amara, lâmpada e estação com conflito em 90 palavras.',
 'GPT B, continue o mesmo enredo: Caio, Amara, estação, lâmpada dourada e chave de cobre. A promessa era não apagar a chama. Continue o trem e o mapa sem reiniciar a história em 90 palavras.',
 'GPT A, segunda rodada: preserve Caio, Amara, lâmpada dourada, chave de cobre e memórias da estação. Explore a torre inundada, o mapa e a promessa sem apagar a chama, em 90 palavras.',
 'GPT B, segunda rodada: Caio e Amara chegaram à torre inundada com a chave de cobre e a lâmpada dourada. Resolva o conflito das memórias sem apagar a chama, respeitando a promessa, em 90 palavras.'
];
const synthesis=padStory('Na estação deserta, Caio recebeu de Amara uma lâmpada dourada, uma chave de cobre e a promessa de não apagar a chama. No trem silencioso, as memórias perdidas dos passageiros apareciam no mapa gravado no vidro; uma sombra exigiu a luz em troca da infância de Caio, mas ele recusou. Amara revelou que a torre inundada guardava o segredo do pai desaparecido de Caio. Ao atravessar a água com a lâmpada acesa e a chave protegida, os dois chegaram à fechadura da torre. Os passageiros esquecidos viram os reflexos da chama pelas janelas abertas e retornaram à estação. Amara, guardiã da memória, recebeu a chave, e Caio conservou sua liberdade e sua promessa. Assim, o mapa se fechou, a torre deixou de estar inundada e nenhuma memória precisou ser apagada.',345);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function fixture(t,{beforeSendFailure=null,readyCount=0,slowCoordinator=false,oversizedTurn=0,shortFinal=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-story-e2e-'));
 const store=new Store(path.join(dir,'canonical.sqlite'));
 const context=Object.freeze({actorId:'lab-story-owner',clientId:'single-client',workspaceSessionId:store.getWorkspaceSession().id});
 const seen={calls:[],sends:[],ready:0};
 const coordinator={
   available:()=>true,
   send:async payload=>{
     seen.calls.push(payload);
     const turn=seen.calls.length;
     if(slowCoordinator)await pause(10);
     if(turn<=4){
       assert.equal(payload.prepareWork,true);
       assert.match(payload.mission,/MISSÃO NARRATIVA AUTÔNOMA/);
       return {content:'Nova instrução de cena',proposal:{title:'Cena '+turn,content:prompts[turn-1],reason:'Preservar continuidade'}};
     }
     assert.equal(turn,5,'only one synthesis after four confirmed scenes');
     assert.equal(payload.prepareWork,false);
     for(const item of scene)assert.ok(payload.analysisContext.works.some(w=>w.messages.some(m=>m.content.includes(item.slice(0,19)))));
     return {content:shortFinal?synthesis.slice(0,680):synthesis};
   }
 };
 const provider={
   busy:()=>false,
   ready:async()=>{
     seen.ready++;
     if(seen.ready<=readyCount)throw Object.assign(Error('composer_not_found'),{providerDeliveryState:'not_submitted'});
     return true;
   },
   send:async({taskId,content})=>{
     seen.sends.push({taskId,content});
     if(beforeSendFailure&&seen.sends.length===beforeSendFailure.at){
       const err=Error(beforeSendFailure.code);
       if(beforeSendFailure.notSubmitted)err.providerDeliveryState='not_submitted';
       throw err;
     }
     const n=seen.sends.length;assert.ok(content.startsWith(prompts[n-1]),'host preserves Groq scene plan');
     assert.match(content,/CONTRATO DE SAÍDA OBRIGATÓRIO/,'host owns output-length instruction');
     const {runId}=store.beginProviderRun(taskId,content);
     store.event(taskId,'provider.submission.intent',{run_id:runId});
     store.event(taskId,'provider.submission.provenance',{run_id:runId});
     store.setChatUrl(taskId,'https://chatgpt.com/c/'+n.toString(16).padStart(8,'0')+'-1234-4123-8123-123456789012');
     store.appendMessage(taskId,'assistant',oversizedTurn===n?scene[n-1]+' '+('O relógio virou e a chama brilhou na estação mais uma vez. '.repeat(20)):scene[n-1]);
     store.finishRun(taskId,runId);
     return {confirmed:true,deliveryObserved:true,responseObserved:true,effectVerified:false,runId};
   }
 };
 const service=new OrchestratorService({store,coordinator,provider,authorize:({context:c})=>c===context});
 t.after(()=>{store.close();fs.rmSync(dir,{force:true,recursive:true})});
 let req=0;
 const call=(op,p)=>service.invoke(context,op,{...p,requestId:'req_'+(++req)});
 const setup=async()=>{
   const p=(await call('project_create',{name:'Narrativa isolada',objective:'Preservar personagens'})).result.projectId;
   const o=(await call('orchestrator_create',{projectId:p,name:'Groq autor',mission:'Criar história'})).result.orchestratorId;
   return {projectId:p,orchestratorId:o};
 };
 const wait=async(id,term=['succeeded','blocked','reconciliation_required'])=>{
   for(let i=0;i<140;i++){
     const row=service.autonomous.get(id);
     if(term.includes(row.state))return row;
     await pause(30);
   }
   throw Error('story_test_did_not_finish');
 };
 return {service,store,context,seen,setup,wait};
}
test('one story mission autonomously runs Groq A1 B1 A2 B2 Groq final with no other commands',async t=>{
 const f=fixture(t);const ids=await f.setup();
 const receipt=await f.service.invoke(f.context,'autonomous_dialogue_start',{
   ...ids,requestId:'story_one',mode:'story',mission:'Uma história de promessa, chave, lâmpada e memória em dois ciclos'});
 assert.equal(receipt.status,'succeeded');
 const result=await f.wait(receipt.result.missionId);
 assert.equal(result.state,'succeeded',JSON.stringify(result));
 assert.equal(result.question_final,synthesis);
 assert.equal(f.seen.calls.length,5);
 assert.equal(f.seen.sends.length,4);
 const summary=f.service.autonomous.status(f.context,ids).mission;
 assert.equal(summary.mode,'story');assert.equal(summary.maxGPTSends,4);
 assert.equal(summary.storyCycles,2);assert.equal(summary.storyTurns,4);
 const rows=f.store.db.prepare('SELECT ordinal,task_id FROM lab_autonomous_story_turns WHERE mission_id=? ORDER BY ordinal').all(result.id);
 assert.deepEqual(rows.map(r=>r.ordinal),[1,2,3,4]);
 assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM runs WHERE status='succeeded'").get().n,4);
 assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
 const again=await f.service.invoke(f.context,'autonomous_dialogue_start',{
   ...ids,requestId:'story_one',mode:'story',mission:'Uma história de promessa, chave, lâmpada e memória em dois ciclos'});
 assert.equal(again.result.missionId,receipt.result.missionId);
 await f.service.autonomous.tick(f.context);
 assert.equal(f.seen.sends.length,4,'idempotency and tick never dispatch GPT again');
});
test('slow hydration is observed, without burning a send or creating a second work',async t=>{
 const f=fixture(t,{readyCount:2});const ids=await f.setup();
 const r=await f.service.invoke(f.context,'autonomous_dialogue_start',{
   ...ids,requestId:'slow_story',mode:'story',mission:'Uma história com carregamento lento'});
 // One tick may stop at waiting_provider and the next scheduled observer resumes.
 for(let i=0;i<15;i++){
   const row=f.service.autonomous.get(r.result.missionId);
   if(row.state==='succeeded')break;
   await f.service.autonomous.tick(f.context);await pause(15);
 }
 const done=await f.wait(r.result.missionId);
 assert.equal(done.state,'succeeded');
 assert.ok(f.seen.ready>=6);
 assert.equal(f.seen.sends.length,4);
 assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_autonomous_story_turns').get().n,4);
});
test('unknown delivery stops the story; does not resend, infer reply or synthesize',async t=>{
 const f=fixture(t,{beforeSendFailure:{at:2,code:'provider_navigation_timeout',notSubmitted:false}});
 const ids=await f.setup();
 const r=await f.service.invoke(f.context,'autonomous_dialogue_start',{
   ...ids,requestId:'uncertain_story',mode:'story',mission:'Drama de duas rodadas'});
 const done=await f.wait(r.result.missionId);
 assert.equal(done.state,'reconciliation_required');
 assert.equal(f.seen.sends.length,2);
 assert.equal(f.seen.calls.length,2,'never synthesize without four receipts');
 await f.service.autonomous.tick(f.context);assert.equal(f.seen.sends.length,2);
});
test('verified pre-submit failure halts without falsely claiming that a message was sent',async t=>{
 const f=fixture(t,{beforeSendFailure:{at:1,code:'composer_not_found',notSubmitted:true}});
 const ids=await f.setup();
 const r=await f.service.invoke(f.context,'autonomous_dialogue_start',{
   ...ids,requestId:'pre_story',mode:'story',mission:'Narrativa controlada'});
 const done=await f.wait(r.result.missionId);
 assert.equal(done.state,'blocked');
 assert.equal(f.seen.sends.length,1);
 await f.service.autonomous.tick(f.context);
 assert.equal(f.seen.sends.length,1);
});
test('diagnosis separates loading, pre-submit blockers and ambiguous delivery',()=>{
 const loading=diagnoseAgentFailure({code:'composer_not_found',stage:'preflight',deliveryState:'not_submitted'});
 assert.equal(loading.category,'transient_pre_submit_wait');
 assert.equal(loading.operatorAction,'observe_health_again_without_dispatch');
 const auth=diagnoseAgentFailure({code:'chatgpt_login_required',stage:'health',deliveryState:'not_submitted'});
 assert.equal(auth.category,'confirmed_pre_submit_blocker');
 const uncertain=diagnoseAgentFailure({code:'composer_not_found',stage:'sending',deliveryState:'unknown'});
 assert.equal(uncertain.category,'delivery_unconfirmed');
 assert.equal(uncertain.replayAllowed,false);assert.equal(uncertain.autoRetry,false);
 const transcript=describeAgentDiagnosticForGroq(uncertain);
 assert.equal(transcript.mayResend,false);assert.equal(transcript.mayClaimRecovery,false);
 assert.equal(diagnoseAgentFailure({code:'provider_navigation_timeout',deliveryState:'uncertain'}).severity,'stop');
 assert.equal(diagnoseAgentFailure({code:'chatgpt_conversation_load_failed',deliveryState:'not_submitted'}).severity,'stop');
});
test('continuity scoring uses actual observed characters and plot, not arithmetic results',()=>{
 const good=storyContinuityEvidence(prompts[1],scene[0]);
 const bad=storyContinuityEvidence('Escreva uma história inteiramente nova sobre meteorologia.',scene[0]);
 assert.equal(good.valid,true);assert.equal(bad.valid,false);
 assert.ok(good.overlap.length>=2);
});
test('story in-flight restart is quarantined before any model or provider replay',async t=>{
 const f=fixture(t);const ids=await f.setup();
 const r=await f.service.invoke(f.context,'autonomous_dialogue_start',{
   ...ids,requestId:'crash_story',mode:'story',mission:'Narrativa com recuperação'});
 await f.wait(r.result.missionId);
 f.store.db.prepare("UPDATE lab_autonomous_dialogues SET state='story_sending_3' WHERE id=?").run(r.result.missionId);
 const next=new OrchestratorService({store:f.store,
   coordinator:{available:()=>true,send:async()=>{throw Error('unexpected_replan')}},
   provider:{busy:()=>false,send:async()=>{throw Error('unexpected_replay')}},
   authorize:({context})=>context===f.context});
 assert.equal(next.autonomous.get(r.result.missionId).state,'reconciliation_required');
 assert.equal(next.autonomous.status(f.context,ids).mission.requiresReconciliation,true);
});

test('Groq output truncated at the fourth scene is replanned once, never replaying GPT',async t=>{
 const f=fixture(t);const ids=await f.setup();
 const original=f.service.coordinator.send;
 let truncated=0;
 f.service.coordinator.send=async payload=>{
   if(payload.mission.includes('ETAPA 4/4')&&payload.completionProfile==='narrative'&&truncated++===0){
     const error=Error('groq_incomplete_response');
     error.orchestratorFailureCode='groq_incomplete_response';
     error.orchestratorRequestOutcome='response_invalid';
     throw error;
   }
   return original(payload);
 };
 const receipt=await f.service.invoke(f.context,'autonomous_dialogue_start',{
   ...ids,requestId:'truncated_plan',mode:'story',mission:'Quatro cenas e correção de resposta Groq interrompida'});
 const result=await f.wait(receipt.result.missionId);
 assert.equal(result.state,'succeeded');
 assert.equal(truncated,1);
 assert.equal(f.seen.sends.length,4);
 assert.equal(f.seen.calls.length,5,'five accepted coordinator outputs, no duplicated GPT sends');
});
test('Groq timeout is an unknown external outcome and is not automatically repeated',async t=>{
 const f=fixture(t);const ids=await f.setup();
 let calls=0;
 const original=f.service.coordinator.send;
 f.service.coordinator.send=async payload=>{
   calls++;
   if(payload.mission.includes('ETAPA 4/4')){
     const error=Error('groq_request_timeout');
     error.orchestratorFailureCode='groq_request_timeout';
     error.orchestratorRequestOutcome='unknown';
     throw error;
   }
   return original(payload);
 };
 const receipt=await f.service.invoke(f.context,'autonomous_dialogue_start',{
   ...ids,requestId:'unknown_groq',mode:'story',mission:'Quatro cenas sem repetição de timeout'});
 const result=await f.wait(receipt.result.missionId);
 assert.equal(result.state,'reconciliation_required');
 assert.equal(f.seen.sends.length,3);
 await f.service.autonomous.tick(f.context);
 assert.equal(f.seen.sends.length,3);
 assert.equal(calls,4,'the uncertain Groq call is never replayed');
});

test('story quality report counts observed GPT turns, rather than trusting completed runs',()=>{
 const pass=assessStoryQuality(scene,synthesis);
 assert.equal(pass.passed,true,JSON.stringify(pass));
 assert.equal(pass.sceneWords.length,4);
 assert.ok(pass.sceneWords.every(n=>n>=75&&n<=110));
 assert.ok(pass.synthesisWords>=320&&pass.synthesisWords<=450);
 const long=assessStoryQuality([...scene.slice(0,2),scene[2]+' '.repeat(1)+
   'Essa cena acrescentou conteúdo demais sem respeitar os limites. '.repeat(30),scene[3]],synthesis);
 assert.equal(long.passed,false);
 assert.ok(long.violations.includes('scene_3_word_limit'));
 const oversizedFinal=assessStoryQuality(scene,synthesis+' Excesso de palavras de desfecho. '.repeat(60));
 assert.equal(oversizedFinal.passed,false);
 assert.ok(oversizedFinal.violations.includes('synthesis_word_limit'));
});
test('four transport-successful GPT scenes do not count as a quality-successful narrative',async t=>{
 const f=fixture(t,{oversizedTurn:2});const ids=await f.setup();
 const receipt=await f.service.invoke(f.context,'autonomous_dialogue_start',{
   ...ids,requestId:'quality_scene_bad',mode:'story',mission:'Teste de qualidade com cena excessiva'});
 const result=await f.wait(receipt.result.missionId);
 assert.equal(result.state,'blocked');
 assert.equal(result.last_error,'story_quality_policy_failed');
 assert.equal(f.seen.sends.length,4);
 const audit=f.store.db.prepare('SELECT report_json FROM lab_autonomous_story_quality WHERE mission_id=?').get(result.id);
 const quality=JSON.parse(audit.report_json);
 assert.equal(quality.passed,false);
 assert.ok(quality.violations.includes('scene_2_word_limit'));
 assert.equal(f.service.autonomous.status(f.context,ids).mission.quality.passed,false);
 await f.service.autonomous.tick(f.context);
 assert.equal(f.seen.sends.length,4,'quality failure must not trigger a fifth GPT message');
});
test('Groq synthesis out of bounds is rejected after all four independently confirmed turns',async t=>{
 const f=fixture(t,{shortFinal:true});const ids=await f.setup();
 const receipt=await f.service.invoke(f.context,'autonomous_dialogue_start',{
   ...ids,requestId:'quality_final_bad',mode:'story',mission:'Síntese limitada por contagem de palavras'});
 const result=await f.wait(receipt.result.missionId);
 assert.equal(result.state,'blocked');
 assert.equal(result.last_error,'story_quality_policy_failed');
 assert.equal(f.seen.sends.length,4);
 const quality=JSON.parse(f.store.db.prepare('SELECT report_json FROM lab_autonomous_story_quality WHERE mission_id=?').get(result.id).report_json);
 assert.ok(quality.violations.includes('synthesis_word_limit'));
});
