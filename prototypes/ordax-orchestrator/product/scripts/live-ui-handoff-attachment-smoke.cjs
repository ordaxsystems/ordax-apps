const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {randomBytes}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {acquireE2ELock}=require('./e2e-lock.cjs');
const {labStagedLocalAppData,waitForLabUiTarget,waitForLabAppMode,labDatabasePath}=require('./e2e-lab-target.cjs');

acquireE2ELock('handoff-attachment-smoke');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const timeoutMs=240000;

function readTaskSnapshot(db,taskId){
  const task=db.prepare('SELECT id,title,status,chat_url,checkpoint FROM tasks WHERE id=?').get(taskId);
  if(!task)return null;
  const checkpoint_record=db.prepare('SELECT version,summary FROM checkpoints WHERE task_id=? ORDER BY version DESC LIMIT 1').get(taskId)||null;
  const messages=db.prepare('SELECT id,role,content,created_at,sequence FROM messages WHERE task_id=? ORDER BY sequence').all(taskId);
  const memoryItems=db.prepare(`SELECT id,task_id,category,memory_key AS key,content,status,source_type,source_ref,created_at,updated_at,archived_at
    FROM project_memory_items WHERE task_id=? AND status='active'
    ORDER BY CASE category WHEN 'goal' THEN 1 WHEN 'constraint' THEN 2 WHEN 'decision' THEN 3 WHEN 'entity' THEN 4
      WHEN 'structure' THEN 5 WHEN 'fact' THEN 6 WHEN 'open_loop' THEN 7 ELSE 8 END,updated_at DESC,id`).all(taskId);
  const conversations=db.prepare('SELECT id,task_id,sequence,chat_url,status,context_checkpoint_version,created_at,updated_at,ended_at FROM task_conversations WHERE task_id=? ORDER BY sequence').all(taskId);
  const events=db.prepare('SELECT seq,task_id,kind,payload,created_at FROM events WHERE task_id=? ORDER BY seq').all(taskId)
    .map(event=>({...event,payload:JSON.parse(event.payload)}));
  const latest_run=db.prepare('SELECT * FROM runs WHERE task_id=? ORDER BY started_at DESC,rowid DESC LIMIT 1').get(taskId)||null;
  if(latest_run?.metrics)latest_run.metrics=JSON.parse(latest_run.metrics);
  return {...task,checkpoint_record,messages,project_memory:{items:memoryItems},conversations,events,latest_run};
}

