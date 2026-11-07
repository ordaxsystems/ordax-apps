// Optional owner-only UI for a disabled-by-default MCP loopback listener.
// No credentials are written to storage or automatically sent to another app.
const localMcpElement=id=>document.getElementById(id);
const mcpStart=localMcpElement('forgeLocalMcpStart');
const mcpStop=localMcpElement('forgeLocalMcpStop');
const mcpRevoke=localMcpElement('forgeLocalMcpRevoke');
const mcpResume=localMcpElement('forgeLocalMcpResume');
const mcpProject=localMcpElement('forgeLocalMcpProject');
const mcpState=localMcpElement('forgeLocalMcpState');
const officialTunnelState=localMcpElement('forgeOfficialTunnelState');
const officialTunnelId=localMcpElement('forgeOfficialTunnelId');
const officialTunnelKey=localMcpElement('forgeOfficialTunnelKey');
const officialTunnelStart=localMcpElement('forgeOfficialTunnelStart');
const officialTunnelStop=localMcpElement('forgeOfficialTunnelStop');
const mcpCredentials=localMcpElement('forgeLocalMcpCredentials');
const mcpToken=localMcpElement('forgeLocalMcpToken');
const mcpUrl=localMcpElement('forgeLocalMcpUrl');
let mcpBusy=false;
let lastMcpStatus=null;
function syncTunnelControls(){
  const session=lastMcpStatus?.officialTunnelSession;
  const running=session?.processRunning===true;
  if(officialTunnelStart)officialTunnelStart.disabled=mcpBusy||running||
    !lastMcpStatus?.officialTunnel?.installed||
    !lastMcpStatus?.scopes?.includes(mcpProject?.value)||
    !officialTunnelId?.value?.trim()||!officialTunnelKey?.value||
    typeof api?.forgeOfficialTunnelStart!=='function';
  if(officialTunnelStop)officialTunnelStop.disabled=mcpBusy||!running||
    typeof api?.forgeOfficialTunnelStop!=='function';
}
const api=window.ordax;
const usable=typeof api?.forgeLocalMcpStatus==='function'&&
  typeof api?.forgeLocalMcpStart==='function'&&
  typeof api?.forgeLocalMcpAdd==='function'&&
  typeof api?.forgeLocalMcpRevoke==='function'&&
  typeof api?.forgeLocalMcpResumeEnable==='function'&&
  typeof api?.forgeLocalMcpResumeDisable==='function'&&
  typeof api?.forgeLocalMcpStop==='function';

