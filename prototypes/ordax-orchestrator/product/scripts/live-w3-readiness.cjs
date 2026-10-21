// Read-only W3 readiness gate for a running, explicitly staged OrdaX Electron App.
// Reports only counts and sanitized readiness reasons; never sends or navigates.
const {DatabaseSync}=require('node:sqlite');
const {labDatabasePath,waitForLabUiTarget,waitForLabAppMode,readLabDebugTargets}=require('./e2e-lab-target.cjs');
const fs=require('node:fs');

const safeReason=new Set(['ready_for_manual_w3','no_linked_task','missing_latest_submission_receipt',
  'provider_login_required','provider_restricted','provider_health_unknown','app_not_ready','database_not_ready']);
function summarize({linkedTasks=0,latestReceiptTasks=0,health={}}={}){
  let reason='ready_for_manual_w3';
  if(linkedTasks<1) reason='no_linked_task';
  else if(latestReceiptTasks<1) reason='missing_latest_submission_receipt';
  else if(health.auth!=='session_present') reason=
    health.auth==='login_required'?'provider_login_required':'provider_health_unknown';
  else if(health.restriction||health.observed!==true) reason=
    health.restriction?'provider_restricted':'provider_health_unknown';
  return {schema:'ordax.lab.w3-readiness.v1',ready:reason==='ready_for_manual_w3',
    reason,linkedTasks,latestReceiptTasks,providerMessagesSent:0,W3Certified:false};
}
function counts(){
  const filename=labDatabasePath();
  if(!fs.existsSync(filename)) throw Error('database_not_ready');
  const db=new DatabaseSync(filename,{readOnly:true});
  try {
    const linkedTasks=db.prepare("SELECT COUNT(*) n FROM tasks WHERE chat_url IS NOT NULL").get().n;
    // Keep the receipt count as a necessary, NOT sufficient, proof: a receipt
    // might belong to an old turn. The canonical W3 handler checks the exact latest turn.
    const receiptEvents=db.prepare("SELECT COUNT(*) n FROM events WHERE kind='provider.submission.provenance'").get().n;
    return {linkedTasks,latestReceiptTasks:Math.min(linkedTasks,receiptEvents)};
  }finally{db.close();}
}
async function run(){
  let stage='app_not_ready';
  let ws;
  try{
    const target=await waitForLabUiTarget({maxWaitMs:10000});
    ws=new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('app_not_ready')),4000);
      ws.onopen=()=>{clearTimeout(timer);resolve()};
      ws.onerror=()=>{clearTimeout(timer);reject(Error('app_not_ready'))};
    });
    let nextId=0;const pending=new Map();
    ws.onmessage=e=>{
      let data;try{data=JSON.parse(e.data)}catch{return}
      const p=pending.get(data.id);if(!p)return;pending.delete(data.id);
      clearTimeout(p.timer);
      if(data.error||data.result?.exceptionDetails)p.reject(Error('app_not_ready'));
      else p.resolve(data.result?.result?.value);
    };
    const evaluate=expression=>new Promise((resolve,reject)=>{
      const id=++nextId;
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('app_not_ready'))},5000);
      pending.set(id,{resolve,reject,timer});
      ws.send(JSON.stringify({id,method:'Runtime.evaluate',
        params:{expression,awaitPromise:true,returnByValue:true}}));
    });
    await waitForLabAppMode(evaluate); // exact staged userData fingerprint
    stage='database_not_ready';
    const state=counts();
    stage='app_not_ready';
    const health=await evaluate("(async()=>{const h=await window.ordax.providerStatus();return {auth:h.auth_state,restriction:!!h.provider_access_problem,observed:h.health_observed===true}})()");
    console.log(JSON.stringify(summarize({...state,health})));
  }catch(error){
    const reason=safeReason.has(error?.message)?error.message:stage;
    console.log(JSON.stringify({schema:'ordax.lab.w3-readiness.v1',ready:false,reason,
      providerMessagesSent:0,W3Certified:false}));
    process.exitCode=2;
  }finally{try{ws?.close()}catch{}}
}
if(require.main===module)run();
module.exports={summarize};
