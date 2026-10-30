import test from 'node:test';
import assert from 'node:assert/strict';
import {excerptAroundBestMatch,searchTaskHistoricalMessages,taskMessageSearchExpression,taskMessageSearchTerms} from '../src/task-message-search.mjs';
import {Store} from '../src/store.mjs';

test('historical search normalizes Portuguese accents, removes boilerplate and quotes every term',()=>{
  assert.equal(
    taskMessageSearchExpression('Recupere a referência antiga; NÃO use: x" OR *'),
    '"recupere" OR "referencia" OR "antiga"'
  );
});

test('historical search never turns a generic prompt into an unscoped FTS match-all',()=>{
  assert.equal(taskMessageSearchExpression('Continue a tarefa no OrdaX.'),'');
});

test('historical search bounds the query expression independently of prompt size',()=>{
  const request=Array.from({length:100},(_,index)=>`distinctiveword${index}`).join(' ');
  const expression=taskMessageSearchExpression(request);
  assert.equal((expression.match(/"/g)||[]).length,128);
  assert.match(expression,/distinctiveword0/);
  assert.doesNotMatch(expression,/distinctiveword99/);
});

test('historical excerpts center the rare nearby facts and preserve a full identifier',()=>{
  const identifier='ARCO-LUAR-4f7d1038-8c2e-4b61-9f37-0a4d8c1e6b52';
  const content=`${'A introdução contém contexto editorial repetido. '.repeat(22)}Referência histórica não canônica: código Arco-Luar ${identifier}. Guarde para recuperação do histórico.`;
  const terms=taskMessageSearchTerms('Recupere o código de referência histórica Arco-Luar mencionado apenas na mensagem antiga.');
  const excerpt=excerptAroundBestMatch(content,terms,180);
  assert.ok(excerpt.includes(identifier),excerpt);
  assert.ok(excerpt.length<=184,`bounded excerpt exceeded its limit: ${excerpt.length}`);
});

test('historical excerpt returns the whole short source and has a bounded fallback',()=>{
  assert.equal(excerptAroundBestMatch('Fato antigo: maré baixa.',new Set(['antigo']),420),'Fato antigo: maré baixa.');
  const long='linha '.repeat(300);
  assert.ok(excerptAroundBestMatch(long,[],80).length<=80);
});

test('continuation search diversifies historical evidence and isolates identical keys across parallel tasks',t=>{
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const task=store.createTask('Missão Alfa');
  const parallel=store.createTask('Missão Beta');

  const archive=store.appendMessage(task.id,'user',
    'Referência histórica da Missão Alfa: ARCO-LUAR-ALFA-739104. Preserve para consulta futura.');
  const order=store.appendMessage(task.id,'user',
    'Registre os dados deste pedido da Missão Alfa: 3 camisetas custam R$ 79,90 cada e o frete custa R$ 12,00. Não calcule o total ainda.');
  const oldTime=store.appendMessage(task.id,'user',
    'Horário da cápsula inicialmente previsto para 04:10; aguarda confirmação independente.');
  const oldPalette=store.appendMessage(task.id,'user',
    'Paleta vigente inicial da Missão Alfa: grafite e jade.');
  const currentTime=store.appendMessage(task.id,'user',
    'Correção do Horário da cápsula: 04:17 confirmado pelo cronômetro calibrado; 04:10 foi revogado.');
  const currentPalette=store.appendMessage(task.id,'user',
    'Correção da Paleta vigente: coral substitui jade e grafite permanece.');
  store.upsertProjectMemory(task.id,{
    category:'fact',key:'Horário da cápsula',
    content:'Vigente 04:17 pelo cronômetro calibrado; 04:10 foi revogado.',
    source_type:'message',source_ref:currentTime.id
  });
  store.upsertProjectMemory(task.id,{
    category:'fact',key:'Paleta vigente',content:'Grafite e coral; jade substituído.',
    source_type:'message',source_ref:currentPalette.id
  });

  // These historical distractors repeat both keys, so a broad FTS ranking can
  // fill its top slots with one topic. Exact canonical source refs must retain
  // a slot for each requested memory key.
  for(let index=0;index<12;index++){
    store.appendMessage(task.id,'user',
      `Revisão ${index+1}: o Horário da cápsula e a Paleta vigente serão discutidos no relatório, sem registrar nova decisão.`);
    store.appendMessage(task.id,'assistant',`Revisão editorial ${index+1} recebida.`);
  }
  for(let index=0;index<4;index++){
    store.appendMessage(task.id,'user',`Nota recente da Missão Alfa ${index+1}.`);
    store.appendMessage(task.id,'assistant',`Nota recente confirmada ${index+1}.`);
  }

  const foreignArchive=store.appendMessage(parallel.id,'user',
    'Referência histórica da Missão Beta: ARCO-LUAR-BETA-284016.');
  const foreignTime=store.appendMessage(parallel.id,'user',
    'Horário da cápsula Beta: 09:41.');
  const foreignPalette=store.appendMessage(parallel.id,'user',
    'Paleta vigente Beta: azul e prata.');
  store.upsertProjectMemory(parallel.id,{
    category:'fact',key:'Horário da cápsula',content:'Beta: 09:41.',
    source_type:'message',source_ref:foreignTime.id
  });
  store.upsertProjectMemory(parallel.id,{
    category:'fact',key:'Paleta vigente',content:'Beta: azul e prata.',
    source_type:'message',source_ref:foreignPalette.id
  });

  const request=[
    'Recupere Horário da cápsula e Paleta vigente pelas fontes canônicas; localize também a referência histórica ARCO-LUAR da Missão Alfa.',
    'Responda apenas com JSON válido usando as chaves total_pedido, estoque_final, paleta_vigente e referencia_antiga.',
    'Calcule total_pedido multiplicando quantidade pelo preço unitário e somando o frete. Calcule estoque_final usando estoque inicial menos unidades vendidas.'
  ].join('\n');
  const packet=store.buildContinuationPacket(task.id,request);
  assert.ok(packet.manifest.retrievedMessageIds.includes(currentTime.id));
  assert.ok(packet.manifest.retrievedMessageIds.includes(currentPalette.id));
  assert.ok(packet.manifest.retrievedMessageIds.includes(archive.id));
  assert.ok(packet.manifest.retrievedMessageIds.includes(order.id));
  assert.ok(packet.manifest.includedMessageIds.includes(currentTime.id));
  assert.ok(packet.manifest.includedMessageIds.includes(currentPalette.id));
  assert.match(packet.prompt,/04:17/);
  assert.match(packet.prompt,/grafite e coral/i);
  assert.match(packet.prompt,/ARCO-LUAR-ALFA-739104/);
  assert.match(packet.prompt,/3 camisetas custam R\$ 79,90 cada e o frete custa R\$ 12,00/);
  assert.doesNotMatch(packet.prompt,/ARCO-LUAR-BETA-284016|09:41|azul e prata/);
  assert.ok(!packet.manifest.retrievedMessageIds.includes(foreignArchive.id));
  assert.ok(!packet.manifest.retrievedMessageIds.includes(foreignTime.id));
  assert.ok(!packet.manifest.retrievedMessageIds.includes(foreignPalette.id));
  assert.ok(packet.manifest.retrievedMessageIds.length<=4);
  assert.ok(packet.manifest.historyWindowOmittedCount>0);
});


test('search preserves real project identifiers, chapter numbers and calibrated clock times',()=>{
  const terms=taskMessageSearchTerms('VESTE: capítulo 9 às 04:17, R$ 42,90 e data 2026-10-26.');
  assert.deepEqual(terms,['veste','capitulo','04','17','42','90','data','2026','10','26']);
  const query=taskMessageSearchExpression('Recupere VESTE capítulo 9 às 04:17.');
  assert.match(query,/"capitulo 9"/);
  assert.match(query,/"04 17"/);
  assert.match(query,/"veste"/);
  assert.equal(taskMessageSearchExpression('04:17'),'"04 17" OR "04" OR "17"');
  assert.equal(taskMessageSearchExpression('Capítulo 9'),'"capitulo 9" OR "capitulo"');
  assert.equal(taskMessageSearchExpression('Continue a tarefa no OrdaX.'),'');
});

test('historical retrieval distinguishes requested VESTE chapter and clock time without leaking parallel task',t=>{
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const alpha=store.createTask('VESTE editorial');
  const beta=store.createTask('VESTE independente');
  const source=store.appendMessage(alpha.id,'user',
    'VESTE Capítulo 9: a agulha de cobre foi medida às 04:17 no farol leste.');
  for(let chapter=10;chapter<=24;chapter++){
    store.appendMessage(alpha.id,'user',
      'VESTE Capítulo '+chapter+': o cronômetro mostrou 04:10 no relatório provisório.');
  }
  const foreign=store.appendMessage(beta.id,'user',
    'VESTE Capítulo 9: o relógio da outra missão marcou 04:17, segredo BETA_NAO_EXPORTAR.');
  const latest=store.appendMessage(alpha.id,'user','Nova conversa. Consultar o fato antigo.');
  const beforeMessage=store.db.prepare('SELECT sequence FROM messages WHERE id=?').get(latest.id);
  const rows=searchTaskHistoricalMessages(store.db,alpha.id,
    'Recupere VESTE Capítulo 9 às 04:17, o registro da agulha de cobre.',
    {beforeMessage,limit:4});
  assert.ok(rows.some(row=>row.id===source.id),JSON.stringify(rows.map(row=>row.id)));
  assert.ok(rows.every(row=>row.task_id===alpha.id));
  assert.ok(!rows.some(row=>row.id===foreign.id));
  assert.ok(rows.every(row=>!row.content.includes('BETA_NAO_EXPORTAR')));
});
