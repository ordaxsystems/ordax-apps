// Existing-thread W3 smoke through the real OrdaX Electron app.
// Read-only: selects a previously successful synthetic Task and clicks its
// built-in "Verificar conversa" button. No ChatGPT direct-mode or resend.
const { DatabaseSync }=require('node:sqlite');
const { waitForLabUiTarget,waitForLabAppMode,labDatabasePath }=require('./e2e-lab-target.cjs');
const { acquireE2ELock }=require('./e2e-lock.cjs');
acquireE2ELock('linked-thread-smoke');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const db=new DatabaseSync(labDatabasePath(),{readOnly:true});
  let fixture;
  try {
    const requested=process.env.ORDAX_LAB_E2E_TASK_ID || null;
    fixture=db.prepare(`SELECT t.id FROM tasks t WHERE t.chat_url IS NOT NULL
      AND (? IS NULL OR t.id=?)
      AND EXISTS (SELECT 1 FROM runs r WHERE r.task_id=t.id AND r.status='succeeded')
      AND EXISTS (SELECT 1 FROM messages m WHERE m.task_id=t.id
        AND m.role='user' AND m.content LIKE '%ORDAX_%')
      ORDER BY t.updated_at DESC LIMIT 1`).get(requested,requested);
  } finally {db.close();}
  if(!fixture)throw new Error('lab_e2e_existing_verified_fixture_missing');
  const target=await waitForLabUiTarget();
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  const pending=new Map();let next=0;
  ws.onmessage=e=>{const msg=JSON.parse(e.data),wait=pending.get(msg.id);
    if(wait){pending.delete(msg.id);msg.error?wait.reject(Error(msg.error.message)):wait.resolve(msg.result);}};
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  const call=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++next;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('lab_e2e_app_observation_timeout'));},8000);
    pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});
    ws.send(JSON.stringify({id,method,params}));
  });
  const evaluate=async expression=>{
    const reply=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(reply.exceptionDetails)throw Error('lab_e2e_app_evaluation_failed');
    return reply.result.value;
  };
  try {
    await waitForLabAppMode(evaluate);
    const id=fixture.id;
    // Selection uses the first-party OrdaX UI; the worker remains hidden.
    let selected=false;
    for(let i=0;i<100;i++){
      selected=await evaluate(`(()=>{const b=[...document.querySelectorAll('.task[data-id]')]
        .find(n=>n.dataset.id===${JSON.stringify(id)});if(!b)return false;b.click();return true})()`);
      if(selected)break;
      await sleep(100);
    }
    if(!selected)throw Error('lab_e2e_fixture_task_not_in_app_navigation');
    let ready=false;
    for(let i=0;i<150;i++){
      ready=await evaluate(`(()=>document.querySelector('#taskId')?.textContent===${JSON.stringify(id)} &&
        !document.querySelector('#inspectLinkedThread')?.disabled)()`);
      if(ready)break;
      await sleep(100);
    }
    if(!ready)throw Error('lab_e2e_readonly_thread_action_not_ready');
    await evaluate(`(()=>{document.querySelector('#inspectLinkedThread').click();return true})()`);
    let diagnosis=null;
    for(let i=0;i<600;i++){
      diagnosis=await evaluate("(()=>{const s=document.querySelector('#linkedThreadStatus');return {state:s?.dataset.state||'unknown',kind:s?.dataset.kind||'unavailable',reason:s?.dataset.reason||'unknown',attributable:s?.dataset.threadRendered==='true'}})()");
      if(diagnosis.state==='complete'||diagnosis.state==='error')break;
      await sleep(100);
    }
    if(diagnosis?.state!=='complete'&&diagnosis?.state!=='error')
      throw Error('lab_e2e_readonly_inspection_not_settled');
    await waitForLabAppMode(evaluate);
    // W3 is defined by the IPC attribution contract, not by translated text
    // or the mere presence of a provider page.
    const certified=diagnosis.state==='complete' &&
      diagnosis.kind==='response_candidate' &&
      diagnosis.reason==='thread_rendered' && diagnosis.attributable===true;
    const result={schema:'ordax.lab.linked-thread-app-e2e.v1',appMode:true,
      fixtureFound:true,readOnly:true,providerMessagesSent:0,
      inspectionState:diagnosis.state,observationKind:diagnosis.kind,
      observationReason:diagnosis.reason,threadRendered:certified,
      inconclusive:!certified};
    console.log(JSON.stringify(result));
    if(!result.threadRendered)process.exitCode=2;
  } finally {ws.close();}
})().catch(error=>{console.error('lab_e2e_linked_thread_failed:',String(error.message||error));process.exitCode=1;});
