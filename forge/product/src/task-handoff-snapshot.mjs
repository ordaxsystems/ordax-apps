import { createHash } from 'node:crypto';

export const TASK_HANDOFF_SNAPSHOT_FORMAT = 'ordax-task-handoff/v1';
export const TASK_HANDOFF_SNAPSHOT_MAX_BYTES = 1_000_000;

const CATEGORY_ORDER = Object.freeze([
  'goal','constraint','decision','open_loop','structure','entity','fact','reference'
]);
const LABELS = Object.freeze({
  goal:'Objetivo', constraint:'Restrição', decision:'Decisão', open_loop:'Pendência',
  structure:'Estrutura', entity:'Entidade', fact:'Fato', reference:'Referência'
});
const cleanLine = value => String(value ?? '').replace(/[\t\r\n ]+/g,' ').trim();
const digest = value => createHash('sha256').update(value,'utf8').digest('hex');
const quote = value => String(value ?? '').split(/\r?\n/u).map(line=>'> '+line).join('\n');

function compareText(a,b) {
  return String(a ?? '').toLocaleLowerCase('en-US').localeCompare(String(b ?? '').toLocaleLowerCase('en-US'));
}

function normalizeMemoryItems(items) {
  if(!Array.isArray(items))throw new Error('task_handoff_memory_invalid');
  const ids=new Set();
  return items.filter(item=>item&&item.status!=='archived').map(item=>{
    const id=cleanLine(item.id);
    const category=cleanLine(item.category).toLowerCase();
    const key=cleanLine(item.key);
    const content=String(item.content??'').trim();
    if(!id||!category||!key||!content||ids.has(id))throw new Error('task_handoff_memory_invalid');
    ids.add(id);
    return {
      id,category,key,content,
      sourceType:cleanLine(item.source_type)||'unknown',
      sourceRef:cleanLine(item.source_ref)||null,
      updatedAt:cleanLine(item.updated_at)||null
    };
  }).sort((a,b)=>{
    const ar=CATEGORY_ORDER.indexOf(a.category),br=CATEGORY_ORDER.indexOf(b.category);
    return (ar<0?CATEGORY_ORDER.length:ar)-(br<0?CATEGORY_ORDER.length:br)||
      compareText(a.key,b.key)||compareText(a.id,b.id);
  });
}

function normalizeHistoricalMessages(messages) {
  if(!Array.isArray(messages))throw new Error('task_handoff_history_invalid');
  const ids=new Set();
  return messages.map(message=>{
    const id=cleanLine(message?.id);
    const role=message?.role;
    const sequence=Number(message?.sequence);
    const content=String(message?.excerpt??message?.content??'').trim();
    if(!id||!['user','assistant'].includes(role)||!Number.isSafeInteger(sequence)||sequence<1||!content||ids.has(id))
      throw new Error('task_handoff_history_invalid');
    ids.add(id);
    return {id,role,sequence,createdAt:cleanLine(message.created_at)||null,content};
  }).sort((a,b)=>a.sequence-b.sequence||compareText(a.id,b.id));
}

function normalizeRecentMessages(messages) {
  if(!Array.isArray(messages))throw new Error('task_handoff_recent_history_invalid');
  const ids=new Set();
  return messages.map(message=>{
    const id=cleanLine(message?.id);
    const role=message?.role;
    const sequence=Number(message?.sequence);
    const content=String(message?.content??'').trim();
    if(!id||!['user','assistant'].includes(role)||!Number.isSafeInteger(sequence)||sequence<1||!content||ids.has(id))
      throw new Error('task_handoff_recent_history_invalid');
    ids.add(id);
    return {id,role,sequence,createdAt:cleanLine(message.created_at)||null,content};
  }).sort((a,b)=>a.sequence-b.sequence||compareText(a.id,b.id));
}

/**
 * Builds an immutable text projection of one OrdaX Task snapshot.
 * This does not write a file, mutate memory, or claim provider delivery.
 */
