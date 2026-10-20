// OrdaX App renderer-only availability. Transport remains protected by
// assertProviderSendReadiness() in the Electron main process AND worker.
// An editable local draft is NOT permission to submit to ChatGPT.
export function providerComposeAvailability(status) {
  const base={allowed:false,reason:'unverified'};
  if(!status || typeof status!=='object')return base;
  if(status.active===true)return {allowed:false,reason:'busy'};
  if(status.health_pending===true)return {allowed:false,reason:'checking'};
  if(status.verification_required===true)return {allowed:false,reason:'verification'};
  if(status.provider_access_problem==='backend_http_429_observed')return {allowed:false,reason:'rate_limited'};
  if(status.provider_access_problem==='backend_http_403_observed')return {allowed:false,reason:'access_restricted'};
  if(status.auth_state==='anonymous')return {allowed:false,reason:'login_required'};
  if(status.auth_state==='authenticating')return {allowed:false,reason:'authenticating'};
  if(status.auth_state==='session_present' &&
    status.composer_ready===true && status.health_observed===true)
    return {allowed:true,reason:'ready'};
  return base;
}

export const COMPOSE_STATUS_MESSAGES=Object.freeze({
  ready:'Sessão detectada • envio disponível. A identidade não é verificada pelo Lab.',
  busy:'ChatGPT está processando uma solicitação. Aguarde a conclusão.',
  checking:'Verificando a sessão do ChatGPT. O texto pode ser salvo como rascunho.',
  verification:'Verificação necessária no ChatGPT. O rascunho local será preservado.',
  rate_limited:'Limitação HTTP 429 observada. Envio bloqueado, sem novas tentativas automáticas.',
  access_restricted:'Acesso HTTP 403 observado. Confira a sessão oficial, sem reenvio automático.',
  login_required:'Entre no ChatGPT para habilitar o envio. Você pode escrever e salvar um rascunho local.',
  authenticating:'Conclua o login na página oficial. O rascunho permanece no OrdaX.',
  unverified:'Sessão do ChatGPT não confirmada. Envio bloqueado; o rascunho é local.'
});
