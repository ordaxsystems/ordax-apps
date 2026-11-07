const STOP_WORDS = new Set([
  'a','ao','aos','as','com','da','das','de','dela','dele','deles','delas','do','dos','e','em','entre','era','essa','esse','esta','este','foi','for','isso','na','nas','no','nos','ou','para','pela','pelas','pelo','pelos','por','que','se','sem','ser','sua','suas','seu','seus','um','uma','umas','uns',
  'apenas','atual','chatgpt','como','conversa','contexto','continua','continuacao','continuar','continue','desta','deste','esta','este','historico','inicio','mensagem','memoria','nova','novo','ordax','pedido','primeiro','projeto','responda','resposta','somente','tarefa','usar','use'
]);

export function taskMessageSearchExpression(value) {
  const normalized=String(value||'').normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR');
  // FTS5 phrase queries keep chapter/step numbers and calibrated times together.
  // Without these anchors, a request for "Capítulo 9" can rank another chapter
  // highly merely because both messages contain "capítulo".
  const anchors=[
    ...[...normalized.matchAll(/(?:^|[^\p{L}\p{N}])(capitulo|etapa|fase|turno)\s+(\d{1,3})(?=$|[^\p{L}\p{N}])/gu)]
      .map(match=>'"'+match[1]+' '+match[2]+'"'),
    ...[...normalized.matchAll(/(?:^|[^\p{L}\p{N}])(\d{1,2}):(\d{2})(?=$|[^\p{L}\p{N}])/gu)]
      .map(match=>'"'+match[1]+' '+match[2]+'"')
  ];
  const terms=taskMessageSearchTerms(value).map(term=>'"'+term+'"');
  return [...new Set([...anchors,...terms])].slice(0,72).join(' OR ');
}

export function taskMessageSearchTerms(value) {
  const normalized=String(value||'').normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR');
  // Numeric references are project evidence: dates, prices, chapter IDs and
  // time components must remain searchable even without a text keyword.
  const words=normalized.match(/[\p{L}\p{N}]+/gu)||[];
  return [...new Set(words.filter(word=>/^\d+$/.test(word)
    ? word.length>=2 && word.length<=12
    : word.length>=4 && !STOP_WORDS.has(word)))].slice(0,64);
}

function normalizeSearchToken(value) {
  return String(value).normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR');
}

export function excerptAroundBestMatch(content, queryTerms, maxChars=420) {
  const source=String(content||'');
  const terms=new Set(queryTerms||[]);
  const cap=Number.isSafeInteger(maxChars)&&maxChars>0?maxChars:420;
  if(source.length<=cap)return source.trim();
  if(!terms.size)return source.slice(0,cap).trim();

  const tokens=[];
  const matcher=/[\p{L}\p{N}]+/gu;
  for(const match of source.matchAll(matcher))tokens.push({value:normalizeSearchToken(match[0]),start:match.index,end:match.index+match[0].length});
  if(!tokens.length)return source.slice(0,cap).trim();
  const frequencies=new Map();
  for(const token of tokens)if(terms.has(token.value))frequencies.set(token.value,(frequencies.get(token.value)||0)+1);

  let bestIndex=0,bestScore=-1;
  for(let index=0;index<tokens.length;index++){
    let score=0;
    for(let offset=-16;offset<=16;offset++){
      const token=tokens[index+offset];
      if(!token||!terms.has(token.value))continue;
      score+=1/Math.sqrt(frequencies.get(token.value)||1)/(1+Math.abs(offset)*0.035);
    }
    if(score>bestScore){bestScore=score;bestIndex=index;}
  }

  const center=tokens[bestIndex].start;
  let start=Math.max(0,Math.min(center-Math.floor(cap/2),source.length-cap));
  const firstIncluded=tokens.find(token=>token.end>start);
  if(firstIncluded)start=firstIncluded.start;
  const limit=Math.min(source.length,start+cap);
  let lastIncluded=null;
  for(let index=tokens.length-1;index>=0;index--){
    if(tokens[index].end<=limit){lastIncluded=tokens[index];break;}
  }
  const end=lastIncluded?.end||limit;
  const excerpt=source.slice(start,end).trim();
  return `${start>0?'… ':''}${excerpt}${end<source.length?' …':''}`;
}

export function searchTaskHistoricalMessages(db,taskId,request,{beforeMessage=null,limit=4}={}) {
  const expression=taskMessageSearchExpression(request);
  const size=Number(limit);
  if (!expression || typeof taskId!=='string' || !taskId || !Number.isSafeInteger(size) || size<1 || size>8) return [];
  if (!Number.isSafeInteger(beforeMessage?.sequence)||beforeMessage.sequence<1) return [];
  const rows=db.prepare(`
    SELECT m.id,m.task_id,m.role,m.content,m.created_at,
      m.sequence,
      bm25(task_message_search) AS search_rank
    FROM task_message_search
    JOIN messages m ON m.rowid=task_message_search.rowid
    WHERE task_message_search MATCH ? AND m.task_id=?
      AND m.sequence < ?
    ORDER BY search_rank ASC,m.sequence DESC
    LIMIT ?
  `).all(expression,taskId,beforeMessage.sequence,size);
  const terms=taskMessageSearchTerms(request);
  return rows.map(message=>({
    ...message,
    excerpt:excerptAroundBestMatch(message.content,terms),
    assets:[]
  }));
}

