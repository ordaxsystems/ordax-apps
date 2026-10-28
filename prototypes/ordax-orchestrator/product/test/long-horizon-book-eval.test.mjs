import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { suggestFromExplicitText } from '../src/memory-suggestions.mjs';
import { Store } from '../src/store.mjs';

const require=createRequire(import.meta.url);
const scripts=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../scripts');
const {createLongHorizonScenario,chapterWordCount,extractArchiveReferenceFromPrompt,wordCount,gradeLedgerAnswer,gradeContinuityAnswer,isExplicitAbstention}=require(path.join(scripts,'long-horizon-book-eval.cjs'));

test('long-horizon challenge uses independent secrets and never leaks the seed into the post-rotation request',()=>{
  const generated=['9f'.repeat(32),'24'.repeat(32),'5c'.repeat(32)];
  let calls=0;
  const scenario=createLongHorizonScenario({uuid:()=>generated[calls++]});
  assert.equal(calls,3);
  assert.equal(new Set([scenario.sealedSecret,scenario.probeNonce,scenario.archiveReference]).size,3);
  assert.match(scenario.firstPrompt,new RegExp(scenario.sealedSecret));
  assert.match(scenario.firstPrompt,new RegExp(scenario.archiveReference));
  assert.doesNotMatch(scenario.finalPrompt,new RegExp(scenario.sealedSecret));
  assert.doesNotMatch(scenario.finalPrompt,new RegExp(scenario.archiveReference));
  assert.match(scenario.finalPrompt,new RegExp(scenario.probeNonce));
  assert.match(scenario.finalPrompt,/Arco-Luar/);
  assert.equal(scenario.memoriesToAccept(1).find(item=>item.key==='Segredo do selo')?.content,scenario.sealedSecret);
  assert.equal(scenario.promptForTurn(25).kind,'continuation_probe');
  assert.equal(scenario.promptForTurn(25).prompt.includes(scenario.sealedSecret),false);
  assert.match(scenario.finalPrompt,/capitulo_24 deve ser o pr[oó]prio texto narrativo/i);
  assert.doesNotMatch(scenario.finalPrompt,/04:10|04:17/);
  assert.doesNotMatch(scenario.finalPrompt,/altura de Lia nunca foi informada/i);
  assert.match(scenario.promptForTurn(9).prompt,/Horário provisório.{0,30}04:10/i);
  assert.match(scenario.promptForTurn(18).prompt,/04:17.{0,120}04:10/i);
  assert.deepEqual(scenario.memoriesToAccept(9).find(item=>item.key==='Horário da cápsula')?.content,
    'Horário provisório: 04:10, inferido do relógio não calibrado da estação; ainda sem confirmação independente.');
  assert.match(scenario.memoriesToAccept(18).find(item=>item.key==='Horário da cápsula')?.content||'',/04:17.{0,100}04:10/);
  assert.equal(scenario.memoriesToAccept(24).some(item=>item.key==='Condição do desfecho'),true);
});

test('persistence grader independently recovers the noncanonical archive reference from the original prompt',()=>{
  const values=['a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d','b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d','c1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'];
  let index=0;
  const scenario=createLongHorizonScenario({uuid:()=>values[index++]});
  assert.equal(extractArchiveReferenceFromPrompt(scenario.firstPrompt),scenario.archiveReference);
  assert.equal(extractArchiveReferenceFromPrompt('sem referência histórica'),'');
  let longIndex=0;
  const longValues=['a','b','c'].map(character=>character.repeat(64));
  const longScenario=createLongHorizonScenario({uuid:()=>longValues[longIndex++]});
  assert.equal(extractArchiveReferenceFromPrompt(longScenario.firstPrompt),longScenario.archiveReference);
});

