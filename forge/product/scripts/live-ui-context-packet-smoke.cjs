const {waitForLabUiTarget,labDatabasePath,waitForLabAppMode}=require('./e2e-lab-target.cjs');
const {acquireE2ELock}=require('./e2e-lock.cjs');
const {DatabaseSync}=require('node:sqlite');
const {randomBytes,createHash}=require('node:crypto');
const {extractJson}=require('./long-horizon-book-eval.cjs');
acquireE2ELock('context-packet-smoke');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const timeoutMs=180000;
const cdpCallTimeoutMs=60000;
let phase='initializing';
let completedSetupTurns=0;

async function main(){
  const secret=randomBytes(32).toString('hex');
  const nonce=randomBytes(32).toString('hex');
  let olderCode=randomBytes(16).toString('hex');
  const resumeTaskId=process.env.ORDAX_LAB_CONTEXT_PACKET_TASK_ID||'';
  if(secret===nonce||secret===olderCode||nonce===olderCode)throw Error('context_probe_seeds_not_independent');
  const target=await waitForLabUiTarget();
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  let nextId=0;
  const pending=new Map();
  const rejectPending=error=>{
    for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(error);}
    pending.clear();
  };
  ws.onmessage=event=>{
    let message;
    try{message=JSON.parse(event.data);}catch{rejectPending(Error('context_e2e_cdp_invalid_json'));return;}
    const waiter=pending.get(message.id);
    if(!waiter)return;
    pending.delete(message.id);clearTimeout(waiter.timer);
    message.error?waiter.reject(Error('context_e2e_cdp_command_failed')):waiter.resolve(message.result);
  };
  ws.onerror=()=>rejectPending(Error('context_e2e_cdp_connection_failed'));
  ws.onclose=()=>rejectPending(Error('context_e2e_cdp_connection_closed'));
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('context_e2e_cdp_connect_timeout')),10000);
    ws.onopen=()=>{clearTimeout(timer);resolve();};
  });
  const call=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++nextId;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('context_e2e_cdp_timeout'));},cdpCallTimeoutMs);
    pending.set(id,{resolve,reject,timer});
    try{ws.send(JSON.stringify({id,method,params}));}
    catch{clearTimeout(timer);pending.delete(id);reject(Error('context_e2e_cdp_send_failed'));}
  });
  const evaluate=async expression=>{
    const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,timeout:cdpCallTimeoutMs-5000});
    if(result.exceptionDetails)throw Error('context_e2e_ui_operation_failed');
    return result.result.value;
  };
  const waitFor=async(fn,{attempts=2400,delay=100}={})=>{
    for(let index=0;index<attempts;index++){
      const value=await fn();
      if(value)return value;
      await sleep(delay);
    }
    return null;
  };
  const waitForProvider=()=>waitFor(()=>evaluate(`(async()=>{
    const status=await window.ordax.providerStatus();
    return status?.connected&&status?.composer_ready&&!status?.verification_required&&
      !status?.active&&!status?.response_generation_active;
  })()`),{attempts:1200,delay:100});
  const taskSnapshot=taskId=>evaluate(`window.ordax.getTask(${JSON.stringify(taskId)})`);
  const send=async prompt=>{
    const state=await waitFor(async()=>{
      const current=await evaluate(`(()=>({disabled:Boolean(document.querySelector('#send')?.disabled),
        text:document.querySelector('#prompt')?.value||''}))()`);
      return !current.disabled&&!current.text?current:null;
    },{attempts:50,delay:100});
    if(!state)throw Error('context_e2e_composer_not_empty_or_ready');
    return evaluate(`(()=>{
      const input=document.querySelector('#prompt');
      if(!input||document.querySelector('#send')?.disabled)throw Error('send_disabled');
      input.value=${JSON.stringify(prompt)};
      input.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('#composer').requestSubmit();
      return true;
    })()`);
  };
  const awaitCompletedTurn=async(taskId,expectedTotalMessages)=>{
    const started=Date.now();
    while(Date.now()-started<timeoutMs){
      const task=await taskSnapshot(taskId);
      if(['failed','interrupted','error'].includes(task?.latest_run?.status))
        throw Error('context_e2e_provider_run_failed');
      const messageCount=Number(task?.continuation?.total_messages??task?.messages?.length??0);
      if(messageCount===expectedTotalMessages&&task?.latest_run?.status==='succeeded'){
        return task.messages?.filter(message=>message.role==='assistant').at(-1)?.content||'';
      }
      await sleep(300);
    }
    throw Error('context_e2e_turn_timeout_or_unverified');
  };
  try{
    phase='app_mode_preflight';
    await waitForLabAppMode(evaluate);
    let taskId,startIndex=0;
    if(resumeTaskId){
      phase='resume_ledger_validation';
      if(!/^task_[0-9a-f-]{36}$/i.test(resumeTaskId))throw Error('context_e2e_resume_task_id_invalid');
      const db=new DatabaseSync(labDatabasePath(),{readOnly:true});
      let resume;
      try{
        const task=db.prepare('SELECT id,status,chat_url FROM tasks WHERE id=?').get(resumeTaskId);
        const messages=db.prepare('SELECT sequence,role,content FROM messages WHERE task_id=? ORDER BY sequence').all(resumeTaskId);
        const runs=db.prepare('SELECT status,COUNT(*) AS n FROM runs WHERE task_id=? GROUP BY status').all(resumeTaskId);
        const conversations=db.prepare("SELECT sequence,status,chat_url FROM task_conversations WHERE task_id=? ORDER BY sequence").all(resumeTaskId);
        const memoryCount=Number(db.prepare("SELECT COUNT(*) AS n FROM project_memory_items WHERE task_id=? AND status='active'").get(resumeTaskId)?.n||0);
        const expectedMarkers=['VESTE_INICIO_OK','PEDIDO_REGISTRADO','ESTOQUE_REGISTRADO','PALETA_INICIAL_REGISTRADA','PALETA_ATUALIZADA'];
        const pairs=[];
        for(let index=0;index<messages.length;index+=2){
          const user=messages[index],assistant=messages[index+1],marker=expectedMarkers[index/2];
          if(!assistant||user.role!=='user'||assistant.role!=='assistant'||
             !String(assistant.content||'').includes(marker))throw Error('context_e2e_resume_message_pair_mismatch');
          pairs.push({marker});
        }
        const olderCodeMatch=messages[0]?.content.match(/\b([a-f0-9]{32})\b/i);
        const runCount=runs.reduce((sum,row)=>sum+Number(row.n),0);
        const succeededCount=runs.find(row=>row.status==='succeeded')?.n||0;
        if(!task||task.status!=='ready'||!task.chat_url||messages.length!==10||pairs.length!==5||
           !olderCodeMatch||runCount!==5||Number(succeededCount)!==5||
           conversations.length!==1||conversations[0].status!=='active'||!conversations[0].chat_url||memoryCount!==0)
          throw Error('context_e2e_resume_state_not_safe');
        olderCode=olderCodeMatch[1];
        resume={messages,pairs};
      }finally{db.close();}
      const selected=await evaluate(`document.querySelector('#taskId')?.textContent||''`);
      if(selected!==resumeTaskId)throw Error('context_e2e_resume_task_not_selected');
      taskId=resumeTaskId;
      startIndex=resume.pairs.length;
      completedSetupTurns=startIndex;
    }else{
      phase='project_scope_preflight';
      const scope=await evaluate(`(async()=>{
        const select=document.querySelector('#projectSelect');
        if(!select)return {available:false,value:null};
        select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));
        await new Promise(resolve=>setTimeout(resolve,50));
        return {available:true,value:select.value||null,
          orchestrationHidden:document.querySelector('#orchestrationPanel')?.hidden===true};
      })()`);
      if(!scope.available||scope.value!==null||!scope.orchestrationHidden)
        throw Error('context_e2e_project_scope_not_cleared');
    }
    phase='provider_preflight';
    if(!await waitForProvider())throw Error('context_e2e_provider_not_ready');

    if(!resumeTaskId){
      phase='task_creation';
      const previousTask=await evaluate(`document.querySelector('#taskId')?.textContent||''`);
      await evaluate(`document.querySelector('#newTask').click();true`);
      taskId=await waitFor(()=>evaluate(`(()=>{
        const id=document.querySelector('#taskId')?.textContent||'';
        return id&&id!==${JSON.stringify(previousTask)}&&
          !document.querySelector('#taskPanel').classList.contains('hidden')?id:null;
      })()`),{attempts:300,delay:50});
      if(!taskId)throw Error('context_e2e_task_creation_failed');
      const taskScope=await evaluate(`(async()=>{
        const task=(await window.ordax.listTasks()).find(item=>item.id===${JSON.stringify(taskId)});
        return {found:Boolean(task),bound:Boolean(task?.lab_binding)};
      })()`);
      if(!taskScope.found||taskScope.bound)throw Error('context_e2e_task_not_isolated');
    }

    const turns=[
      {prompt:`Estamos iniciando uma tarefa da loja de roupas VESTE. Guarde como referência antiga desta conversa, sem promovê-la a memória canônica: ${olderCode}. Não repita a referência. Responda exatamente: VESTE_INICIO_OK`,expected:'VESTE_INICIO_OK'},
      {prompt:'Registre os dados deste pedido VESTE: 3 camisetas custam R$ 79,90 cada e o frete custa R$ 12,00. Não calcule o total ainda. Responda exatamente: PEDIDO_REGISTRADO',expected:'PEDIDO_REGISTRADO'},
      {prompt:'Registre o estoque da VESTE: havia 12 camisetas e 5 foram vendidas. Não calcule o saldo ainda. Responda exatamente: ESTOQUE_REGISTRADO',expected:'ESTOQUE_REGISTRADO'},
      {prompt:'A paleta atual da VESTE é grafite e jade. Registre esta versão como vigente por enquanto. Responda exatamente: PALETA_INICIAL_REGISTRADA',expected:'PALETA_INICIAL_REGISTRADA'},
      {prompt:'Atualização mais recente da VESTE: remova jade e substitua por coral; grafite continua. Esta é a paleta vigente e substitui a anterior. Responda exatamente: PALETA_ATUALIZADA',expected:'PALETA_ATUALIZADA'},
      {prompt:'Registre o estado do catálogo VESTE. Não altere pedido, estoque ou paleta. Responda exatamente: CATALOGO_REGISTRADO',expected:'CATALOGO_REGISTRADO'},
      {prompt:'Registre a revisão das fotos do catálogo VESTE. Preserve os fatos confirmados. Responda exatamente: FOTOS_REGISTRADAS',expected:'FOTOS_REGISTRADAS'},
      {prompt:'Registre a revisão da página de produto VESTE. Não invente atributos. Responda exatamente: PAGINA_REVISADA',expected:'PAGINA_REVISADA'},
      {prompt:'Registre a checagem final de conteúdo da loja VESTE. Não altere preço, estoque ou paleta. Responda exatamente: CONTEUDO_VALIDADO',expected:'CONTEUDO_VALIDADO'}
    ];
    const turnAnswers=[];
    for(let index=0;index<startIndex;index++){
      const task=await taskSnapshot(taskId);
      turnAnswers.push(task.messages?.filter(message=>message.role==='assistant')[index]?.content||'');
    }
    for(let index=startIndex;index<turns.length;index++){
      phase=`send_setup_turn_${index+1}`;
      await send(turns[index].prompt);
      phase=`await_setup_turn_${index+1}`;
      const answer=await awaitCompletedTurn(taskId,(index+1)*2);
      if(!answer.includes(turns[index].expected))throw Error('context_e2e_setup_turn_mismatch');
      turnAnswers.push(answer);
      completedSetupTurns=index+1;
    }

    phase='write_canonical_memory';
    const stored=await evaluate(`window.ordax.upsertProjectMemory(${JSON.stringify(taskId)},
      {category:'fact',key:'Segredo de continuidade',content:${JSON.stringify(secret)}})`);
    const memory=stored?.project_memory?.items?.find(item=>item.key==='Segredo de continuidade'&&item.content===secret&&item.status==='active');
    if(!memory?.id)throw Error('context_e2e_canonical_memory_not_stored');
    const beforeRotation=await taskSnapshot(taskId);
    const stockSource=beforeRotation.messages.find(message=>message.role==='user'&&String(message.content||'').includes('havia 12 camisetas'));
    const paletteSource=beforeRotation.messages.find(message=>message.role==='user'&&String(message.content||'').includes('remova jade e substitua por coral'));
    if(!stockSource?.id||!paletteSource?.id)throw Error('context_e2e_canonical_fact_sources_missing');
    const stockSaved=await evaluate(`window.ordax.upsertProjectMemory(${JSON.stringify(taskId)},
      {category:'fact',key:'Estoque VESTE',content:'Estoque inicial de 12 camisetas; 5 vendidas; saldo confirmado de 7.',source_type:'message',source_ref:${JSON.stringify(stockSource.id)}})`);
    const stockMemory=stockSaved?.project_memory?.items?.find(item=>item.key==='Estoque VESTE'&&item.source_ref===stockSource.id&&item.status==='active');
    const paletteSaved=await evaluate(`window.ordax.upsertProjectMemory(${JSON.stringify(taskId)},
      {category:'fact',key:'Paleta vigente',content:'Grafite e coral; coral substituiu jade.',source_type:'message',source_ref:${JSON.stringify(paletteSource.id)}})`);
    const paletteMemory=paletteSaved?.project_memory?.items?.find(item=>item.key==='Paleta vigente'&&item.source_ref===paletteSource.id&&item.status==='active');
    if(!stockMemory?.id||!paletteMemory?.id)throw Error('context_e2e_canonical_fact_memory_missing');
    if(beforeRotation.messages.some(message=>String(message.content||'').includes(secret))||
      beforeRotation.checkpoint_record?.summary?.includes(secret))
      throw Error('context_e2e_secret_leaked_before_handoff');

    phase='rotate_provider_conversation';
    const rotationButton=await evaluate(`(()=>({disabled:Boolean(document.querySelector('#rotateConversation')?.disabled)}))()`);
    if(rotationButton.disabled)throw Error('context_e2e_rotation_control_disabled');
    await evaluate(`document.querySelector('#rotateConversation').click();true`);
    const rotated=await waitFor(async()=>{
      const task=await taskSnapshot(taskId);
      return !task?.chat_url&&task?.conversations?.some(conversation=>conversation.status==='archived')?task:null;
    },{attempts:300,delay:100});
    if(!rotated)throw Error('context_e2e_rotation_not_observed');
    if(!await waitForProvider())throw Error('context_e2e_new_provider_chat_not_ready');

    const request=[
      'Esta é uma conversa GPT nova da mesma tarefa OrdaX. Recupere o fato canônico do pacote de continuidade e o nonce desta mensagem.',
      `Nonce exclusivo deste pedido: ${nonce}`,
      'Recupere também o código aleatório citado como referência antiga no primeiro turno desta tarefa. Ele não está neste pedido; use somente o trecho histórico que o OrdaX recuperar.',
      'Responda apenas com JSON válido usando as chaves "secret", "nonce", "total_pedido", "estoque_final", "paleta_vigente", "referencia_antiga" e "altura_lia".',
      'Calcule total_pedido como quantidade vezes preço unitário mais frete; calcule estoque_final como estoque inicial menos unidades vendidas. Use a atualização mais recente da paleta.',
      'O segredo deve vir da memória canônica. Para altura_lia, responda "não consta" se o contexto não trouxer um valor confirmado. Não invente.'
    ].join('\n');
    if(request.includes(secret)||request.includes(secret.slice(0,12))||request.includes(olderCode))throw Error('context_e2e_probe_leaks_secret');
    const db=new DatabaseSync(labDatabasePath(),{readOnly:true});
    let expectedPacket,preSend;
    try{
      const task=db.prepare('SELECT id,title,checkpoint FROM tasks WHERE id=?').get(taskId);
      const checkpoint=db.prepare('SELECT version,summary FROM checkpoints WHERE task_id=? ORDER BY version DESC LIMIT 1').get(taskId);
      const memoryItems=db.prepare(`SELECT id,task_id,category,memory_key AS key,content,status,source_type,source_ref,created_at,updated_at,archived_at
        FROM project_memory_items WHERE task_id=? AND status='active'
        ORDER BY CASE category WHEN 'goal' THEN 1 WHEN 'constraint' THEN 2 WHEN 'decision' THEN 3 WHEN 'entity' THEN 4
          WHEN 'structure' THEN 5 WHEN 'fact' THEN 6 WHEN 'open_loop' THEN 7 ELSE 8 END,updated_at DESC,id`).all(taskId);
      const stockMemoryRow=memoryItems.find(item=>item.key==='Estoque VESTE')||null;
      const paletteMemoryRow=memoryItems.find(item=>item.key==='Paleta vigente')||null;
      const recentMessages=db.prepare(`SELECT id,role,content,created_at,sequence FROM messages WHERE task_id=?
        ORDER BY sequence DESC LIMIT 8`).all(taskId).reverse().map(message=>({...message,assets:[]}));
      const totalMessageCount=Number(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE task_id=?').get(taskId)?.n||0);
      const {searchTaskHistoricalMessagesWithMemoryKeys}=await import('../src/task-message-search.mjs');
      const retrievedMessages=searchTaskHistoricalMessagesWithMemoryKeys(db,taskId,request,{beforeMessage:recentMessages[0],limit:4,memoryItems});
      const {buildProjectContinuationPacket}=await import('../src/continuation-context.mjs');
      expectedPacket=buildProjectContinuationPacket({title:task?.title,
        checkpoint:checkpoint?.summary||task?.checkpoint,checkpointVersion:Number(checkpoint?.version||0),
        memoryItems,recentMessages,retrievedMessages,totalMessageCount,request});
      const priorMessages=db.prepare('SELECT id,role,content FROM messages WHERE task_id=? ORDER BY sequence').all(taskId);
      const priorCheckpoints=db.prepare('SELECT summary FROM checkpoints WHERE task_id=?').all(taskId);
      const olderMessage=priorMessages.find(message=>message.content.includes(olderCode));
      preSend={memoryId:memory?.id,checkpointVersion:Number(checkpoint?.version||0),
        stockMemoryId:stockMemoryRow?.id||null,paletteMemoryId:paletteMemoryRow?.id||null,
        stockSourceId:stockMemoryRow?.source_ref||null,paletteSourceId:paletteMemoryRow?.source_ref||null,
        canonicalSourcesOutsideRecentWindow:Boolean(stockMemoryRow?.source_ref&&paletteMemoryRow?.source_ref&&
          !recentMessages.some(message=>message.id===stockMemoryRow.source_ref||message.id===paletteMemoryRow.source_ref)),
        canonicalSourcesRecovered:Boolean(stockMemoryRow?.source_ref&&paletteMemoryRow?.source_ref&&
          retrievedMessages.some(message=>message.id===stockMemoryRow.source_ref)&&
          retrievedMessages.some(message=>message.id===paletteMemoryRow.source_ref)),
        secretOnlyInCanon:!priorMessages.some(row=>row.content.includes(secret))&&
          !priorCheckpoints.some(row=>row.summary.includes(secret)),
        olderCodeOnlyInFirstUserMessage:priorMessages.filter(row=>row.content.includes(olderCode)).length===1&&
          priorMessages[0]?.role==='user'&&priorMessages[0]?.content.includes(olderCode)===true,
        olderCodeExcludedFromRecentWindow:!recentMessages.some(message=>message.content.includes(olderCode)),
        olderCodeAbsentFromCheckpoint:!priorCheckpoints.some(row=>row.summary.includes(olderCode)),
        olderCodeRetrievedFromSearch:retrievedMessages.some(message=>message.id===olderMessage?.id&&message.excerpt.includes(olderCode)),
        olderCodeBoundToManifest:expectedPacket.manifest.retrievedMessageIds.includes(olderMessage?.id),
        secretPresentInContext:expectedPacket.prompt.includes(secret),
        olderCodePresentInProviderContext:expectedPacket.prompt.includes(olderCode),
        requestExcludesSecret:!request.includes(secret),
        requestExcludesOlderCode:!request.includes(olderCode),
        noncePresentInRequest:request.includes(nonce),
        historyWindowMessageCount:expectedPacket.manifest.historyWindowMessageCount,
        historyWindowRetrievedCount:expectedPacket.manifest.historyWindowRetrievedCount,
        historyWindowOmittedCount:expectedPacket.manifest.historyWindowOmittedCount,
        historyWindowReason:expectedPacket.manifest.omissionReasons.includes('history_window'),
        criticalOmissions:expectedPacket.manifest.criticalOmissions};
    }finally{db.close();}
    if(!preSend.secretOnlyInCanon||!preSend.secretPresentInContext||!preSend.requestExcludesSecret||
      !preSend.noncePresentInRequest||!preSend.requestExcludesOlderCode||preSend.criticalOmissions!==0||
      !preSend.canonicalSourcesOutsideRecentWindow||!preSend.canonicalSourcesRecovered||
      !preSend.olderCodeOnlyInFirstUserMessage||!preSend.olderCodeExcludedFromRecentWindow||
      !preSend.olderCodeAbsentFromCheckpoint||!preSend.olderCodeRetrievedFromSearch||
      !preSend.olderCodeBoundToManifest||!preSend.olderCodePresentInProviderContext||
      preSend.historyWindowMessageCount!==10||preSend.historyWindowRetrievedCount<3||
      preSend.historyWindowRetrievedCount>4||
      preSend.historyWindowOmittedCount!==preSend.historyWindowMessageCount-preSend.historyWindowRetrievedCount||
      !preSend.historyWindowReason)
      throw Error('context_e2e_pre_send_context_invariant_failed');

    phase='send_cross_conversation_probe';
    await send(request);
    phase='await_cross_conversation_probe';
    const finalAnswer=await awaitCompletedTurn(taskId,20);
    const data=extractJson(finalAnswer);
    const normalizedAnswer=String(data?.altura_lia||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const answerReference=String(data?.referencia_antiga||'').match(/[a-f0-9]{32}/i)?.[0]||'';
    const total=Number(String(data?.total_pedido??'').replace(/[^\d,.-]/g,'').replace(',','.'));
    const palette=Array.isArray(data?.paleta_vigente)?data.paleta_vigente.join(' '):String(data?.paleta_vigente||'');
    const normalizedPalette=palette.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const answerPassed=data?.secret===secret&&data?.nonce===nonce&&Math.abs(total-251.7)<0.001&&
      Number(data?.estoque_final)===7&&normalizedPalette.includes('grafite')&&
      normalizedPalette.includes('coral')&&!normalizedPalette.includes('jade')&&
      answerReference===olderCode&&
      /nao consta|nao informado|nao disponivel/.test(normalizedAnswer);
    const postDb=new DatabaseSync(labDatabasePath(),{readOnly:true});
    let receipt;
    try{
      const task=postDb.prepare('SELECT status,chat_url FROM tasks WHERE id=?').get(taskId);
      const messages=postDb.prepare('SELECT id,role,content FROM messages WHERE task_id=? ORDER BY sequence').all(taskId);
      const userMessage=messages.filter(message=>message.role==='user').at(-1);
      const event=postDb.prepare(`SELECT payload FROM events WHERE task_id=? AND kind='provider.submission.provenance'
        AND json_extract(payload,'$.message_id')=? ORDER BY seq DESC LIMIT 1`).get(taskId,userMessage?.id);
      const conversations=postDb.prepare(`SELECT id,sequence,status,chat_url,context_checkpoint_version,
        (SELECT COUNT(*) FROM conversation_completed_runs r WHERE r.conversation_id=c.id) AS completed_turns
        FROM task_conversations c WHERE task_id=? ORDER BY sequence`).all(taskId);
      const parsed=event?JSON.parse(event.payload):null;
      const manifest=parsed?.context_manifest;
      receipt={
        taskId,taskStatus:task?.status||null,
        userMessages:messages.filter(message=>message.role==='user').length,
        assistantMessages:messages.filter(message=>message.role==='assistant').length,
        conversations:conversations.map(({sequence,status,context_checkpoint_version,completed_turns})=>({sequence,status,checkpointVersion:Number(context_checkpoint_version||0),completedTurns:Number(completed_turns)})),
        distinctProviderChats:new Set(conversations.map(row=>row.chat_url).filter(Boolean)).size,
        latestUserPromptExcludesCanonicalSecret:messages.filter(message=>message.role==='user').every(message=>!message.content.includes(secret)),
        canonicalMemoryCount:Number(postDb.prepare("SELECT COUNT(*) AS n FROM project_memory_items WHERE task_id=? AND status='active'").get(taskId).n),
        providerReceiptPresent:Boolean(parsed),
        promptDigestMatches:parsed?.prompt_sha256===createHash('sha256').update(expectedPacket.prompt.trim(),'utf8').digest('hex'),
        contextDigestMatches:manifest?.context_sha256===expectedPacket.manifest.contextSha256,
        checkpointVersionMatches:Number(manifest?.checkpoint_version||0)===preSend.checkpointVersion,
        memoryIdBound:manifest?.included_memory_ids?.includes(memory?.id)===true,
        canonicalSourceRefsBound:Boolean(preSend.stockMemoryId&&preSend.paletteMemoryId&&
          [preSend.stockMemoryId,preSend.paletteMemoryId].every(id=>manifest?.included_memory_ids?.includes(id))&&
          manifest?.retrieved_message_ids?.includes(preSend.stockSourceId)&&
          manifest?.retrieved_message_ids?.includes(preSend.paletteSourceId)),
        taskScopedRetrievedMessages:Boolean(manifest&&manifest.retrieved_message_ids.every(id=>
          postDb.prepare('SELECT task_id FROM messages WHERE id=?').get(id)?.task_id===taskId)),
        contextChars:Number(manifest?.context_chars||0),
        attachmentUseful:manifest?.attachment_useful===true,
        historyWindowMessageCount:Number(manifest?.history_window_message_count||0),
        historyWindowRetrievedCount:Number(manifest?.history_window_retrieved_count||0),
        historyWindowOmittedCount:Number(manifest?.history_window_omitted_count||0),
        historyWindowOmissionsMatch: Number(manifest?.history_window_omitted_count||0)===expectedPacket.manifest.historyWindowOmittedCount,
        retrievedMessageIdsMatch:JSON.stringify(manifest?.retrieved_message_ids||[])===JSON.stringify(expectedPacket.manifest.retrievedMessageIds),
        retrievedMessageIdBound:manifest?.retrieved_message_ids?.includes(messages[0]?.id)===true&&
          manifest?.included_message_ids?.includes(messages[0]?.id)===true,
        manifestPartial:manifest?.partial===true,
        historyWindowReasonRecorded:Array.isArray(manifest?.omission_reasons)&&manifest.omission_reasons.includes('history_window'),
        manifestContainsNoSecret:Boolean(event)&&!event.payload.includes(secret),
        criticalContextComplete:manifest?.context_included===true&&manifest?.critical_omissions===0,
        quickCheck:postDb.prepare('PRAGMA quick_check').get().quick_check
      };
    }finally{postDb.close();}
    const passed=answerPassed&&receipt.taskStatus==='ready'&&receipt.userMessages===10&&
      receipt.assistantMessages===10&&receipt.conversations.length===2&&receipt.distinctProviderChats===2&&
      receipt.conversations[0].status==='archived'&&receipt.conversations[0].completedTurns===9&&
      receipt.conversations[1].status==='active'&&receipt.conversations[1].completedTurns===1&&
      receipt.latestUserPromptExcludesCanonicalSecret&&receipt.providerReceiptPresent&&
      receipt.promptDigestMatches&&receipt.contextDigestMatches&&receipt.checkpointVersionMatches&&
      receipt.memoryIdBound&&receipt.canonicalSourceRefsBound&&receipt.taskScopedRetrievedMessages&&
      receipt.canonicalMemoryCount===3&&receipt.contextChars>0&&!receipt.attachmentUseful&&
      receipt.historyWindowOmissionsMatch&&receipt.historyWindowMessageCount===10&&
      receipt.historyWindowRetrievedCount>=3&&receipt.historyWindowRetrievedCount<=4&&
      receipt.historyWindowOmittedCount===receipt.historyWindowMessageCount-receipt.historyWindowRetrievedCount&&
      receipt.retrievedMessageIdsMatch&&receipt.retrievedMessageIdBound&&
      receipt.manifestPartial&&receipt.historyWindowReasonRecorded&&
      receipt.manifestContainsNoSecret&&receipt.criticalContextComplete&&receipt.quickCheck==='ok';
    phase='complete';
    console.log(JSON.stringify({schema:'ordax.lab.context-packet-live-e2e.v2',passed,
      setupTurnsObserved:turnAnswers.length,manualRotationObserved:receipt.conversations.length===2,
      memorySecretWasNotInChatOrCheckpoint:preSend.secretOnlyInCanon,
      memorySecretWasInProviderContext:preSend.secretPresentInContext,
      oldReferenceWasInFirstTurnOnly:preSend.olderCodeOnlyInFirstUserMessage,
      oldReferenceWasOutsideRecentWindow:preSend.olderCodeExcludedFromRecentWindow,
      oldReferenceWasRetrievedByOrdaX:preSend.olderCodeRetrievedFromSearch&&preSend.olderCodePresentInProviderContext,
      canonicalFactSourcesWereOutsideRecentWindow:preSend.canonicalSourcesOutsideRecentWindow,
      canonicalFactSourcesWereRetrieved:preSend.canonicalSourcesRecovered&&receipt.canonicalSourceRefsBound,
      retrievedMessageScopeWasTaskBound:receipt.taskScopedRetrievedMessages,
      independentNonceWasOnlyInCurrentRequest:preSend.noncePresentInRequest,
      answerPassed,receipt},null,2));
    if(!passed)process.exitCode=2;
  }finally{try{ws.close();}catch{}}
}

main().catch(error=>{
  const message=String(error?.message||'context_e2e_failed');
  console.error(JSON.stringify({schema:'ordax.lab.context-packet-live-e2e.error.v1',phase,
    completedSetupTurns,error:message.replace(/\b[a-f0-9]{64}\b/gi,'[redacted]')}));
  process.exitCode=1;
});
