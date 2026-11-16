// OrdaX App renderer-only availability. Transport remains protected by
// assertProviderSendReadiness() in the Electron main process AND worker.
// An editable local draft is NOT permission to submit to ChatGPT.
export function providerComposeAvailability(status,{hostMode=false}={}) {
  if(hostMode===true)return {allowed:false,reason:'host_auth_unavailable'};
  const base={allowed:false,reason:'unverified'};
  if(!status || typeof status!=='object')return base;
  if(status.active===true)return {allowed:false,reason:'busy'};
  if(status.health_pending===true)return {allowed:false,reason:'checking'};
  if(status.response_generation_active===true)return {allowed:false,reason:'busy'};
  if(status.provider_response_failure==='chatgpt_response_retry_required')
    return {allowed:false,reason:'response_retry_required'};
  if(status.provider_response_failure==='chatgpt_response_error_observed')
    return {allowed:false,reason:'response_error'};
  if(status.verification_required===true)return {allowed:false,reason:'verification'};
  if(status.provider_access_problem==='backend_http_429_observed')return {allowed:false,reason:'rate_limited'};
  if(status.provider_access_problem==='backend_http_403_observed')return {allowed:false,reason:'access_restricted'};
  if(status.auth_state==='anonymous')return {allowed:false,reason:'login_required'};
  if(status.auth_state==='authenticating')return {allowed:false,reason:'authenticating'};
  if(status.page_state==='conversation_load_failed')return {allowed:false,reason:'conversation_unavailable'};
  if(status.auth_state==='session_present' &&
    status.composer_ready===true && status.health_observed===true)
    return {allowed:true,reason:'ready'};
  return base;
}

// Read-only status for Forge MCP clients. A working App transport is not a
// logged-in ChatGPT session. Never export cookies, account info or page text.
export function providerSessionReport(health){
  if(Array.isArray(health)){
    // Each worker owns an independent ChatGPT DOM even with one shared
    // persistent Electron partition. One ready primary lane cannot certify
    // the other lanes or authorize a parallel agent launch.
    const workers=health.map((lane,index)=>{
      const report=providerSessionReport(lane);
      return Object.freeze({
        id:/^[A-Za-z0-9_-]{1,80}$/.test(lane?.id||'')?lane.id:'unknown-'+index,
        authState:report.authState,
        sendReady:report.sendReady,
        reason:report.reason
      });
    });
    const readyWorkers=workers.filter(w=>w.sendReady).length;
    const allReady=workers.length>0&&readyWorkers===workers.length;
    const loginRequired=workers.some(w=>w.reason==='login_required');
    const reason=allReady?'ready':loginRequired?'login_required':
      (workers.find(w=>!w.sendReady)?.reason||'unverified');
    const seen=new Set(workers.map(w=>w.authState));
    return Object.freeze({
      schema:'ordax.forge.provider-session/1',
      authState:allReady?'session_present':seen.size>1?'mixed':
        (seen.values().next().value||'unknown'),
      healthObserved:allReady,
      composerReady:allReady,
      sendReady:allReady,
      reason,loginRequired,identityVerified:false,
      readyWorkers,totalWorkers:workers.length,workers:Object.freeze(workers)
    });
  }
  const availability=providerComposeAvailability(health);
  const authState=['session_present','anonymous','authenticating'].includes(health?.auth_state)
    ?health.auth_state:'unknown';
  return Object.freeze({
    schema:'ordax.forge.provider-session/1',
    authState,
    healthObserved:health?.health_observed===true,
    composerReady:health?.composer_ready===true,
    sendReady:availability.allowed===true,
    reason:availability.reason,
    loginRequired:availability.reason==='login_required',
    identityVerified:false
  });
}

export function canStartFreshProviderChat({task,status,availability,activeRun=false,hostMode=false}={}) {
  if(hostMode || activeRun || !task?.chat_url || !status || typeof status!=='object')return false;
  const sessionObserved=status.auth_state==='session_present'&&status.health_observed===true&&
    status.verification_required!==true&&status.active!==true&&status.response_generation_active!==true&&
    !['backend_http_403_observed','backend_http_429_observed'].includes(status.provider_access_problem);
  if(!sessionObserved)return false;
  const providerReady=availability?.allowed===true&&availability.reason==='ready';
  const unavailableConversation=availability?.reason==='conversation_unavailable'&&
    status.page_state==='conversation_load_failed';
  if(!providerReady&&!unavailableConversation)return false;
  if(task.status==='running'||task.status==='interrupted')return false;
  const run=task.latest_run;
  if(run&&run.status!=='succeeded'&&!(run.status==='failed'&&
    run.provider_delivery_state==='not_submitted'&&run.submit_attempt_observed!==true))return false;
  return true;
}

export const COMPOSE_STATUS_MESSAGES=Object.freeze({
  host_auth_unavailable:'Este Host não tem transporte suportado para o ChatGPT Web. Entrar em outra aba não conecta a sessão; o rascunho fica local e o envio está bloqueado.',
  ready:'Sessão detectada • envio disponível. A identidade não é verificada pelo Lab.',
  busy:'ChatGPT está processando uma solicitação. Aguarde a conclusão.',
  response_retry_required:'O ChatGPT exibiu “Tente novamente”. A resposta não foi concluída. Confira o painel antes de continuar; nenhuma mensagem será reenviada automaticamente.',
  response_error:'O ChatGPT exibiu um erro de resposta. Confira o painel e o histórico da tarefa antes de continuar; nenhuma mensagem será reenviada automaticamente.',
  conversation_unavailable:'A conversa do ChatGPT não carregou. Envio bloqueado e histórico local preservado; nenhum reenvio.',
  checking:'Verificando a sessão do ChatGPT. O texto pode ser salvo como rascunho.',
  verification:'Verificação necessária no ChatGPT. O rascunho local será preservado.',
  rate_limited:'Limitação HTTP 429 observada. Envio bloqueado, sem novas tentativas automáticas.',
  access_restricted:'Acesso HTTP 403 observado. Confira a sessão oficial, sem reenvio automático.',
  login_required:'Entre no ChatGPT para habilitar o envio. Você pode escrever e salvar um rascunho local.',
  authenticating:'Conclua o login na página oficial. O rascunho permanece no OrdaX.',
  unverified:'Sessão do ChatGPT não confirmada. Envio bloqueado; o rascunho é local.'
});
