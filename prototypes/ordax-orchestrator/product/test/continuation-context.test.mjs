import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertContinuationContextReady, buildProjectContinuation, buildProjectContinuationPacket } from '../src/continuation-context.mjs';

test('a persistent project continues across internal provider conversations without assuming a domain', () => {
  const text=buildProjectContinuation({
    title:'Sistema de atendimento',
    checkpoint:'Implementado cadastro; autenticação ainda pendente.',
    memoryItems:[
      {category:'goal',key:'MVP',content:'Permitir atendimento offline.',status:'active'},
      {category:'decision',key:'Persistência',content:'Usar SQLite WAL.',status:'active'},
      {category:'constraint',key:'Privacidade',content:'Não enviar dados privados sem autorização.',status:'active'},
      {category:'open_loop',key:'Login',content:'Implementar fluxo de autenticação.',status:'active'}
    ],
    recentMessages:[{role:'user',content:'Já validamos o armazenamento local.'}],
    request:'Continue pelo login.'
  });
  assert.match(text,/Projeto\/Task persistente: Sistema de atendimento/);
  assert.match(text,/\[OBJETIVO\] MVP: Permitir atendimento offline/);
  assert.match(text,/\[DECISAO\] Persistência: Usar SQLite WAL/);
  assert.match(text,/\[RESTRICAO\] Privacidade/);
  assert.match(text,/\[PENDENCIA\] Login/);
  assert.match(text,/Já validamos o armazenamento local/);
  assert.match(text,/\[\[ORDAX_MEMORY_PROPOSALS_V1\]\]/);
  assert.match(text,/O bloco é uma proposta pendente de revisão no OrdaX, nunca memória confirmada/);
  assert.ok(text.endsWith('Pedido atual:\nContinue pelo login.'));
});

