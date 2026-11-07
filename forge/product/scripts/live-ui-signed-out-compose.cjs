// Real OrdaX App UI, signed-out and isolated staged profile only.
// Existing synthetic Task: "P5 Offline Login Gate Fixture". No provider send.
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {waitForLabUiTarget,waitForLabAppMode,labDatabasePath,readLabDebugTargets}=require('./e2e-lab-target.cjs');
const {acquireE2ELock}=require('./e2e-lock.cjs');
acquireE2ELock('signed-out-compose-gate');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const dbpath=labDatabasePath();
function snapshot(){
  const db=new DatabaseSync(dbpath,{readOnly:true});
  try{
    const n=sql=>db.prepare(sql).get().n;
    const task=db.prepare("SELECT id,draft FROM tasks WHERE title='P5 Offline Login Gate Fixture'").get();
    assert.ok(task,'lab_e2e_offline_fixture_missing');
    return {task,runs:n('SELECT COUNT(*) n FROM runs'),
      messages:n('SELECT COUNT(*) n FROM messages'),
      actions:n('SELECT COUNT(*) n FROM action_ledger')};
  }finally{db.close();}
}
async function providerUrl(){
  const targets=await readLabDebugTargets();
  const page=targets.find(t=>{try{return t.type==='page'&&new URL(t.url).hostname==='chatgpt.com';}catch{return false;}});
  return page?.url||null;
}
async function main(){
  const before=snapshot();
  assert.equal(before.task.draft||'','', 'lab_e2e_offline_fixture_not_clean');
  const target=await waitForLabUiTarget();
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok,fail)=>{ws.onopen=ok;ws.onerror=fail;});
  let id=0;const pending=new Map();
  ws.onmessage=e=>{
    let m;try{m=JSON.parse(e.data);}catch{return;}
    const p=pending.get(m.id);if(!p)return;
    pending.delete(m.id);
    m.error||m.result?.exceptionDetails?p.reject(Error('lab_e2e_ui_eval_failed')):
      p.resolve(m.result?.result?.value);
  };
  const evaluate=expression=>new Promise((resolve,reject)=>{
    const n=++id;
    const timer=setTimeout(()=>{pending.delete(n);reject(Error('lab_e2e_ui_timeout'));},5000);
    pending.set(n,{resolve:x=>{clearTimeout(timer);resolve(x);},
      reject:e=>{clearTimeout(timer);reject(e);}});
    ws.send(JSON.stringify({id:n,method:'Runtime.evaluate',
      params:{expression,awaitPromise:true,returnByValue:true}}));
  });
  try{
    await waitForLabAppMode(evaluate);
    const originalUrl=await providerUrl();
    const click="(()=>{const t=[...document.querySelectorAll('.task[data-id]')].find(el=>el.dataset.id==="+
      JSON.stringify(before.task.id)+");if(!t)return false;t.click();return true;})()";
    let selected=false;
    for(let i=0;i<60;i++){selected=await evaluate(click);if(selected)break;await sleep(100);}
    assert.equal(selected,true,'lab_e2e_offline_fixture_not_listed');
    let state;
    const probe="(()=>({selected:document.querySelector('#taskId')?.textContent==="+
      JSON.stringify(before.task.id)+",blocked:document.querySelector('#send')?.disabled===true,"+
      "editorActive:document.querySelector('#prompt')?.disabled!==true,"+
      "loginAction:Boolean(document.querySelector('#composerLogin')),"+
      "ready:document.querySelector('#composer')?.dataset.sendReady==='true',"+
      "warning:Boolean(document.querySelector('#composerConnectionText')?.textContent)}))()";
    for(let i=0;i<90;i++){
      state=await evaluate(probe);
      if(state?.selected&&state.blocked&&state.warning)break;
      await sleep(150);
    }
    assert.equal(state?.selected,true,'lab_e2e_offline_task_not_selected');
    assert.equal(state?.blocked,true,'lab_e2e_signed_out_send_enabled');
    assert.equal(state?.ready,false,'lab_e2e_signed_out_provider_ready');
    assert.equal(state?.loginAction,true,'lab_e2e_login_action_missing');
    assert.equal(state?.editorActive,true,'lab_e2e_offline_draft_editor_disabled');
    const marker='ORDAX_P5_OFFLINE_DRAFT_NOT_SENT';
    const type="(()=>{const input=document.querySelector('#prompt');input.value="+JSON.stringify(marker)+
      ";input.dispatchEvent(new Event('input',{bubbles:true}));"+
      "document.querySelector('#composer').requestSubmit();return true;})()";
    await evaluate(type);
    let after;
    for(let i=0;i<50;i++){after=snapshot();if(after.task.draft===marker)break;await sleep(100);}
    assert.equal(after.task.draft,marker,'lab_e2e_draft_not_saved');
    assert.equal(await evaluate("document.querySelector('#prompt')?.value"),marker,'lab_e2e_draft_lost');
    assert.deepEqual({runs:after.runs,messages:after.messages,actions:after.actions},
      {runs:before.runs,messages:before.messages,actions:before.actions},
      'lab_e2e_offline_send_changed_ledger');
    assert.equal(await providerUrl(),originalUrl,'lab_e2e_provider_url_changed');
    await waitForLabAppMode(evaluate);
    console.log(JSON.stringify({schema:'ordax.lab.signed-out-app-e2e.v1',
      appMode:true,signedOutSendBlocked:true,offlineDraftEditable:true,
      draftPersisted:true,providerUrlUnchanged:true,
      providerMessagesSent:0,ledgerCountsUnchanged:true}));
  }finally{ws.close();}
}
main().catch(e=>{
  const reasons=new Set(['lab_e2e_offline_fixture_missing','lab_e2e_offline_fixture_not_clean',
    'lab_e2e_offline_fixture_not_listed','lab_e2e_offline_task_not_selected',
    'lab_e2e_signed_out_send_enabled','lab_e2e_signed_out_provider_ready',
    'lab_e2e_login_action_missing','lab_e2e_offline_draft_editor_disabled',
    'lab_e2e_draft_not_saved','lab_e2e_draft_lost',
    'lab_e2e_offline_send_changed_ledger','lab_e2e_provider_url_changed']);
  const reason=String(e?.message||'');
  console.error(JSON.stringify({schema:'ordax.lab.signed-out-app-e2e.v1',pass:false,
    reason:reasons.has(reason)?reason:'lab_e2e_signed_out_app_gate_failed'}));
  process.exitCode=2;
});