async function main(){
  let secret='';
  let secretMemoryId='';
  let stage='connect';
  const setStage=name=>{
    stage=name;
    console.error(JSON.stringify({schema:'ordax.lab.handoff-attachment-smoke.progress.v1',stage:name}));
  };
  const resumeTaskId=String(process.env.ORDAX_E2E_HANDOFF_TASK_ID||'').trim();
  const nonce=randomBytes(32).toString('hex');
  const db=new DatabaseSync(labDatabasePath(),{readOnly:true});
  const target=await waitForLabUiTarget();
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  let nextId=0;
  const pending=new Map();
  const settlePending=error=>{
    for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(error);}
    pending.clear();
  };
  ws.onmessage=event=>{
    let message;try{message=JSON.parse(event.data);}catch{return settlePending(Error('handoff_e2e_invalid_message'));}
    const waiter=pending.get(message.id);if(!waiter)return;
    pending.delete(message.id);clearTimeout(waiter.timer);
    if(message.error||message.result?.exceptionDetails)waiter.reject(Error('handoff_e2e_ui_operation_failed'));
    else waiter.resolve(message.result?.result?.value);
  };
  ws.onerror=()=>settlePending(Error('handoff_e2e_cdp_failed'));
  ws.onclose=()=>settlePending(Error('handoff_e2e_cdp_closed'));
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('handoff_e2e_cdp_timeout')),10000);ws.onopen=()=>{clearTimeout(timer);resolve();};});
  const evaluate=expression=>new Promise((resolve,reject)=>{
    const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(Error('handoff_e2e_ui_timeout:'+stage));},30000);
    pending.set(id,{resolve,reject,timer});
    try{ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true,timeout:25000}}));}
    catch{clearTimeout(timer);pending.delete(id);reject(Error('handoff_e2e_ui_operation_failed'));}
  });
  const waitFor=async(fn,{delay=150}={})=>{
    const started=Date.now();while(Date.now()-started<timeoutMs){const value=await fn();if(value)return value;await sleep(delay);}return null;
  };
  const taskSnapshot=taskId=>readTaskSnapshot(db,taskId);
  const waitForProvider=()=>waitFor(()=>evaluate(`(async()=>{const s=await window.ordax.providerStatus();return s?.connected&&s?.composer_ready&&!s?.verification_required&&!s?.active&&!s?.response_generation_active})()`));
  const send=async prompt=>{
    const ready=await waitFor(()=>evaluate(`(()=>({disabled:Boolean(document.querySelector('#send')?.disabled),text:document.querySelector('#prompt')?.value||''}))()`)
      .then(value=>!value.disabled&&!value.text));
    if(!ready)throw Error('handoff_e2e_composer_not_ready');
    return evaluate(`(()=>{const input=document.querySelector('#prompt');if(!input||document.querySelector('#send')?.disabled)throw Error('send_disabled');input.value=${JSON.stringify(prompt)};input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#composer').requestSubmit();return true})()`);
  };
  const awaitTurn=async(taskId,expectedMessageCount)=>{
    const result=await waitFor(async()=>{
      const task=await taskSnapshot(taskId);
      if(['failed','interrupted','error'].includes(task?.latest_run?.status)){
        const error=String(task.latest_run.error||'');
        const [failedStage='',reason='']=error.split(':');
        const safeStage=/^[a-z][a-z0-9-]{0,63}$/i.test(failedStage)?failedStage:'unknown';
        const safeReason=/^[a-z][a-z0-9_]{0,95}$/i.test(reason)?reason:'unknown';
        throw Error(`handoff_e2e_run_failed:${stage}:${safeStage}:${safeReason}`);
      }
      if(task?.messages?.length===expectedMessageCount&&task.latest_run?.status==='succeeded')return task;
      return null;
    });
    if(!result)throw Error('handoff_e2e_turn_timeout');
    return result;
  };

  try{
    setStage('app_mode');
    await waitForLabAppMode(evaluate);
    let taskId=resumeTaskId;
    let task=null;
    if(resumeTaskId){
      setStage('resume_task_validation');
      const task=taskSnapshot(resumeTaskId);
      const userMessages=task?.messages.filter(message=>message.role==='user')||[];
      const assistantMessages=task?.messages.filter(message=>message.role==='assistant')||[];
      const secretItem=task?.project_memory.items.find(item=>item.key==='R-047'&&item.status==='active');
      const match=secretItem?.content.match(/Valor de continuidade que só pode ser recuperado do pacote anexo:\s*([a-f0-9]{64})$/u);
      const fillerCount=task?.project_memory.items.filter(item=>/^AUX-\d{3}$/u.test(item.key)).length||0;
      if(!task||task.status!=='ready'||userMessages.length!==1||assistantMessages.length!==1||
         !userMessages[0].content.includes('Nonce inicial')||!assistantMessages[0].content.includes('HANDOFF_INITIAL_OK')||
         task.latest_run?.status!=='succeeded'||!secretItem||!match||fillerCount<24)
        throw Error('handoff_e2e_resume_precondition_failed');
      secret=match[1];secretMemoryId=secretItem.id;
    }else{
      secret=randomBytes(32).toString('hex');
      setStage('clear_project_selection');
      await evaluate(`(()=>{const project=document.querySelector('#projectSelect');if(project?.value){project.value='';project.dispatchEvent(new Event('change',{bubbles:true}));}return true})()`);
      setStage('provider_readiness');
      if(!await waitForProvider())throw Error('handoff_e2e_provider_not_ready');
      setStage('create_task');
      const priorTaskId=await evaluate(`document.querySelector('#taskId')?.textContent?.trim()||''`);
      await evaluate(`document.querySelector('#newTask').click();true`);
      setStage('task_creation_observation');
      taskId=await waitFor(()=>evaluate(`(()=>{const id=document.querySelector('#taskId')?.textContent?.trim()||'';return id&&id!==${JSON.stringify(priorTaskId)}&&!document.querySelector('#taskPanel')?.classList.contains('hidden')?id:null})()`),{delay:75});
      if(!taskId)throw Error('handoff_e2e_task_creation_failed');

      setStage('initial_send');
      const initialNonce=randomBytes(12).toString('hex');
      await send(`Começaremos uma tarefa de teste de continuidade. Nonce inicial ${initialNonce}. Responda somente: HANDOFF_INITIAL_OK`);
      setStage('initial_response_observation');
      const task=await awaitTurn(taskId,2);
      if(!task.messages.at(-1)?.content?.includes('HANDOFF_INITIAL_OK'))throw Error('handoff_e2e_initial_response_mismatch');

      setStage('seed_memory');
      const inserted=await evaluate(`(async()=>{
        const secret=${JSON.stringify(secret)};
        const taskId=${JSON.stringify(taskId)};
        const sealed=await window.ordax.upsertProjectMemory(taskId,{category:'reference',key:'R-047',content:'Registro interno de referência R-047. Valor de continuidade que só pode ser recuperado do pacote anexo: '+secret});
        const secretItem=sealed?.project_memory?.items?.find(item=>item.key==='R-047'&&item.status==='active');
        if(!secretItem?.id)throw Error('secret_memory_not_saved');
        for(let i=1;i<=32;i++){
          const suffix=String(i).padStart(3,'0');
          const filler='REF-'+suffix+'-'+Math.random().toString(36).slice(2).padEnd(10,'x');
          await window.ordax.upsertProjectMemory(taskId,{category:'reference',key:'AUX-'+suffix,
            content:'Registro auxiliar sintético '+filler+'; este conteúdo serve para exercitar orçamento de contexto e não representa informação real. '.repeat(5)});
        }
        return {secretMemoryId:secretItem.id};
      })()`);
      secretMemoryId=inserted?.secretMemoryId||'';
      const seeded=taskSnapshot(taskId);
      if(!secretMemoryId||seeded?.project_memory.items.length<33)throw Error('handoff_e2e_memory_seed_failed');
    }

    const request=`Esta é a mesma tarefa OrdaX em uma conversa GPT nova. Consulte o registro R-047 no pacote de continuidade e retorne o valor exato. Responda somente JSON com as chaves "value" e "nonce". Nonce exclusivo desta solicitação: ${nonce}`;
    const {buildProjectContinuationPacket}=await import('../src/continuation-context.mjs');
    setStage('read_task_snapshot');
    task=taskSnapshot(taskId);
    const expectedPacket=buildProjectContinuationPacket({
      title:task.title,checkpoint:task.checkpoint_record?.summary||task.checkpoint||'',
      checkpointVersion:Number(task.checkpoint_record?.version||0),
      memoryItems:task.project_memory.items,
      recentMessages:task.messages.slice(-8),retrievedMessages:[],
      totalMessageCount:task.messages.length,request
    });
    const targetMemory=task.project_memory.items.find(item=>item.id===secretMemoryId);
    if(!targetMemory||expectedPacket.manifest.includedMemoryIds.includes(secretMemoryId)||
       expectedPacket.prompt.includes(secret)||request.includes(secret)||expectedPacket.manifest.attachmentUseful!==true)
      throw Error('handoff_e2e_attachment_precondition_failed');

    setStage('rotate_conversation');
    await evaluate(`document.querySelector('#rotateConversation').click();true`);
    setStage('rotation_observation');
    const rotated=await waitFor(async()=>{
      const value=await taskSnapshot(taskId);
      return !value?.chat_url&&value?.conversations?.some(row=>row.status==='archived')?value:null;
    },{delay:100});
    if(!rotated)throw Error('handoff_e2e_rotation_failed');
    setStage('new_conversation_readiness');
    if(!await waitForProvider())throw Error('handoff_e2e_new_conversation_not_ready');
    setStage('second_send');
    await send(request);
    setStage('second_response_observation');
    task=await awaitTurn(taskId,4);
    const answer=String(task.messages.filter(message=>message.role==='assistant').at(-1)?.content||'');
    let parsed=null;
    try{parsed=JSON.parse(answer.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{}
    const runId=task.latest_run?.id;
    const attachmentEvent=task.events?.find(event=>event.kind==='provider.context_attachment.uploaded'&&event.payload?.run_id===runId);
    const provenanceEvent=task.events?.find(event=>event.kind==='provider.submission.provenance'&&event.payload?.run_id===runId);
    const attachment=provenanceEvent?.payload?.context_attachment;
    const staged=labStagedLocalAppData();
    const {resolveTaskHandoffRoot}=await import('../src/task-handoff-file.mjs');
    const handoffRoot=resolveTaskHandoffRoot({tempRoot:os.tmpdir(),userRoot:path.join(staged,'OrdaX','OrchestratorLab')});
    const tempFile=attachment?.filename?path.join(handoffRoot,attachment.filename):null;
    const databaseQuickCheck=db.prepare('PRAGMA quick_check').get().quick_check;
    const evidence={
      taskCreatedInApp:true,providerResponseObserved:task.latest_run?.status==='succeeded',
      sameTaskMessageCount:task.messages.length,distinctProviderChats:new Set(task.conversations?.map(row=>row.chat_url).filter(Boolean)).size,
      memoryOmittedFromInline:!expectedPacket.manifest.includedMemoryIds.includes(secretMemoryId)&&!expectedPacket.prompt.includes(secret),
      attachmentUploadEvent:Boolean(attachmentEvent),attachmentBoundToSubmission:Boolean(attachment&&attachment.sha256&&attachment.delivery_state==='uploaded'),
      attachmentHashMatchesUploadEvent:attachment?.sha256===attachmentEvent?.payload?.sha256,
      providerReturnedFileOnlySecret:parsed?.value===secret,providerReturnedRequestNonce:parsed?.nonce===nonce,
      referenceValueAbsentFromPersistedUserMessages:!task.messages.some(message=>message.role==='user'&&String(message.content||'').includes(secret)),
      referenceValueObservedInAssistantTranscript:task.messages.some(message=>message.role==='assistant'&&String(message.content||'').includes(secret)),
      appTemporaryAttachmentRemoved:Boolean(tempFile&&!fs.existsSync(tempFile)),
      attachmentRunMetricConfirmed:task.latest_run?.metrics?.context_attachment_state==='confirmed',
      attachmentBytesRecorded:Number.isSafeInteger(attachment?.byte_length)&&attachment.byte_length>0,
      sqliteQuickCheck:databaseQuickCheck
    };
    const passed=evidence.taskCreatedInApp&&evidence.providerResponseObserved&&evidence.sameTaskMessageCount===4&&
      evidence.distinctProviderChats===2&&evidence.memoryOmittedFromInline&&evidence.attachmentUploadEvent&&
      evidence.attachmentBoundToSubmission&&evidence.attachmentHashMatchesUploadEvent&&
      evidence.providerReturnedFileOnlySecret&&evidence.providerReturnedRequestNonce&&
      evidence.referenceValueAbsentFromPersistedUserMessages&&evidence.referenceValueObservedInAssistantTranscript&&
      evidence.appTemporaryAttachmentRemoved&&
      evidence.attachmentRunMetricConfirmed&&evidence.attachmentBytesRecorded&&evidence.sqliteQuickCheck==='ok';
    console.log(JSON.stringify({schema:'ordax.lab.handoff-attachment-smoke.v1',passed,taskId,runId,evidence},null,2));
    if(!passed)process.exitCode=2;
  }finally{try{ws.close();}catch{}db.close();}
}

main().catch(error=>{
  const allowed=new Set(['handoff_e2e_cdp_timeout','handoff_e2e_ui_operation_failed','handoff_e2e_ui_timeout',
    'handoff_e2e_run_failed','handoff_e2e_task_creation_failed','handoff_e2e_provider_not_ready','handoff_e2e_initial_response_mismatch',
    'handoff_e2e_memory_seed_failed','handoff_e2e_resume_precondition_failed','handoff_e2e_attachment_precondition_failed','handoff_e2e_rotation_failed',
    'handoff_e2e_new_conversation_not_ready','handoff_e2e_run_failed','handoff_e2e_turn_timeout']);
  const allowedStages=new Set(['connect','app_mode','clear_project_selection','provider_readiness','create_task',
    'task_creation_observation','initial_send','initial_response_observation','seed_memory','resume_task_validation',
    'read_task_snapshot','rotate_conversation','rotation_observation','new_conversation_readiness','second_send','second_response_observation']);
  const code=String(error?.message||'');
  const [base,stage,failedStage,reason]=code.split(':');
  const allowedRunStages=new Set(['context-attachment','baseline','prepare','health','submit','await-response','other']);
  const allowedRunReasons=new Set(['provider_context_attachment_input_not_observed',
    'provider_context_attachment_upload_unconfirmed','provider_context_attachment_upload_failed',
    'provider_context_file_input_unavailable','provider_context_file_input_ambiguous',
    'provider_context_attachment_integrity_failed','chatgpt_verification_required','chatgpt_login_required']);
  console.error(JSON.stringify({schema:'ordax.lab.handoff-attachment-smoke.v1',passed:false,
    error:allowed.has(base)?base:'handoff_e2e_failed',
    ...(base==='handoff_e2e_ui_timeout'&&allowedStages.has(stage)?{stage}:{}),
    ...(base==='handoff_e2e_run_failed'&&allowedStages.has(stage)?{stage}:{}),
    ...(base==='handoff_e2e_run_failed'&&allowedRunStages.has(failedStage)?{runFailureStage:failedStage}:{}),
    ...(base==='handoff_e2e_run_failed'&&allowedRunReasons.has(reason)?{runFailureReason:reason}:{})}));
  process.exitCode=1;
});
