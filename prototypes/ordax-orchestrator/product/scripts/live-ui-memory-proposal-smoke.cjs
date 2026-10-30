const {waitForLabUiTarget,labDatabasePath,waitForLabAppMode}=require('./e2e-lab-target.cjs');
const {acquireE2ELock}=require('./e2e-lock.cjs');
const {DatabaseSync}=require('node:sqlite');
const {randomBytes,createHash}=require('node:crypto');

acquireE2ELock('assistant-memory-proposal-smoke');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const timeoutMs=240000;
const cdpCallTimeoutMs=60000;
let phase='initializing';

async function main(){
  const secret='ORDAX_CANON_'+randomBytes(32).toString('hex');
  const nonce='ORDAX_REQUEST_'+randomBytes(32).toString('hex');
  if(secret===nonce)throw Error('memory_proposal_seeds_not_independent');
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
    try{message=JSON.parse(event.data);}catch{rejectPending(Error('memory_proposal_cdp_invalid_json'));return;}
    const waiter=pending.get(message.id);
    if(!waiter)return;
    pending.delete(message.id);clearTimeout(waiter.timer);
    message.error?waiter.reject(Error('memory_proposal_cdp_command_failed')):waiter.resolve(message.result);
  };
  ws.onerror=()=>rejectPending(Error('memory_proposal_cdp_connection_failed'));
  ws.onclose=()=>rejectPending(Error('memory_proposal_cdp_connection_closed'));
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('memory_proposal_cdp_connect_timeout')),10000);
    ws.onopen=()=>{clearTimeout(timer);resolve();};
  });
  const call=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++nextId;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('memory_proposal_cdp_timeout'));},cdpCallTimeoutMs);
    pending.set(id,{resolve,reject,timer});
    try{ws.send(JSON.stringify({id,method,params}));}
    catch{clearTimeout(timer);pending.delete(id);reject(Error('memory_proposal_cdp_send_failed'));}
  });
  const evaluate=async expression=>{
    const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,timeout:cdpCallTimeoutMs-5000});
    if(result.exceptionDetails)throw Error('memory_proposal_ui_operation_failed');
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
  })()`),{attempts:1500,delay:100});
  const taskSnapshot=taskId=>evaluate(`window.ordax.getTask(${JSON.stringify(taskId)})`);
  const send=async prompt=>{
    const ready=await waitFor(async()=>{
      const state=await evaluate(`(()=>({disabled:Boolean(document.querySelector('#send')?.disabled),
        text:document.querySelector('#prompt')?.value||''}))()`);
      return !state.disabled&&!state.text?state:null;
    },{attempts:300,delay:100});
    if(!ready)throw Error('memory_proposal_composer_not_ready_or_empty');
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
        throw Error('memory_proposal_provider_run_failed');
      const messageCount=Number(task?.continuation?.total_messages??task?.messages?.length??0);
      if(messageCount===expectedTotalMessages&&task?.latest_run?.status==='succeeded')
        return task.messages?.filter(message=>message.role==='assistant').at(-1)?.content||'';
      await sleep(300);
    }
    throw Error('memory_proposal_turn_timeout_or_unverified');
  };

  try{
    phase='app_mode_preflight';
    await waitForLabAppMode(evaluate);
    const scope=await evaluate(`(async()=>{
      const select=document.querySelector('#projectSelect');
      if(!select)return {available:false,value:null};
      select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,50));
      return {available:true,value:select.value||null,hidden:document.querySelector('#orchestrationPanel')?.hidden===true};
    })()`);
    if(!scope.available||scope.value!==null||!scope.hidden)throw Error('memory_proposal_scope_not_isolated');
    phase='provider_preflight';
    if(!await waitForProvider())throw Error('memory_proposal_provider_not_ready');

    phase='task_creation';
    const previousTask=await evaluate(`document.querySelector('#taskId')?.textContent||''`);
    await evaluate(`document.querySelector('#newTask').click();true`);
    const taskId=await waitFor(()=>evaluate(`(()=>{
      const id=document.querySelector('#taskId')?.textContent||'';
      return id&&id!==${JSON.stringify(previousTask)}&&!document.querySelector('#taskPanel').classList.contains('hidden')?id:null;
    })()`),{attempts:300,delay:50});
    if(!taskId||!/^task_[0-9a-f-]{36}$/i.test(taskId))throw Error('memory_proposal_task_creation_failed');
    const initial=await taskSnapshot(taskId);
    if(!initial||initial.messages.length||initial.latest_run)throw Error('memory_proposal_task_not_empty');
    const taskInfo=await evaluate(`(async()=>{
      const task=(await window.ordax.listTasks()).find(item=>item.id===${JSON.stringify(taskId)});
      return {found:Boolean(task),bound:Boolean(task?.lab_binding)};
    })()`);
    if(!taskInfo.found||taskInfo.bound)throw Error('memory_proposal_task_not_unbound');

    phase='first_real_gpt_conversation';
    const firstRequest='Estamos iniciando uma tarefa de projeto. Responda somente com a palavra PRONTO.';
    await send(firstRequest);
    const firstAnswer=await awaitCompletedTurn(taskId,2);
    if(!/\bPRONTO\b/i.test(firstAnswer))throw Error('memory_proposal_first_gpt_turn_not_confirmed');
    const firstState=await taskSnapshot(taskId);
    const firstChatUrl=firstState?.chat_url||'';
    if(!firstChatUrl)throw Error('memory_proposal_first_chat_not_linked');

    phase='write_private_canonical_memory';
    const stored=await evaluate(`window.ordax.upsertProjectMemory(${JSON.stringify(taskId)},
      {category:'fact',key:'Marcador de continuidade sigiloso',content:${JSON.stringify(secret)}})`);
    const memory=stored?.project_memory?.items?.find(item=>item.key==='Marcador de continuidade sigiloso'&&item.content===secret&&item.status==='active');
    if(!memory?.id)throw Error('memory_proposal_canonical_memory_not_stored');
    const oneTurnDb=new DatabaseSync(labDatabasePath(),{readOnly:true});
    let secretOnlyInCanon;
    try{
      const messages=oneTurnDb.prepare('SELECT content FROM messages WHERE task_id=?').all(taskId);
      const checkpoints=oneTurnDb.prepare('SELECT summary FROM checkpoints WHERE task_id=?').all(taskId);
      secretOnlyInCanon=!messages.some(row=>row.content.includes(secret))&&!checkpoints.some(row=>row.summary.includes(secret));
    }finally{oneTurnDb.close();}
    if(!secretOnlyInCanon)throw Error('memory_proposal_secret_leaked_before_rotation');

    phase='manual_conversation_rotation';
    const rotation=await evaluate(`(()=>({disabled:Boolean(document.querySelector('#rotateConversation')?.disabled)}))()`);
    if(rotation.disabled)throw Error('memory_proposal_rotation_disabled');
    await evaluate(`document.querySelector('#rotateConversation').click();true`);
    const rotated=await waitFor(async()=>{
      const task=await taskSnapshot(taskId);
      return !task?.chat_url&&task?.conversations?.some(conversation=>conversation.status==='archived')?task:null;
    },{attempts:400,delay:100});
    if(!rotated)throw Error('memory_proposal_rotation_not_observed');
    if(!await waitForProvider())throw Error('memory_proposal_second_chat_not_ready');

    phase='pre_send_canonical_context_proof';
    const nonce='ORDAX_REQUEST_'+randomBytes(32).toString('hex');
    const request=[
      'Continue a mesma tarefa OrdaX em uma conversa GPT nova. O marcador canônico pode estar no contexto fornecido pelo OrdaX; se estiver, copie-o exatamente. Não invente um valor ausente.',
      `Marcador desta solicitação: ${nonce}`,
      'Para uma loja demonstrativa de roupas, tome uma decisão concreta e verificável para o próximo passo do catálogo. Dê uma justificativa curta em português, sem inventar dados de produtos.',
      'Se a resposta estabelecer uma decisão durável, registre exatamente uma proposta no formato permitido pelo protocolo de memória do OrdaX. A proposta é provisória e não substitui memória aprovada.'
    ].join('\n');
    if(request.includes(secret))throw Error('memory_proposal_request_leaks_secret');
    const beforeDb=new DatabaseSync(labDatabasePath(),{readOnly:true});
    let expectedPacket,preSend;
    try{
      const task=beforeDb.prepare('SELECT id,title,checkpoint FROM tasks WHERE id=?').get(taskId);
      const checkpoint=beforeDb.prepare('SELECT version,summary FROM checkpoints WHERE task_id=? ORDER BY version DESC LIMIT 1').get(taskId);
      const memoryItems=beforeDb.prepare(`SELECT id,task_id,category,memory_key AS key,content,status,source_type,source_ref,created_at,updated_at,archived_at
        FROM project_memory_items WHERE task_id=? AND status='active' ORDER BY updated_at DESC,id`).all(taskId);
      const recentMessages=beforeDb.prepare(`SELECT id,role,content,created_at,sequence FROM messages WHERE task_id=? ORDER BY sequence DESC LIMIT 8`).all(taskId).reverse().map(row=>({...row,assets:[]}));
      const totalMessageCount=Number(beforeDb.prepare('SELECT COUNT(*) AS n FROM messages WHERE task_id=?').get(taskId)?.n||0);
      const {buildProjectContinuationPacket}=await import('../src/continuation-context.mjs');
      expectedPacket=buildProjectContinuationPacket({title:task?.title,checkpoint:checkpoint?.summary||task?.checkpoint,
        checkpointVersion:Number(checkpoint?.version||0),memoryItems,recentMessages,totalMessageCount,request});
      const conversations=beforeDb.prepare('SELECT sequence,status,chat_url FROM task_conversations WHERE task_id=? ORDER BY sequence').all(taskId);
      preSend={memoryId:memory?.id,secretInCanonical:Boolean(memoryItems.find(item=>item.id===memory?.id)?.content===secret),
        secretInProviderPacket:expectedPacket.prompt.includes(secret),secretInUserRequest:request.includes(secret),
        nonceInUserRequest:request.includes(nonce),contextIncluded:expectedPacket.manifest.contextIncluded,
        criticalOmissions:expectedPacket.manifest.criticalOmissions,firstChatArchived:conversations[0]?.status==='archived',
        firstChatUrl:conversations[0]?.chat_url||'',conversationCount:conversations.length,
        oldChatNotVisibleToNewConversation:Boolean(conversations[0]?.chat_url&&!conversations.some(row=>row.status==='active'&&row.chat_url===conversations[0].chat_url))};
    }finally{beforeDb.close();}
    if(!preSend.secretInCanonical||!preSend.secretInProviderPacket||preSend.secretInUserRequest||
       !preSend.nonceInUserRequest||!preSend.contextIncluded||preSend.criticalOmissions!==0||
       !preSend.firstChatArchived||preSend.firstChatUrl!==firstChatUrl||preSend.conversationCount!==1||!preSend.oldChatNotVisibleToNewConversation)
      throw Error('memory_proposal_context_preflight_failed');

    phase='second_real_gpt_conversation';
    await send(request);
    const secondAnswer=await awaitCompletedTurn(taskId,4);
    if(!secondAnswer.includes(secret)||!secondAnswer.includes(nonce))throw Error('memory_proposal_cross_chat_answer_missing_evidence');
    if(!secondAnswer.includes('[[ORDAX_MEMORY_PROPOSALS_V1]]')||!secondAnswer.includes('[[/ORDAX_MEMORY_PROPOSALS_V1]]'))
      throw Error('memory_proposal_block_not_returned_by_gpt');

    phase='pending_candidate_provenance';
    const pendingState=await taskSnapshot(taskId);
    const assistantMessage=pendingState?.messages?.filter(message=>message.role==='assistant').at(-1);
    const assistantCandidates=(pendingState?.project_memory?.candidates||[]).filter(item=>item.source_role==='assistant'&&item.source_message_id===assistantMessage?.id);
    if(!assistantMessage?.id||!assistantCandidates.length)throw Error('memory_proposal_candidate_not_created');
    const activeBeforeReview=(pendingState.project_memory.items||[]).filter(item=>item.status==='active');
    const candidateWasPendingBeforeReview=assistantCandidates.every(item=>item.status==='pending');
    if(activeBeforeReview.length!==1||!candidateWasPendingBeforeReview)
      throw Error('memory_proposal_was_auto_promoted');
    const beforeScanCount=assistantCandidates.length;
    const scanned=await evaluate(`window.ordax.scanMemoryCandidates(${JSON.stringify(taskId)})`);
    const scanCandidates=(scanned?.project_memory?.candidates||[]).filter(item=>item.source_role==='assistant'&&item.source_message_id===assistantMessage.id);
    if(scanCandidates.length!==beforeScanCount)throw Error('memory_proposal_scan_not_idempotent');

    phase='approve_through_app_ui';
    const candidate=assistantCandidates[0];
    const clicked=await evaluate(`(()=>{
      const card=[...document.querySelectorAll('.memory-candidate')].find(node=>node.dataset.candidateId===${JSON.stringify(candidate.id)});
      const button=card?.querySelector('[data-review="accept"]');
      if(!button||button.disabled)return false;
      button.click();return true;
    })()`);
    if(!clicked)throw Error('memory_proposal_approval_control_unavailable');
    const approved=await waitFor(async()=>{
      const task=await taskSnapshot(taskId);
      const canon=task?.project_memory?.items?.find(item=>item.id===candidate.memory_item_id||
        (item.category===candidate.category&&item.key===candidate.key&&item.content===candidate.content));
      return canon?.status==='active'?{task,canon}:null;
    },{attempts:120,delay:100});
    if(!approved)throw Error('memory_proposal_explicit_approval_not_persisted');

    phase='durable_provenance_validation';
    const db=new DatabaseSync(labDatabasePath(),{readOnly:true});
    let receipt;
    try{
      const task=db.prepare('SELECT status,chat_url FROM tasks WHERE id=?').get(taskId);
      const messages=db.prepare('SELECT id,role,content,sequence FROM messages WHERE task_id=? ORDER BY sequence').all(taskId);
      const userMessages=messages.filter(message=>message.role==='user');
      const assistantMessages=messages.filter(message=>message.role==='assistant');
      const conversations=db.prepare(`SELECT id,sequence,status,chat_url,
        (SELECT COUNT(*) FROM conversation_completed_runs r WHERE r.conversation_id=c.id) AS completed_turns
        FROM task_conversations c WHERE task_id=? ORDER BY sequence`).all(taskId);
      const candidateRow=db.prepare('SELECT * FROM project_memory_candidates WHERE id=? AND task_id=?').get(candidate.id,taskId);
      const memoryRow=db.prepare('SELECT * FROM project_memory_items WHERE id=? AND task_id=?').get(candidateRow?.memory_item_id,taskId);
      const assistantEvent=db.prepare(`SELECT payload FROM events WHERE task_id=? AND kind='provider.submission.provenance'
        AND json_extract(payload,'$.message_id')=? ORDER BY seq DESC LIMIT 1`).get(taskId,userMessages.at(-1)?.id);
      const parsed=assistantEvent?JSON.parse(assistantEvent.payload):null;
      const manifest=parsed?.context_manifest;
      const suggestionEvent=db.prepare(`SELECT payload FROM events WHERE task_id=? AND kind='project_memory.candidate_suggested'
        AND json_extract(payload,'$.source_message_id')=? ORDER BY seq DESC LIMIT 1`).get(taskId,assistantMessage.id);
      const reviewEvent=db.prepare(`SELECT payload FROM events WHERE task_id=? AND kind='project_memory.candidate_reviewed'
        AND json_extract(payload,'$.candidate_id')=? ORDER BY seq DESC LIMIT 1`).get(taskId,candidate.id);
      receipt={taskStatus:task?.status||null,userMessages:userMessages.length,assistantMessages:assistantMessages.length,
        userRequestExcludesSecret:userMessages.every(row=>!row.content.includes(secret)),
        assistantResponseContainsSecret:assistantMessages.at(-1)?.content.includes(secret)===true,
        distinctProviderChats:new Set(conversations.map(row=>row.chat_url).filter(Boolean)).size,
        conversationStates:conversations.map(row=>({sequence:row.sequence,status:row.status,turns:Number(row.completed_turns)})),
        contextManifestPresent:Boolean(manifest),contextIncluded:manifest?.context_included===true,
        canonicalMemoryBound:manifest?.included_memory_ids?.includes(memory?.id)===true,
        promptDigestMatches:parsed?.prompt_sha256===createHash('sha256').update(expectedPacket.prompt.trim(),'utf8').digest('hex'),
        contextDigestMatches:manifest?.context_sha256===expectedPacket.manifest.contextSha256,
        canonicalSecretExcludedFromProvenance:Boolean(assistantEvent&&!assistantEvent.payload.includes(secret)),
        assistantCandidatePendingBeforeReview:candidateWasPendingBeforeReview,
        candidateAccepted:candidateRow?.status==='accepted',
        acceptedMemoryLinkedToAssistant:Boolean(memoryRow?.source_type==='message'&&memoryRow.source_ref===assistantMessage.id),
        suggestionEventRole:suggestionEvent?JSON.parse(suggestionEvent.payload).source_role:null,
        reviewEventAction:reviewEvent?JSON.parse(reviewEvent.payload).action:null,
        integrity:db.prepare('PRAGMA quick_check').get().quick_check};
    }finally{db.close();}
    const passed=receipt.taskStatus==='ready'&&receipt.userMessages===2&&receipt.assistantMessages===2&&
      receipt.userRequestExcludesSecret&&receipt.assistantResponseContainsSecret&&receipt.distinctProviderChats===2&&
      receipt.conversationStates.length===2&&receipt.conversationStates[0].status==='archived'&&
      receipt.conversationStates[0].turns===1&&receipt.conversationStates[1].status==='active'&&
      receipt.conversationStates[1].turns===1&&receipt.contextManifestPresent&&receipt.contextIncluded&&
      receipt.canonicalMemoryBound&&receipt.promptDigestMatches&&receipt.contextDigestMatches&&
      receipt.canonicalSecretExcludedFromProvenance&&receipt.candidateAccepted&&
      receipt.assistantCandidatePendingBeforeReview&&
      receipt.acceptedMemoryLinkedToAssistant&&receipt.suggestionEventRole==='assistant'&&
      receipt.reviewEventAction==='accept'&&receipt.integrity==='ok';
    phase='complete';
    console.log(JSON.stringify({schema:'ordax.lab.assistant-memory-proposal-live-e2e.v1',passed,taskId,
      canonicalSecretOnlyInOrdaXBeforeRotation:true,requestExcludedSecret:true,
      gptWebReturnedSecretFromNewConversation:receipt.assistantResponseContainsSecret,
      gptWebProducedPendingProposal:assistantCandidates.length>0,
      proposalAcceptedOnlyThroughUi:true,receipt}));
    ws.close();
    if(!passed)process.exitCode=2;
  }catch(error){
    try{ws.close();}catch{}
    console.error(JSON.stringify({schema:'ordax.lab.assistant-memory-proposal-live-e2e.v1',passed:false,phase,
      error:String(error?.message||error).slice(0,180)}));
    process.exitCode=2;
  }
}
main().catch(error=>{
  console.error(JSON.stringify({schema:'ordax.lab.assistant-memory-proposal-live-e2e.v1',passed:false,
    phase,error:String(error?.message||error).slice(0,180)}));
  process.exitCode=2;
});