test('25-turn book challenge retrieves a noncanonical first-turn reference after provider rotation',t=>{
  const scenario=createLongHorizonScenario({uuid:(()=>{let n=0;return()=>`history-${++n}-${'d'.repeat(64)}`;})()});
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const task=store.createTask('Livro com recuperação histórica');
  let initialReferenceMessage=null;
  let provisionalScheduleSourceId=null;
  let provisionalScheduleMemory=null;
  let currentScheduleMemory=null;
  for(let turn=1;turn<=24;turn++){
    const prompt=scenario.promptForTurn(turn).prompt;
    const user=store.appendMessage(task.id,'user',prompt);
    if(turn===1)initialReferenceMessage=user;
    if(turn===9)provisionalScheduleSourceId=user.id;
    for(const memory of scenario.memoriesToAccept(turn)){
      const saved=store.upsertProjectMemory(task.id,{...memory,source_type:'message',source_ref:user.id});
      if(turn===9&&memory.key==='Horário da cápsula')provisionalScheduleMemory=saved;
      if(turn===18&&memory.key==='Horário da cápsula')currentScheduleMemory=saved;
    }
    store.appendMessage(task.id,'assistant',turn===1?'Mapa editorial aprovado.':`Capítulo ${turn-1} concluído.`);
  }
  const latest=store.messages(task.id,{limit:8});
  const proofRequest=scenario.promptForTurn(25).prompt;
  const packet=store.buildContinuationPacket(task.id,proofRequest);
  assert.equal(packet.manifest.historyWindowMessageCount,40);
  assert.ok(packet.manifest.historyWindowRetrievedCount>0&&packet.manifest.historyWindowRetrievedCount<=4);
  assert.equal(packet.manifest.historyWindowOmittedCount,
    packet.manifest.historyWindowMessageCount-packet.manifest.historyWindowRetrievedCount);
  assert.ok(packet.manifest.retrievedMessageIds.includes(initialReferenceMessage.id));
  assert.ok(packet.manifest.includedMessageIds.includes(initialReferenceMessage.id));
  const historicalMatch=store.searchHistoricalMessages(task.id,proofRequest,{beforeMessage:latest[0],limit:4})
    .find(message=>message.id===initialReferenceMessage.id);
  assert.ok(historicalMatch?.excerpt.includes(scenario.archiveReference));
  assert.ok(packet.prompt.includes(scenario.archiveReference));
  assert.ok(packet.prompt.includes(scenario.sealedSecret));
  assert.equal(currentScheduleMemory?.id,provisionalScheduleMemory?.id);
  assert.notEqual(currentScheduleMemory?.source_ref,provisionalScheduleMemory?.source_ref);
  assert.match(currentScheduleMemory?.content||'',/04:17/);
  assert.match(provisionalScheduleMemory?.content||'',/04:10/);
  assert.ok(packet.manifest.includedMemoryIds.includes(currentScheduleMemory?.id));
  const temporalHistory=store.searchHistoricalMessages(task.id,'Horário da cápsula',{beforeMessage:latest[0],limit:4});
  const temporalPrior=temporalHistory.find(message=>message.content.includes('Horário provisório: 04:10'));
  assert.ok(temporalPrior?.excerpt.includes('04:10'));
  assert.ok(packet.manifest.retrievedMessageIds.includes(provisionalScheduleSourceId));
  assert.ok(packet.prompt.includes('04:10'));
  assert.ok(packet.prompt.includes('04:17'));
  assert.doesNotMatch(proofRequest,/04:10|04:17/);
  assert.ok(!proofRequest.includes(scenario.archiveReference));
  assert.ok(!proofRequest.includes(scenario.sealedSecret));
  assert.ok(store.listProjectMemory(task.id).every(item=>!item.content.includes(scenario.archiveReference)));
  assert.ok(!latest.some(message=>message.content.includes(scenario.archiveReference)));
  assert.equal(packet.manifest.attachmentUseful,false);
});

