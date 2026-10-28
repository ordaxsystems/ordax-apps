// The login CTA must match the observed provider state. Showing "Entrar" for
// a ready session is misleading and can unnecessarily navigate away from work.
export function resolveProviderLoginAction(status,{hostMode=false}={}) {
  if(hostMode) return {mode:'hidden',hidden:true,label:'Entrar no ChatGPT'};

  const busy=status?.active===true||status?.response_generation_active===true;
  if(busy) return {mode:'hidden',hidden:true,label:'ChatGPT em andamento'};

  const sessionReady=status?.auth_state==='session_present'&&
    status?.composer_ready===true&&
    status?.verification_required!==true;
  if(sessionReady) return {mode:'hidden',hidden:true,label:'ChatGPT conectado'};

  if(status?.auth_state==='anonymous')
    return {mode:'login',hidden:false,label:'Entrar no ChatGPT'};
  if(status?.auth_state==='authenticating')
    return {mode:'open',hidden:false,label:'Continuar no ChatGPT'};
  return {mode:'open',hidden:false,label:'Abrir ChatGPT'};
}
