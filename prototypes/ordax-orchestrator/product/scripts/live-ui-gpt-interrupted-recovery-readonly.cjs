// Physical READ-ONLY certification of an interrupted GPT Web reply in the
// staged Electron Lab. Does NOT submit prompts or confirm/import replies.
// Requires an existing acknowledged receipt for the LATEST user turn.
// Do not use production profiles, copy cookies, or seed fictitious receipts.
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {waitForLabUiTarget,waitForLabAppMode,labDatabasePath}=require('./e2e-lab-target.cjs');

const expectedTaskId=String(process.env.ORDAX_LAB_E2E_TASK_ID||'').trim();
if(process.env.ORDAX_LAB_E2E_RECOVERY_READONLY!=='1'||
   !/^task_[0-9a-f-]{20,80}$/i.test(expectedTaskId))
  throw Error('lab_recovery_explicit_task_approval_required');
// Validate explicit task scope before loading the lock's profile-specific path.
const {acquireE2ELock}=require('./e2e-lock.cjs');
// E2E lock also checks the approved, isolated alpha profile before CDP.
acquireE2ELock('gpt-interrupted-recovery-readonly');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const {readInterruptedRecoverySnapshot}=require('./gpt-interrupted-recovery-preflight.cjs');
function snapshot() {
  const db=new DatabaseSync(labDatabasePath(),{readOnly:true});
  try {return readInterruptedRecoverySnapshot(db,expectedTaskId);}
  finally {db.close();}
}

async function main(){
  const before=snapshot();
  const target=await waitForLabUiTarget();
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  const pending=new Map();let seq=0;
  ws.onmessage=event=>{
    let reply;
    try{reply=JSON.parse(event.data);}catch{return;}
    const item=pending.get(reply.id);
    if(!item)return;
    pending.delete(reply.id);clearTimeout(item.timer);
    reply.error||reply.result?.exceptionDetails
      ?item.reject(Error('lab_recovery_cdp_evaluation_failed'))
      :item.resolve(reply.result?.result?.value);
  };
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('lab_recovery_cdp_connect_timeout')),10000);
    ws.onopen=()=>{clearTimeout(timer);resolve();};
    ws.onerror=()=>{clearTimeout(timer);reject(Error('lab_recovery_cdp_connect_failed'));};
  });
  const evaluate=expression=>new Promise((resolve,reject)=>{
    const id=++seq;
    const timer=setTimeout(()=>{
      pending.delete(id);reject(Error('lab_recovery_cdp_timeout'));
    },10000);
    pending.set(id,{resolve,reject,timer});
    ws.send(JSON.stringify({id,method:'Runtime.evaluate',
      params:{expression,awaitPromise:true,returnByValue:true}}));
  });
  try {
    await waitForLabAppMode(evaluate); // Attests exact staged profile fingerprint
    // Poll for the local item, but never click repeatedly on an uncertain CDP result.
    let present=false;
    for(let i=0;i<100;i++){
      present=await evaluate("(()=>[...document.querySelectorAll('.task[data-id]')].some(el=>el.dataset.id==="+
        JSON.stringify(expectedTaskId)+"))()");
      if(present)break;
      await sleep(100);
    }
    if(!present)throw Error('lab_recovery_task_not_visible');
    const clicked=await evaluate("(()=>{const el=[...document.querySelectorAll('.task[data-id]')].find(n=>n.dataset.id==="+
      JSON.stringify(expectedTaskId)+");if(!el)return false;el.click();return true})()");
    if(clicked!==true)throw Error('lab_recovery_task_click_not_confirmed');
    let ready=false;
    for(let i=0;i<150;i++){
      ready=await evaluate("(()=>document.querySelector('#taskId')?.textContent==="+
        JSON.stringify(expectedTaskId)+"&&!document.querySelector('#inspectLinkedThread')?.disabled)()");
      if(ready)break;
      await sleep(100);
    }
    if(!ready)throw Error('lab_recovery_readonly_action_not_ready');
    // The ONLY provider action is the App's receipt-first W3 inspector.
    // Intentionally never click #confirmLinkedReplyRecovery, composer or send.
    if(await evaluate("(()=>{document.querySelector('#inspectLinkedThread').click();return true})()")!==true)
      throw Error('lab_recovery_inspection_not_triggered');
    let state=null;
    for(let i=0;i<600;i++){
      state=await evaluate("(()=>{const el=document.querySelector('#linkedThreadStatus');return {status:el?.dataset.state||'unknown',kind:el?.dataset.kind||'unavailable',reason:el?.dataset.reason||'unknown',rendered:el?.dataset.threadRendered==='true',previewVisible:!document.querySelector('#linkedReplyRecovery')?.classList.contains('hidden'),previewChars:Math.min(document.querySelector('#linkedReplyRecoveryText')?.textContent?.length||0,12000)};})()");
      if(['complete','error'].includes(state?.status))break;
      await sleep(100);
    }
    if(!['complete','error'].includes(state?.status))
      throw Error('lab_recovery_inspection_not_settled');
    await waitForLabAppMode(evaluate);
    const after=snapshot();
    assert.deepEqual(after,before,'lab_recovery_mutated_canonical_ledger');
    const certified=state.status==='complete' && state.kind==='response_candidate' &&
      state.reason==='thread_rendered' && state.rendered===true &&
      state.previewVisible===true && state.previewChars>0;
    console.log(JSON.stringify({
      schema:'ordax.lab.gpt-interrupted-recovery-readonly.v1',
      profileBound:true,runInterrupted:true,receiptMatched:true,readOnly:true,
      ledgerUnchanged:true,providerMessagesSent:0,repliesImported:0,
      inspectionState:state.status,observationKind:state.kind,
      observationReason:state.reason,responsePreviewObserved:certified,
      inconclusive:!certified,gptRecoveryCertified:certified
    }));
    if(!certified)process.exitCode=2;
  }finally{
    for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('lab_recovery_cdp_closed'));}
    pending.clear();
    ws.close();
  }
}
main().catch(error=>{
  const code=String(error?.message||'lab_recovery_unavailable');
  const allowed=new Set([
    'lab_recovery_interrupted_task_required','lab_recovery_failed_run_required',
    'lab_recovery_active_workspace_unavailable','lab_recovery_workspace_mismatch',
    'lab_recovery_latest_user_turn_required',
    'lab_recovery_verified_receipt_required','lab_recovery_task_not_visible',
    'lab_recovery_task_click_not_confirmed','lab_recovery_readonly_action_not_ready',
    'lab_recovery_inspection_not_triggered','lab_recovery_inspection_not_settled',
    'lab_recovery_mutated_canonical_ledger','lab_recovery_cdp_connect_timeout',
    'lab_recovery_cdp_connect_failed','lab_recovery_cdp_evaluation_failed',
    'lab_recovery_cdp_timeout','lab_recovery_cdp_closed'
  ]);
  console.error(JSON.stringify({schema:'ordax.lab.gpt-interrupted-recovery-readonly.v1',
    success:false,reason:allowed.has(code)?code:'lab_recovery_unavailable'}));
  process.exitCode=2;
});
