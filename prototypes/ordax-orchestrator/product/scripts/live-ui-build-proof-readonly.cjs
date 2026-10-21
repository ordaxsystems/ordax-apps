// Read-only runtime identity from the real OrdaX App via trusted IPC.
// Never types, navigates, sends prompts, authenticates or restores data.
const {waitForLabUiTarget,waitForLabAppMode}=require('./e2e-lab-target.cjs');
const {acquireE2ELock}=require('./e2e-lock.cjs');
acquireE2ELock('runtime-build-proof');
(async()=>{
 const expectedCommit=process.env.ORDAX_LAB_E2E_EXPECTED_COMMIT;
 const expectedDigest=process.env.ORDAX_LAB_E2E_EXPECTED_DIGEST;
 if(!/^[a-f0-9]{40}$/.test(expectedCommit||'') ||
    !/^[a-f0-9]{64}$/.test(expectedDigest||''))
   throw Error('lab_build_expected_identity_required');
 const tab=await waitForLabUiTarget();
 const ws=new WebSocket(tab.webSocketDebuggerUrl);
 try{
  await new Promise((resolve,reject)=>{
   ws.onopen=resolve;ws.onerror=()=>reject(Error('lab_build_socket_not_ready'));
  });
  const evaluate=expression=>new Promise((resolve,reject)=>{
    let timer;
    Promise.race([
    new Promise((resolve,reject)=>{
      ws.onmessage=event=>{
       let msg;
       try{msg=JSON.parse(event.data)}catch{return reject(Error('lab_build_invalid_response'))}
       if(msg.id!==1)return;
       if(msg.error||msg.result?.exceptionDetails)
         return reject(Error('lab_build_ipc_rejected'));
       resolve(msg.result?.result?.value);
      };
      ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',
        params:{expression,awaitPromise:true,returnByValue:true}}));
    }),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('lab_build_read_timeout')),20000)})
    ]).then(resolve,reject).finally(()=>clearTimeout(timer));
  });
  await waitForLabAppMode(evaluate); // Real App shell + exact staged profile.
  const proof=await evaluate('window.ordax.labBuildProof()');
  if(proof?.schema!=='ordax.lab.runtime-build.v1' || proof?.verified!==true ||
    proof?.status!=='verified'||proof.sourceCommit!==expectedCommit||
    proof.contentDigest!==expectedDigest)
    throw Error('lab_build_runtime_identity_mismatch');
  let preparationUiVerified=false;
  if(process.env.ORDAX_LAB_E2E_VERIFY_MVP_PREPARATION==='1'){
    // Read-only App DOM and trusted STATUS IPC; no role selection, key write,
    // provider navigation, planning, or dispatch.
    const ui=await evaluate(`(async()=>{const r=document.querySelector('#labSupervisorRole');const k=document.querySelector('#labSupervisorKeyInput');const s=await window.ordax.supervisorStatus();return {options:r?[...r.options].map(o=>o.value):[],keyType:k?.type,formPresent:!!document.querySelector('#labSupervisorKeyForm'),keySavePresent:!!document.querySelector('#labSupervisorKeySave'),keyRemovePresent:!!document.querySelector('#labSupervisorKeyRemove'),objectivePresent:!!document.querySelector('#labSupervisorObjective'),enabled:s?.enabled,hasSavedKey:s?.keySaved,secureStorageAvailable:s?.secureStorageAvailable,exposedApiKey:Object.prototype.hasOwnProperty.call(s||{},'apiKey')}})()`);
    if(JSON.stringify(ui?.options)!==JSON.stringify(['none','math-teacher','ordax-architect']) ||
       ui.keyType!=='password' || !ui.formPresent || !ui.keySavePresent ||
       !ui.keyRemovePresent || !ui.objectivePresent ||
       ui.enabled!==false || ui.hasSavedKey!==false ||
       ui.secureStorageAvailable!==true || ui.exposedApiKey!==false)
      throw Error('lab_build_mvp_preparation_not_ready');
    preparationUiVerified=true;
  }
  console.log(JSON.stringify({schema:'ordax.lab.runtime-app-proof.v1',
    appMode:true,runtimeVerified:true,sourceCommit:proof.sourceCommit,
    contentDigest:proof.contentDigest,providerMessagesSent:0,
    ...(preparationUiVerified?{preparationUiVerified:true,supervisorEnabled:false,keySaved:false}:{}),
    cutoverPerformed:false}));
 }finally{ws.close()}
})().catch(e=>{
 const allowed=new Set(['lab_build_expected_identity_required','lab_build_socket_not_ready',
 'lab_build_invalid_response','lab_build_ipc_rejected','lab_build_read_timeout',
 'lab_build_app_mode_required','lab_build_runtime_identity_mismatch',
 'lab_build_mvp_preparation_not_ready']);
 console.error(JSON.stringify({schema:'ordax.lab.runtime-app-proof.v1',ok:false,
  reason:allowed.has(e?.message)?e.message:'lab_build_probe_unavailable'}));
 process.exitCode=2;
});