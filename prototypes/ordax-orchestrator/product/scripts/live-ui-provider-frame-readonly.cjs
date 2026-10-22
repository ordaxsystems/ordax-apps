// Read-only diagnostics for the existing ChatGPT provider renderer of staged OrdaX Lab.
// Provider CDP is diagnostic only; only actual OrdaX App UI tests count as certification.
const {acquireE2ELock}=require('./e2e-lock.cjs');
const {DEBUG_PORT,readLabDebugTargets,waitForLabUiTarget}=require('./e2e-lab-target.cjs');
acquireE2ELock('provider-frame-readonly');
(async()=>{
  await waitForLabUiTarget();
  const targets=await readLabDebugTargets();
  const provider=targets.find(target=>{
    if(target?.type!=='page')return false;
    try{
      const url=new URL(target.url),ws=new URL(target.webSocketDebuggerUrl);
      return url.protocol==='https:'&&url.hostname==='chatgpt.com'&&
        ws.protocol==='ws:'&&ws.hostname==='127.0.0.1'&&
        ws.port===DEBUG_PORT&&ws.pathname.startsWith('/devtools/page/');
    }catch{return false;}
  });
  if(!provider)throw new Error('lab_provider_target_not_available');
  const ws=new WebSocket(provider.webSocketDebuggerUrl);
  let timer;
  try {
    await new Promise((resolve,reject)=>{
      ws.onopen=resolve;ws.onerror=()=>reject(new Error('lab_provider_cdp_unavailable'));
    });
    const expression="(()=>({"+
      "readyState:['loading','interactive','complete'].includes(document.readyState)?document.readyState:'unknown',"+
      "bodyPresent:Boolean(document.body),"+
      "pageType:/^\\/c\\/[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(location.pathname)?'conversation':location.pathname==='/'?'home':'other',"+
      "mainPresent:Boolean(document.querySelector('main,[role=\"main\"]')),"+
      "composerPresent:Boolean(document.querySelector('#prompt-textarea,[contenteditable=\"true\"][role=\"textbox\"]')),"+
      "userNodeCount:Math.min(1000,document.querySelectorAll('[data-message-author-role=\"user\"],[data-message-role=\"user\"],[data-message-author=\"user\"]').length),"+
      "assistantNodeCount:Math.min(1000,document.querySelectorAll('[data-message-author-role=\"assistant\"],[data-message-role=\"assistant\"],[data-message-author=\"assistant\"]').length),"+
      "conversationTurnStructuralCount:Math.min(1000,document.querySelectorAll('[data-testid=\"conversation-turn\"],[data-chatgpt-selection-message-id],[data-message-id]').length),"+
      "backendApiFailureCounts:(()=>{const c={s401:0,s403:0,s404:0,s429:0,s5xx:0};for(const e of performance.getEntriesByType('resource')){try{const u=new URL(e.name);if(u.origin!==location.origin||!u.pathname.startsWith('/backend-api/'))continue;const s=e.responseStatus;if(s===401)c.s401++;else if(s===403)c.s403++;else if(s===404)c.s404++;else if(s===429)c.s429++;else if(s>=500&&s<=599)c.s5xx++;}catch{}}for(const k of Object.keys(c))c[k]=Math.min(1000,c[k]);return c;})()"+
    "}))()";
    const result=await Promise.race([
      new Promise((resolve,reject)=>{
        ws.onmessage=event=>{
          let parsed;
          try{parsed=JSON.parse(event.data);}catch{return reject(new Error('lab_provider_cdp_malformed'));}
          if(parsed.id!==1)return;
          if(parsed.error||parsed.result?.exceptionDetails)
            return reject(new Error('lab_provider_renderer_evaluation_rejected'));
          resolve(parsed.result?.result?.value);
        };
        ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',
          params:{expression,returnByValue:true,awaitPromise:false}}));
      }),
      new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(new Error('lab_provider_renderer_observation_timeout')),5000);
      })
    ]);
    if(!result||typeof result.bodyPresent!=='boolean')
      throw new Error('lab_provider_renderer_invalid_observation');
    console.log(JSON.stringify({schema:'ordax.lab.provider-frame-readonly.v1',
      inspectionOnly:true,notAppCertification:true,...result}));
  } finally {
    if(timer)clearTimeout(timer);
    ws.close();
  }
})().catch(error=>{
  const code=String(error?.message||'lab_provider_diagnostic_unavailable');
  const allow=new Set(['lab_provider_target_not_available','lab_provider_cdp_unavailable',
    'lab_provider_cdp_malformed','lab_provider_renderer_evaluation_rejected',
    'lab_provider_renderer_observation_timeout','lab_provider_renderer_invalid_observation']);
  console.error(JSON.stringify({schema:'ordax.lab.provider-frame-readonly.v1',
    inspectionOnly:true,diagnosticError:allow.has(code)?code:'lab_provider_diagnostic_unavailable'}));
  process.exitCode=1;
});
