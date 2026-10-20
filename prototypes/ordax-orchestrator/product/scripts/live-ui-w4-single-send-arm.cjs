// W4 operator-only ARM gate: one harmless prompt through the OrdaX APP.
// Emits a receipt after the app enters await-response. Does NOT kill anything,
// restart, navigate direct mode, or retry. The operator separately verifies
// the live Run and interrupts ONLY the precisely scoped staged Lab process.
if(process.env.ORDAX_LAB_E2E_CRASH_EXPLICIT!=='1')
  throw new Error('lab_w4_explicit_single_send_approval_required');
const {randomUUID}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {waitForLabUiTarget,waitForLabAppMode,labDatabasePath}=require('./e2e-lab-target.cjs');
const {acquireE2ELock}=require('./e2e-lock.cjs');
acquireE2ELock('w4-single-send-arm');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const db=new DatabaseSync(labDatabasePath(),{readOnly:true});
  try {
    const running=db.prepare("SELECT COUNT(*) n FROM runs WHERE status='running'").get().n;
    const dispatch=db.prepare("SELECT COUNT(*) n FROM action_ledger WHERE status='dispatching'").get().n;
    if(running||dispatch)throw new Error('lab_w4_preexisting_active_work');
  }finally{db.close();}
  const tab=await waitForLabUiTarget();
  const ws=new WebSocket(tab.webSocketDebuggerUrl);
  let seq=0;const pending=new Map();
  const evaluate=async expression=>{
    const r=await new Promise((resolve,reject)=>{
      const id=++seq;
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('lab_w4_cdp_observation_timeout'));},9000);
      pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});
      ws.send(JSON.stringify({id,method:'Runtime.evaluate',
        params:{expression,returnByValue:true,awaitPromise:true}}));
    });
    if(r?.exceptionDetails)throw new Error('lab_w4_ui_evaluation_rejected');
    return r?.result?.value;
  };
  ws.onmessage=event=>{
    let m;try{m=JSON.parse(event.data);}catch{return;}
    const p=pending.get(m.id);
    if(p){pending.delete(m.id);m.error?p.reject(new Error('lab_w4_cdp_rejected')):p.resolve(m.result);}
  };
  try {
    await new Promise((resolve,reject)=>{
      ws.onopen=resolve;ws.onerror=()=>reject(new Error('lab_w4_cdp_not_ready'));
    });
    await waitForLabAppMode(evaluate);
    const health=await evaluate("(async()=>{const s=await window.ordax.providerStatus();return {auth:s.auth_state,ready:s.composer_ready,verification:s.verification_required}})()");
    if(health?.auth!=='session_present'||health?.ready!==true||health?.verification===true)
      throw new Error('lab_w4_provider_not_ready');
    const previous=await evaluate("document.querySelector('#taskId')?.textContent||''");
    await evaluate("(()=>{document.querySelector('#newTask').click();return true})()");
    let taskId='';
    for(let i=0;i<120;i++){
      taskId=await evaluate("document.querySelector('#taskId')?.textContent||''");
      if(taskId&&taskId!==previous)break;
      await sleep(50);
    }
    if(!taskId||taskId===previous)throw new Error('lab_w4_new_task_not_ready');
    await evaluate("(()=>{window.__ordaxW4ObservedStage='';window.ordax.onTaskStage(p=>{window.__ordaxW4ObservedStage=String(p?.stage||'')});return true})()");
    const marker='ORDAX_P5_W4_'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase();
    const prompt='Teste tecnico inofensivo do OrdaX. Comece com '+marker+
      '. Depois escreva 600 itens numerados contendo apenas a palavra teste e o numero. Sem conclusao.';
    // Exactly ONE submission via the first-party OrdaX App form.
    await evaluate("(()=>{const p=document.querySelector('#prompt');p.value="+
      JSON.stringify(prompt)+";p.dispatchEvent(new Event('input',{bubbles:true}));"+
      "document.querySelector('#composer').requestSubmit();return true})()");
    let stage='';
    for(let i=0;i<700;i++){
      stage=await evaluate("document.documentElement.dataset.ordaxView==='app'?String(window.__ordaxW4ObservedStage||''):'wrong_view'");
      if(stage==='await-response')break;
      if(stage==='wrong_view')throw new Error('lab_w4_app_view_lost');
      await sleep(50);
    }
    if(stage!=='await-response')throw new Error('lab_w4_submission_receipt_not_observed');
    await waitForLabAppMode(evaluate);
    console.log(JSON.stringify({schema:'ordax.lab.w4-single-send-arm.v1',
      armed:true,appMode:true,marker,taskId,stage,providerMessagesSent:1,
      operatorMustCheckSqliteRunStillActive:true}));
  } finally {ws.close();}
})().catch(error=>{
  const codes=new Set(['lab_w4_preexisting_active_work','lab_w4_provider_not_ready',
    'lab_w4_new_task_not_ready','lab_w4_app_view_lost',
    'lab_w4_submission_receipt_not_observed','lab_w4_cdp_observation_timeout',
    'lab_w4_cdp_not_ready','lab_w4_cdp_rejected','lab_w4_ui_evaluation_rejected']);
  const e=String(error?.message||'lab_w4_unknown');
  console.error(JSON.stringify({schema:'ordax.lab.w4-single-send-arm.v1',
    armed:false,error:codes.has(e)?e:'lab_w4_failed',retryAllowed:false}));
  process.exitCode=1;
});
