import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { buildTaskHandoffSnapshot } from '../src/task-handoff-snapshot.mjs';

test('handoff snapshot is a deterministic, source-linked projection of active Task memory',t=>{
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const task=store.createTask('Missão editorial');
  const first=store.appendMessage(task.id,'user','O selo guarda o código FATO-ARQUIVO-91; a altura não foi informada.');
  store.appendMessage(task.id,'assistant','Registro recebido.');
  store.upsertProjectMemory(task.id,{category:'goal',key:'Livro',content:'Concluir 24 capítulos sem revelar o selo antes do final.',source_type:'message',source_ref:first.id});
  store.upsertProjectMemory(task.id,{category:'fact',key:'Código do selo',content:'FATO-ARQUIVO-91',source_type:'message',source_ref:first.id});
  const archived=store.upsertProjectMemory(task.id,{category:'fact',key:'Paleta antiga',content:'jade e âmbar',source_type:'manual'});
  store.archiveProjectMemory(task.id,archived.id);
  for(let i=0;i<6;i++){
    store.appendMessage(task.id,'user',`Revisão editorial do capítulo ${i+1}, sem alterar o segredo.`);
    store.appendMessage(task.id,'assistant',`Revisão ${i+1} registrada.`);
  }
  const latest=store.appendMessage(task.id,'assistant','A última etapa confirmada foi revisar o capítulo 6.');
  store.checkpoint(task.id,'Capítulos 1 a 6 revisados; capítulo 7 pendente.',{chapter:6});

  const request='Recupere o código do selo e o registro original que o definiu.';
  const a=store.buildTaskHandoffSnapshot(task.id,{request});
  const b=store.buildTaskHandoffSnapshot(task.id,{request});
  assert.equal(a.filename,b.filename);
  assert.equal(a.content,b.content);
  assert.equal(a.manifest.sha256,b.manifest.sha256);
  assert.equal(a.manifest.deliveryState,'not_attached');
  assert.equal(a.manifest.checkpointVersion,1);
  assert.match(a.filename,/\.txt$/u);
  assert.match(a.content,/Capítulos 1 a 6 revisados/u);
  assert.match(a.content,/Concluir 24 capítulos/u);
  assert.match(a.content,/FATO-ARQUIVO-91/u);
  assert.doesNotMatch(a.content,/Paleta antiga|jade e âmbar/u);
  assert.ok(a.manifest.memoryIds.includes(store.listProjectMemory(task.id).find(item=>item.key==='Código do selo').id));
  assert.ok(a.manifest.memorySourceRefs.some(ref=>ref.sourceRef===first.id));
  assert.ok(a.manifest.historicalMessageIds.includes(first.id));
  assert.ok(a.manifest.recentMessageIds.includes(latest.id));
  assert.match(a.content,/A última etapa confirmada foi revisar o capítulo 6/u);
  assert.ok(a.manifest.historicalMessageOmissions>0);
  assert.equal(a.manifest.byteLength,Buffer.byteLength(a.content,'utf8'));
  assert.match(a.manifest.sha256,/^[a-f0-9]{64}$/u);
  assert.match(a.content,/não uma memória independente/u);
  assert.match(a.content,/não prova que foi anexado/u);
});

test('snapshot is task-scoped, preserves account-independent Task identity, and fails closed instead of truncating',t=>{
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const task=store.createTask('Continuidade independente de conta');
  const other=store.createTask('Outra tarefa com palavras iguais');
  const source=store.appendMessage(task.id,'user','Fato raro da primeira conversa: COFRE-ALFA-7782.');
  store.upsertProjectMemory(task.id,{category:'goal',key:'Retomar',content:'Continuar nesta Task mesmo após troca da conversa GPT.',source_type:'message',source_ref:source.id});
  store.appendMessage(other.id,'user','Fato raro da primeira conversa: COFRE-BETA-1199.');
  const unmatched=store.appendMessage(task.id,'user','Registro de fonte sem correspondência textual: ID-HISTORICO-NAO-INDEXADO-7491.');
  for(let index=0;index<5;index++){
    store.appendMessage(task.id,'user',`Nota recente sem o código antigo ${index+1}.`);
    store.appendMessage(task.id,'assistant',`Registro recente ${index+1}.`);
  }
  const snapshot=store.buildTaskHandoffSnapshot(task.id,{request:'Recupere o fato raro COFRE-ALFA-7782.'});
  assert.equal(snapshot.manifest.taskId,task.id);
  assert.ok(snapshot.content.includes('COFRE-ALFA-7782'));
  assert.ok(!snapshot.content.includes('COFRE-BETA-1199'));
  assert.throws(()=>store.buildTaskHandoffSnapshot('task_missing'),/task_not_found/u);
  const explicitlyIncluded=store.buildTaskHandoffSnapshot(task.id,{request:'Consulte o histórico da loja.',includeMessageIds:[unmatched.id]});
  assert.ok(explicitlyIncluded.manifest.historicalMessageIds.includes(unmatched.id));
  assert.match(explicitlyIncluded.content,/ID-HISTORICO-NAO-INDEXADO-7491/u);
  assert.throws(()=>store.buildTaskHandoffSnapshot(task.id,{includeMessageIds:[store.messages(other.id).at(-1).id]}),/task_handoff_message_scope_invalid/u);
  const corrupted=store.createTask('Memória com origem estrangeira');
  const foreignSource=store.appendMessage(other.id,'user','Origem que pertence a outra Task.');
  store.upsertProjectMemory(corrupted.id,{category:'fact',key:'Origem',content:'Não exportar sem validar.',source_type:'message',source_ref:foreignSource.id});
  assert.throws(()=>store.buildTaskHandoffSnapshot(corrupted.id),/task_handoff_source_scope_invalid/u);
  assert.throws(()=>buildTaskHandoffSnapshot({
    taskId:'task_large',title:'Snapshot grande',checkpointVersion:1,
    memoryItems:[{id:'memory_large',category:'fact',key:'Grande',content:'x'.repeat(5000),status:'active'}],
    maxBytes:1024
  }),/task_handoff_snapshot_exceeds_limit/u);
});

test('snapshot manifest contains provenance and hashes but never duplicates message or memory content',()=>{
  const snapshot=buildTaskHandoffSnapshot({
    taskId:'task_provenance',title:'Snapshot verificável',checkpoint:'Estado atual.',checkpointVersion:3,
    memoryItems:[{id:'memory_1',category:'constraint',key:'Segredo',content:'SENTINELA-ARQUIVO-UNICO',status:'active',source_type:'message',source_ref:'msg_source'}],
    historicalMessages:[{id:'msg_source',role:'user',sequence:1,excerpt:'Fonte histórica selecionada.',created_at:'2026-10-25T12:00:00.000Z'}],
    historyMessageCount:50
  });
  assert.doesNotMatch(JSON.stringify(snapshot.manifest),/SENTINELA-ARQUIVO-UNICO|Fonte histórica selecionada/u);
  assert.equal(snapshot.manifest.historicalMessageOmissions,49);
  assert.deepEqual(snapshot.manifest.historicalMessageIds,['msg_source']);
  assert.deepEqual(snapshot.manifest.memorySourceRefs,[{memoryId:'memory_1',sourceType:'message',sourceRef:'msg_source'}]);
  assert.equal(snapshot.manifest.deliveryState,'not_attached');
});