test('long-horizon correction keeps the newest fact canonical and preserves both sourced versions for temporal reasoning',t=>{
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const task=store.createTask('Linha do tempo com correção');
  const original=store.appendMessage(task.id,'user',
    'Plano provisório: a cápsula abriria às 04:10; esse horário ainda dependia da calibração do cronômetro.');
  const initial=store.upsertProjectMemory(task.id,{
    category:'fact',key:'Horário da cápsula',content:'Plano provisório: 04:10, ainda não validado.',
    source_type:'message',source_ref:original.id
  });
  for(let index=0;index<6;index++){
    store.appendMessage(task.id,'user',`Nota de revisão sem mudança de cronograma ${index+1}.`);
    store.appendMessage(task.id,'assistant',`Revisão editorial registrada ${index+1}.`);
  }
  const correction=store.appendMessage(task.id,'user',
    'Correção confirmada: a previsão anterior de 04:10 foi revogada; o horário vigente da cápsula é 04:17, confirmado pelo cronômetro marítimo calibrado.');
  const updated=store.upsertProjectMemory(task.id,{
    category:'fact',key:'Horário da cápsula',
    content:'Horário vigente: 04:17, confirmado pelo cronômetro marítimo calibrado. A previsão anterior de 04:10 foi revogada.',
    source_type:'message',source_ref:correction.id
  });
  for(let index=0;index<6;index++){
    store.appendMessage(task.id,'user',`Anotação posterior sem dado temporal ${index+1}.`);
    store.appendMessage(task.id,'assistant',`Anotação arquivada ${index+1}.`);
  }

  const request='Informe o horário vigente da cápsula e a previsão anterior que foi revogada.';
  const packet=store.buildContinuationPacket(task.id,request);
  const activeMemory=store.listProjectMemory(task.id).find(item=>item.key==='Horário da cápsula');
  assert.equal(initial.id,updated.id);
  assert.equal(activeMemory.id,initial.id);
  assert.equal(activeMemory.content,updated.content);
  assert.equal(activeMemory.source_ref,correction.id);
  assert.ok(packet.manifest.retrievedMessageIds.includes(original.id));
  assert.ok(packet.manifest.retrievedMessageIds.includes(correction.id));
  assert.match(packet.prompt,/Horário vigente: 04:17/);
  assert.match(packet.prompt,/previsão provisória.{0,80}04:10|Plano provisório.{0,80}04:10/i);
  assert.match(packet.prompt,/04:17.{0,100}04:10|04:10.{0,100}04:17/);
  assert.ok(packet.manifest.omissionReasons.includes('history_window'));
  assert.equal(packet.manifest.attachmentUseful,false);
});

test('the 24-chapter mission varies its turns and every persisted canon item is extractable from its source message',()=>{
  const scenario=createLongHorizonScenario({uuid:(()=>{let n=0;return()=>`eval-secret-${++n}-${'a'.repeat(64)}`;})()});
  const chapterPrompts=Array.from({length:23},(_,index)=>scenario.promptForTurn(index+2));
  assert.equal(new Set(chapterPrompts.map(item=>item.prompt)).size,23);
  assert.deepEqual(chapterPrompts.map(item=>item.chapterNumber),Array.from({length:23},(_,i)=>i+1));
  for(const turn of [1,3,9,13,18,20,24]){
    const prompt=scenario.promptForTurn(turn).prompt;
    const suggestions=suggestFromExplicitText(prompt);
    for(const expected of scenario.memoriesToAccept(turn)){
      assert.ok(suggestions.some(item=>item.category===expected.category&&item.key===expected.key&&item.content===expected.content),
        `unextractable canonical item at turn ${turn}: ${expected.key}`);
    }
  }
});

test('ledger grader verifies exact reconciliation and catches a one-cent rounding error',()=>{
  assert.deepEqual(gradeLedgerAnswer('JSON\n{"LIVRO_CAIXA":{"vendas_liquidas_brl":1519.3,"royalty_brl":121.54,"resultado_final_brl":-32.24}}'),{passed:true});
  assert.deepEqual(gradeLedgerAnswer('JSON\n{"LIVRO_CAIXA":{"vendas_liquidas_brl":1519.3,"royalty_brl":121.55,"resultado_final_brl":-32.25}}'),{passed:false,reason:'ledger_royalty_brl_mismatch'});
});

