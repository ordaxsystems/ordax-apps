import {validateWorkProposal} from './orchestrator-proposal.mjs';
import {requireConfirmedChatReceipt} from './supervisor-chat-receipt.mjs';
import {assertTaskHasNoUncertainTransport} from './provider-uncertain-run-policy.mjs';
import {diagnoseAgentFailure} from './agent-failure-diagnosis.mjs';

export const STORY_ROUNDS=2;
export const STORY_TURNS=STORY_ROUNDS*2;
const word = text => Array.from(new Set(String(text||'').toLocaleLowerCase('pt-BR')
  .match(/[\p{L}]{5,}/gu)||[])).filter(t=>!['sobre','entre','quando','depois','porque','estava','estavam',
    'havia','ainda','outro','outra','parte','primeira','segunda','trecho','historia','história',
    'continue','resposta','personagens','palavras','palavra','entanto','muito','nessa',
    'nesse','aquele','aquela','foram','seria','passou','certo','sendo'].includes(t));
export function storyContinuityEvidence(text,prior,{required=2}={}) {
  const anchors=word(prior);
  const candidates=new Set(word(text));
  const overlap=anchors.filter(t=>candidates.has(t));
  return {valid:overlap.length>=required,overlap:overlap.slice(0,8),required,
    anchorsAvailable:anchors.length};
}
function witnessedAnswers(engine,row){
  const turns=engine.db.prepare('SELECT ordinal,task_id,prompt FROM lab_autonomous_story_turns WHERE mission_id=? ORDER BY ordinal').all(row.id);
  return turns.map(turn=>({ordinal:turn.ordinal,prompt:turn.prompt,answer:engine.answer(turn.task_id),taskId:turn.task_id}));
}
function storyInstruction(ordinal,prior){
  const labels=['GPT A, primeira rodada','GPT B, primeira rodada','GPT A, segunda rodada','GPT B, segunda rodada'];
  if(ordinal===1)return 'GROQ: invente agora VOCÊ o primeiro parágrafo de uma história original em português. '+
    'Inclua seu parágrafo literalmente no início do prompt como prólogo e peça ao '+labels[0]+
    ' para continuar a cena, com 75 a 110 palavras, criando um protagonista, um objeto e um conflito. '+
    'Defina uma regra de continuidade (por exemplo, uma promessa que não pode ser quebrada).';
  return 'Prepare a próxima instrução ao '+labels[ordinal-1]+' para continuar a MESMA história, '+
    'não recomeçar nem apagar acontecimentos. Inclua no prompt nomes, objetos e consequências COMPROVADOS '+
    'pelo trecho anterior e mantenha a regra dramática já introduzida. A resposta deve ter 75 a 110 palavras. '+
    'Não invente que o GPT respondeu; use somente as respostas comprovadas apresentadas no contexto de análise.';
}
export async function planStoryTurn(engine,row,ordinal){
  const owner=engine.service.orchestrator(row.project_id,row.orchestrator_id);
  const turns=ordinal===1?[]:witnessedAnswers(engine,row);
  if(turns.length!==ordinal-1)throw Error('story_missing_confirmed_turn');
  const previous=turns.at(-1);
  const mission='MISSÃO NARRATIVA AUTÔNOMA: duas rodadas, GPT A e GPT B, quatro envios. '+
    'Você é Groq, coordenador criativo, NÃO é o executor GPT. Missão: '+row.mission+
    '\nETAPA '+ordinal+'/'+STORY_TURNS+': '+storyInstruction(ordinal,previous?.answer||'');
  // No duplicate full project transcript, no repeated historical JSON.
  // The confirmed per-turn answer is passed ONCE as bounded, untrusted data.
  const analysisContext={phase:'narrative_turn',ordinal,
    works:turns.map(t=>({title:'Cena '+t.ordinal,
      messages:[{role:'assistant',content:t.answer.slice(0,1100)}]}))};
  const sendPlan=completionProfile=>engine.service.coordinator.send({
    taskId:owner.chat_task_id,mission,projectId:row.project_id,
    orchestratorId:row.orchestrator_id,analysisContext,prepareWork:true,
    repositoryUrl:null,completionProfile
  });
  let result;
  try{result=await sendPlan('narrative');}
  catch(error){
    // Only an explicitly rejected, truncated Groq response is safe to
    // replan once. Never repeat a timeout, unknown API outcome or GPT send.
    if(error?.orchestratorFailureCode!=='groq_incomplete_response'||
       error?.orchestratorRequestOutcome!=='response_invalid')throw error;
    result=await sendPlan('narrative_recovery');
  }
  const proposal=validateWorkProposal(result?.proposal);
  if(proposal.content.length<100)throw Error('story_scene_prompt_too_short');
  if(previous){
    const continuity=storyContinuityEvidence(proposal.content,previous.answer);
    if(!continuity.valid)throw Error('story_continuity_anchor_missing');
  }
  return proposal;
}
export async function sendStoryTurn(engine,context,row,ordinal){
  engine.service.requireAccess(context,'autonomous_dialogue_start',row.project_id);
  const turn=engine.db.prepare('SELECT task_id,prompt FROM lab_autonomous_story_turns WHERE mission_id=? AND ordinal=?')
    .get(row.id,ordinal);
  if(!turn)throw Error('story_turn_not_prepared');
  assertTaskHasNoUncertainTransport(engine.store,turn.task_id);
  const receipt=await engine.service.provider.send({taskId:turn.task_id,content:turn.prompt,
    draftRevision:null,taskKind:'work'});
  requireConfirmedChatReceipt(receipt);
  const answer=engine.answer(turn.task_id);
  if(answer.length<80)throw Error('story_scene_response_too_short');
  const rows=engine.db.prepare('SELECT task_id FROM lab_autonomous_story_turns WHERE mission_id=? AND ordinal<=? ORDER BY ordinal')
    .all(row.id,ordinal);
  const urls=rows.map(t=>engine.db.prepare('SELECT chat_url FROM tasks WHERE id=?').get(t.task_id)?.chat_url);
  if(new Set(urls).size!==urls.length)throw Error('story_conversations_not_distinct');
}
export async function synthesizeStory(engine,row){
  const owner=engine.service.orchestrator(row.project_id,row.orchestrator_id);
  const turns=witnessedAnswers(engine,row);
  if(turns.length!==STORY_TURNS)throw Error('story_incomplete');
  const analysisContext={phase:'narrative_synthesis',
    works:turns.map(t=>({title:'Cena '+t.ordinal,
      messages:[{role:'assistant',content:t.answer.slice(0,1200)}]}))};
  const mission='SÍNTESE FINAL AUTÔNOMA: você é Groq e deve escrever a versão final coesa '+
    'do conto colaborativo em português. NÃO envie nova mensagem ao GPT. Preserve '+
    'personagens, objeto, conflitos e promessas, sem contradizer as quatro cenas '+
    'OBSERVADAS no contexto de análise. Uma história com início, duas rodadas '+
    'e desfecho; 320 a 450 palavras. Missão original: '+row.mission;
  const sendSynthesis=completionProfile=>engine.service.coordinator.send({
    taskId:owner.chat_task_id,mission,projectId:row.project_id,
    orchestratorId:row.orchestrator_id,analysisContext,prepareWork:false,
    repositoryUrl:null,completionProfile
  });
  let result;
  try{result=await sendSynthesis('narrative');}
  catch(error){
    if(error?.orchestratorFailureCode!=='groq_incomplete_response'||
       error?.orchestratorRequestOutcome!=='response_invalid')throw error;
    result=await sendSynthesis('narrative_recovery');
  }
  const text=String(result?.content||'').trim();
  if(text.length<300||text.length>12000)throw Error('story_synthesis_invalid_length');
  const coverage=turns.map(t=>storyContinuityEvidence(text,t.answer));
  if(coverage.some(c=>!c.valid))throw Error('story_synthesis_coverage_missing');
  return text;
}
export function storyFailureDiagnosis(error,phase){
  const d=diagnoseAgentFailure({
    code:error?.providerFailureCode||error?.message,stage:phase,
    deliveryState:phase.startsWith('story_sending')
      ?error?.providerDeliveryState||'unknown'
      :error?.orchestratorRequestOutcome==='rejected'||error?.orchestratorRequestOutcome==='response_invalid'
        ?'not_submitted':'unknown'
  });
  return d;
}
export async function advanceStory(engine,context,row){
  const state=row.state;
  const plan=/^story_queued_([1-4])$/.exec(state);
  const ready=/^story_ready_([1-4])$/.exec(state);
  let working='';
  try{
    if(plan){
      const ordinal=Number(plan[1]);working='story_planning_'+ordinal;
      engine.move(row.id,state,working);
      const proposal=await planStoryTurn(engine,row,ordinal);
      engine.db.exec('SAVEPOINT autonomous_story_prepare');
      try{
        const task=engine.service.mutate('work_create',{projectId:row.project_id,
          orchestratorId:row.orchestrator_id,title:proposal.title});
        engine.db.prepare('INSERT INTO lab_autonomous_story_turns(mission_id,ordinal,task_id,prompt) VALUES(?,?,?,?)')
          .run(row.id,ordinal,task.taskId,proposal.content);
        engine.move(row.id,working,'story_ready_'+ordinal);
        engine.db.exec('RELEASE SAVEPOINT autonomous_story_prepare');
      }catch(error){
        engine.db.exec('ROLLBACK TO SAVEPOINT autonomous_story_prepare');
        engine.db.exec('RELEASE SAVEPOINT autonomous_story_prepare');
        throw error;
      }
      return {state:'advanced'};
    }
    if(ready){
      const ordinal=Number(ready[1]);
      // Only readiness observation is retried. No submission has been claimed.
      if(typeof engine.service.provider?.ready==='function'){
        try{await engine.service.provider.ready();}
        catch(error){
          const diagnosis=diagnoseAgentFailure({code:error?.providerFailureCode||error?.message,
            stage:'preflight',deliveryState:'not_submitted'});
          if(diagnosis.severity==='wait')return {state:'waiting_provider',diagnosis};
          engine.move(row.id,state,'blocked',{last_error:diagnosis.evidence.code});
          return {state:'blocked',diagnosis};
        }
      }
      working='story_sending_'+ordinal;engine.move(row.id,state,working);
      await sendStoryTurn(engine,context,row,ordinal);
      engine.move(row.id,working,ordinal===STORY_TURNS?'story_ready_synthesis':'story_queued_'+(ordinal+1));
      return {state:'advanced'};
    }
    if(state==='story_ready_synthesis'){
      working='story_synthesizing';engine.move(row.id,state,working);
      const result=await synthesizeStory(engine,row);
      engine.move(row.id,working,'succeeded',{question_final:result});
      return {state:'advanced'};
    }
    return {state:'idle'};
  }catch(error){
    if(!working)throw error;
    const diagnosis=storyFailureDiagnosis(error,working);
    const uncertain=working.startsWith('story_sending')&&error?.providerDeliveryState!=='not_submitted'
      ||!working.startsWith('story_sending')&&
        error?.orchestratorRequestOutcome!=='rejected'&&error?.orchestratorRequestOutcome!=='response_invalid';
    engine.move(row.id,working,uncertain?'reconciliation_required':'blocked',
      {last_error:diagnosis.evidence.code});
    return {state:uncertain?'reconciliation_required':'blocked',diagnosis};
  }
}
