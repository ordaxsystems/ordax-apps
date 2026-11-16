import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {openProjectMemory,memoryFile,REPO ,nextAutonomousCheckpoint} from '../project-memory.mjs';

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
    second.acknowledge(second.snapshot().inbox.filter(x=>!x.delivered));
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
test('inbox mantém um estado recente por agente e preserva todo o histórico',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'forge-git-inbox-'));
  try{
    const mem=openProjectMemory(dir);
    const first={kind:'github_change_unverified',agent:'agent-2',
      detail:'Sem commit ainda',forCoordinator:true};
    const second={kind:'github_revision',agent:'agent-2',sha:'c'.repeat(40),
      detail:'Commit remoto confirmado',forCoordinator:true};
    mem.event(first);
    mem.event(second);
    assert.equal(mem.snapshot().inbox.filter(x=>!x.delivered&&x.agent==='agent-2').length,1);
    assert.equal(mem.snapshot().events.length,2);
    // An older checkpoint is compacted on reopen, without discarding evidence.
    const filename=memoryFile(dir);
    const legacy=JSON.parse(readFileSync(filename,'utf8'));
    legacy.inbox.unshift({...legacy.events[0],delivered:false});
    writeFileSync(filename,JSON.stringify(legacy));
    const restored=openProjectMemory(dir).snapshot();
    assert.equal(restored.inbox.filter(x=>!x.delivered&&x.agent==='agent-2').length,1);
    assert.equal(restored.events.length,2);
    assert.equal(restored.inbox.find(x=>!x.delivered).kind,'github_revision');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('nova conversa zera URL antiga antes de qualquer envio GPT',()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'forge-git-new-thread-'));
 try{
   const memory=openProjectMemory(dir);
   memory.patch('agent-2',{autoContinue:true,autoPending:true,
     chatUrl:'https://chatgpt.com/c/prior'});
   memory.beginTurn('agent-2','Continue a missão.',{continuation:true,newSession:true});
   const result=openProjectMemory(dir).agent('agent-2');
   assert.equal(result.chatUrl,null);
   assert.equal(result.status,'running');
   assert.equal(result.autoPending,false);
 }finally{rmSync(dir,{force:true,recursive:true});}
});
test('o começo do turno guarda HEAD antes da execução e suporta recuperação',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'forge-git-inflight-'));
  try{
    const mem=openProjectMemory(dir);
    const baseline='a'.repeat(40);
    mem.patch('agent-2',{lastHead:baseline,chatUrl:'https://chatgpt.com/c/prior'});
    mem.beginTurn('agent-2','Melhore testes e acessibilidade.');
    const interrupted=openProjectMemory(dir).agent('agent-2');
    assert.equal(interrupted.turnStartHead,baseline);
    assert.equal(interrupted.status,'running');
    assert.equal(interrupted.chatUrl,'https://chatgpt.com/c/prior');
    mem.patch('agent-2',{status:'awaiting-provider',lastHead:'b'.repeat(40)});
    const resumed=openProjectMemory(dir).agent('agent-2');
    assert.notEqual(resumed.lastHead,resumed.turnStartHead);
    assert.equal(resumed.status,'awaiting-provider');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('vários commits na mesma conversa consomem apenas um ciclo',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'forge-git-rounds-'));
  try{
    const store=openProjectMemory(dir);
    store.patch('agent-2',{autoContinue:true,autoPending:false,autoRounds:0,
      lastHead:'a'.repeat(40)});
    const first=nextAutonomousCheckpoint(store.agent('agent-2'),{limit:6});
    assert.deepEqual(first,{autoContinue:true,autoPending:true,autoRounds:1});
    store.patch('agent-2',first);
    for(let i=0;i<5;i++){
      store.patch('agent-2',{lastHead:String(i+1).repeat(40)});
      assert.equal(nextAutonomousCheckpoint(store.agent('agent-2'),{limit:6}),null);
    }
    assert.equal(openProjectMemory(dir).agent('agent-2').autoRounds,1);
    store.beginTurn('agent-2','Continue a missão.',{continuation:true,newSession:true});
    const second=nextAutonomousCheckpoint(store.agent('agent-2'),{limit:6});
    assert.deepEqual(second,{autoContinue:true,autoPending:true,autoRounds:2});
    store.patch('agent-2',second);
    assert.equal(nextAutonomousCheckpoint(store.agent('agent-2'),{limit:6}),null);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('limite de seis ciclos não depende do número de commits',()=>{
 const last=nextAutonomousCheckpoint({autoContinue:true,autoPending:false,autoRounds:5},{limit:6});
 assert.deepEqual(last,{autoRounds:6,autoContinue:false,autoPending:false});
 assert.equal(nextAutonomousCheckpoint(last,{limit:6}),null);
 assert.equal(nextAutonomousCheckpoint({autoContinue:false,autoPending:false,autoRounds:2}),null);
});
test('confirma somente os avisos entregues; eventos concorrentes ficam pendentes',()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'forge-git-concurrent-inbox-'));
 try{
  const state=openProjectMemory(dir);
  state.event({kind:'github_revision',agent:'agent-1',sha:'a'.repeat(40),
    detail:'Primeira alteração',forCoordinator:true});
  const sent=state.snapshot().inbox.filter(x=>!x.delivered);
  state.event({kind:'github_revision',agent:'agent-2',sha:'b'.repeat(40),
    detail:'Outra alteração durante resposta do Forjador',forCoordinator:true});
  state.acknowledge(sent);
  const remaining=state.snapshot().inbox.filter(x=>!x.delivered);
  assert.equal(remaining.length,1);
  assert.equal(remaining[0].agent,'agent-2');
  assert.equal(remaining[0].sha,'b'.repeat(40));
  assert.throws(()=>state.acknowledge(2),/avisos_a_confirmar_invalidos/);
  assert.equal(openProjectMemory(dir).snapshot().inbox.filter(x=>!x.delivered).length,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('novo aviso do mesmo agente substitui o antigo sem reconhecimento indevido',()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'forge-git-replace-inbox-'));
 try{
  const state=openProjectMemory(dir);
  state.event({kind:'github_change_unverified',agent:'agent-2',
    detail:'Sem commit',forCoordinator:true});
  const obsolete=state.snapshot().inbox.filter(x=>!x.delivered);
  state.event({kind:'github_revision',agent:'agent-2',sha:'c'.repeat(40),
    detail:'Commit confirmado depois',forCoordinator:true});
  state.acknowledge(obsolete);
  const current=state.snapshot().inbox.filter(x=>!x.delivered);
  assert.equal(current.length,1);
  assert.equal(current[0].kind,'github_revision');
  assert.equal(current[0].sha,'c'.repeat(40));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
