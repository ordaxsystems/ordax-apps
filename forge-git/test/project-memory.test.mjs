import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {openProjectMemory,memoryFile,REPO} from '../project-memory.mjs';

test('uma única memória independente de conversas, com fatos versionados',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'forge-git-memory-'));
  try{
    const first=openProjectMemory(dir);
    assert.equal(first.snapshot().repository,REPO);
    assert.deepEqual(first.snapshot().agents.map(a=>a.id),['forjador','agent-1','agent-2']);
    first.observe({base:'main',sha:'a'.repeat(40),at:'2026-11-16T08:00:00Z'});
    first.patch('agent-1',{chatUrl:'https://chatgpt.com/c/example',status:'idle',task:'Crie a pizzaria.'});
    first.event({kind:'github_revision',agent:'agent-1',sha:'b'.repeat(40),
      detail:'Commit confirmado',forCoordinator:true});
    const second=openProjectMemory(dir);
    assert.equal(second.snapshot().observed.sha,'a'.repeat(40));
    assert.equal(second.agent('agent-1').chatUrl,'https://chatgpt.com/c/example');
    assert.equal(second.snapshot().inbox.filter(x=>!x.delivered).length,1);
    assert.match(second.context(),/GitHub:/);
    assert.doesNotMatch(second.context(),/Commit confirmado|Avisos pendentes|Eventos confirmados/);
    second.acknowledge(1);
    assert.equal(openProjectMemory(dir).snapshot().inbox.filter(x=>!x.delivered).length,0);
    assert.ok(!readFileSync(memoryFile(dir),'utf8').includes('github_pat_'));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('memória bloqueia entradas arbitrárias e commits sem identidade válida',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'forge-git-memory-'));
  try{
    const memory=openProjectMemory(dir);
    assert.throws(()=>memory.patch('agent-1',{token:'secret'}));
    assert.throws(()=>memory.patch('other',{status:'running'}));
    assert.throws(()=>memory.observe({base:'main',sha:'fake',at:''}));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('continuidade autorizada persiste entre reinicializações sem guardar segredo',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'forge-git-auto-'));
  try{
    const memory=openProjectMemory(dir);
    memory.patch('agent-2',{autoContinue:true,autoRounds:2,autoPending:true,autoGoal:'Crie site de pizzaria funcional'});
    const restored=openProjectMemory(dir).agent('agent-2');
    assert.equal(restored.autoContinue,true);
    assert.equal(restored.autoRounds,2);
    assert.equal(restored.autoPending,true);
    assert.match(restored.autoGoal,/pizzaria/);
    assert.equal(restored.token,undefined);
  }finally{rmSync(dir,{force:true,recursive:true});}
});
test('inbox não duplica avisos idênticos',()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'forge-git-dedup-'));
 try{
  const mem=openProjectMemory(dir);
  const receipt={kind:'github_revision',agent:'agent-2',sha:'c'.repeat(40),
    detail:'Commit confirmado',forCoordinator:true};
  mem.event(receipt);mem.event(receipt);
  assert.equal(mem.snapshot().inbox.filter(x=>!x.delivered).length,1);
  assert.equal(mem.snapshot().events.filter(x=>x.kind==='github_revision').length,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('checkpoint da continuação só é consumido quando a nova execução é registrada',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'forge-git-claim-'));
  try{
    const state=openProjectMemory(dir);
    state.patch('agent-2',{autoContinue:true,autoPending:true,autoGoal:'Continuar tarefas reais'});
    // Janela programada, ainda sem envio: deve sobreviver a reinício.
    assert.equal(openProjectMemory(dir).agent('agent-2').autoPending,true);
    assert.throws(()=>state.beginTurn('agent-1','Continue.',{continuation:true}),
      /continuacao_nao_autorizada/);
    const before=openProjectMemory(dir).agent('agent-2');
    assert.equal(before.status,'idle');
    state.beginTurn('agent-2','Continue a missão.',{continuation:true});
    // Após registrar o turno, um reinício não pode reenviá-lo automaticamente.
    const after=openProjectMemory(dir).agent('agent-2');
    assert.equal(after.status,'running');
    assert.equal(after.autoPending,false);
    assert.equal(after.autoContinue,true);
    assert.equal(after.task,'Continue a missão.');
    assert.throws(()=>state.beginTurn('agent-2','Continue de novo.',{continuation:true}),
      /continuacao_nao_autorizada/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
