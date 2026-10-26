const {waitForLabUiTarget,labDatabasePath,waitForLabAppMode}=require('./e2e-lab-target.cjs');
const {acquireE2ELock}=require('./e2e-lock.cjs');
const {DatabaseSync}=require('node:sqlite');
const {randomBytes,createHash}=require('node:crypto');
const {createLongHorizonScenario,chapterWordCount,extractArchiveReferenceFromPrompt,gradeLedgerAnswer,gradeContinuityAnswer}=require('./long-horizon-book-eval.cjs');

const turns=Number(process.env.ORDAX_E2E_TURNS||25);
if(!Number.isSafeInteger(turns)||turns<2||turns>30)throw new Error('invalid_multiturn_bounds');
const resumeTaskId=String(process.env.ORDAX_E2E_RESUME_TASK_ID||'');
if(resumeTaskId&&!/^task_[a-f0-9-]{36}$/i.test(resumeTaskId))throw new Error('invalid_resume_task_id');
const composerReadyTimeoutMs=Number(process.env.ORDAX_E2E_READY_TIMEOUT_MS||120000);
if(!Number.isSafeInteger(composerReadyTimeoutMs)||composerReadyTimeoutMs<1000||composerReadyTimeoutMs>240000)
  throw new Error('invalid_composer_ready_timeout');
const cdpCallTimeoutMs=Number(process.env.ORDAX_E2E_CDP_TIMEOUT_MS||30000);
if(!Number.isSafeInteger(cdpCallTimeoutMs)||cdpCallTimeoutMs<5000||cdpCallTimeoutMs>60000)
  throw new Error('invalid_cdp_call_timeout');