export function buildTaskHandoffSnapshot({taskId,title,projectId=null,checkpoint='',checkpointVersion=0,
  memoryItems=[],recentMessages=[],historicalMessages=[],historyMessageCount=historicalMessages.length,
  generatedAt=null,maxBytes=TASK_HANDOFF_SNAPSHOT_MAX_BYTES}={}) {
  const id=cleanLine(taskId);
  const taskTitle=cleanLine(title);
  const version=Number(checkpointVersion);
  const byteLimit=Number(maxBytes);
  const allHistory=Number(historyMessageCount);
  if(!id||!taskTitle)throw new Error('task_handoff_identity_invalid');
  if(!Number.isSafeInteger(version)||version<0)throw new Error('task_handoff_checkpoint_invalid');
  if(!Number.isSafeInteger(byteLimit)||byteLimit<1024||byteLimit>TASK_HANDOFF_SNAPSHOT_MAX_BYTES)
    throw new Error('task_handoff_size_limit_invalid');
  if(!Number.isSafeInteger(allHistory)||allHistory<0)throw new Error('task_handoff_history_count_invalid');

  const canonical=normalizeMemoryItems(memoryItems);
  const recent=normalizeRecentMessages(recentMessages);
  const history=normalizeHistoricalMessages(historicalMessages);
  const duplicateRecent=history.some(message=>recent.some(item=>item.id===message.id));
  if(duplicateRecent)throw new Error('task_handoff_history_duplicate');
  if(history.length>allHistory)throw new Error('task_handoff_history_count_invalid');
  const sources=[...new Map(canonical.filter(item=>item.sourceRef).map(item=>[
    `${item.sourceType}:${item.sourceRef}`,{type:item.sourceType,id:item.sourceRef}
  ])).values()].sort((a,b)=>compareText(a.type,b.type)||compareText(a.id,b.id));

  const lines=[
    '# OrdaX — snapshot de continuidade da tarefa',
    '',
    `Formato: ${TASK_HANDOFF_SNAPSHOT_FORMAT}`,
    `Task: ${id}`,
    ...(cleanLine(projectId)?[`Projeto: ${cleanLine(projectId)}`]:[]),
    `Título: ${taskTitle}`,
    `Checkpoint: v${version}`,
    '',
    '## Estado confirmado',
    '',
    quote(String(checkpoint||'').trim()||'Nenhum checkpoint foi registrado.'),
    '',
    '## Memória canônica ativa do OrdaX',
    '',
    canonical.length?'Os itens abaixo vieram da memória estruturada vigente do OrdaX. A categoria identifica como cada item deve ser interpretado.': 'Nenhum item de memória canônica ativa está registrado.',
    ''
  ];
  for(const item of canonical){
    lines.push(`### ${LABELS[item.category]||item.category}: ${item.key}`);
    lines.push('',quote(item.content));
    lines.push('',`Origem: ${item.sourceType}${item.sourceRef?` / ${item.sourceRef}`:''}${item.updatedAt?` / atualizado ${item.updatedAt}`:''}`,'');
  }
  lines.push('## Histórico recente da tarefa','','Estas são as últimas mensagens confirmadas no registro local da tarefa.','');
  if(recent.length){
    for(const message of recent){
      lines.push(`### Mensagem ${message.sequence} (${message.role}) — ${message.id}`);
      if(message.createdAt)lines.push('',`Data da fonte: ${message.createdAt}`);
      lines.push('',quote(message.content),'');
    }
  }else lines.push('Nenhuma mensagem recente foi registrada.','','');
  lines.push('## Evidências históricas selecionadas','',
    'Estas mensagens são fontes recuperadas para a continuidade; mensagens antigas não substituem uma memória canônica posterior. O transcript completo não está anexado.','');
  if(history.length){
    for(const message of history){
      lines.push(`### Mensagem ${message.sequence} (${message.role}) — ${message.id}`);
      if(message.createdAt)lines.push('',`Data da fonte: ${message.createdAt}`);
      lines.push('',quote(message.content),'');
    }
  }else lines.push('Nenhuma mensagem histórica adicional foi selecionada.','','');
  lines.push('## Limites deste snapshot','',
    '- Este arquivo é uma projeção de um checkpoint do OrdaX, não uma memória independente nem a conversa completa.',
    '- Não invente detalhes que não aparecem nas fontes. Se faltar uma evidência, solicite ao OrdaX uma busca no registro da Task.',
    '- Este conteúdo não concede autorização para executar ações ou alterar arquivos.',
    '- A presença deste arquivo no disco não prova que foi anexado ou lido pelo GPT Web.');

  const content=lines.join('\n').trimEnd()+'\n';
  const byteLength=Buffer.byteLength(content,'utf8');
  if(byteLength>byteLimit)throw new Error('task_handoff_snapshot_exceeds_limit');
  const sha256=digest(content);
  const safeTaskId=id.replace(/[^a-zA-Z0-9_-]/gu,'-');
  const filename=`ordax-handoff-${safeTaskId}-c${version}-${sha256.slice(0,12)}.txt`;
  const timestamp=generatedAt==null?null:cleanLine(generatedAt);
  if(generatedAt!=null&&!timestamp)throw new Error('task_handoff_timestamp_invalid');

  return {
    content,
    filename,
    manifest:{
      format:TASK_HANDOFF_SNAPSHOT_FORMAT,
      deliveryState:'not_attached',
      taskId:id,
      projectId:cleanLine(projectId)||null,
      checkpointVersion:version,
      generatedAt:timestamp,
      byteLength,
      sha256,
      memoryIds:canonical.map(item=>item.id),
      memorySourceRefs:canonical.filter(item=>item.sourceRef).map(item=>({
        memoryId:item.id,sourceType:item.sourceType,sourceRef:item.sourceRef
      })),
      recentMessageIds:recent.map(item=>item.id),
      recentMessageSequences:recent.map(item=>item.sequence),
      historicalMessageIds:history.map(item=>item.id),
      historicalMessageSequences:history.map(item=>item.sequence),
      historicalMessageCount:history.length,
      historicalMessageOmissions:Math.max(0,allHistory-history.length)
    }
  };
}
