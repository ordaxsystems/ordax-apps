(() => {
  if (window.ordax || location.protocol !== 'http:' || location.hostname !== '127.0.0.1') return;
  const listeners=new Map();
  const confirmationQueue=[];
  let eventSource=null;
  let activeConfirmation=null;
  let confirmationResolution='idle';
  let transportState='connecting';
  const notice=document.getElementById('hostBrowserSessionNotice');
  const title=document.getElementById('hostBrowserSessionTitle');
  const message=document.getElementById('hostBrowserSessionMessage');
  const offlineNotice=document.getElementById('hostBrowserOfflineNotice');
  const offlineTitle=document.getElementById('hostBrowserOfflineTitle');
  const offlineMessage=document.getElementById('hostBrowserOfflineMessage');
  const hostControls=document.getElementById('hostBrowserControls');
  const shutdownButton=document.getElementById('hostBrowserShutdown');
  const shutdownStatus=document.getElementById('hostBrowserShutdownStatus');
  const confirmationStatus=document.getElementById('hostBrowserConfirmationStatus');
  const confirmationApprove=document.getElementById('hostBrowserConfirmationApprove');
  const confirmationCancel=document.getElementById('hostBrowserConfirmationCancel');
  const transportErrors=new Set(['host_connection_lost','host_request_outcome_unknown','host_confirmation_outcome_unknown']);

  function updateConfirmationControls() {
    const locked=transportState!=='ready'||confirmationResolution!=='idle';
    if(confirmationApprove)confirmationApprove.disabled=locked;
    if(confirmationCancel)confirmationCancel.disabled=locked;
    if(!confirmationStatus)return;
    if(!activeConfirmation) {
      confirmationStatus.hidden=true;
      confirmationStatus.textContent='';
    } else if(confirmationResolution==='unknown') {
      confirmationStatus.hidden=false;
      confirmationStatus.textContent='Não foi possível confirmar se a decisão chegou ao Host. Esta confirmação está bloqueada para evitar uma decisão duplicada; confira o estado da ação antes de continuar.';
    } else if(confirmationResolution==='expired') {
      confirmationStatus.hidden=false;
      confirmationStatus.textContent='Esta confirmação expirou ou deixou de estar pendente no Host. O OrdaX não repetirá a decisão.';
    } else if(transportState!=='ready') {
      confirmationStatus.hidden=false;
      confirmationStatus.textContent='Host desconectado. A confirmação continua pendente; os botões serão liberados quando a conexão voltar.';
    } else {
      confirmationStatus.hidden=true;
      confirmationStatus.textContent='';
    }
  }

  function setSessionState(ready,errorCode='') {
    transportState=ready?'ready':'offline';
    updateConfirmationControls();
    document.documentElement.dataset.ordaxHostSession=ready?'ready':
      transportErrors.has(errorCode)?'offline':'rejected';
    if(offlineNotice)offlineNotice.hidden=true;
    if(ready) {
      if(notice)notice.hidden=true;
      if(hostControls)hostControls.hidden=false;
      const summary=document.getElementById('hostBrowserStatusSummary');
      if(summary)summary.textContent='Host local ativo';
      return;
    }
    if(transportErrors.has(errorCode)) {
      if(notice)notice.hidden=true;
      if(hostControls)hostControls.hidden=true;
      const summary=document.getElementById('hostBrowserStatusSummary');
      if(summary)summary.textContent='Host local desconectado';
      const copies={
        host_connection_lost:['Host local desconectado','Esta aba pode mostrar dados desatualizados. As ações estão bloqueadas até a conexão voltar. Se uma solicitação falhou durante o envio, confira o histórico antes de repeti-la.'],
        host_request_outcome_unknown:['Resultado da solicitação incerto','A conexão caiu durante uma solicitação. O Host pode tê-la recebido; não repita até conferir o histórico/recibo. Reabra o endereço emitido pelo processo ativo.'],
        host_confirmation_outcome_unknown:['Confirmação não confirmada','A conexão caiu ao registrar uma decisão de confirmação. O processo pode tê-la recebido; a ação está bloqueada nesta aba para evitar duplicidade. Confira o estado no app antes de continuar.']
      };
      const copy=copies[errorCode]||copies.host_connection_lost;
      if(offlineTitle)offlineTitle.textContent=copy[0];
      if(offlineMessage)offlineMessage.textContent=copy[1];
      if(offlineNotice)offlineNotice.hidden=false;
      return;
    }
    if(!notice)return;
    notice.hidden=false;
    if(hostControls)hostControls.hidden=true;
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
    if(transportState!=='ready')throw Object.assign(new Error('host_transport_offline'),{code:'host_transport_offline',transportOutcome:'not_submitted'});
    let response;
    try {
      response=await fetch('/api/invoke',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})});
    } catch {
      setSessionState(false,'host_request_outcome_unknown');
      throw Object.assign(new Error('host_request_outcome_unknown'),{code:'host_request_outcome_unknown',transportOutcome:'unknown'});
    }
    const data=await response.json().catch(()=>({}));
    if(response.status===401) {
      setSessionState(false,'host_session_required');
      throw Object.assign(new Error('host_session_required'),{code:'host_session_required',transportOutcome:'not_submitted'});
    }
    if(!response.ok)throw Object.assign(new Error(data.error||'request_failed'),{code:data.error||'request_failed'});
    return data;
  }

  function ensureEvents() {
    if(eventSource||!listeners.size)return;
    eventSource=new EventSource('/api/events');
    eventSource.addEventListener('open',()=>setSessionState(true));
    eventSource.addEventListener('error',()=>setSessionState(false,'host_connection_lost'));
    for(const name of ['orchestrator-changed','run-started','task-stage','task-stream','task-provider-navigation']) {
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
    confirmationResolution='idle';
    if(!dialog){void resolveConfirmation(false);return;}
    document.getElementById('hostBrowserConfirmationTitle').textContent=activeConfirmation.title||'Confirmar ação';
    document.getElementById('hostBrowserConfirmationMessage').textContent=activeConfirmation.message||'';
    document.getElementById('hostBrowserConfirmationDetail').textContent=activeConfirmation.detail||'';
    document.getElementById('hostBrowserConfirmationApprove').textContent=activeConfirmation.approveLabel||'Confirmar';
    document.getElementById('hostBrowserConfirmationCancel').textContent=activeConfirmation.cancelLabel||'Cancelar';
    dialog.dataset.confirmationId=String(activeConfirmation.id||'');
    if(!dialog.open)dialog.showModal();
    updateConfirmationControls();
  }
  async function resolveConfirmation(approved) {
    const request=activeConfirmation;
    if(!request||confirmationResolution!=='idle')return;
    if(!await ready||transportState!=='ready') {
      updateConfirmationControls();
      return;
    }
    confirmationResolution='submitting';
    updateConfirmationControls();
    try {
      const response=await fetch('/api/confirmation',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({id:request.id,approved})});
      if(response.status===401) {
        confirmationResolution='expired';
        setSessionState(false,'host_session_required');
        updateConfirmationControls();
        return;
      }
      if(response.status===409) {
        confirmationResolution='expired';
        updateConfirmationControls();
        return;
      }
      if(!response.ok)throw new Error('confirmation_response_unknown');
      activeConfirmation=null;
      confirmationResolution='idle';
      const dialog=document.getElementById('hostBrowserConfirmation');
      if(dialog?.open)dialog.close();
      if(dialog)delete dialog.dataset.confirmationId;
      updateConfirmationControls();
      showNextConfirmation();
    } catch {
      confirmationResolution='unknown';
      setSessionState(false,'host_confirmation_outcome_unknown');
      updateConfirmationControls();
    }
  }
  function subscribe(name,callback) {
    if(typeof callback!=='function')throw new TypeError('event_callback_required');
    let set=listeners.get(name);if(!set)listeners.set(name,set=new Set());set.add(callback);
    void ready.then(()=>ensureEvents());
    return ()=>{set.delete(callback);if(!set.size)listeners.delete(name);if(!listeners.size&&eventSource){eventSource.close();eventSource=null;}};
  }

  const api={};
  const methods={
    coordinatorChatStatus:[],coordinatorChatEnable:['enabled'],chatgptPlanStatus:[],chatgptPlanDisconnect:[],
    orchestratorInvoke:['operation','input'],orchestratorMcp:['message'],
    supervisorStatus:[],supervisorSaveKey:['key'],supervisorRemoveKey:[],setTaskSupervisorRole:['taskId','role'],
    supervisorPlan:['payload'],supervisorRecoverable:['payload'],supervisorInspect:['payload'],supervisorApprove:['payload'],supervisorDispatch:['payload'],
    workspace:[],setWorkspaceNavigation:['navigation'],listTasks:[],createTask:['title'],getTask:['id'],getTaskDraft:['id'],openTask:['id'],inspectLinkedThread:['taskId'],loadMessagePage:['taskId','before'],
    renameTask:['taskId','title'],setDraft:['taskId','content','revision'],resumeCapsule:['id'],rotateConversation:['id'],
    upsertProjectMemory:['taskId','item'],archiveProjectMemory:['taskId','memoryId'],scanMemoryCandidates:['taskId'],
    reviewMemoryCandidate:['taskId','candidateId','action','changes'],send:['payload'],labProfileProof:[],labBuildProof:[],providerStatus:[],
    providerDiagnostic:[],getObserverMode:[],setObserverMode:['mode'],login:[],home:[],reload:[],setChatVisible:['visible']
  };
  for(const [name,parameters] of Object.entries(methods))api[name]=(...args)=>invoke(name,...parameters.map((_,index)=>args[index]));
  api.chatgptPlanLogin=async()=>{
    const result=await invoke('chatgptPlanLogin');
    let authorization;
    try {authorization=new URL(result?.authorizationUrl);} catch {throw Object.assign(new Error('chatgpt_authorization_url_invalid'),{code:'chatgpt_authorization_url_invalid'});}
    if(authorization.protocol!=='https:'||authorization.hostname!=='auth.openai.com'||
      authorization.pathname!=='/api/accounts/authorize')
      throw Object.assign(new Error('chatgpt_authorization_url_invalid'),{code:'chatgpt_authorization_url_invalid'});
    location.assign(authorization.href);
    return {opening:true};
  };
  api.onOrchestratorChanged=callback=>subscribe('orchestrator-changed',callback);
  api.onRunStarted=callback=>subscribe('run-started',callback);
  api.onTaskStage=callback=>subscribe('task-stage',callback);
  api.onTaskStream=callback=>subscribe('task-stream',callback);
  api.onTaskProviderNavigation=callback=>subscribe('task-provider-navigation',callback);
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
      setSessionState(false,'host_request_outcome_unknown');
      shutdownButton.disabled=false;
      if(shutdownStatus)shutdownStatus.textContent='Resultado do encerramento incerto. Verifique se o serviço continua ativo antes de tentar novamente.';
    }
  });
})();
