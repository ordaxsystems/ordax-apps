import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';

test('two long-running projects retain independent historical evidence across a real SQLite restart',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-long-context-'));
  const file=path.join(dir,'mission.sqlite');
  let store=new Store(file);
  t.after(()=>{
    try{store?.close();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  });

  const projectA=store.createTask('VESTE projeto A');
  const projectB=store.createTask('VESTE projeto B');
  const secretA=randomUUID();
  const secretB=randomUUID();
  assert.notEqual(secretA,secretB);

  const firstA=store.appendMessage(projectA.id,'user',
    'VESTE Capítulo 9. Referência histórica da primeira janela: selo '+secretA+'.');
  const firstB=store.appendMessage(projectB.id,'user',
    'VESTE Capítulo 9. Referência histórica da primeira janela: selo '+secretB+'.');
  const clockA=store.appendMessage(projectA.id,'user',
    'Horário da cápsula: 04:17 pelo cronômetro marítimo calibrado; 04:10 foi revogado.');
  store.upsertProjectMemory(projectA.id,{
    category:'fact',key:'Horário da cápsula',
    content:'Vigente 04:17 pelo cronômetro marítimo calibrado; provisório 04:10 revogado.',
    source_type:'message',source_ref:clockA.id
  });

  for(let n=0;n<120;n++){
    store.appendMessage(projectA.id,'user',
      'Nota operacional A '+n+': atividade simulada sem nova decisão canônica.');
    store.appendMessage(projectB.id,'user',
      'Nota operacional B '+n+': atividade simulada independente.');
  }
  store.close();
  store=new Store(file);

  const request='Recupere a referência histórica da primeira janela VESTE Capítulo 9 e o horário vigente da cápsula. Não invente fatos.';
  const resultA=store.buildContinuationPacket(projectA.id,request);
  const resultB=store.buildContinuationPacket(projectB.id,
    'Recupere a referência histórica da primeira janela VESTE Capítulo 9.');
  assert.ok(resultA.manifest.historyWindowMessageCount>=100);
  assert.ok(resultB.manifest.historyWindowMessageCount>=100);
  assert.ok(resultA.manifest.retrievedMessageIds.includes(firstA.id),
    'project A must recover the original source, not just a recent summary');
  assert.ok(resultB.manifest.retrievedMessageIds.includes(firstB.id),
    'project B must recover its own first-turn source');
  assert.match(resultA.prompt,new RegExp(secretA));
  assert.match(resultB.prompt,new RegExp(secretB));
  assert.doesNotMatch(resultA.prompt,new RegExp(secretB));
  assert.doesNotMatch(resultB.prompt,new RegExp(secretA));
  assert.match(resultA.prompt,/04:17/);
  assert.doesNotMatch(resultA.prompt,/BETA_NAO_EXPORTAR/);
  assert.ok(resultA.manifest.promptChars<=16000);
  assert.ok(resultB.manifest.promptChars<=16000);
  assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