function hideSecret(){
  if(mcpToken)mcpToken.value='';
  if(mcpUrl)mcpUrl.value='';
  if(mcpCredentials)mcpCredentials.hidden=true;
}
function setState(message){
  if(mcpState)mcpState.textContent=message;
}
async function refreshMcp(){
  if(!usable){
    setState('Disponível somente no aplicativo Electron local; não está conectado ao GPT Web.');
    if(mcpStart)mcpStart.disabled=true;
    if(mcpStop)mcpStop.disabled=true;
    if(mcpRevoke)mcpRevoke.disabled=true;
    if(mcpResume)mcpResume.disabled=true;
    return;
  }
  try{
    const status=await api.forgeLocalMcpStatus();
    lastMcpStatus=status;
    syncTunnelControls();
    if(officialTunnelState){
      officialTunnelState.textContent=status.officialTunnelSession?.processRunning
        ?'Cliente de túnel iniciado para o projeto autorizado. Conexão e chamadas GPT Web ainda não comprovadas.'
        :status.officialTunnel?.installed
          ?'Cliente oficial OpenAI '+status.officialTunnel.clientVersion+
            ' instalado e verificado. GPT Web não conectado; faltam autorização e permissões do workspace.'
          :'GPT Web não conectado. Cliente oficial ainda não verificado nesta instalação.';
    }
    const scopes=Array.isArray(status.scopes)?status.scopes:(status.scope?[status.scope]:[]);
    const selected=scopes.includes(mcpProject?.value);
    const trusted=Array.isArray(status.trustedProjects)?status.trustedProjects:[];
    const approved=trusted.includes(mcpProject?.value);
    const autoResume=Array.isArray(status.autoResumeProjects)
      ?status.autoResumeProjects.includes(mcpProject?.value):false;
    if(mcpStart){
      mcpStart.disabled=mcpBusy||!mcpProject?.value||selected;
      mcpStart.textContent=status.running
        ?(approved?'Conectar projeto confiável':'Autorizar outro projeto')
        :(approved?'Reativar projeto confiável':'Ativar MCP local');
    }
    if(mcpRevoke)mcpRevoke.disabled=mcpBusy||(!selected&&!approved);
    if(mcpResume){
      mcpResume.textContent=autoResume?'Desativar reconexão automática':'Manter conectado após reinício';
      mcpResume.disabled=mcpBusy||(!autoResume&&(!selected||!status.autoResumeAvailable));
    }
    if(mcpStop)mcpStop.disabled=mcpBusy||!status.running;
    if(mcpProject)mcpProject.disabled=mcpBusy;
    if(status.running){
      setState('MCP local ativo para '+scopes.length+' projeto(s). '+
        (status.autoResumeBlocked?'Reconexão bloqueada; confira a porta e autorizações. ':'')+
        'Reconexão após reinício é opcional e protegida pelo Windows. '+
        'Não conectado ao GPT Web.');
    }else{
      hideSecret();
      setState('MCP local desativado. Nenhuma porta MCP aberta pelo Forge. '+
        trusted.length+' projeto(s) com confiança salva no SQLite; as chaves não são persistidas.');
    }
  }catch{
    lastMcpStatus=null;
    syncTunnelControls();
    hideSecret();
    setState('Não foi possível verificar o MCP local.');
    if(mcpStart)mcpStart.disabled=true;
    if(mcpStop)mcpStop.disabled=true;
    if(mcpRevoke)mcpRevoke.disabled=true;
    if(mcpResume)mcpResume.disabled=true;
  }
}
async function loadProjects(){
  if(!usable)return refreshMcp();
  try{
    const result=await api.orchestratorInvoke('projects_list',{});
    const projects=result?.projects||result?.result?.projects||[];
    const previous=mcpProject.value;
    mcpProject.replaceChildren();
    for(const project of projects){
      if(typeof project?.id!=='string')continue;
      const option=document.createElement('option');
      option.value=project.id;
      option.textContent=(project.name||'Projeto')+' ('+project.id+')';
      mcpProject.appendChild(option);
    }
    if([...mcpProject.options].some(option=>option.value===previous))mcpProject.value=previous;
    if(!projects.length)setState('Crie um projeto antes de habilitar o MCP local.');
  }catch{setState('Não foi possível carregar projetos autorizados.');}
  await refreshMcp();
}
mcpStart?.addEventListener('click',async()=>{
  if(mcpBusy||!usable||!mcpProject?.value)return;
  mcpBusy=true;hideSecret();mcpStart.disabled=true;
  try{
    const active=await api.forgeLocalMcpStatus();
    const enabled=active.running
      ?await api.forgeLocalMcpAdd(mcpProject.value)
      :await api.forgeLocalMcpStart(mcpProject.value);
    if(enabled?.running&&enabled?.token&&enabled?.endpoint){
      mcpUrl.value=enabled.endpoint;
      mcpToken.value=enabled.token;
      mcpCredentials.hidden=false;
    }else if(enabled?.declined)setState('Ativação cancelada; MCP continua desligado.');
  }catch(error){setState('Ativação não realizada: '+String(error?.message||'falha local').slice(0,130));}
  finally{mcpBusy=false;await refreshMcp();}
});
mcpStop?.addEventListener('click',async()=>{
  if(mcpBusy||!usable)return;
  mcpBusy=true;mcpStop.disabled=true;
  try{await api.forgeLocalMcpStop();hideSecret();}
  catch{setState('Não foi possível confirmar o encerramento do MCP.');}
  finally{mcpBusy=false;await refreshMcp();}
});
mcpRevoke?.addEventListener('click',async()=>{
  if(mcpBusy||!usable||!mcpProject?.value)return;
  mcpBusy=true;mcpRevoke.disabled=true;
  try{await api.forgeLocalMcpRevoke(mcpProject.value);hideSecret();}
  catch{setState('Não foi possível revogar a autorização deste projeto.');}
  finally{mcpBusy=false;await refreshMcp();}
});
mcpResume?.addEventListener('click',async()=>{
  if(mcpBusy||!usable||!mcpProject?.value)return;
  mcpBusy=true;mcpResume.disabled=true;
  try{
    const info=await api.forgeLocalMcpStatus();
    const isEnabled=Array.isArray(info.autoResumeProjects)&&
      info.autoResumeProjects.includes(mcpProject.value);
    if(isEnabled)await api.forgeLocalMcpResumeDisable(mcpProject.value);
    else await api.forgeLocalMcpResumeEnable(mcpProject.value);
  }catch{setState('Reconexão segura não disponível neste perfil Windows.');}
  finally{mcpBusy=false;await refreshMcp();}
});
officialTunnelId?.addEventListener('input',syncTunnelControls);
officialTunnelKey?.addEventListener('input',syncTunnelControls);
officialTunnelStart?.addEventListener('click',async()=>{
  if(mcpBusy||!usable||!mcpProject?.value||!officialTunnelKey?.value)return;
  const request={projectId:mcpProject.value,
    tunnelId:officialTunnelId.value.trim(),runtimeKey:officialTunnelKey.value};
  officialTunnelKey.value=''; // Never retain the restricted key in the UI.
  mcpBusy=true;syncTunnelControls();
  try{
    const result=await api.forgeOfficialTunnelStart(request);
    if(result?.declined)setState('Conexão remota não autorizada; nada foi iniciado.');
  }catch{
    setState('Túnel não iniciado. Verifique autorização, ID e chave restrita no Windows.');
  }finally{
    request.runtimeKey=null;
    mcpBusy=false;await refreshMcp();
  }
});
officialTunnelStop?.addEventListener('click',async()=>{
  if(mcpBusy||typeof api?.forgeOfficialTunnelStop!=='function')return;
  mcpBusy=true;syncTunnelControls();
  try{await api.forgeOfficialTunnelStop();}
  catch{setState('Não foi possível confirmar o encerramento do túnel.');}
  finally{mcpBusy=false;await refreshMcp();}
});
mcpProject?.addEventListener('change',()=>{hideSecret();void refreshMcp();});
localMcpElement('settingsTabConnections')?.addEventListener('click',()=>{void loadProjects();});
localMcpElement('openAppSettings')?.addEventListener('click',()=>{void loadProjects();});
localMcpElement('appSettingsDialog')?.addEventListener('close',()=>{
  hideSecret();
  if(officialTunnelKey)officialTunnelKey.value='';
  syncTunnelControls();
});
void loadProjects();
