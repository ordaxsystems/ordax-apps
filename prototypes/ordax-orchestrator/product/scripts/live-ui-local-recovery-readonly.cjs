// P5 local continuity in the real OrdaX App (NOT W3/W4 external certification).
// Never navigates to the provider, submits a prompt or writes to SQLite.
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {waitForLabUiTarget,waitForLabAppMode,labDatabasePath}=require('./e2e-lab-target.cjs');
const {acquireE2ELock}=require('./e2e-lock.cjs');
acquireE2ELock('local-recovery-readonly');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const dbpath=labDatabasePath();
const readDB=()=>new DatabaseSync(dbpath,{readOnly:true});
function snapshot(){
  const db=readDB();
  try{
    const n=sql=>db.prepare(sql).get().n;
    return {
      runs:n('SELECT COUNT(*) AS n FROM runs'),
      messages:n('SELECT COUNT(*) AS n FROM messages'),
      actions:n('SELECT COUNT(*) AS n FROM action_ledger'),
      active:n("SELECT COUNT(*) AS n FROM runs WHERE status IN ('running','planning','dispatching')")
    };
  }finally{db.close();}
}
function fixtures(){
  const db=readDB();
  try {
    const find=status=>db.prepare("SELECT t.id FROM tasks t WHERE t.status=? "+
      "AND EXISTS(SELECT 1 FROM messages m WHERE m.task_id=t.id AND m.role='user' AND m.content LIKE '%ORDAX_%') "+
      "AND EXISTS(SELECT 1 FROM runs r WHERE r.task_id=t.id AND r.status=?) "+
      "ORDER BY t.updated_at DESC LIMIT 1").get(status,status==='ready'?'succeeded':'interrupted');
    const done=find('ready'),interrupted=find('interrupted');
    assert.ok(done&&interrupted,'lab_e2e_local_fixtures_missing');
    const last=db.prepare("SELECT content FROM messages WHERE task_id=? AND role=? ORDER BY created_at DESC,id DESC LIMIT 1");
    const get=(id,role)=>last.get(id,role)?.content;
    const pair=[
      {kind:'complete',id:done.id,user:get(done.id,'user'),assistant:get(done.id,'assistant')},
      {kind:'interrupted',id:interrupted.id,user:get(interrupted.id,'user'),assistant:null}
    ];
    for(const v of pair)assert.ok(v.user&&(v.kind!=='complete'||v.assistant),'lab_e2e_local_fixture_content_missing');
    return pair;
  }finally{db.close();}
}
async function main(){
  const before=snapshot();
  assert.equal(before.active,0,'lab_e2e_active_run_detected');
  const pair=fixtures();
  const target=await waitForLabUiTarget();
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  const pending=new Map();let next=0;
  ws.onmessage=e=>{
    let m;try{m=JSON.parse(e.data);}catch{return;}
    const p=pending.get(m.id);if(!p)return;
    pending.delete(m.id);
    m.error?p.reject(Error('lab_e2e_cdp_rejected')):p.resolve(m.result);
  };
  await new Promise((ok,bad)=>{ws.onopen=ok;ws.onerror=bad;});
  const evaluate=async expression=>{
    const id=++next;
    const result=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('lab_e2e_ui_timeout'));},5000);
      pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},
        reject:e=>{clearTimeout(timer);reject(e);}});
      ws.send(JSON.stringify({id,method:'Runtime.evaluate',
        params:{expression,awaitPromise:true,returnByValue:true}}));
    });
    if(result?.exceptionDetails)throw Error('lab_e2e_ui_evaluation_failed');
    return result?.result?.value;
  };
  let previous='';
  try{
    await waitForLabAppMode(evaluate);
    previous=await evaluate("document.querySelector('#taskId')?.textContent||''");
    for(const v of pair){
      const click="(()=>{const n=[...document.querySelectorAll('.task[data-id]')].find(t=>t.dataset.id==="+
        JSON.stringify(v.id)+");if(!n)return false;n.click();return true})()";
      let clicked=false;
      for(let i=0;i<60;i++){clicked=await evaluate(click);if(clicked)break;await sleep(100);}
      assert.equal(clicked,true,'lab_e2e_task_not_in_navigation');
      const expr="(()=>{const t=[...document.querySelectorAll('#messageList .message .message-content')].map(n=>n.textContent||'');"+
        "const banner=document.querySelector('#recoveryBanner');return {"+
        "selected:document.querySelector('#taskId')?.textContent==="+JSON.stringify(v.id)+","+
        "userVisible:t.some(x=>x.includes("+JSON.stringify(v.user)+")),"+
        "assistantVisible:"+(v.assistant?"t.some(x=>x.includes("+JSON.stringify(v.assistant)+"))":"false")+","+
        "interruptedBannerVisible:Boolean(banner&&!banner.classList.contains('hidden'))"+
        "}})()";
      let state=null;
      for(let i=0;i<100;i++){
        state=await evaluate(expr);
        if(state?.selected&&state.userVisible&&
          (v.kind==='complete'?state.assistantVisible:state.interruptedBannerVisible))break;
        await sleep(100);
      }
      assert.equal(state?.selected,true,'lab_e2e_task_selection_not_confirmed');
      assert.equal(state.userVisible,true,'lab_e2e_user_content_not_rendered');
      if(v.kind==='complete')assert.equal(state.assistantVisible,true,'lab_e2e_assistant_not_rendered');
      else assert.equal(state.interruptedBannerVisible,true,'lab_e2e_interruption_not_rendered');
      await waitForLabAppMode(evaluate);
    }
    assert.deepEqual(snapshot(),before,'lab_e2e_local_read_modified_ledger');
    console.log(JSON.stringify({schema:'ordax.lab.local-recovery-app-e2e.v1',
      appMode:true,readOnly:true,completedTaskReopened:true,
      completedReplyVisible:true,interruptedTaskReopened:true,
      interruptionBannerVisible:true,providerMessagesSent:0,
      providerNavigationPerformed:false,ledgerCountsUnchanged:true,
      W3Certified:false,W4Certified:false}));
  }finally{
    if(previous){
      try{await evaluate("(()=>{const b=[...document.querySelectorAll('.task[data-id]')].find(t=>t.dataset.id==="+
        JSON.stringify(previous)+");if(b)b.click();return true})()");}catch{}
    }
    ws.close();
  }
}
main().catch(error=>{
  const reasons=new Set(['lab_e2e_local_fixtures_missing','lab_e2e_local_fixture_content_missing',
    'lab_e2e_active_run_detected','lab_e2e_task_not_in_navigation',
    'lab_e2e_task_selection_not_confirmed','lab_e2e_user_content_not_rendered',
    'lab_e2e_assistant_not_rendered','lab_e2e_interruption_not_rendered',
    'lab_e2e_local_read_modified_ledger','lab_e2e_ui_timeout']);
  const code=String(error?.message||'');
  console.error(JSON.stringify({schema:'ordax.lab.local-recovery-app-e2e.v1',success:false,
    reason:reasons.has(code)?code:'lab_e2e_local_recovery_failed'}));
  process.exitCode=2;
});