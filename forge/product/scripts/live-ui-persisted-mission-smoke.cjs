const {DatabaseSync}=require('node:sqlite');
const {extractArchiveReferenceFromPrompt,gradeContinuityAnswer}=require('./long-horizon-book-eval.cjs');
const {labDatabasePath,waitForLabUiTarget,waitForLabAppMode}=require('./e2e-lab-target.cjs');
const {acquireE2ELock}=require('./e2e-lock.cjs');

acquireE2ELock('persisted-mission-smoke');

const taskId=process.env.ORDAX_E2E_PERSIST_TASK_ID||'';
if(!/^task_[a-f0-9-]{36}$/i.test(taskId))throw new Error('persisted_mission_task_id_required');
const providerReadyTimeoutMs=60000;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function main(){
  let expectedSecret='';
  let expectedNonce='';
  let expectedArchiveReference='';
  const db=new DatabaseSync(labDatabasePath(),{readOnly:true});
  let evidence;
  try{
    const task=db.prepare('SELECT id,status,chat_url FROM tasks WHERE id=?').get(taskId);
    if(!task)throw new Error('persisted_mission_task_missing');
    const messages=db.prepare('SELECT id,role,content,created_at FROM messages WHERE task_id=? ORDER BY sequence').all(taskId);
    const users=messages.filter(row=>row.role==='user');
    const assistants=messages.filter(row=>row.role==='assistant');
    expectedSecret=db.prepare("SELECT content FROM project_memory_items WHERE task_id=? AND category='fact' AND memory_key='Segredo do selo' AND status='active'").get(taskId)?.content||'';
    expectedNonce=String(users.at(-1)?.content||'').match(/nonce desta solicita[cç][aã]o[^:]*:\s*([a-f0-9]{64})/i)?.[1]||'';
    expectedArchiveReference=extractArchiveReferenceFromPrompt(users[0]?.content||'');
    const temporalMemory=db.prepare(`SELECT id,content,source_ref FROM project_memory_items WHERE task_id=?
      AND category='fact' AND memory_key='Horário da cápsula' AND status='active'`).get(taskId)||null;
    const provisionalSource=users.find(row=>row.content.includes('Horário provisório: 04:10'))||null;
    const correctionSource=temporalMemory?.source_ref?messages.find(row=>row.id===temporalMemory.source_ref):null;
    const grade=gradeContinuityAnswer(assistants.at(-1)?.content||'',{
      sealedSecret:expectedSecret,probeNonce:expectedNonce,archiveReference:expectedArchiveReference
    });
    const runRows=db.prepare('SELECT status,COUNT(*) count FROM runs WHERE task_id=? GROUP BY status').all(taskId);
    const runs=Object.fromEntries(runRows.map(row=>[row.status,Number(row.count)]));
    const conversations=db.prepare(`SELECT sequence,status,context_checkpoint_version,chat_url,
      (SELECT COUNT(*) FROM conversation_completed_runs r WHERE r.conversation_id=c.id) completed_turns
      FROM task_conversations c WHERE task_id=? ORDER BY sequence`).all(taskId);
    const distinctChats=Number(db.prepare('SELECT COUNT(DISTINCT chat_url) n FROM task_conversations WHERE task_id=? AND chat_url IS NOT NULL').get(taskId).n);
    const workspace=db.prepare('SELECT metadata FROM workspace_sessions ORDER BY updated_at DESC LIMIT 1').get();
    const workspaceMetadata=JSON.parse(workspace?.metadata||'{}');
    const latestRun=db.prepare('SELECT completed_at FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 1').get(taskId);
    const startupAfterCompletion=Date.parse(workspaceMetadata.last_started_at||'')>Date.parse(latestRun?.completed_at||'');
    evidence={
      taskReady:task.status==='ready',providerConversationBound:Boolean(task.chat_url),
      userMessages:users.length,assistantMessages:assistants.length,
      succeededRuns:runs.succeeded||0,failedRuns:runs.failed||0,interruptedRuns:runs.interrupted||0,
      activeCanonicalSecret:Boolean(expectedSecret),noncePersisted:Boolean(expectedNonce),
      historicalReferenceRecoveredFromInitialMessage:Boolean(expectedArchiveReference),
      temporalMemoryCanonical:Boolean(temporalMemory?.content.includes('04:17')&&temporalMemory?.content.includes('04:10')),
      temporalPriorMessagePersisted:Boolean(provisionalSource),
      temporalCorrectionSourcePersisted:Boolean(correctionSource?.role==='user'&&correctionSource.content.includes('04:17')),
      temporalUpdateVerified:grade.temporalUpdateVerified===true,
      conversations:conversations.map(row=>({sequence:Number(row.sequence),status:row.status,
        checkpointVersion:Number(row.context_checkpoint_version||0),completedTurns:Number(row.completed_turns)})),
      distinctProviderChats:distinctChats,memoryCount:Number(db.prepare("SELECT COUNT(*) n FROM project_memory_items WHERE task_id=? AND status='active'").get(taskId).n),
      latestAnswerPassesContinuityGrade:grade.passed,finalChapterWords:grade.chapterWords||0,
      appRestartedAfterLastRun:startupAfterCompletion,sqliteQuickCheck:db.prepare('PRAGMA quick_check').get().quick_check
    };
  }finally{db.close();}

  const target=await waitForLabUiTarget();
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  try{
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=()=>reject(new Error('persisted_mission_cdp_unavailable'));});
    let sequence=0;
    const pending=new Map();
    ws.onmessage=event=>{
      let message;try{message=JSON.parse(event.data);}catch{return;}
      const waiter=pending.get(message.id);if(!waiter)return;
      pending.delete(message.id);clearTimeout(waiter.timer);
      if(message.error||message.result?.exceptionDetails)waiter.reject(new Error('persisted_mission_ui_read_failed'));
      else waiter.resolve(message.result?.result?.value);
    };
    const evaluate=expression=>new Promise((resolve,reject)=>{
      const id=++sequence;
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('persisted_mission_ui_timeout'));},10000);
      pending.set(id,{resolve,reject,timer});
      ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
    });
    await waitForLabAppMode(evaluate);
    await evaluate(`(()=>{const project=document.querySelector('#projectSelect');if(project&&project.value){project.value='';project.dispatchEvent(new Event('change',{bubbles:true}));}return true})()`);
    let taskVisible=false;
    for(let i=0;i<160;i++){
      taskVisible=await evaluate(`Boolean(document.querySelector('.task[data-id=${JSON.stringify(taskId)}]'))`);
      if(taskVisible)break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    if(!taskVisible)throw new Error('persisted_mission_task_not_in_ui');
    const select=await evaluate(`(()=>{const button=document.querySelector('.task[data-id=${JSON.stringify(taskId)}]');if(!button)return false;button.click();return true})()`);
    if(!select)throw new Error('persisted_mission_task_not_in_ui');
    const expectedSecretLiteral=JSON.stringify(expectedSecret);
    const expectedNonceLiteral=JSON.stringify(expectedNonce);
    const providerStartedAt=Date.now();
    let provider={authState:'unknown',composerReady:false,verificationRequired:false};
    while(Date.now()-providerStartedAt<providerReadyTimeoutMs){
      provider=await evaluate(`(async()=>{const s=await window.ordax.providerStatus();return {
        authState:s?.auth_state||"unknown",composerReady:s?.composer_ready===true,
        verificationRequired:s?.verification_required===true
      }})()`);
      if(provider.authState==='session_present'&&provider.composerReady&&!provider.verificationRequired)break;
      await sleep(250);
    }
    let rendered=null;
    for(let i=0;i<240;i++){
      const expression=`(()=>{const messages=[...document.querySelectorAll('#messages .message')];const last=messages.at(-1)?.innerText||'';return {
        selectedTask:document.querySelector('#taskId')?.textContent?.trim()||'',messageCount:messages.length,
        finalAssistantContainsSecret:last.includes(${expectedSecretLiteral}),
        finalAssistantContainsNonce:last.includes(${expectedNonceLiteral}),
        finalAssistantLooksStructured:last.includes('capitulo_24')&&last.includes('segredo_selo')
      }})()`;
      rendered=await evaluate(expression);
      if(rendered.selectedTask===taskId&&rendered.messageCount>=50)break;
      await sleep(50);
    }
    evidence={...evidence,providerSessionDetected:provider.authState==='session_present',providerComposerReady:provider.composerReady,
      providerVerificationRequired:provider.verificationRequired,
      providerSessionReadyWaitMs:Date.now()-providerStartedAt,
      persistedTaskRendered:rendered?.selectedTask===taskId&&rendered?.messageCount>=50,
      renderedFinalAnswerHasSecret:rendered?.finalAssistantContainsSecret===true,
      renderedFinalAnswerHasNonce:rendered?.finalAssistantContainsNonce===true,
      renderedFinalAnswerStructured:rendered?.finalAssistantLooksStructured===true};
  }finally{ws.close();}

  const conversationAccounting=evidence.conversations.length===2&&
    evidence.conversations[0].sequence===1&&evidence.conversations[0].status==='archived'&&evidence.conversations[0].completedTurns===24&&
    evidence.conversations[1].sequence===2&&evidence.conversations[1].status==='active'&&
    evidence.conversations[1].checkpointVersion===24&&evidence.conversations[1].completedTurns===1;
  const passed=evidence.taskReady&&evidence.providerConversationBound&&evidence.userMessages===25&&
    evidence.assistantMessages===25&&evidence.succeededRuns===25&&!evidence.failedRuns&&!evidence.interruptedRuns&&
    evidence.activeCanonicalSecret&&evidence.noncePersisted&&conversationAccounting&&evidence.distinctProviderChats===2&&
    evidence.memoryCount===29&&evidence.latestAnswerPassesContinuityGrade&&evidence.temporalMemoryCanonical&&
    evidence.temporalPriorMessagePersisted&&evidence.temporalCorrectionSourcePersisted&&evidence.temporalUpdateVerified&&
    evidence.finalChapterWords>=100&&evidence.finalChapterWords<=150&&
    evidence.historicalReferenceRecoveredFromInitialMessage&&
    evidence.appRestartedAfterLastRun&&evidence.sqliteQuickCheck==='ok'&&evidence.providerSessionDetected&&
    evidence.providerComposerReady&&evidence.persistedTaskRendered&&evidence.renderedFinalAnswerHasSecret&&
    evidence.renderedFinalAnswerHasNonce&&evidence.renderedFinalAnswerStructured;
  console.log(JSON.stringify({schema:'ordax.lab.persisted-mission-smoke.v1',passed,...evidence},null,2));
  if(!passed)process.exitCode=2;
}

main().catch(error=>{
  const allowed=new Set(['persisted_mission_task_id_required','persisted_mission_task_missing',
    'persisted_mission_cdp_unavailable','persisted_mission_ui_read_failed','persisted_mission_ui_timeout',
    'persisted_mission_task_not_in_ui']);
  const message=String(error?.message||'persisted_mission_smoke_failed');
  console.error(JSON.stringify({schema:'ordax.lab.persisted-mission-smoke.v1',passed:false,
    error:allowed.has(message)?message:'persisted_mission_smoke_failed'}));
  process.exitCode=1;
});
