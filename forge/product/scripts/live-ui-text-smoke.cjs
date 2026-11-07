const { waitForLabUiTarget, labDatabasePath, waitForLabAppMode } = require('./e2e-lab-target.cjs');
const { acquireE2ELock } = require('./e2e-lock.cjs');
const { DatabaseSync } = require('node:sqlite');
acquireE2ELock('text-smoke');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const mode=String(process.env.ORDAX_E2E_MODE||'auto').toLowerCase();
  if(!['auto','fast','beta'].includes(mode)) throw new Error('invalid_e2e_mode');
  const defaultMarker={auto:'ORDAX_UI_STREAM_OK',fast:'ORDAX_UI_FAST_OK',beta:'ORDAX_UI_BETA_OK'}[mode];
  const marker=String(process.env.ORDAX_E2E_MARKER||defaultMarker);
  const prompt=String(process.env.ORDAX_E2E_PROMPT||('Responda exatamente: '+marker));
  const responseTimeoutMs=Number(process.env.ORDAX_E2E_RESPONSE_TIMEOUT_MS||300000);
  if(!Number.isSafeInteger(responseTimeoutMs)||responseTimeoutMs<30000||responseTimeoutMs>900000)
    throw new Error('invalid_response_timeout');
  const requireStream=process.env.ORDAX_REQUIRE_STREAM==='1';
  const requireFastDelivery=process.env.ORDAX_REQUIRE_FAST==='1';
  const discoverStarted=Date.now();
  const target=await waitForLabUiTarget();
  const ws=new WebSocket(target.webSocketDebuggerUrl); let seq=0; const pending=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const {resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result);}};
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evalJs=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails){const d=r.exceptionDetails;throw new Error([d.text,d.exception?.description,d.exception?.value].filter(Boolean).join(' | ')||'eval_failed');}return r.result.value;};
  await waitForLabAppMode(evalJs); // Fail acceptance, not the direct-mode fallback.
  let uiReady=false;for(let i=0;i<200;i++){uiReady=await evalJs(`document.readyState==='complete'&&Boolean(document.querySelector('#newTask'))&&Boolean(document.querySelector('#prompt'))&&Boolean(document.querySelector('#observerMode'))`);if(uiReady)break;await sleep(50);}if(!uiReady)throw new Error('ordax_ui_not_ready');
  const projectScope=await evalJs(`(async()=>{const s=document.querySelector('#projectSelect');if(!s)return {available:false,selected:null};s.value='';s.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,50));return {available:true,selected:s.value||null}})()`);
  if(!projectScope.available||projectScope.selected!==null)throw new Error('provider_only_project_scope_not_cleared');
  const projectScopeReady=await evalJs(`document.querySelector('#projectSelect')?.value===''&&document.querySelector('#orchestrationPanel')?.hidden===true`);
  if(!projectScopeReady)throw new Error('provider_only_project_transition_not_complete');
  const existingTaskMarker=String(process.env.ORDAX_E2E_EXISTING_TASK_MARKER||'').trim();
  const providerWaitStarted=Date.now(); let providerReady=false;
  for(let i=0;i<600;i++){providerReady=await evalJs(`(async()=>{const s=await window.ordax.providerStatus();return Boolean(s?.connected&&s?.composer_ready&&!s?.verification_required)})()`);if(providerReady)break;await sleep(50);}if(!providerReady)throw new Error('provider_not_ready');
  const provider_ready_wait_ms=Date.now()-providerWaitStarted;
  await evalJs(`(()=>{const s=document.querySelector('#observerMode');if(s.value!==${JSON.stringify(mode)}){s.value=${JSON.stringify(mode)};s.dispatchEvent(new Event('change',{bubbles:true}));}return true})()`);
  for(let i=0;i<100;i++){if(await evalJs(`document.querySelector('#observerMode').value===${JSON.stringify(mode)}&&!document.querySelector('#observerMode').disabled`))break;await sleep(30);}
  const initial=await evalJs(`(()=>({observerMode:document.querySelector('#observerMode').value,
    provider:document.querySelector('#providerText')?.textContent?.trim()||'',
    observerHint:document.querySelector('#observerHint')?.textContent?.trim()||'',
    selectedPane:document.querySelector('#rightPaneTabs [aria-selected="true"]')?.dataset.pane||'unknown',
    composerState:document.querySelector('#composerConnection')?.dataset.state||'unknown'}))()`);
  let createdTaskId=null;
  if(existingTaskMarker) {
    const db=new DatabaseSync(labDatabasePath(),{readOnly:true});
    let fixture;
    try {
      fixture=db.prepare(`SELECT t.id,t.chat_url,
        (SELECT COUNT(*) FROM lab_task_bindings b WHERE b.task_id=t.id) AS bindings,
        (SELECT COUNT(*) FROM runs r WHERE r.task_id=t.id AND r.status=?) AS succeeded_runs
        FROM tasks t WHERE EXISTS (SELECT 1 FROM messages m WHERE m.task_id=t.id
          AND m.role=? AND instr(m.content,?)>0) ORDER BY t.rowid DESC LIMIT 1`)
        .get('succeeded','user',existingTaskMarker);
    } finally { db.close(); }
    if(!fixture?.chat_url||fixture.bindings!==0||fixture.succeeded_runs<1)
      throw new Error('provider_only_existing_task_fixture_invalid');
    const selected=await evalJs(`(()=>{const node=document.querySelector('.task[data-id='+JSON.stringify(${JSON.stringify(fixture.id)})+']');if(!node)return false;node.click();return true})()`);
    if(!selected)throw new Error('provider_only_existing_task_not_visible');
    for(let i=0;i<200;i++){
      const state=await evalJs(`(()=>({id:document.querySelector('#taskId')?.textContent||'',visible:!document.querySelector('#taskPanel').classList.contains('hidden')}))()`);
      if(state.visible&&state.id===fixture.id){createdTaskId=state.id;break;}
      await sleep(50);
    }
    if(!createdTaskId)throw new Error('provider_only_existing_task_open_failed');
  } else {
    const previousTaskId=await evalJs(`document.querySelector('#taskId')?.textContent||''`);
    await evalJs(`document.querySelector('#newTask').click(); true`);
    for(let i=0;i<200;i++){
      const state=await evalJs(`(()=>({id:document.querySelector('#taskId')?.textContent||'',visible:!document.querySelector('#taskPanel').classList.contains('hidden')}))()`);
      if(state.visible&&state.id&&state.id!==previousTaskId){createdTaskId=state.id;break;}
      await sleep(50);
    }
    if(!createdTaskId)throw new Error('new_task_not_ready');
  }
  const taskScope=await evalJs(`(async()=>{const tasks=await window.ordax.listTasks();const task=tasks.find(item=>item.id===${JSON.stringify(createdTaskId)});return {found:Boolean(task),bound:Boolean(task?.lab_binding)}})()`);
  if(!taskScope.found||taskScope.bound)throw new Error('provider_only_task_is_project_bound');
  const baseline=await evalJs(`(()=>{const messages=[...document.querySelectorAll('#messageList > .message')].filter(n=>!n.classList.contains('live'));return {userCount:messages.filter(n=>n.classList.contains('user')).length,assistantCount:messages.filter(n=>n.classList.contains('assistant')).length,errorCount:messages.filter(n=>n.classList.contains('error')).length,userTexts:messages.filter(n=>n.classList.contains('user')).map(n=>n.querySelector('.message-content')?.textContent||'')}})()`);
  const started=Date.now(); let lastHeartbeatAt=started;
  await evalJs(`(()=>{const p=document.querySelector('#prompt');p.value=${JSON.stringify(prompt)};p.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#composer').requestSubmit();return true})()`);
  let firstVisibleAt=null,firstVisibleText='',firstVisibleSource='',finalAt=null,finalText='',sawLive=false,sawFast=false,sawBeta=false,lastMeaningfulLive='',liveRegressed=false,newUserObserved=false,newAssistantObserved=false;const samples=[],statuses=[];
  const maxResponseChecks=Math.ceil(responseTimeoutMs/50);
  for(let i=0;i<maxResponseChecks;i++){const state=await evalJs(`(()=>({runStatus:document.querySelector('#runStatus')?.textContent||'',sendDisabled:Boolean(document.querySelector('#send')?.disabled),live:document.querySelector('.message.live .live-content')?.textContent||'',streamStarted:document.querySelector('.message.live')?.dataset.streamStarted==='true',messages:[...document.querySelectorAll('#messageList > .message')].map(n=>({role:n.classList.contains('assistant')?'assistant':n.classList.contains('user')?'user':n.classList.contains('error')?'error':'other',live:n.classList.contains('live'),text:n.querySelector('.message-content')?.textContent||''}))}))()`);if(state.runStatus.includes('Fast'))sawFast=true;if(state.runStatus.includes('Beta'))sawBeta=true;if(statuses.length<20&&state.runStatus&&statuses.at(-1)!==state.runStatus)statuses.push(state.runStatus);const users=state.messages.filter(x=>x.role==='user'&&!x.live);const assistants=state.messages.filter(x=>x.role==='assistant'&&!x.live);newUserObserved=users.length>baseline.userCount||(!baseline.userTexts.includes(prompt)&&users.some(x=>x.text.trim()===prompt.trim()));if(state.messages.filter(x=>x.role==='error').length>baseline.errorCount)throw new Error('provider_run_ui_error');const meaningfulLive=state.streamStarted && state.live&&!/^(?:Preparando|Processando)/i.test(state.live.trim());if(meaningfulLive){sawLive=true;if(lastMeaningfulLive&&state.live.length<lastMeaningfulLive.length)liveRegressed=true;lastMeaningfulLive=state.live;if(!firstVisibleAt){firstVisibleAt=Date.now();firstVisibleText=state.live;firstVisibleSource='stream';}}if(samples.length<16&&state.live&&samples.at(-1)!==state.live)samples.push(state.live);const assistant=assistants.length>baseline.assistantCount?assistants.at(-1)?.text||'':'';newAssistantObserved=Boolean(assistant);if(assistant.includes(marker)&&!firstVisibleAt){firstVisibleAt=Date.now();firstVisibleText=assistant;firstVisibleSource='final';}if(newUserObserved&&assistant.includes(marker)&&!state.sendDisabled&&!state.live){finalAt=Date.now();finalText=assistant;break;}if(Date.now()-lastHeartbeatAt>=15000){console.error(JSON.stringify({schema:'ordax.lab.live-text-smoke-progress.v1',taskId:createdTaskId,elapsedMs:Date.now()-started,runStatus:state.runStatus.trim().slice(0,80),streaming:Boolean(state.live),partialChars:state.live.length,assistantObserved:newAssistantObserved}));lastHeartbeatAt=Date.now();}await sleep(50);}
  const finalUi=await evalJs(`(()=>({observerMode:document.querySelector('#observerMode').value,
    selectedPane:document.querySelector('#rightPaneTabs [aria-selected="true"]')?.dataset.pane||'unknown',
    composerState:document.querySelector('#composerConnection')?.dataset.state||'unknown',
    runStatusHidden:document.querySelector('#runStatus').classList.contains('hidden')}))()`);
  const providerStatus=await evalJs('window.ordax.providerStatus()');
  const fastOperational=mode!=='fast'||Boolean(sawFast||providerStatus?.fast_stream_capable);
  const modeEvidence=mode==='fast'?(fastOperational&&(!requireFastDelivery||sawFast)):mode==='beta'?!sawFast:true;
  const streamEvidence=!requireStream||sawLive;
  const crossRunLeak=/ORDAX_UI_(?:FAST|BETA|STREAM)_OK/.test(firstVisibleText)&&!firstVisibleText.includes(marker);
  const safeProviderStatus=Object.fromEntries(['connected','active','ready','persistent_session','api_used','private_endpoint_used','auth_state','composer_ready','verification_required','backendApi403Observed','backendApi403Count','fast_stream_capable','fast_observer_ready'].filter(key=>Object.hasOwn(providerStatus||{},key)).map(key=>[key,providerStatus[key]]));
  const result={mode,marker,taskId:createdTaskId,continuingExistingTask:Boolean(existingTaskMarker),elapsed_ms:Date.now()-discoverStarted,responseTimeoutMs,responseTimedOut:!finalAt,awaitingResponse:Boolean(newUserObserved&&!finalAt&&finalUi.composerState==='busy'),provider_ready_wait_ms,uiReady,projectScopeCleared:projectScopeReady,taskUnbound:!taskScope.bound,baselineAssistantCount:baseline.assistantCount,newUserObserved,newAssistantObserved,initial,requireStream,requireFastDelivery,sawLive,sawFast,sawBeta,fastOperational,streamEvidence,modeEvidence,monotonic:!liveRegressed,liveRegressed,crossRunLeak,firstVisibleSource,finalContainsMarker:finalText.includes(marker),ttfv_ms:firstVisibleAt?firstVisibleAt-started:null,total_ms:finalAt?finalAt-started:null,finalUi,providerStatus:safeProviderStatus,passed:Boolean(uiReady&&projectScopeReady&&!taskScope.bound&&newUserObserved&&newAssistantObserved&&streamEvidence&&modeEvidence&&!liveRegressed&&!crossRunLeak&&finalText.includes(marker)&&finalUi.runStatusHidden)};
  console.log(JSON.stringify(result,null,2));ws.close();process.exit(result.passed?0:2);
})().catch(e=>{console.error(e);process.exit(1)});
