// Read-only diagnosis of the last submitted GPT Web turn in staged Orchestrator Lab.
// Emits only bounded counts/booleans; never prints account, conversation URL,
// prompt, memory value or assistant response text.
const {DatabaseSync}=require('node:sqlite');
const {createHash}=require('node:crypto');
const {acquireE2ELock}=require('./e2e-lock.cjs');
const {DEBUG_PORT,readLabDebugTargets,waitForLabUiTarget}=require('./e2e-lab-target.cjs');
const {providerMessageSelectors,queryProviderMessageNodes,providerMessageQueryBootstrap}=require('../src/provider-dom-selectors.cjs');
const {gradeContinuityAnswer,extractJson,extractArchiveReferenceFromPrompt,isExplicitAbstention,firstDirection,firstClock}=require('./long-horizon-book-eval.cjs');

acquireE2ELock('last-response-diagnostic');

async function main(){
  await waitForLabUiTarget();
  const db=new DatabaseSync(require('./e2e-lab-target.cjs').labDatabasePath(),{readOnly:true});
  let evidence;
  try{
    const requestedTaskId=String(process.env.ORDAX_E2E_DIAGNOSTIC_TASK_ID||'').trim();
    const task=requestedTaskId
      ?db.prepare('SELECT id,title,checkpoint,chat_url,status FROM tasks WHERE id=?').get(requestedTaskId)
      :db.prepare('SELECT id,title,checkpoint,chat_url,status FROM tasks ORDER BY updated_at DESC LIMIT 1').get();
    if(!task?.id||!task.chat_url)throw new Error('last_response_task_unbound');
    const message=db.prepare("SELECT id,content FROM messages WHERE task_id=? AND role='user' ORDER BY sequence DESC LIMIT 1").get(task.id);
    const firstUser=db.prepare("SELECT content FROM messages WHERE task_id=? AND role='user' ORDER BY sequence LIMIT 1").get(task.id);
    const secret=db.prepare("SELECT content FROM project_memory_items WHERE task_id=? AND category='fact' AND memory_key='Segredo do selo' AND status='active'").get(task.id);
    const checkpoint=db.prepare('SELECT summary FROM checkpoints WHERE task_id=? ORDER BY version DESC LIMIT 1').get(task.id);
    const checkpointRows=db.prepare('SELECT version,summary FROM checkpoints WHERE task_id=? ORDER BY version').all(task.id);
    const activeConversation=db.prepare("SELECT id,context_checkpoint_version FROM task_conversations WHERE task_id=? AND status='active' ORDER BY sequence DESC LIMIT 1").get(task.id);
    const conversationCheckpoint=Number(activeConversation?.context_checkpoint_version||0)>0
      ?db.prepare('SELECT summary FROM checkpoints WHERE task_id=? AND version=?').get(task.id,Number(activeConversation.context_checkpoint_version)):null;
    const memoryItems=db.prepare(`SELECT id,task_id,category,memory_key AS key,content,status,source_type,source_ref,created_at,updated_at,archived_at
      FROM project_memory_items WHERE task_id=? AND status='active'
      ORDER BY CASE category WHEN 'goal' THEN 1 WHEN 'constraint' THEN 2 WHEN 'decision' THEN 3 WHEN 'entity' THEN 4 WHEN 'structure' THEN 5 WHEN 'fact' THEN 6 WHEN 'open_loop' THEN 7 ELSE 8 END,updated_at DESC,id`).all(task.id);
    const recentMessages=db.prepare(`SELECT id,role,content,created_at,sequence FROM messages WHERE task_id=? AND id<>? ORDER BY sequence DESC LIMIT 8`).all(task.id,message.id).reverse().map(row=>({...row,assets:[]}));
    const receiptRow=db.prepare("SELECT payload FROM events WHERE task_id=? AND kind='provider.submission.provenance' AND json_extract(payload,'$.message_id')=? ORDER BY seq DESC LIMIT 1").get(task.id,message?.id);
    const receipt=receiptRow?JSON.parse(receiptRow.payload):null;
    const nonce=String(message?.content||'').match(/nonce desta solicita[cç][aã]o[^:]*:\s*([a-f0-9]{64})/i)?.[1]||null;
    const {buildProjectContinuation}=await import('../src/continuation-context.mjs');
    const rebuild=summary=>buildProjectContinuation({title:task.title,checkpoint:summary||task.checkpoint,
      memoryItems,recentMessages,request:message?.content||''});
    const latestPrompt=rebuild(checkpoint?.summary);
    const conversationPrompt=rebuild(conversationCheckpoint?.summary);
    const latestDigest=createHash('sha256').update(latestPrompt.trim(),'utf8').digest('hex');
    const conversationDigest=createHash('sha256').update(conversationPrompt.trim(),'utf8').digest('hex');
    const matchingCheckpointVersions=checkpointRows.filter(row=>{
      const candidate=rebuild(row.summary);
      return createHash('sha256').update(candidate.trim(),'utf8').digest('hex')===receipt?.prompt_sha256;
    }).map(row=>Number(row.version));
    const targets=await readLabDebugTargets();
    const target=targets.find(item=>{
      try{return item.type==='page'&&new URL(item.url).origin==='https://chatgpt.com'&&
        new URL(item.url).pathname===new URL(task.chat_url).pathname;}
      catch{return false;}
    });
    if(!target?.webSocketDebuggerUrl)throw new Error('last_response_provider_page_unavailable');
    const ws=new WebSocket(target.webSocketDebuggerUrl);
    try{
      await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=()=>reject(new Error('last_response_provider_cdp_unavailable'));});
      const expression='(()=>{'+providerMessageQueryBootstrap+
        `const nonce=${JSON.stringify(nonce||'')};const secret=${JSON.stringify(secret?.content||'')};`+
        `const expectedPrompt=${JSON.stringify(conversationPrompt)};`+
        `const users=queryProviderMessageNodes(document,'user',providerMessageSelectors);`+
        `const assistants=queryProviderMessageNodes(document,'assistant',providerMessageSelectors);`+
        `const user=users.at(-1)||null;const observedUser=String(user?.innerText||'').trim();const observedUserTextContent=String(user?.textContent||'').trim();`+
        `const expand=Boolean(user&&Array.from(user.querySelectorAll('button,[role="button"]')).some(control=>/^(Mostrar mais|Show more)$/i.test(String(control.innerText||control.textContent||control.getAttribute('aria-label')||'').trim())));`+
        `const userContainingNonce=users.find(node=>(node.innerText||node.textContent||'').includes(nonce));`+
        `const texts=assistants.map(node=>node.innerText||node.textContent||'');`+
        `const clean=value=>String(value??'').replace(/\\u00a0/g,' ').replace(/\\s+/g,' ').trim();`+
        `const norm=clean(observedUser);const expectedNorm=clean(expectedPrompt);`+
        `const normTextContent=clean(observedUserTextContent);`+
        `const withoutShowMore=clean(observedUser.replace(/\\s*(?:Mostrar mais|Show more)\\s*$/iu,'').replace(/\\s*…\\s*$/u,''));`+
        `const withoutShowMoreTextContent=clean(observedUserTextContent.replace(/\\s*(?:Mostrar mais|Show more)\\s*$/iu,'').replace(/\\s*…\\s*$/u,''));`+
        `const last=texts.at(-1)||'';`+
        `const after=user?assistants.some(node=>Boolean(user.compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING)):false;`+
        `const generating=Boolean(document.querySelector('button[data-testid="stop-button"],button[aria-label*="Parar"],button[aria-label*="Stop"]'));`+
        `return {nonceFoundInProviderUser:Boolean(userContainingNonce),latestUserContainsNonce:Boolean(user&&observedUser.includes(nonce)),`+
        `latestUserChars:Math.min(observedUser.length,100000),expectedPromptChars:expectedPrompt.length,expandControlPresent:expand,`+
        `latestUserMatchesSubmittedPrompt:norm===expectedNorm,`+
        `latestUserTextContentMatchesSubmittedPrompt:normTextContent===expectedNorm,`+
        `latestUserCollapsedPrefixMatchesSubmittedPrompt:Boolean(expand&&expectedNorm.startsWith(withoutShowMore)),`+
        `latestUserTextContentPrefixMatchesSubmittedPrompt:Boolean(expand&&expectedNorm.startsWith(withoutShowMoreTextContent)),`+
        `latestUserCollapsedChars:withoutShowMore.length,latestUserTextContentChars:observedUserTextContent.length,`+
        `assistantNodeCount:Math.min(texts.length,1000),`+
        `lastAssistantChars:Math.min(last.length,100000),assistantAfterProbe:after,`+
        `lastAssistantHasExpectedSecret:Boolean(secret&&last.includes(secret)),`+
        `lastAssistantHasProbeNonce:Boolean(nonce&&last.includes(nonce)),`+
        `lastAssistantLooksStructured:last.includes('"segredo_selo"')&&last.includes('"capitulo_24"'),`+
        `generationStopVisible:generating,lastAssistantText:last,`+
        `pageType:/^\\/c\\/[0-9a-f-]{20,}$/i.test(location.pathname)?'conversation':'other'};})()`;
      const value=await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('last_response_provider_diagnostic_timeout')),8000);
        ws.onmessage=event=>{let data;try{data=JSON.parse(event.data);}catch{return reject(new Error('last_response_provider_cdp_invalid'));}
          if(data.id!==1)return;clearTimeout(timer);
          if(data.error||data.result?.exceptionDetails)return reject(new Error('last_response_provider_renderer_rejected'));
          resolve(data.result?.result?.value);};
        ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:false}}));
      });
      const archiveReference=extractArchiveReferenceFromPrompt(firstUser?.content||'');
      const answerGrade=gradeContinuityAnswer(value.lastAssistantText,{sealedSecret:secret?.content||'',probeNonce:nonce||'',archiveReference});
      const answerData=extractJson(value.lastAssistantText)||{};
      const normalized=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
      const chapter=normalized(answerData.capitulo_24);
      const word=(value,term)=>new RegExp(`(^|\\W)${term}(\\W|$)`,'u').test(normalized(value));
      const run=db.prepare('SELECT id,status,error,metrics FROM runs WHERE task_id=? ORDER BY started_at DESC LIMIT 1').get(task.id);
      const metrics=run?.metrics?JSON.parse(run.metrics):{};
      evidence={taskStatus:task.status,dbHasMemorySecret:Boolean(secret?.content),nonceInPrompt:Boolean(nonce),
        rebuiltPromptDigestMatchesReceipt:Boolean(receipt?.prompt_sha256&&receipt.prompt_sha256===conversationDigest),
        latestCheckpointDigestMatchesReceipt:Boolean(receipt?.prompt_sha256&&receipt.prompt_sha256===latestDigest),
        latestCheckpointVersion:Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM checkpoints WHERE task_id=?').get(task.id)?.version||0),
        conversationCheckpointVersion:Number(activeConversation?.context_checkpoint_version||0),
        matchingCheckpointVersions,
        reconstructedPromptChars:conversationPrompt.length,
        receiptMatchesActiveConversation:receipt?.conversation_id===activeConversation?.id,
        submissionReceiptBoundToLatestUser:Boolean(receipt?.message_id===message?.id),
        failedRunStatus:run?.status||null,failedRunError:Boolean(run?.error),
        firstDeltaObserved:Boolean(metrics?.first_delta_at||metrics?.firstDeltaAt),
        assistantAnswerPassedIndependentGrader:answerGrade.passed,
        assistantAnswerGradeReason:answerGrade.passed?'passed':answerGrade.reason,...value};
      evidence.answerFieldChecks={directionCorrect:firstDirection(answerData.agulha_direcao)==='sudeste',
      compassConditionCorrect:normalized(answerData.agulha_condicao).includes('baixa'),
        gateNorth:word(answerData.comporta_fechada,'norte'),sectorEast:word(answerData.setor_energizado,'leste'),
        finalAtLighthouse:normalized(answerData.final_local).includes('farol')&&normalized(answerData.final_local).includes('leste'),
        lowTide:normalized(answerData.final_mare).includes('baixa'),
        abstainsHeight:isExplicitAbstention(answerData.altura_lia),
        causalChain:['norte','leste','04:17','baixa'].every(term=>word(answerData.causalidade,term)),secretExact:answerData.segredo_selo===secret?.content,
        nonceExact:answerData.nonce===nonce,ledgerExact:answerData.vendas_liquidas_brl===1519.30&&answerData.royalty_brl===121.54&&answerData.resultado_final_brl===-32.24,
        chapterHasLia:/\blia\b/u.test(chapter),chapterHasCapsule:chapter.includes('capsula'),
        chapterHasEastLighthouse:chapter.includes('farol')&&chapter.includes('leste'),
        chapterHasLiteral0417:chapter.includes('04:17'),chapterHasSecret:Boolean(secret?.content&&chapter.includes(normalized(secret.content))),
        finalChapterWords:Number(String(answerData.capitulo_24||'').match(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu)?.length||0)};
      delete evidence.lastAssistantText;
    }finally{ws.close();}
  }finally{db.close();}
  console.log(JSON.stringify({schema:'ordax.lab.last-response-diagnostic.v1',readOnly:true,...evidence}));
}

main().catch(error=>{
  const allowed=new Set(['last_response_task_unbound','last_response_provider_page_unavailable',
    'last_response_provider_cdp_unavailable','last_response_provider_diagnostic_timeout',
    'last_response_provider_cdp_invalid','last_response_provider_renderer_rejected']);
  const message=String(error?.message||'last_response_diagnostic_failed');
  console.error(JSON.stringify({schema:'ordax.lab.last-response-diagnostic.v1',readOnly:true,
    error:allowed.has(message)?message:'last_response_diagnostic_failed'}));
  process.exitCode=1;
});
