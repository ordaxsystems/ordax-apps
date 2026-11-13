// The native Forge owns ONE application-level MCP connection.
// Project selection below is exclusively for configuring physical folders.
// Never move or persist tunnel credentials through project UI state.
const localMcpElement=id=>document.getElementById(id);
const APP_SCOPE='forge_app';
const mcpStart=localMcpElement('forgeLocalMcpStart');
const mcpStop=localMcpElement('forgeLocalMcpStop');
const mcpRevoke=localMcpElement('forgeLocalMcpRevoke');
const mcpResume=localMcpElement('forgeLocalMcpResume');
const workspaceProject=localMcpElement('forgeLocalMcpProject');
const mcpState=localMcpElement('forgeLocalMcpState');
const cloudflareState=localMcpElement('forgeCloudflareState');
const cloudflareInstall=localMcpElement('forgeCloudflareInstall');
const cloudflareTeam=localMcpElement('forgeCloudflareTeam');
const cloudflareAudience=localMcpElement('forgeCloudflareAudience');
const cloudflareToken=localMcpElement('forgeCloudflareToken');
const cloudflareStart=localMcpElement('forgeCloudflareStart');
const cloudflareStop=localMcpElement('forgeCloudflareStop');
const cloudflareBadge=localMcpElement('forgeCloudflareBadge');
const localMcpBadge=localMcpElement('forgeLocalMcpBadge');
const cloudflareTokenToggle=localMcpElement('forgeCloudflareTokenToggle');
const officialTunnelState=localMcpElement('forgeOfficialTunnelState');
const officialTunnelId=localMcpElement('forgeOfficialTunnelId');
const officialTunnelInstall=localMcpElement('forgeOfficialTunnelInstall');
const officialTunnelKey=localMcpElement('forgeOfficialTunnelKey');
const officialTunnelStart=localMcpElement('forgeOfficialTunnelStart');
const officialTunnelStop=localMcpElement('forgeOfficialTunnelStop');
const mcpCredentials=localMcpElement('forgeLocalMcpCredentials');
const mcpToken=localMcpElement('forgeLocalMcpToken');
const mcpUrl=localMcpElement('forgeLocalMcpUrl');
const api=window.ordax;
const usable=typeof api?.forgeLocalMcpStatus==='function'&&
  typeof api?.forgeLocalMcpStart==='function'&&
  typeof api?.forgeLocalMcpRevoke==='function'&&
  typeof api?.forgeLocalMcpResumeEnable==='function'&&
  typeof api?.forgeLocalMcpResumeDisable==='function'&&
  typeof api?.forgeLocalMcpStop==='function';
let mcpBusy=false,lastMcpStatus=null;
const appActive=status=>status?.running===true&&status?.scopes?.length===1&&
  status.scopes[0]===APP_SCOPE;
