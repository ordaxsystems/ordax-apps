(() => {
  if (window.ordax || location.protocol !== 'http:' || location.hostname !== '127.0.0.1') return;
  const listeners=new Map();
  const confirmationQueue=[];
  let eventSource=null;
  let activeConfirmation=null;
  const notice=document.getElementById('hostBrowserSessionNotice');
  const title=document.getElementById('hostBrowserSessionTitle');
  const message=document.getElementById('hostBrowserSessionMessage');
  const hostControls=document.getElementById('hostBrowserControls');
  const shutdownButton=document.getElementById('hostBrowserShutdown');
  const shutdownStatus=document.getElementById('hostBrowserShutdownStatus');

  function setSessionState(ready,errorCode='') {
    document.documentElement.dataset.ordaxHostSession=ready?'ready':'rejected';
    if(!notice)return;
    notice.hidden=ready;
    if(hostControls)hostControls.hidden=!ready;
    if(ready)return;
    const copies={
      host_session_limit:['O host local atingiu o limite de sessões','Feche abas antigas ou reinicie o host local do OrdaX.'],
      host_session_required:['A sessão local expirou','Reinicie o host do OrdaX e abra o novo link local gerado pelo processo.'],
      default:['Não foi possível validar a sessão local','Abra o link local gerado pelo processo OrdaX. O acesso só aceita a sessão deste host e navegador.']
    };
    const copy=copies[errorCode]||copies.default;
    if(title)title.textContent=copy[0];
    if(message)message.textContent=copy[1];
  }

  const ready=(async()=>{
    try {
      const response=await fetch('/api/session',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw Object.assign(new Error(data.error||'host_session_unavailable'),{code:data.error||'host_session_unavailable'});
      setSessionState(true);
      return true;
    } catch(error) {
      setSessionState(false,error.code||'host_session_unavailable');
      return false;
    }
  })();

  async function invoke(method,...args) {
    if(!await ready)throw new Error('host_session_required');
    const response=await fetch('/api/invoke',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(data.error||'request_failed'),{code:data.error||'request_failed'});
    return data;
  }

  function ensureEvents() {
    if(eventSource||!listeners.size)return;
    eventSource=new EventSource('/api/events');
    for(const name of ['orchestrator-changed','run-started','task-stage','task-stream']) {
      eventSource.addEventListener(name,event=>{
        let payload;try{payload=JSON.parse(event.data);}catch{return;}
        for(const callback of listeners.get(name)||[])callback(payload);
      });
    }
    eventSource.addEventListener('confirm',event=>{
      let request;try{request=JSON.parse(event.data);}catch{return;}
      confirmationQueue.push(request);showNextConfirmation();
    });
  }
  function showNextConfirmation() {
    if(activeConfirmation||!confirmationQueue.length)return;
    const dialog=document.getElementById('hostBrowserConfirmation');
    activeConfirmation=confirmationQueue.shift();
    if(!dialog){void resolveConfirmation(false);return;}
    document.getElementById('hostBrowserConfirmationTitle').textContent=activeConfirmation.title||'Confirmar ação';
    document.getElementById('hostBrowserConfirmationMessage').textContent=activeConfirmation.message||'';
    document.getElementById('hostBrowserConfirmationDetail').textContent=activeConfirmation.detail||'';
    document.getElementById('hostBrowserConfirmationApprove').textContent=activeConfirmation.approveLabel||'Confirmar';
    document.getElementById('hostBrowserConfirmationCancel').textContent=activeConfirmation.cancelLabel||'Cancelar';
    dialog.dataset.confirmationId=String(activeConfirmation.id||'');
    if(!dialog.open)dialog.showModal();
  }
  async function resolveConfirmation(approved) {
    const request=activeConfirmation;
    if(!request)return;
    activeConfirmation=null;
    const dialog=document.getElementById('hostBrowserConfirmation');
    if(dialog?.open)dialog.close();
    if(dialog)delete dialog.dataset.confirmationId;
    if(await ready)await fetch('/api/confirmation',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:request.id,approved})}).catch(()=>{});
    showNextConfirmation();
  }
  function subscribe(name,callback) {
    if(typeof callback!=='function')throw new TypeError('event_callback_required');
    let set=listeners.get(name);if(!set)listeners.set(name,set=new Set());set.add(callback);
    void ready.then(()=>ensureEvents());
    return ()=>{set.delete(callback);if(!set.size)listeners.delete(name);if(!listeners.size&&eventSource){eventSource.close();eventSource=null;}};
  }

  const api={};
  const methods={
    coordinatorChatStatus:[],coordinatorChatEnable:['enabled'],orchestratorInvoke:['operation','input'],orchestratorMcp:['message'],
    supervisorStatus:[],supervisorSaveKey:['key'],supervisorRemoveKey:[],setTaskSupervisorRole:['taskId','role'],
    supervisorPlan:['payload'],supervisorRecoverable:['payload'],supervisorInspect:['payload'],supervisorApprove:['payload'],supervisorDispatch:['payload'],
    workspace:[],listTasks:[],createTask:['title'],getTask:['id'],getTaskDraft:['id'],openTask:['id'],inspectLinkedThread:['taskId'],loadMessagePage:['taskId','before'],
    renameTask:['taskId','title'],setDraft:['taskId','content','revision'],resumeCapsule:['id'],rotateConversation:['id'],
    upsertProjectMemory:['taskId','item'],archiveProjectMemory:['taskId','memoryId'],scanMemoryCandidates:['taskId'],
    reviewMemoryCandidate:['taskId','candidateId','action','changes'],send:['payload'],labProfileProof:[],labBuildProof:[],providerStatus:[],
    providerDiagnostic:[],getObserverMode:[],setObserverMode:['mode'],login:[],home:[],reload:[],setChatVisible:['visible']
  };
  for(const [name,parameters] of Object.entries(methods))api[name]=(...args)=>invoke(name,...parameters.map((_,index)=>args[index]));
  api.onOrchestratorChanged=callback=>subscribe('orchestrator-changed',callback);
  api.onRunStarted=callback=>subscribe('run-started',callback);
  api.onTaskStage=callback=>subscribe('task-stage',callback);
  api.onTaskStream=callback=>subscribe('task-stream',callback);
  Object.defineProperty(window,'ordax',{value:api,configurable:false,writable:false});
  Object.defineProperty(window,'ordaxHost',{value:Object.freeze({ready,hostMode:true}),configurable:false,writable:false});
  document.documentElement.dataset.ordaxHostUi='true';
  document.getElementById('hostBrowserConfirmationApprove')?.addEventListener('click',event=>{
    event.preventDefault();const dialog=document.getElementById('hostBrowserConfirmation');
    if(dialog?.dataset.confirmationId)void resolveConfirmation(true);
  });
  document.getElementById('hostBrowserConfirmationCancel')?.addEventListener('click',event=>{
    event.preventDefault();const dialog=document.getElementById('hostBrowserConfirmation');
    if(dialog?.dataset.confirmationId)void resolveConfirmation(false);
  });
  document.getElementById('hostBrowserConfirmation')?.addEventListener('cancel',event=>{
    event.preventDefault();const dialog=event.currentTarget;
    if(dialog.dataset.confirmationId)void resolveConfirmation(false);
  });
  shutdownButton?.addEventListener('click',async()=>{
    shutdownButton.disabled=true;
    if(shutdownStatus)shutdownStatus.textContent='Encerrando o processo do OrdaX…';
    try {
      if(!await ready)throw new Error('host_session_required');
      const response=await fetch('/api/shutdown',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});
      if(!response.ok)throw new Error('shutdown_rejected');
      if(shutdownStatus)shutdownStatus.textContent='Solicitação recebida. O serviço local será encerrado.';
    } catch {
      shutdownButton.disabled=false;
      if(shutdownStatus)shutdownStatus.textContent='Não foi possível encerrar o serviço. Tente novamente.';
    }
  });
})();