test('a large canonical project remains complete in the local SSOT while the provider gets a bounded honest selection', () => {
  const memoryItems=Array.from({length:100},(_,i)=>({
    category:i%3===0?'goal':i%3===1?'decision':'open_loop',
    key:'Item ' + i,
    content:'Descrição detalhada '+i+' '+('x'.repeat(260)),
    status:'active'
  }));
  const lastRequest='Corrija o módulo de sincronização sem alterar os contratos anteriores.';
  const context=buildProjectContinuation({
    title:'Plataforma de módulos',
    checkpoint:'Snapshot versionado v42',
    memoryItems,
    recentMessages:Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',content:'Histórico '+i+' '+('y'.repeat(220))})),
    request:lastRequest,
    maxChars:3800
  });
  assert.ok(context.length<=3800);
  assert.match(context,/\[MEMORIA PARCIAL\]/);
  assert.match(context,/\[JANELA DE HISTORICO\]/);
  assert.match(context,/\[HISTORICO FORA DO ORCAMENTO\]/);
  assert.ok(context.endsWith('Pedido atual:\n'+lastRequest));
  assert.doesNotMatch(context,/\[FIM DO CONTEXTO ORDAX\][\s\S]*\[MEMORIA/);
  assert.equal(memoryItems.length,100);
});

test('when user request itself exceeds budget it must be preserved verbatim', () => {
  const request='continuidade '+'a'.repeat(20000);
  const output=buildProjectContinuation({
    title:'Projeto de pesquisa',request,memoryItems:[],maxChars:16000
  });
  assert.equal(output,request);
});

test('archived canonical records never enter the provider continuity capsule', () => {
  const output=buildProjectContinuation({
    title:'Campanha',
    checkpoint:'Fase de execução',
    memoryItems:[
      {category:'decision',key:'Ativa',content:'Executar primeiro piloto.',status:'active'},
      {category:'decision',key:'Antiga',content:'REGRA_OBSOLETA_987',status:'archived'}
    ],
    request:'Prossiga com o plano.'
  });
  assert.match(output,/Executar primeiro piloto/);
  assert.doesNotMatch(output,/REGRA_OBSOLETA_987/);
});

test('continuation packet exposes deterministic, content-free provenance for future handoff files',()=>{
  const input={
    title:'Projeto Longo',checkpoint:'Estado confirmado v7',checkpointVersion:7,
    memoryItems:[
      {id:'mem_goal',category:'goal',key:'Missão',content:'Concluir o projeto com validação.',status:'active'},
      {id:'mem_old',category:'decision',key:'Legado',content:'Não incluir este item.',status:'archived'}
    ],
    recentMessages:[{id:'msg_1',role:'user',content:'Executar etapa aprovada.'}],
    request:'Continue.',maxChars:16000
  };
  const first=buildProjectContinuationPacket(input);
  const second=buildProjectContinuationPacket(input);
  assert.equal(first.prompt,second.prompt);
  assert.deepEqual(first.manifest,second.manifest);
  assert.equal(first.manifest.format,'ordax-continuation-context/v1');
  assert.equal(first.manifest.checkpointVersion,7);
  assert.equal(first.manifest.contextIncluded,true);
  assert.equal(assertContinuationContextReady(first),true);
  assert.equal(first.manifest.contextSha256,createHash('sha256').update(first.prompt.slice(0,first.prompt.lastIndexOf('\nPedido atual:')),'utf8').digest('hex'));
  assert.equal(first.manifest.promptSha256,createHash('sha256').update(first.prompt.trim(),'utf8').digest('hex'));
  assert.deepEqual(first.manifest.includedMemoryIds,['mem_goal']);
  assert.deepEqual(first.manifest.includedMessageIds,['msg_1']);
  assert.equal(first.manifest.partial,false);
  assert.equal(JSON.stringify(first.manifest).includes('Concluir o projeto'),false);
  assert.equal(JSON.stringify(first.manifest).includes('Executar etapa aprovada'),false);
});

test('long persisted history is reported separately from context-budget loss',()=>{
  const messages=Array.from({length:20},(_,index)=>({
    id:`message_${index+1}`,role:index%2?'assistant':'user',content:`Turno antigo ${index+1}`
  }));
  const packet=buildProjectContinuationPacket({
    title:'Missão com histórico longo',checkpoint:'Progresso confirmado',
    memoryItems:[{id:'goal_1',category:'goal',key:'Objetivo',content:'Concluir com validação.',status:'active'}],
    recentMessages:messages,totalMessageCount:20,request:'Continue a missão.'
  });
  assert.equal(packet.manifest.historyWindowOmittedCount,12);
  assert.deepEqual(packet.manifest.historyWindowOmittedIds,messages.slice(0,12).map(message=>message.id));
  assert.deepEqual(packet.manifest.omissionReasons,['history_window']);
  assert.equal(packet.manifest.partial,true);
  assert.equal(packet.manifest.attachmentUseful,false);
  assert.match(packet.prompt,/\[JANELA DE HISTORICO\]/);
  assert.doesNotMatch(packet.prompt,/Turno antigo 1(?:\D|$)/);
});

test('relevant archived messages are injected separately from the recent window with explicit source provenance',()=>{
  const old={id:'msg_old',role:'user',content:'A referência antiga era VESTE_REF_7391. Guarde este código para consulta posterior.',created_at:'2026-01-01T10:00:00.000Z',excerpt:'A referência antiga era VESTE_REF_7391.'};
  const recent=Array.from({length:8},(_,index)=>({id:`msg_recent_${index+1}`,role:index%2?'assistant':'user',content:`Histórico recente ${index+1}`,created_at:`2026-01-02T10:00:0${index}.000Z`}));
  const packet=buildProjectContinuationPacket({
    title:'Continuidade VESTE',checkpoint:'Pedido e paleta confirmados.',
    recentMessages:recent,retrievedMessages:[old],totalMessageCount:10,
    request:'Recupere o código da referência antiga citada no início da tarefa.'
  });
  assert.match(packet.prompt,/Trechos de conversas anteriores recuperados por relevância/);
  assert.match(packet.prompt,/VESTE_REF_7391/);
  assert.match(packet.prompt,/Trechos de conversas anteriores recuperados por relevância/);
  assert.deepEqual(packet.manifest.retrievedMessageIds,['msg_old']);
  assert.equal(packet.manifest.retrievedMessageCount,1);
  assert.equal(packet.manifest.historyWindowMessageCount,2);
  assert.equal(packet.manifest.historyWindowRetrievedCount,1);
  assert.equal(packet.manifest.historyWindowOmittedCount,1);
  assert.deepEqual(packet.manifest.omissionReasons,['history_window']);
  assert.equal(packet.manifest.partial,true);
  assert.equal(packet.manifest.attachmentUseful,false);
});

test('historical retrieval omitted by its budget is reported and never described as delivered',()=>{
  const packet=buildProjectContinuationPacket({
    title:'Saturação de recuperação',checkpoint:'Estado confirmado.',
    recentMessages:Array.from({length:8},(_,index)=>({id:`recent_${index}`,role:'user',content:'Contexto recente.'})),
    retrievedMessages:[{id:'old_fact',role:'user',content:'FATO_ANTIGO_4831 '+'detalhe '.repeat(120)}],
    totalMessageCount:10,request:'Recupere o fato antigo.',maxChars:1300
  });
  assert.equal(packet.manifest.retrievedMessageCount,0);
  assert.equal(packet.manifest.retrievedMessageOmissions,1);
  assert.equal(packet.manifest.historyWindowRetrievedCount,0);
  assert.equal(packet.manifest.historyWindowOmittedCount,2);
  assert.ok(packet.manifest.omissionReasons.includes('retrieved_history_budget'));
  assert.doesNotMatch(packet.prompt,/FATO_ANTIGO_4831/);
  assert.equal(packet.manifest.partial,true);
});

test('continuation packet marks omitted canonical memory and refuses to claim complete context',()=>{
  const memoryItems=Array.from({length:100},(_,index)=>({
    id:`memory_${index}`,category:index%2?'constraint':'fact',key:`Regra ${index}`,
    content:`Conteúdo ${index} `+'x'.repeat(500),status:'active'
  }));
  const packet=buildProjectContinuationPacket({
    title:'Projeto sob saturação',checkpoint:'checkpoint atual',memoryItems,
    request:'Continue o trabalho.',maxChars:1800
  });
  assert.equal(packet.manifest.contextIncluded,true);
  assert.equal(packet.manifest.partial,true);
  assert.equal(packet.manifest.attachmentUseful,true);
  assert.ok(packet.manifest.criticalOmissions>0);
  assert.ok(packet.manifest.omittedMemoryCount>0);
  assert.ok(packet.manifest.omittedMemoryIds.length>0);
  assert.ok(packet.prompt.length<=1800);
  assert.match(packet.prompt,/\[MEMORIA PARCIAL\]/);
  assert.throws(()=>assertContinuationContextReady(packet),/continuation_context_critical_memory_omitted/);
});

test('the production context budget detects critical-memory saturation at its default limit',()=>{
  const memoryItems=Array.from({length:50},(_,index)=>({
    id:`decision_${index}`,category:'decision',key:`Decision ${index}`,
    content:`Registro aprovado ${index} `+'x'.repeat(380),status:'active'
  }));
  const packet=buildProjectContinuationPacket({
    title:'Projeto extenso',checkpoint:'Checkpoint aprovado v91',checkpointVersion:91,
    memoryItems,recentMessages:[{id:'msg_recent',role:'assistant',content:'Último resultado validado.'}],
    request:'Continue usando as decisões vigentes.'
  });
  assert.equal(packet.manifest.maxChars,16000);
  assert.equal(packet.manifest.contextIncluded,true);
  assert.equal(packet.manifest.attachmentUseful,true);
  assert.ok(packet.manifest.omittedMemoryCount>0);
  assert.ok(packet.manifest.criticalOmissions>0);
  assert.ok(packet.manifest.contextChars<=16000-packet.manifest.requestChars-15);
  assert.throws(()=>assertContinuationContextReady(packet),/continuation_context_critical_memory_omitted/);
});

test('an oversized request is preserved but its missing continuity context is explicit',()=>{
  const packet=buildProjectContinuationPacket({
    title:'Projeto',checkpoint:'checkpoint',
    memoryItems:[{id:'goal_1',category:'goal',key:'Objetivo',content:'Não esquecer.',status:'active'}],
    recentMessages:[{id:'msg_1',role:'user',content:'Histórico útil.'}],
    request:'Pedido '+'p'.repeat(5000),maxChars:1000
  });
  assert.equal(packet.prompt,'Pedido '+'p'.repeat(5000));
  assert.equal(packet.manifest.contextIncluded,false);
  assert.equal(packet.manifest.criticalOmissions,1);
  assert.equal(packet.manifest.omittedMemoryIds[0],'goal_1');
  assert.equal(packet.manifest.omittedMessageIds[0],'msg_1');
  assert.equal(packet.manifest.attachmentUseful,true);
  assert.throws(()=>assertContinuationContextReady(packet),/continuation_context_unavailable_request_exceeds_budget/);
});


test('confirmed canonical memory is either wholly delivered or explicitly omitted, never silently abbreviated',()=>{
  const marker='DECISAO_VERIFICADA_NO_FINAL_927a1b';
  const key='Arquitetura SSOT e decisão vigente do projeto';
  const content='Acesso exclusivamente via Runtime autorizado. '+('Contrato confirmado permanece vigente em todos os projetos. '.repeat(12))+marker;
  assert.ok(content.length>380);
  const options={
    title:'Missão longa',checkpoint:'Revisão dos contratos aprovada.',
    memoryItems:[{id:'long_decision_1',category:'decision',key,content,status:'active'}],
    request:'Recupere a decisão vigente exatamente, incluindo o identificador final.'
  };
  const complete=buildProjectContinuationPacket(options);
  assert.equal(complete.manifest.criticalOmissions,0);
  assert.equal(complete.manifest.partial,false);
  assert.deepEqual(complete.manifest.includedMemoryIds,['long_decision_1']);
  assert.ok(complete.prompt.includes('['+'DECISAO'+'] '+key+': '+content));
  assert.ok(complete.prompt.includes(marker));
  assert.doesNotMatch(complete.prompt,/\[trecho abreviado\]/);

  const constrained=buildProjectContinuationPacket({...options,maxChars:1500});
  assert.ok(constrained.prompt.length<=1500);
  assert.ok(constrained.manifest.criticalOmissions>0);
  assert.equal(constrained.manifest.partial,true);
  assert.equal(constrained.manifest.attachmentUseful,true);
  assert.deepEqual(constrained.manifest.omittedMemoryIds,['long_decision_1']);
  assert.deepEqual(constrained.manifest.includedMemoryIds,[]);
  assert.doesNotMatch(constrained.prompt,new RegExp(marker));
  assert.throws(()=>assertContinuationContextReady(constrained),/continuation_context_critical_memory_omitted/);
});

test('long canonical key with critical scope remains intact when included',()=>{
  const key='Decisão arquitetural: '+'s'.repeat(130)+'_END';
  const packet=buildProjectContinuationPacket({
    title:'Auditoria de decisões',
    checkpoint:'Contrato canônico confirmado.',
    memoryItems:[{id:'long_key',category:'constraint',key,content:'Sem bypass do Runtime.',status:'active'}],
    request:'Conserve o nome exato da decisão.'
  });
  assert.ok(packet.manifest.includedMemoryIds.includes('long_key'));
  assert.ok(packet.prompt.includes(key));
  assert.doesNotMatch(packet.prompt,/\[trecho abreviado\]/);
});