function hideSecret(){
  if(mcpToken)mcpToken.value='';
  if(mcpUrl)mcpUrl.value='';
  if(mcpCredentials)mcpCredentials.hidden=true;
}
function setState(message){if(mcpState)mcpState.textContent=message;}
function syncTunnelControls(){
  const remote=lastMcpStatus?.cloudflareTunnelSession;
  const runningCloudflare=Boolean(remote?.state&&remote.state!=='stopped');
  if(cloudflareInstall){
    const installed=lastMcpStatus?.cloudflareClientPresent===true;
    cloudflareInstall.textContent=installed?'Conector cloudflared instalado':'Instalar conector cloudflared oficial';
    cloudflareInstall.hidden=installed;
    cloudflareInstall.disabled=mcpBusy||installed||
      typeof api?.forgeCloudflareInstall!=='function';
  }
  if(cloudflareStart)cloudflareStart.disabled=mcpBusy||runningCloudflare||
    !appActive(lastMcpStatus)||!lastMcpStatus?.appTrusted||
    !lastMcpStatus?.cloudflareClientPresent||
    !cloudflareTeam?.value.trim()||!cloudflareAudience?.value.trim()||
    !cloudflareToken?.value||
    typeof api?.forgeCloudflareStart!=='function';
  if(cloudflareStop)cloudflareStop.disabled=mcpBusy||!runningCloudflare||
    remote?.state==='stopping'||typeof api?.forgeCloudflareStop!=='function';
  if(officialTunnelInstall)officialTunnelInstall.disabled=mcpBusy||
    lastMcpStatus?.officialTunnel?.installed===true||
    typeof api?.forgeOfficialTunnelInstall!=='function';
  const session=lastMcpStatus?.officialTunnelSession;
  const running=Boolean(session?.state&&session.state!=='stopped');
  if(officialTunnelStart)officialTunnelStart.disabled=mcpBusy||running||
    !appActive(lastMcpStatus)||!lastMcpStatus?.appTrusted||
    !lastMcpStatus?.officialTunnel?.installed||
    !officialTunnelId?.value?.trim()||!officialTunnelKey?.value||
    typeof api?.forgeOfficialTunnelStart!=='function';
  if(officialTunnelStop)officialTunnelStop.disabled=mcpBusy||!running||
    session?.state==='stopping'||typeof api?.forgeOfficialTunnelStop!=='function';
}
function syncControls(){
  const active=appActive(lastMcpStatus);
  const trusted=lastMcpStatus?.appTrusted===true;
  const autoResume=lastMcpStatus?.autoResumeApp===true;
  if(mcpStart){
    mcpStart.disabled=mcpBusy||!usable||active;
    mcpStart.textContent=trusted?'Reativar MCP do Forge':'Autorizar MCP do Forge';
  }
  if(mcpRevoke)mcpRevoke.disabled=mcpBusy||!usable||(!trusted&&!active);
  if(mcpResume){
    mcpResume.textContent=autoResume?'Desativar reconexão automática':'Manter conectado após reinício';
    mcpResume.disabled=mcpBusy||!usable||
      (!autoResume&&(!active||!lastMcpStatus?.autoResumeAvailable));
  }
  if(mcpStop)mcpStop.disabled=mcpBusy||!usable||!active;
  syncTunnelControls();
}
async function refreshMcp(){
  if(!usable){
    lastMcpStatus=null;
    setState('MCP disponível somente no Forge Electron local; GPT Web não conectado.');
    syncControls();return;
  }
  try{
    const status=await api.forgeLocalMcpStatus();
    lastMcpStatus=status;
    syncControls();
    if(cloudflareState){
      const remote=status.cloudflareTunnelSession;
      const phase=remote?.state??'stopped';
      cloudflareState.textContent=phase==='starting'
        ?'Abrindo o conector. A autenticação Access e a conexão GPT ainda não foram verificadas.'
        :phase==='stopping'?'Encerrando o conector e revogando o acesso local.'
        :remote?.processRunning
          ?'Conector iniciado neste Windows; isso ainda não comprova conexão ao GPT Web.'
          :status.cloudflareClientPresent
            ?'Conector instalado. Inicie o túnel protegido para permitir a conexão autorizada.'
            :'O conector oficial precisa ser instalado antes de iniciar o túnel.';
      if(cloudflareBadge){
        const active=remote?.processRunning===true;
        cloudflareBadge.textContent=phase==='starting'?'Iniciando…':
          phase==='stopping'?'Desligando…':active?'Conector iniciado':'Túnel desligado';
        cloudflareBadge.dataset.state=active?'ready':phase==='stopped'?'blocked':'waiting';
      }
    }
    if(officialTunnelState){
      const tunnel=status.officialTunnelSession;
      officialTunnelState.textContent=tunnel?.state==='starting'
        ?'Iniciando cliente oficial; conexão GPT Web ainda não verificada.'
        :tunnel?.state==='stopping'
          ?'Encerrando cliente oficial; conexão GPT Web ainda não verificada.'
          :tunnel?.processRunning&&tunnel.clientReady
            ?'Cliente oficial pronto no Windows (/readyz=200). Conexão GPT Web e chamada MCP ainda não comprovadas.'
            :tunnel?.processRunning&&tunnel.clientReadiness==='not_ready'
              ?'Cliente oficial ativo, mas ainda não pronto (/readyz=503). GPT Web não conectado.'
              :tunnel?.processRunning
                ?'Cliente oficial iniciado; prontidão /readyz ainda não verificada. GPT Web não conectado.'
                :status.officialTunnel?.installed
                  ?'Cliente oficial OpenAI '+status.officialTunnel.clientVersion+
                    ' verificado. Túnel do Forge ainda não conectado ao GPT Web.'
                  :'Cliente oficial não instalado/verificado. Use “Instalar cliente oficial do túnel”, depois configure o ID e a chave. GPT Web ainda não conectado.';
    }
    if(localMcpBadge){
      const active=appActive(status);
      localMcpBadge.textContent=active?'MCP ativo':status.appTrusted?'Autorizado · inativo':'MCP desativado';
      localMcpBadge.dataset.state=active?'ready':'blocked';
    }
    if(appActive(status)){
      setState('MCP local ativo em 127.0.0.1; arquivos restritos às pastas autorizadas. GPT Web ainda não comprovado.'+
        (status.autoResumeBlocked?' Reconexão automática bloqueada.':''));
    }else{
      hideSecret();
      setState(status.appTrusted
        ?'Autorização preservada. Reative o MCP para trabalhar nos projetos.'
        :'Autorize o MCP uma única vez para habilitar os projetos locais.');
    }
  }catch{
    lastMcpStatus=null;
    hideSecret();syncControls();
    if(officialTunnelState)officialTunnelState.textContent=
      'Estado do túnel indisponível; conexão GPT Web não comprovada.';
    setState('Não foi possível verificar o MCP do aplicativo.');
  }
}
async function loadProjects(){
  // This selector is for local workspace management only.
  try{
    const result=await api.orchestratorInvoke('projects_list',{});
    const projects=result?.projects||result?.result?.projects||[];
    if(workspaceProject){
      const previous=workspaceProject.value;
      workspaceProject.replaceChildren();
      for(const project of projects){
        if(typeof project?.id!=='string')continue;
        const option=document.createElement('option');
        option.value=project.id;
        option.textContent=(project.name||'Projeto')+' ('+project.id+')';
        workspaceProject.appendChild(option);
      }
      if([...workspaceProject.options].some(option=>option.value===previous))
        workspaceProject.value=previous;
    }
  }catch{/* The workspace selector has independent availability. */}
  await refreshMcp();
}
mcpStart?.addEventListener('click',async()=>{
  if(mcpBusy||!usable)return;
  mcpBusy=true;hideSecret();syncControls();
  try{
    const enabled=await api.forgeLocalMcpStart();
    if(enabled?.running&&enabled?.scope===APP_SCOPE&&enabled?.token&&enabled?.endpoint){
      mcpUrl.value=enabled.endpoint;
      mcpToken.value=enabled.token;
      mcpCredentials.hidden=false;
    }else if(enabled?.declined)setState('Autorização do MCP Forge cancelada.');
  }catch{setState('Não foi possível ativar o MCP do aplicativo.');}
  finally{mcpBusy=false;await refreshMcp();}
});
mcpStop?.addEventListener('click',async()=>{
  if(mcpBusy||!usable)return;
  mcpBusy=true;syncControls();
  try{await api.forgeLocalMcpStop();hideSecret();}
  catch{setState('Não foi possível confirmar o encerramento do MCP.');}
  finally{mcpBusy=false;await refreshMcp();}
});
mcpRevoke?.addEventListener('click',async()=>{
  if(mcpBusy||!usable)return;
  mcpBusy=true;syncControls();
  try{await api.forgeLocalMcpRevoke();hideSecret();}
  catch{setState('Não foi possível revogar a autorização do Forge.');}
  finally{mcpBusy=false;await refreshMcp();}
});
mcpResume?.addEventListener('click',async()=>{
  if(mcpBusy||!usable)return;
  mcpBusy=true;syncControls();
  try{
    const info=await api.forgeLocalMcpStatus();
    if(info.autoResumeApp)await api.forgeLocalMcpResumeDisable();
    else await api.forgeLocalMcpResumeEnable();
  }catch{setState('Reconexão segura não disponível neste perfil Windows.');}
  finally{mcpBusy=false;await refreshMcp();}
});
cloudflareInstall?.addEventListener('click',async()=>{
  if(mcpBusy||typeof api?.forgeCloudflareInstall!=='function')return;
  mcpBusy=true;syncControls();
  if(cloudflareState)cloudflareState.textContent='Baixando cloudflared oficial e verificando SHA-256…';
  let failed=false;
  try{const result=await api.forgeCloudflareInstall();if(result?.declined)failed=true;}
  catch{failed=true;}
  finally{
    mcpBusy=false;await refreshMcp();
    if(failed&&cloudflareState)cloudflareState.textContent=
      'Instalação do cloudflared não concluída ou não autorizada.';
  }
});
for(const input of [cloudflareTeam,cloudflareAudience,cloudflareToken])
  input?.addEventListener('input',syncTunnelControls);