// A broad query can spend every historical slot on one topic in a compound
// request. Reserve part of the bounded set for exact sources of requested
// canonical memories, then diversify the remaining slots across the distinct
// information needs expressed in the request before using broad relevance.
export function searchTaskHistoricalMessagesWithMemoryKeys(db,taskId,request,{
  beforeMessage=null,limit=4,memoryItems=[]
}={}) {
  const size=Number(limit);
  if(!Number.isSafeInteger(size)||size<1||size>8)return [];
  const requestTerms=new Set(taskMessageSearchTerms(request));
  const relevantKeys=(Array.isArray(memoryItems)?memoryItems:[])
    .filter(item=>item&&item.status!=='archived'&&typeof item.key==='string')
    .map((item,index)=>{
      const keyTerms=taskMessageSearchTerms(item.key);
      const matches=keyTerms.filter(term=>requestTerms.has(term)).length;
      return {item,index,keyTerms,matches};
    })
    .filter(({keyTerms,matches})=>keyTerms.length>0&&matches>=Math.min(2,keyTerms.length))
    .sort((a,b)=>b.matches-a.matches||b.keyTerms.length-a.keyTerms.length||
      String(b.item.updated_at||'').localeCompare(String(a.item.updated_at||''))||a.index-b.index);
  const topicBudget=Math.min(relevantKeys.length,Math.max(1,Math.floor(size/2)));
  const topicMessages=[];
  const topicIds=new Set();
  const addTopicMessage=(message,terms)=>{
    if(!message||!['user','assistant'].includes(message.role)||topicIds.has(message.id))return false;
    topicIds.add(message.id);
    const excerptTerms=new Set([...requestTerms,...terms]);
    topicMessages.push({...message,excerpt:excerptAroundBestMatch(message.content,excerptTerms),assets:[]});
    return true;
  };

  // First reserve one evidence source for each relevant canonical key. If a
  // key has a source_ref, prefer that exact task-bound user message over an
  // FTS hit that merely repeats the key words without carrying the decision.
  for(const {item} of relevantKeys){
    const source=item.source_ref&&Number.isSafeInteger(beforeMessage?.sequence)
      ?db.prepare(`SELECT id,task_id,role,content,created_at,sequence FROM messages
        WHERE id=? AND task_id=? AND role='user' AND sequence<?`).get(item.source_ref,taskId,beforeMessage.sequence)
      :null;
    const terms=[...taskMessageSearchTerms(item.key),...taskMessageSearchTerms(item.content)];
    if(source)addTopicMessage(source,terms);
    else {
      const matches=searchTaskHistoricalMessages(db,taskId,item.key,{beforeMessage,limit:8});
      const sourceMessage=matches.find(message=>message.role==='user');
      if(sourceMessage)addTopicMessage(sourceMessage,terms);
    }
    if(topicMessages.length>=topicBudget)break;
  }

  const segments=String(request||'').split(/(?:\r?\n+|(?<=[.!?])\s+)/u)
    .map(segment=>segment.trim()).filter(Boolean).slice(0,12);
  // When a request explicitly compares versions of a canonical fact, include
  // one prior user source for that same key. Historical sources stay out of
  // ordinary "use the latest" requests, where they could reintroduce stale data.
  for(const {item,keyTerms} of relevantKeys){
    const temporalSegment=segments.find(segment=>{
      const normalized=normalizeSearchToken(segment);
      const terms=new Set(taskMessageSearchTerms(segment));
      const asksForVersions=/\b(?:vers(?:ao|oes)|provisor\w*|anterio\w*|supersedid\w*|revogad\w*|compar\w*|antes|antig\w*)\b/u.test(normalized);
      return asksForVersions&&keyTerms.some(term=>terms.has(term));
    });
    if(!temporalSegment||topicMessages.length>=size)continue;
    const prior=searchTaskHistoricalMessages(db,taskId,item.key,{beforeMessage,limit:8})
      .find(message=>message.role==='user'&&message.id!==item.source_ref);
    if(prior)addTopicMessage(prior,[...keyTerms,...taskMessageSearchTerms(item.content),
      ...taskMessageSearchTerms(temporalSegment)]);
  }

  // Retrieve one best source per distinct request segment. This prevents a
  // compound request's broad FTS ranking from crowding out a specific need
  // such as an old reference, calculation input, or prior chapter.
  const candidates=new Map();
  for(const segment of segments){
    const terms=taskMessageSearchTerms(segment);
    if(!terms.length)continue;
    const termSet=new Set(terms);
    const matches=searchTaskHistoricalMessages(db,taskId,segment,{beforeMessage,limit:8});
    for(const message of matches){
      if(!['user','assistant'].includes(message.role)||topicIds.has(message.id))continue;
      const sourceTerms=new Set(taskMessageSearchTerms(message.content));
      const overlap=[...termSet].filter(term=>sourceTerms.has(term)).length;
      if(!overlap)continue;
      const score=overlap/Math.sqrt(termSet.size);
      const current=candidates.get(message.id);
      if(!current||score>current.score){
        candidates.set(message.id,{message,terms,score});
      }
    }
  }
  const diversified=[...candidates.values()].sort((a,b)=>b.score-a.score||
    Number(a.message.search_rank||0)-Number(b.message.search_rank||0)||
    Number(b.message.sequence||0)-Number(a.message.sequence||0));
  for(const candidate of diversified){
    addTopicMessage(candidate.message,candidate.terms);
    if(topicMessages.length>=size)break;
  }

  const general=searchTaskHistoricalMessages(db,taskId,request,{beforeMessage,limit:size});
  const merged=new Map();
  for(const message of [...topicMessages,...general])if(message?.id&&!merged.has(message.id))merged.set(message.id,message);
  return [...merged.values()].slice(0,size);
}
