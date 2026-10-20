// Explicit operator-only, read-only P5 gate for packaged and staged builds.
// Never types, sends, navigates, authenticates, or exports conversation content.
const {acquireE2ELock}=require('./e2e-lock.cjs');
const {waitForLabUiTarget}=require('./e2e-lab-target.cjs');
acquireE2ELock('ui-readiness');
(async()=>{
  const started=Date.now();
  const tab=await waitForLabUiTarget();
  const ws=new WebSocket(tab.webSocketDebuggerUrl);
  try{
    await new Promise((resolve,reject)=>{
      ws.onopen=resolve;
      ws.onerror=()=>reject(new Error('lab_cdp_socket_not_ready'));
    });
    let seq=0;
    const expression=`(async()=>{
      const status=await window.ordax.providerStatus();
      const diagnostic=await window.ordax.providerDiagnostic();
      return {
        authState:String(status?.auth_state||'unknown'),
        composerReady:status?.composer_ready===true,
        verificationRequired:status?.verification_required===true,
        backendApi403Observed:status?.provider_access_problem==='backend_http_403_observed',
        backendApi403Count:Math.max(0,Math.min(100,Number(status?.backend_api_403_count)||0)),
        diagnosticSchema:String(diagnostic?.schema||'unknown'),
        pageType:String(diagnostic?.pageType||'unknown'),
        authenticated:String(diagnostic?.authenticated||'not_verified'),
        delivery:String(diagnostic?.delivery||'not_evaluated')
      };
    })()`;
    let deadlineTimer;
    let data;
    try {
      data=await Promise.race([
      new Promise((resolve,reject)=>{
        const id=++seq;
        ws.onmessage=event=>{
          let message;
          try{message=JSON.parse(event.data);}catch{return reject(new Error('lab_cdp_invalid_response'));}
          if(message.id!==id)return;
          if(message.error||message.result?.exceptionDetails)return reject(new Error('lab_cdp_status_read_failed'));
          resolve(message.result?.result?.value);
        };
        ws.send(JSON.stringify({id,method:'Runtime.evaluate',
          params:{expression,awaitPromise:true,returnByValue:true}}));
      }),
      new Promise((_,reject)=>{ deadlineTimer=setTimeout(()=>reject(new Error('lab_cdp_read_timeout')),25000); })
      ]);
    } finally {
      if(deadlineTimer)clearTimeout(deadlineTimer);
    }
    if(!data||data.diagnosticSchema!=='ordax.lab.provider-dom-diagnostic.v1')
      throw new Error('lab_diagnostic_contract_missing');
    console.log(JSON.stringify({
      schema:'ordax.lab.windows-readiness.v1',
      labUiReady:true,waitMs:Date.now()-started,...data,
      // Page presence is not proof of authenticated identity or safe delivery.
      e2eAuthenticated:false,e2eDelivered:false
    }));
  } finally {ws.close();}
})().catch(error=>{
  // Error code only; no URLs, account metadata, prompts or HTML are printed.
  console.error(JSON.stringify({schema:'ordax.lab.windows-readiness.v1',
    labUiReady:false,error:String(error?.message||'readiness_failed').slice(0,100)}));
  process.exitCode=1;
});
