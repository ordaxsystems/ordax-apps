// OrdaX App-only W3 preflight: test an explicitly isolated, unauthenticated
// staged profile with an intentionally UNDELIVERED linked fixture.
// This is a negative safety test, NEVER proof that a real thread was restored.
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {waitForLabUiTarget,waitForLabAppMode,labDatabasePath,
  readLabDebugTargets}=require('./e2e-lab-target.cjs');
const {acquireE2ELock}=require('./e2e-lock.cjs');
const {w3OfflineFailure}=require('./w3-offline-error-report.cjs');
acquireE2ELock('w3-offline-preflight');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const expectedTaskTitle='P5 W3 Offline Preflight Fixture';
// Report only a fixed internal stage on failure; never dump raw CDP errors,
// account state, provider URLs, credentials or conversation contents.
let preflightStage='initialization';
function snapshot(){
  const db=new DatabaseSync(labDatabasePath(),{readOnly:true});
  try{
    const n=sql=>db.prepare(sql).get().n;
    const task=db.prepare('SELECT id,chat_url FROM tasks WHERE title=?').get(expectedTaskTitle);
    assert.ok(task && task.chat_url,'lab_w3_offline_fixture_missing');
    return {task,runs:n('SELECT COUNT(*) n FROM runs'),
      messages:n('SELECT COUNT(*) n FROM messages'),actions:n('SELECT COUNT(*) n FROM action_ledger'),
      receipts:n("SELECT COUNT(*) n FROM events WHERE kind='provider.submission.provenance'")};
  }finally{db.close();}
}
async function providerUrl(){
  const items=await readLabDebugTargets();
  return items.find(item=>{try{return item.type==='page'&&new URL(item.url).hostname==='chatgpt.com';}catch{return false}})?.url||null;
}
async function main(){
  preflightStage='fixture_snapshot';
  const before=snapshot();
  assert.equal(before.receipts,0,'lab_w3_offline_fixture_must_lack_receipt');
  preflightStage='lab_ui_target';
  const target=await waitForLabUiTarget();
  preflightStage='cdp_connection';
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('lab_w3_cdp_connect_timeout')),10000);
    ws.onopen=()=>{clearTimeout(timeout);resolve()};
    ws.onerror=()=>{clearTimeout(timeout);reject(Error('lab_w3_cdp_connection_failed'))};
  });
  let seq=0;const pending=new Map();
  ws.onmessage=e=>{
    let reply;try{reply=JSON.parse(e.data)}catch{return}
    const p=pending.get(reply.id);if(!p)return;
    pending.delete(reply.id);
    reply.error||reply.result?.exceptionDetails?p.reject(Error('lab_w3_ui_observation_failed')):
      p.resolve(reply.result?.result?.value);
  };
  const evaluate=expression=>new Promise((resolve,reject)=>{
    const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('lab_w3_ui_timeout'))},5000);
    pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v)},
      reject:e=>{clearTimeout(timer);reject(e)}});
    ws.send(JSON.stringify({id,method:'Runtime.evaluate',
      params:{expression,awaitPromise:true,returnByValue:true}}));
  });
  try{
    preflightStage='app_profile';
    await waitForLabAppMode(evaluate); // includes exact staged profile attestation
    // Observe existing health only. We must NEVER navigate if this test profile
    // unexpectedly has a ready account or composer.
    preflightStage='provider_health';
    const health=await evaluate("(async()=>{const h=await window.ordax.providerStatus();return {auth:h.auth_state,composer:h.composer_ready,restriction:h.provider_access_problem,url:h.url,observed:h.health_observed}})()");
    const canNavigate=health.auth==='session_present'&&health.composer===true &&
      health.observed===true&&!health.restriction;
    if(canNavigate)throw Error('lab_w3_offline_precondition_not_safe');
    const linked=new URL(before.task.chat_url);
    if(health.url&&linked.href===health.url)
      throw Error('lab_w3_offline_already_at_linked_thread');
    preflightStage='provider_url_baseline';
    const urlBefore=await providerUrl();
    preflightStage='task_selection';
    let selected=false;
    for(let i=0;i<90;i++){
      selected=await evaluate("(()=>{const item=[...document.querySelectorAll('.task[data-id]')].find(n=>n.dataset.id==="+JSON.stringify(before.task.id)+");if(!item)return false;item.click();return true;})()");
      if(selected)break;
      await sleep(100);
    }
    assert.equal(selected,true,'lab_w3_offline_task_missing_in_app');
    preflightStage='task_panel';
    let ready=false;
    for(let i=0;i<90;i++){
      ready=await evaluate("(()=>document.querySelector('#taskId')?.textContent==="+JSON.stringify(before.task.id)+"&&!document.querySelector('#inspectLinkedThread')?.disabled)()");
      if(ready)break;await sleep(100);
    }
    assert.equal(ready,true,'lab_w3_offline_inspection_button_disabled');
    preflightStage='inspection_click';
    await evaluate("(()=>{document.querySelector('#inspectLinkedThread').click();return true})()");
    preflightStage='inspection_result';
    let state=null;
    for(let i=0;i<120;i++){
      state=await evaluate("(()=>{const n=document.querySelector('#linkedThreadStatus');return {state:n?.dataset.state,reason:n?.dataset.reason,rendered:n?.dataset.threadRendered}})()");
      if(['complete','error'].includes(state?.state))break;
      await sleep(100);
    }
    assert.equal(state?.state,'complete','lab_w3_offline_inspection_not_terminal');
    // A missing latest-turn receipt must block BEFORE a provider auth check
    // or navigation; this is why the no-receipt fixture exists.
    assert.equal(state?.reason,'provider_submission_provenance_missing',
      'lab_w3_offline_receipt_first_not_observed');
    assert.equal(state?.rendered,'false','lab_w3_offline_false_certification');
    preflightStage='postconditions';
    assert.equal(await providerUrl(),urlBefore,'lab_w3_offline_unexpected_navigation');
    const after=snapshot();
    assert.deepEqual({runs:after.runs,messages:after.messages,actions:after.actions},
      {runs:before.runs,messages:before.messages,actions:before.actions},
      'lab_w3_offline_mutated_ledger');
    preflightStage='final_profile_check';
    await waitForLabAppMode(evaluate);
    preflightStage='complete';
    console.log(JSON.stringify({schema:'ordax.lab.w3-offline-preflight.v1',
      appMode:true,profileBound:true,inspectionState:state.state,
      reason:state.reason,threadRendered:false,providerUrlUnchanged:true,
      receiptCount:before.receipts,receiptGuardTriggered:true,
      ledgerCountsUnchanged:true,providerMessagesSent:0,W3Certified:false}));
  }finally{ws.close();}
}
main().catch(error=>{
  console.error(JSON.stringify(w3OfflineFailure(error,preflightStage)));
  process.exitCode=2;
});