acquireE2ELock('multiturn-smoke');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function main(){
  const {SUCCESSFUL_TURNS_PER_SEGMENT}=await import('../src/conversation-policy.mjs');
  if(turns!==SUCCESSFUL_TURNS_PER_SEGMENT+1)throw new Error('long_context_eval_requires_exactly_one_provider_rotation');
  let scenario;
  if(resumeTaskId){
    const db=new DatabaseSync(labDatabasePath(),{readOnly:true});
    try{
      const task=db.prepare('SELECT id,status,chat_url FROM tasks WHERE id=?').get(resumeTaskId);
      const messages=db.prepare('SELECT id,role,content,sequence FROM messages WHERE task_id=? ORDER BY sequence').all(resumeTaskId);
      const users=messages.filter(message=>message.role==='user');
      const assistants=messages.filter(message=>message.role==='assistant');
      const runs=db.prepare("SELECT COUNT(*) AS n FROM runs WHERE task_id=? AND status='succeeded'").get(resumeTaskId);
      const conversations=db.prepare('SELECT sequence,status,chat_url FROM task_conversations WHERE task_id=? ORDER BY sequence').all(resumeTaskId);
      const secret=db.prepare("SELECT content FROM project_memory_items WHERE task_id=? AND category='fact' AND memory_key='Segredo do selo' AND status='active'").get(resumeTaskId)?.content||'';
      const currentSchedule=db.prepare("SELECT content FROM project_memory_items WHERE task_id=? AND category='fact' AND memory_key='Horário da cápsula' AND status='active'").get(resumeTaskId)?.content||'';
      const archiveReference=extractArchiveReferenceFromPrompt(users[0]?.content||'');
      if(task?.status!=='ready'||!task.chat_url||users.length!==24||assistants.length!==24||Number(runs?.n)!==24||
        conversations.length!==1||conversations[0].sequence!==1||conversations[0].status!=='active'||
        !secret||!archiveReference||!currentSchedule.includes('04:17')||!currentSchedule.includes('04:10'))
        throw new Error('resume_task_not_at_verified_24_turn_checkpoint');
      let nonce='';
      do{nonce=randomBytes(32).toString('hex');}while(nonce===secret||`ARCO-LUAR-${nonce}`===archiveReference);
      scenario=createLongHorizonScenario({uuid:(()=>{const values=[secret,nonce,archiveReference.slice('ARCO-LUAR-'.length)];let index=0;return()=>values[index++];})()});
    }finally{db.close();}
  }else scenario=createLongHorizonScenario({uuid:()=>randomBytes(32).toString('hex')});
  const target=await waitForLabUiTarget();
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  let sequence=0;
  const pending=new Map();
  const rejectPending=error=>{
    for(const waiter of pending.values())waiter.reject(error);
    pending.clear();
  };
  ws.onmessage=event=>{
    let message;
    try{message=JSON.parse(event.data);}catch{rejectPending(new Error('lab_cdp_invalid_response'));return;}
    if(!message.id||!pending.has(message.id))return;
    const waiter=pending.get(message.id);pending.delete(message.id);clearTimeout(waiter.timer);
    message.error?waiter.reject(new Error('lab_cdp_command_rejected')):waiter.resolve(message.result);
  };
  ws.onerror=()=>rejectPending(new Error('lab_cdp_connection_failed'));
  ws.onclose=()=>rejectPending(new Error('lab_cdp_connection_closed'));
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('lab_cdp_connect_timeout')),cdpCallTimeoutMs);
    ws.onopen=()=>{clearTimeout(timer);resolve();};
  });
  const call=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++sequence;
    const timer=setTimeout(()=>{
      pending.delete(id);
      reject(new Error(`lab_cdp_command_timeout_${method}`));
    },cdpCallTimeoutMs);
    pending.set(id,{resolve,reject,timer});
    try{ws.send(JSON.stringify({id,method,params}));}
    catch{clearTimeout(timer);pending.delete(id);reject(new Error('lab_cdp_send_failed'));}
  });
  const evaluate=async expression=>{
    const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,timeout:cdpCallTimeoutMs});
    if(result.exceptionDetails){
      const detail=result.exceptionDetails;
      throw new Error([detail.text,detail.exception?.description,detail.exception?.value].filter(Boolean).join(' | ')||'ui_evaluation_failed');
    }
    return result.result.value;
  };
  const waitForComposerReady=async turn=>{
    const started=Date.now();
    let blockedObserved=false;
    let lastState=null;
    while(Date.now()-started<composerReadyTimeoutMs){
      lastState=await evaluate(`(async()=>{
        const button=document.querySelector('#send');
        const composer=document.querySelector('#composer');
        const status=await window.ordax.providerStatus();
        return {
          sendEnabled:Boolean(button&&!button.disabled),
          sendReady:composer?.dataset.sendReady==='true',
          composerReady:status?.composer_ready===true,
          sessionPresent:status?.auth_state==='session_present',
          generationActive:status?.response_generation_active===true,
          providerActive:status?.active===true,
          verificationRequired:status?.verification_required===true
        };
      })()`);
      const ready=lastState.sendEnabled&&lastState.sendReady&&lastState.composerReady&&
        lastState.sessionPresent&&!lastState.generationActive&&!lastState.providerActive&&
        !lastState.verificationRequired;
      if(ready)return {waitMs:Date.now()-started,blockedObserved};
      blockedObserved=true;
      await sleep(250);
    }
    throw new Error(`provider_composer_ready_timeout_turn_${turn}_${JSON.stringify({
      blockedObserved,sendEnabled:lastState?.sendEnabled===true,
      composerReady:lastState?.composerReady===true,generationActive:lastState?.generationActive===true,
      providerActive:lastState?.providerActive===true,verificationRequired:lastState?.verificationRequired===true
    })}`);
  };
  try{
    await waitForLabAppMode(evaluate);
    const scope=await evaluate(`(async()=>{const select=document.querySelector('#projectSelect');if(!select)return {available:false,selected:null};select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,50));return {available:true,selected:select.value||null}})()`);
    if(!scope.available||scope.selected!==null)throw new Error('provider_only_project_scope_not_cleared');
    const scopeReady=await evaluate(`document.querySelector('#projectSelect')?.value===''&&document.querySelector('#orchestrationPanel')?.hidden===true`);
    if(!scopeReady)throw new Error('provider_only_project_transition_not_complete');
    const provider=await evaluate(`(async()=>{const status=await window.ordax.providerStatus();return {ready:Boolean(status?.connected&&status?.composer_ready&&!status?.verification_required),authState:status?.auth_state||'unknown'}})()`);
    if(!provider.ready)throw new Error('provider_not_ready');
    const previousTaskId=await evaluate(`document.querySelector('#taskId')?.textContent||''`);
    let taskId=resumeTaskId||null;
    if(resumeTaskId){
      const selected=await evaluate(`(()=>{const task=document.querySelector('.task[data-id=${JSON.stringify(resumeTaskId)}]');if(!task)return false;task.click();return true})()`);
      if(!selected)throw new Error('resume_task_not_visible');
      for(let i=0;i<200;i++){
        const state=await evaluate(`(()=>({id:document.querySelector('#taskId')?.textContent||'',visible:!document.querySelector('#taskPanel').classList.contains('hidden')}))()`);
        if(state.visible&&state.id===resumeTaskId)break;
        await sleep(50);
      }
      const selectedId=await evaluate(`document.querySelector('#taskId')?.textContent||''`);
      if(selectedId!==resumeTaskId)throw new Error('resume_task_not_ready');
    }else{
      await evaluate(`document.querySelector('#newTask').click();true`);
      taskId=null;
      for(let i=0;i<200;i++){
        const state=await evaluate(`(()=>({id:document.querySelector('#taskId')?.textContent||'',visible:!document.querySelector('#taskPanel').classList.contains('hidden')}))()`);
        if(state.visible&&state.id&&state.id!==previousTaskId){taskId=state.id;break;}
        await sleep(50);
      }
      if(!taskId)throw new Error('new_task_not_ready');
    }
    const initial=await evaluate(`window.ordax.getTask(${JSON.stringify(taskId)})`);
    if(!initial)throw new Error('multiturn_task_not_found');
    if(!resumeTaskId&&(initial.messages.length!==0||initial.latest_run))throw new Error('multiturn_task_not_empty');
    if(resumeTaskId&&(initial.messages.length!==48||initial.messages.filter(message=>message.role==='user').length!==24||
      initial.messages.filter(message=>message.role==='assistant').length!==24||initial.latest_run?.status!=='succeeded'))
      throw new Error('resume_task_snapshot_changed');
    const taskInfo=await evaluate(`(async()=>{const tasks=await window.ordax.listTasks();const task=tasks.find(item=>item.id===${JSON.stringify(taskId)});return {found:Boolean(task),bound:Boolean(task?.lab_binding)}})()`);
    if(!taskInfo.found||taskInfo.bound)throw new Error('multiturn_task_not_unbound');

    const results=[];
    let finalContextProvenance=null;
    const acceptedMemoryKeys=new Set(initial.project_memory?.items?.map(item=>`${item.category}:${item.key}`)||[]);
    const acceptedMemoryIds=new Map((initial.project_memory?.items||[]).map(item=>[`${item.category}:${item.key}`,item.id]));
    let ledgerPassed=false;
    let continuityGrade=null;
    let finalChapterWords=0;
    if(resumeTaskId){
      const priorAssistant=initial.messages?.filter(message=>message.role==='assistant')||[];
      ledgerPassed=gradeLedgerAnswer(priorAssistant[19]?.content||'').passed;
      if(!ledgerPassed)throw new Error('resume_task_ledger_not_verified');
    }
    for(let turn=resumeTaskId?turns:1;turn<=turns;turn++){
      // GPT can still be streaming after the Task has received its final
      // answer snapshot. Wait for the app's own readiness gate; never bypass
      // it with an alternate submit mechanism or resend an uncertain turn.
      const readiness=await waitForComposerReady(turn);
      const {prompt,kind,chapterNumber}=scenario.promptForTurn(turn);
      if(turn===SUCCESSFUL_TURNS_PER_SEGMENT+1&&prompt.includes(scenario.sealedSecret))
        throw new Error('memory_probe_leaks_seed_secret');
      const before=await evaluate(`window.ordax.getTask(${JSON.stringify(taskId)})`);
      const priorTotalMessages=Number(before.continuation?.total_messages??before.messages.length);
      if(turn===SUCCESSFUL_TURNS_PER_SEGMENT+1){
        // Capture the exact SSOT inputs before the send. The completed Run can
        // create a later checkpoint, so reconstructing from post-run state is
        // not a valid provenance test.
        const db=new DatabaseSync(labDatabasePath(),{readOnly:true});
        try{
          const task=db.prepare('SELECT title,checkpoint FROM tasks WHERE id=?').get(taskId);
          const checkpoint=db.prepare('SELECT version,summary FROM checkpoints WHERE task_id=? ORDER BY version DESC LIMIT 1').get(taskId);
          const memoryItems=db.prepare(`SELECT id,task_id,category,memory_key AS key,content,status,source_type,source_ref,created_at,updated_at,archived_at
            FROM project_memory_items WHERE task_id=? AND status='active'
            ORDER BY CASE category WHEN 'goal' THEN 1 WHEN 'constraint' THEN 2 WHEN 'decision' THEN 3 WHEN 'entity' THEN 4
              WHEN 'structure' THEN 5 WHEN 'fact' THEN 6 WHEN 'open_loop' THEN 7 ELSE 8 END,updated_at DESC,id`).all(taskId);
          const recentMessages=db.prepare(`SELECT id,role,content,created_at,sequence FROM messages WHERE task_id=?
            ORDER BY sequence DESC LIMIT 8`).all(taskId).reverse().map(message=>({...message,assets:[]}));
          const totalMessageCount=Number(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE task_id=?').get(taskId)?.n||0);
          const {searchTaskHistoricalMessagesWithMemoryKeys}=await import('../src/task-message-search.mjs');
          const retrievedMessages=searchTaskHistoricalMessagesWithMemoryKeys(db,taskId,prompt,{beforeMessage:recentMessages[0],limit:4,memoryItems});
          const {buildProjectContinuationPacket}=await import('../src/continuation-context.mjs');
          const expectedPacket=buildProjectContinuationPacket({title:task?.title,
            checkpoint:checkpoint?.summary||task?.checkpoint,checkpointVersion:Number(checkpoint?.version||0),
            memoryItems,recentMessages,retrievedMessages,totalMessageCount,request:prompt});
          const expectedProviderPrompt=expectedPacket.prompt;
          const referenceSources=db.prepare(`SELECT id,role,sequence,content FROM messages
            WHERE task_id=? AND instr(content,?)>0 ORDER BY sequence`).all(taskId,scenario.archiveReference);
          const referenceSource=referenceSources.find(message=>message.role==='user')||null;
          const scheduleMemory=memoryItems.find(item=>item.key==='Horário da cápsula'&&item.status==='active')||null;
          const provisionalSchedule=db.prepare(`SELECT id,role,sequence,content FROM messages
            WHERE task_id=? AND role='user' AND instr(content,'Horário provisório: 04:10')>0 ORDER BY sequence LIMIT 1`).get(taskId)||null;
          const correctionSource=scheduleMemory?.source_ref?db.prepare('SELECT id,role,sequence,content FROM messages WHERE task_id=? AND id=?').get(taskId,scheduleMemory.source_ref):null;
          finalContextProvenance={
            promptSha256:createHash('sha256').update(expectedProviderPrompt.trim(),'utf8').digest('hex'),
            promptChars:expectedProviderPrompt.length,
            checkpointVersion:Number(checkpoint?.version||0),
            requiredFactsIncluded:[scenario.sealedSecret,'Sinal inicial','Comporta no capítulo doze',
              'Livro-caixa do lançamento','Condição do desfecho','Horário da cápsula',scenario.archiveReference].every(value=>expectedProviderPrompt.includes(value)),
            requestDoesNotLeakSecret:!prompt.includes(scenario.sealedSecret),
            requestDoesNotLeakHistoricalReference:!prompt.includes(scenario.archiveReference),
            historicalReferenceOnlyInInitialUserMessage:referenceSources.length===1&&
              referenceSources[0]?.id===referenceSource?.id&&referenceSource?.sequence===1,
            historicalReferenceNotCanonical:memoryItems.every(item=>!item.content.includes(scenario.archiveReference)),
            historicalReferenceOutsideRecentWindow:!recentMessages.some(message=>message.content.includes(scenario.archiveReference)),
            historicalReferenceRecoveredBySearch:retrievedMessages.some(message=>
              message.id===referenceSource?.id&&message.excerpt.includes(scenario.archiveReference)),
            historicalReferenceBoundToManifest:expectedPacket.manifest.retrievedMessageIds.includes(referenceSource?.id),
            historicalReferenceIncludedInContext:expectedPacket.prompt.includes(scenario.archiveReference),
            temporalCurrentMemoryCanonical:Boolean(scheduleMemory&&scheduleMemory.content.includes('04:17')&&
              scheduleMemory.content.includes('04:10')&&correctionSource?.id===scheduleMemory.source_ref),
            temporalCurrentMemoryBoundToManifest:expectedPacket.manifest.includedMemoryIds.includes(scheduleMemory?.id),
            temporalCorrectionSourceIsUserMessage:correctionSource?.role==='user'&&correctionSource.content.includes('04:10')&&correctionSource.content.includes('04:17'),
            temporalOldVersionHasIndependentSource:provisionalSchedule?.role==='user'&&provisionalSchedule.content.includes('04:10'),
            temporalOldVersionRecoveredBySearch:retrievedMessages.some(message=>message.id===provisionalSchedule?.id&&message.excerpt.includes('04:10')),
            temporalOldVersionBoundToManifest:expectedPacket.manifest.retrievedMessageIds.includes(provisionalSchedule?.id),
            temporalCurrentValueNotLeakedByFinalRequest:!prompt.includes('04:17'),
            temporalSupersededValueNotLeakedByFinalRequest:!prompt.includes('04:10'),
            temporalCurrentValuePresentInContext:Boolean(scheduleMemory&&expectedPacket.prompt.includes(scheduleMemory.content)),
            temporalSupersededValuePresentInContext:expectedPacket.prompt.includes('04:10'),
            retrievedMessageIds:expectedPacket.manifest.retrievedMessageIds,
            historicalReferenceSourceId:referenceSource?.id||null,
            historyWindowMessageCount:expectedPacket.manifest.historyWindowMessageCount,
            historyWindowRetrievedCount:expectedPacket.manifest.historyWindowRetrievedCount,
            historyWindowOmittedCount:expectedPacket.manifest.historyWindowOmittedCount
          };
        }finally{db.close();}
        if(!finalContextProvenance?.requiredFactsIncluded||!finalContextProvenance.requestDoesNotLeakSecret||
          !finalContextProvenance.requestDoesNotLeakHistoricalReference||
          !finalContextProvenance.historicalReferenceOnlyInInitialUserMessage||
          !finalContextProvenance.historicalReferenceNotCanonical||
          !finalContextProvenance.historicalReferenceOutsideRecentWindow||
          !finalContextProvenance.historicalReferenceRecoveredBySearch||
          !finalContextProvenance.historicalReferenceBoundToManifest||
          !finalContextProvenance.historicalReferenceIncludedInContext||
          !finalContextProvenance.temporalCurrentMemoryCanonical||
          !finalContextProvenance.temporalCurrentMemoryBoundToManifest||
          !finalContextProvenance.temporalCorrectionSourceIsUserMessage||
          !finalContextProvenance.temporalOldVersionHasIndependentSource||
          !finalContextProvenance.temporalOldVersionRecoveredBySearch||
          !finalContextProvenance.temporalOldVersionBoundToManifest||
          !finalContextProvenance.temporalCurrentValueNotLeakedByFinalRequest||
          !finalContextProvenance.temporalSupersededValueNotLeakedByFinalRequest||
          !finalContextProvenance.temporalCurrentValuePresentInContext||
          !finalContextProvenance.temporalSupersededValuePresentInContext)
          throw new Error('pre_rotation_context_snapshot_incomplete');
      }
      await evaluate(`(()=>{const prompt=document.querySelector('#prompt');if(!prompt||document.querySelector('#send')?.disabled)throw new Error('composer_not_ready');prompt.value=${JSON.stringify(prompt)};prompt.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#composer').requestSubmit();return true})()`);

      const startedAt=Date.now();
      let accepted=null;
      while(Date.now()-startedAt<240000){
        const state=await evaluate(`window.ordax.getTask(${JSON.stringify(taskId)})`);
        if(state.latest_run?.status==='failed'||state.latest_run?.status==='interrupted'||state.latest_run?.status==='error'){
          throw new Error(`provider_turn_${turn}_${state.latest_run.status}_${state.latest_run.error||'without_reason'}`);
        }
        const totalMessages=Number(state.continuation?.total_messages??state.messages.length);
        const answer=state.messages.filter(message=>message.role==='assistant').at(-1)?.content||'';
        if(totalMessages===priorTotalMessages+2&&
          state.latest_run?.status==='succeeded'){
          if(turn===1&&answer.includes(scenario.archiveReference))
            throw new Error('historical_reference_echoed_before_cross_chat_probe');
          if(kind==='outline'&&answer.trim().length<250)throw new Error('book_outline_response_too_short');
          if(kind==='chapter'){
            const words=chapterWordCount(answer,chapterNumber);
            if(words<100||words>150)throw new Error(`book_chapter_${chapterNumber}_word_count_${words}`);
          }
          if(turn===20){
            const grade=gradeLedgerAnswer(answer);
            ledgerPassed=grade.passed;
            if(!ledgerPassed)throw new Error(`ledger_grading_failed_${grade.reason}`);
          }
          if(kind==='continuation_probe'){
            continuityGrade=gradeContinuityAnswer(answer,scenario);
            if(!continuityGrade.passed)throw new Error(`long_context_grading_failed_${continuityGrade.reason}`);
            finalChapterWords=continuityGrade.chapterWords;
          }
          accepted={elapsedMs:Date.now()-startedAt,messageCount:state.messages.length,
            runStatus:state.latest_run.status,providerDeliveryState:state.latest_run.provider_delivery_state,
            ...(kind==='chapter'?{chapterNumber,chapterWords:chapterWordCount(answer,chapterNumber)}:{}),
            ...(turn===20?{ledgerPassed}:{}),
            ...(kind==='continuation_probe'?{continuityGrade,finalChapterWords}:{})};
          break;
        }
        await sleep(500);
      }
      if(!accepted)throw new Error(`provider_turn_${turn}_timeout_or_unverified`);
      results.push({turn,...accepted,composerReadyWaitMs:readiness.waitMs,
        composerWasGated:readiness.blockedObserved});
      console.log(JSON.stringify({event:'turn_completed',turn,total:turns,...accepted,
        composerReadyWaitMs:readiness.waitMs,composerWasGated:readiness.blockedObserved}));
      for(const expected of scenario.memoriesToAccept(turn)){
        const candidate=await evaluate(`(async()=>{const task=await window.ordax.getTask(${JSON.stringify(taskId)});const latestUser=task?.messages?.filter(item=>item.role==='user').at(-1);return task?.project_memory?.candidates?.find(item=>item.category===${JSON.stringify(expected.category)}&&item.key===${JSON.stringify(expected.key)}&&item.content===${JSON.stringify(expected.content)}&&item.source_message_id===latestUser?.id)||null})()`);
        if(!candidate?.id)throw new Error(`project_memory_candidate_missing_${turn}_${expected.category}_${expected.key}`);
        const memoryKey=`${expected.category}:${expected.key}`;
        const expectedTemporalConflict=turn===18&&expected.category==='fact'&&expected.key==='Horário da cápsula';
        if(Boolean(candidate.conflict)!==expectedTemporalConflict)
          throw new Error(`project_memory_conflict_state_unexpected_${turn}_${expected.key}`);
        const priorMemoryId=acceptedMemoryIds.get(memoryKey);
        const changes=expectedTemporalConflict?{
          confirm_conflict:true,
          expected_canonical_memory_id:candidate.canonical_memory_id,
          expected_canonical_content:candidate.canonical_content
        }:{};
        if(expectedTemporalConflict&&(!priorMemoryId||candidate.canonical_memory_id!==priorMemoryId||
          candidate.canonical_content!=='Horário provisório: 04:10, inferido do relógio não calibrado da estação; ainda sem confirmação independente.'||
          !candidate.content.includes('04:17')||!candidate.content.includes('04:10')))
          throw new Error('temporal_conflict_review_did_not_match_expected_revision');
        const reviewed=await evaluate(`window.ordax.reviewMemoryCandidate(${JSON.stringify(taskId)},${JSON.stringify(candidate.id)},'accept',${JSON.stringify(changes)})`);
        const accepted=Boolean(reviewed?.project_memory?.items?.some(item=>item.category===expected.category&&item.key===expected.key&&item.content===expected.content&&item.status==='active'));
        if(!accepted)throw new Error(`project_memory_candidate_not_canonical_${turn}_${expected.key}`);
        const savedMemory=reviewed.project_memory.items.find(item=>item.category===expected.category&&item.key===expected.key&&item.content===expected.content&&item.status==='active');
        if(priorMemoryId&&savedMemory?.id!==priorMemoryId)throw new Error(`project_memory_identity_changed_${turn}_${expected.key}`);
        acceptedMemoryIds.set(memoryKey,savedMemory.id);
        acceptedMemoryKeys.add(memoryKey);
      }
    }

    const db=new DatabaseSync(labDatabasePath(),{readOnly:true});
    let receipt;
    try{
      const task=db.prepare('SELECT status,chat_url FROM tasks WHERE id=?').get(taskId);
      const counts=db.prepare('SELECT role,COUNT(*) AS count FROM messages WHERE task_id=? GROUP BY role').all(taskId);
      const runs=db.prepare('SELECT status,COUNT(*) AS count FROM runs WHERE task_id=? GROUP BY status').all(taskId);
      const conversations=db.prepare(`SELECT c.sequence,c.status,c.context_checkpoint_version,
        COUNT(r.run_id) AS completed_turns FROM task_conversations c
        LEFT JOIN conversation_completed_runs r ON r.conversation_id=c.id
        WHERE c.task_id=? GROUP BY c.id ORDER BY c.sequence`).all(taskId);
      const autoRotationEvents=Number(db.prepare("SELECT COUNT(*) AS count FROM events WHERE task_id=? AND kind='provider.conversation.auto_rotated'").get(taskId)?.count||0);
      const checkpoint=db.prepare('SELECT MAX(version) AS version FROM checkpoints WHERE task_id=?').get(taskId);
      const messageCharacters=Number(db.prepare('SELECT COALESCE(SUM(LENGTH(content)),0) AS n FROM messages WHERE task_id=?').get(taskId)?.n||0);
      const activeMemoryCount=Number(db.prepare("SELECT COUNT(*) AS n FROM project_memory_items WHERE task_id=? AND status='active'").get(taskId)?.n||0);
      const distinctProviderChats=Number(db.prepare('SELECT COUNT(DISTINCT chat_url) AS n FROM task_conversations WHERE task_id=? AND chat_url IS NOT NULL').get(taskId)?.n||0);
      const canonicalMessages=db.prepare('SELECT id,role,content,created_at FROM messages WHERE task_id=? ORDER BY sequence').all(taskId);
      const finalUserIndex=canonicalMessages.map(message=>message.role).lastIndexOf('user');
      const finalUser=canonicalMessages[finalUserIndex];
      const activeSegment=db.prepare("SELECT id,context_checkpoint_version FROM task_conversations WHERE task_id=? AND status='active' ORDER BY sequence DESC LIMIT 1").get(taskId);
      const providerEvent=finalUser?db.prepare(`SELECT payload FROM events WHERE task_id=? AND kind='provider.submission.provenance'
        AND json_extract(payload,'$.message_id')=? ORDER BY seq DESC LIMIT 1`).get(taskId,finalUser.id):null;
      const providerContextVerified=Boolean(finalUser&&providerEvent&&finalContextProvenance&&activeSegment&&(()=>{
        const eventPayload=JSON.parse(providerEvent.payload);
        return eventPayload.prompt_sha256===finalContextProvenance.promptSha256&&
          eventPayload.conversation_id===activeSegment.id&&eventPayload.message_id===finalUser.id&&
          eventPayload.response_observed===false&&
          !finalUser.content.includes(scenario.sealedSecret)&&
          !finalUser.content.includes(scenario.archiveReference)&&
          eventPayload.context_manifest?.retrieved_message_ids?.includes(finalContextProvenance.historicalReferenceSourceId)&&
          Number(activeSegment.context_checkpoint_version||0)===finalContextProvenance.checkpointVersion;
      })());
      const providerContextChars=Number(finalContextProvenance?.promptChars||0);
      const requiredFactsIncluded=finalContextProvenance?.requiredFactsIncluded===true&&
        finalContextProvenance?.requestDoesNotLeakSecret===true&&
        finalContextProvenance?.historicalReferenceIncludedInContext===true&&
        finalContextProvenance?.historicalReferenceBoundToManifest===true;
      const temporalContinuityVerified=finalContextProvenance?.temporalCurrentMemoryCanonical===true&&
        finalContextProvenance?.temporalCurrentMemoryBoundToManifest===true&&
        finalContextProvenance?.temporalOldVersionRecoveredBySearch===true&&
        finalContextProvenance?.temporalOldVersionBoundToManifest===true&&
        finalContextProvenance?.temporalCurrentValueNotLeakedByFinalRequest===true&&
        finalContextProvenance?.temporalSupersededValueNotLeakedByFinalRequest===true;
      const byRole=Object.fromEntries(counts.map(row=>[row.role,row.count]));
      const byRunStatus=Object.fromEntries(runs.map(row=>[row.status,row.count]));
      receipt={taskId,taskStatus:task?.status||null,providerConversationBound:Boolean(task?.chat_url),
        userMessages:byRole.user||0,assistantMessages:byRole.assistant||0,
        successfulRuns:byRunStatus.succeeded||0,failedRuns:byRunStatus.failed||0,
        interruptedRuns:byRunStatus.interrupted||0,conversations,autoRotationEvents,
        checkpointVersion:checkpoint?.version||0,messageCharacters,approxMessageTokens:Math.ceil(messageCharacters/4),
        activeMemoryCount,distinctProviderChats,providerContextVerified,providerContextChars,requiredFactsIncluded,temporalContinuityVerified,
        temporalCurrentMemoryCanonical:finalContextProvenance?.temporalCurrentMemoryCanonical===true,
        temporalOldVersionRecoveredBySearch:finalContextProvenance?.temporalOldVersionRecoveredBySearch===true,
        temporalCurrentValueNotLeakedByFinalRequest:finalContextProvenance?.temporalCurrentValueNotLeakedByFinalRequest===true,
        temporalSupersededValueNotLeakedByFinalRequest:finalContextProvenance?.temporalSupersededValueNotLeakedByFinalRequest===true,
        historicalReferenceOnlyInInitialUserMessage:finalContextProvenance?.historicalReferenceOnlyInInitialUserMessage===true,
        historicalReferenceNotCanonical:finalContextProvenance?.historicalReferenceNotCanonical===true,
        historicalReferenceOutsideRecentWindow:finalContextProvenance?.historicalReferenceOutsideRecentWindow===true,
        historicalReferenceRecoveredBySearch:finalContextProvenance?.historicalReferenceRecoveredBySearch===true,
        historicalReferenceBoundToManifest:finalContextProvenance?.historicalReferenceBoundToManifest===true,
        historyWindowMessageCount:finalContextProvenance?.historyWindowMessageCount||0,
        historyWindowRetrievedCount:finalContextProvenance?.historyWindowRetrievedCount||0,
        historyWindowOmittedCount:finalContextProvenance?.historyWindowOmittedCount||0,
        attachmentUseful: (()=>{const event=providerEvent?JSON.parse(providerEvent.payload):null;return event?.context_manifest?.attachment_useful===true;})(),
        quickCheck:db.prepare('PRAGMA quick_check').get().quick_check};
    }finally{db.close();}
    const expectedSegments=Math.ceil(turns/SUCCESSFUL_TURNS_PER_SEGMENT);
    const segmentAccounting=receipt.conversations.length===expectedSegments&&receipt.conversations.every((segment,index)=>{
      const expectedTurns=Math.min(SUCCESSFUL_TURNS_PER_SEGMENT,turns-index*SUCCESSFUL_TURNS_PER_SEGMENT);
      return segment.sequence===index+1&&segment.completed_turns===expectedTurns&&
        segment.status===(index===expectedSegments-1?'active':'archived')&&
        (index===0||Number(segment.context_checkpoint_version||0)>=index*SUCCESSFUL_TURNS_PER_SEGMENT);
    });
    const passed=receipt.quickCheck==='ok'&&receipt.userMessages===turns&&
      receipt.assistantMessages===turns&&receipt.successfulRuns===turns&&
      receipt.failedRuns===0&&receipt.interruptedRuns===0&&
      receipt.autoRotationEvents===expectedSegments-1&&segmentAccounting&&
      receipt.checkpointVersion>=turns&&receipt.providerConversationBound&&
      receipt.distinctProviderChats===2&&receipt.activeMemoryCount===acceptedMemoryKeys.size&&
      acceptedMemoryKeys.size>=25&&ledgerPassed&&continuityGrade?.passed===true&&finalChapterWords>=100&&finalChapterWords<=150&&
      receipt.providerContextVerified&&receipt.requiredFactsIncluded&&receipt.historicalReferenceOnlyInInitialUserMessage&&
      receipt.temporalContinuityVerified&&
      receipt.historicalReferenceNotCanonical&&receipt.historicalReferenceOutsideRecentWindow&&
      receipt.historicalReferenceRecoveredBySearch&&receipt.historicalReferenceBoundToManifest&&
      receipt.historyWindowRetrievedCount>=1&&receipt.historyWindowOmittedCount>=1;
    console.log(JSON.stringify({event:'long_horizon_eval_summary',turns,passed,
      acceptedMemoryCount:acceptedMemoryKeys.size,ledgerPassed,continuityGrade,finalChapterWords,
      providerAuthState:provider.authState,
      totalElapsedMs:results.reduce((sum,result)=>sum+result.elapsedMs,0),receipt},null,2));
    if(!passed)process.exitCode=2;
  }finally{try{ws.close();}catch{}}
}

main().catch(error=>{console.error(error);process.exitCode=1;});