cloudflareTokenToggle?.addEventListener('click',()=>{
  if(!cloudflareToken)return;
  const visible=cloudflareToken.type==='password';
  cloudflareToken.type=visible?'text':'password';
  cloudflareTokenToggle.textContent=visible?'Ocultar':'Mostrar';
  cloudflareTokenToggle.setAttribute('aria-label',visible?'Ocultar token':'Mostrar token');
  cloudflareTokenToggle.setAttribute('aria-pressed',String(visible));
});
cloudflareStart?.addEventListener('click',async()=>{
  if(mcpBusy||!appActive(lastMcpStatus)||!cloudflareToken?.value)return;
  const request={team:cloudflareTeam.value.trim(),audience:cloudflareAudience.value.trim(),
    token:cloudflareToken.value};
  cloudflareToken.value='';
  cloudflareToken.type='password';
  if(cloudflareTokenToggle){
    cloudflareTokenToggle.textContent='Mostrar';
    cloudflareTokenToggle.setAttribute('aria-pressed','false');
    cloudflareTokenToggle.setAttribute('aria-label','Mostrar token');
  }
  mcpBusy=true;syncControls();
  try{
    const result=await api.forgeCloudflareStart(request);
    if(result?.declined&&cloudflareState)cloudflareState.textContent='Autorização cancelada; túnel desligado.';
  }catch{if(cloudflareState)cloudflareState.textContent=
    'Túnel bloqueado. Verifique Cloudflare Access, JWT, identidade e componente oficial.';}
  finally{request.token=null;mcpBusy=false;await refreshMcp();}
});
cloudflareStop?.addEventListener('click',async()=>{
  if(mcpBusy||typeof api?.forgeCloudflareStop!=='function')return;
  mcpBusy=true;syncControls();
  try{await api.forgeCloudflareStop();}
  catch{if(cloudflareState)cloudflareState.textContent='Falha ao encerrar túnel.';}
  finally{mcpBusy=false;await refreshMcp();}
});
officialTunnelInstall?.addEventListener('click',async()=>{
  if(mcpBusy||typeof api?.forgeOfficialTunnelInstall!=='function')return;
  mcpBusy=true;syncControls();
  if(officialTunnelState)officialTunnelState.textContent=
    'Instalando cliente oficial com verificação de SHA-256…';
  let failed=false;
  try{
    const result=await api.forgeOfficialTunnelInstall();
    if(result?.declined)failed=true;
  }catch{failed=true;}
  finally{
    mcpBusy=false;await refreshMcp();
    if(failed&&officialTunnelState)officialTunnelState.textContent=
      'Instalação não concluída. Confira autorização, conexão de internet e componentes existentes.';
  }
});
for(const button of document.querySelectorAll('[data-forge-tunnel-link]')){
  button.addEventListener('click',async()=>{
    try{await api.forgeOfficialTunnelOpenSetup(button.dataset.forgeTunnelLink);}
    catch{if(officialTunnelState)officialTunnelState.textContent=
      'Não foi possível abrir a configuração da OpenAI no navegador.';}
  });
}
officialTunnelId?.addEventListener('input',syncTunnelControls);
officialTunnelKey?.addEventListener('input',syncTunnelControls);
officialTunnelStart?.addEventListener('click',async()=>{
  if(mcpBusy||!usable||!appActive(lastMcpStatus)||!officialTunnelKey?.value)return;
  const request={tunnelId:officialTunnelId.value.trim(),runtimeKey:officialTunnelKey.value};
  officialTunnelKey.value='';
  mcpBusy=true;syncControls();
  try{
    const result=await api.forgeOfficialTunnelStart(request);
    if(result?.declined)setState('Túnel do Forge não autorizado; nada foi iniciado.');
  }catch{setState('Túnel não iniciado. Confira autorização, ID e chave restrita no Windows.');}
  finally{request.runtimeKey=null;mcpBusy=false;await refreshMcp();}
});
officialTunnelStop?.addEventListener('click',async()=>{
  if(mcpBusy||typeof api?.forgeOfficialTunnelStop!=='function')return;
  mcpBusy=true;syncControls();
  try{await api.forgeOfficialTunnelStop();}
  catch{setState('Não foi possível confirmar o encerramento do túnel.');}
  finally{mcpBusy=false;await refreshMcp();}
});
localMcpElement('settingsTabConnections')?.addEventListener('click',()=>{void loadProjects();});
localMcpElement('openAppSettings')?.addEventListener('click',()=>{void loadProjects();});
if(typeof api?.onForgeOfficialTunnelChanged==='function')
  api.onForgeOfficialTunnelChanged(()=>{if(!mcpBusy)void refreshMcp();});
if(typeof api?.onForgeCloudflareChanged==='function')
  api.onForgeCloudflareChanged(()=>{if(!mcpBusy)void refreshMcp();});
localMcpElement('appSettingsDialog')?.addEventListener('close',()=>{
  hideSecret();
  if(officialTunnelKey)officialTunnelKey.value='';
  if(cloudflareToken)cloudflareToken.value='';
  syncControls();
});
let readinessPollPending=false;
setInterval(async()=>{
  if(readinessPollPending||mcpBusy||!lastMcpStatus?.officialTunnelSession?.processRunning||
    !localMcpElement('appSettingsDialog')?.open)return;
  readinessPollPending=true;
  try{await refreshMcp();}finally{readinessPollPending=false;}
},3000);
void loadProjects();