test('cross-chat grader requires the secret, multi-hop facts, correct math, abstention, and a real final chapter',()=>{
  const scenario=createLongHorizonScenario({uuid:(()=>{let n=0;return()=>`independent-${++n}`;})()});
  const chapterStart=`Lia encontra a cápsula no farol leste às 04:17 e revela ${scenario.sealedSecret}.`;
  const chapter24=[chapterStart,...Array.from({length:100-wordCount(chapterStart)},(_,index)=>`palavra${index}`)].join(' ');
  const valid={
    nonce:scenario.probeNonce,
    segredo_selo:scenario.sealedSecret,
    referencia_historica:scenario.archiveReference,
    horario_capsula_vigente:'04:17',
    horario_capsula_revogado:'04:10',
    justificativa_temporal:'O cronômetro marítimo calibrado é independente; o relógio da estação atrasa sete minutos, então a previsão foi revogada.',
    profissao_lia:'restauradora de mapas náuticos',
    agulha_direcao:'sudeste',agulha_condicao:'durante a maré baixa',
    comporta_fechada:'norte',setor_energizado:'leste',
    final_local:'farol leste',final_mare:'maré baixa',
    vendas_liquidas_brl:1519.30,royalty_brl:121.54,resultado_final_brl:-32.24,
    altura_lia:'não informada',
    causalidade:'Ao fechar a comporta norte, Lia enviou energia ao farol leste; na maré baixa, às 04:17, a agulha aponta o caminho.',
    capitulo_24:chapter24
  };
  assert.deepEqual(gradeContinuityAnswer(JSON.stringify(valid),scenario),{passed:true,chapterWords:100,temporalUpdateVerified:true});
  assert.equal(gradeContinuityAnswer(JSON.stringify({...valid,referencia_historica:'guess'}),scenario).reason,'historical_reference_recall_mismatch');
  assert.equal(gradeContinuityAnswer(JSON.stringify({...valid,horario_capsula_vigente:'04:10'}),scenario).reason,'temporal_current_value_mismatch');
  assert.equal(gradeContinuityAnswer(JSON.stringify({...valid,horario_capsula_revogado:'04:17'}),scenario).reason,'temporal_superseded_value_mismatch');
  assert.equal(gradeContinuityAnswer(JSON.stringify({...valid,justificativa_temporal:'Acho que houve uma mudança de horário.'}),scenario).reason,'temporal_update_provenance_incomplete');
  const naturallyExpanded={...valid,agulha_direcao:'Sudeste, e não nordeste.',agulha_condicao:'durante a maré baixa, confirmada pela referência histórica.',final_horario:'Às 04:17, na maré baixa.'};
  assert.deepEqual(gradeContinuityAnswer(JSON.stringify(naturallyExpanded),scenario),{passed:true,chapterWords:100,temporalUpdateVerified:true});
  assert.equal(gradeContinuityAnswer(JSON.stringify({...valid,agulha_direcao:'nordeste, não sudeste'}),scenario).reason,'continuity_agulha_direcao_mismatch');
  assert.equal(gradeContinuityAnswer(JSON.stringify({...valid,agulha_condicao:'durante a maré alta'}),scenario).reason,'continuity_agulha_condition_mismatch');
  assert.equal(gradeContinuityAnswer(JSON.stringify({...valid,segredo_selo:'adivinhado'}),scenario).reason,'independent_secret_recall_mismatch');
  assert.equal(gradeContinuityAnswer(JSON.stringify({...valid,altura_lia:'1,70 m'}),scenario).reason,'abstention_height_not_observed');
  assert.deepEqual(gradeContinuityAnswer(JSON.stringify({...valid,altura_lia:'não consta'}),scenario),{passed:true,chapterWords:100,temporalUpdateVerified:true});
  assert.equal(gradeContinuityAnswer(JSON.stringify({...valid,altura_lia:'Não consta no histórico; talvez 1,70 m.'}),scenario).reason,'abstention_height_not_observed');
  assert.equal(isExplicitAbstention('não foi informada'),true);
  assert.equal(isExplicitAbstention('sem evidência explícita de medida'),true);
  assert.equal(isExplicitAbstention('não consta, talvez 1,70 m'),false);
  assert.equal(gradeContinuityAnswer(JSON.stringify({...valid,resultado_final_brl:0}),scenario).reason,'continuity_resultado_final_brl_mismatch');
  assert.equal(gradeContinuityAnswer(JSON.stringify({...valid,capitulo_24:chapter24.replace('04:17','04 e dezessete')}),scenario).reason,'chapter_24_time_missing');
  assert.equal(gradeContinuityAnswer(JSON.stringify({...valid,capitulo_24:chapter24.replace('cápsula','arquivo')}),scenario).reason,'chapter_24_capsule_missing');
  assert.equal(gradeContinuityAnswer(JSON.stringify({...valid,capitulo_24:chapter24.replace('farol leste','torre oriental')}),scenario).reason,'chapter_24_east_lighthouse_missing');
  assert.equal(gradeContinuityAnswer(JSON.stringify({...valid,capitulo_24:chapter24.replace(scenario.sealedSecret,'segredo esquecido')}),scenario).reason,'chapter_24_revealed_secret_missing');
  assert.equal(chapterWordCount('### Capítulo 12 — O desvio\n'+chapter24,12),100);
});
