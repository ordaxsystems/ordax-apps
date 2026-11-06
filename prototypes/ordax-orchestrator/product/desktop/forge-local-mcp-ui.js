// Optional owner-only UI for a disabled-by-default MCP loopback listener.
// No credentials are written to storage or automatically sent to another app.
const localMcpElement=id=>document.getElementById(id);
const mcpStart=localMcpElement('forgeLocalMcpStart');
const mcpStop=localMcpElement('forgeLocalMcpStop');
const mcpProject=localMcpElement('forgeLocalMcpProject');
const mcpState=localMcpElement('forgeLocalMcpState');
const mcpCredentials=localMcpElement('forgeLocalMcpCredentials');
const mcpToken=localMcpElement('forgeLocalMcpToken');
const mcpUrl=localMcpElement('forgeLocalMcpUrl');
let mcpBusy=false;
const api=window.ordax;
const usable=typeof api?.forgeLocalMcpStatus==='function'&&
  typeof api?.forgeLocalMcpStart==='function'&&
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
    return;
  }
  try{
    const status=await api.forgeLocalMcpStatus();
    if(mcpStart)mcpStart.disabled=mcpBusy||status.running||!mcpProject?.value;
    if(mcpStop)mcpStop.disabled=mcpBusy||!status.running;
    if(mcpProject)mcpProject.disabled=mcpBusy||status.running;
    if(status.running){
      setState('MCP local ativo para '+status.scope+'. Expira: '+status.expiresAt+
        '. Não conectado ao GPT Web.');
    }else{
      hideSecret();
      setState('MCP local desativado. Nenhuma porta MCP aberta pelo Forge.');
    }
  }catch{
    hideSecret();
    setState('Não foi possível verificar o MCP local.');
    if(mcpStart)mcpStart.disabled=true;
    if(mcpStop)mcpStop.disabled=true;
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
    const enabled=await api.forgeLocalMcpStart(mcpProject.value);
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
mcpProject?.addEventListener('change',()=>{void refreshMcp();});
localMcpElement('settingsTabConnections')?.addEventListener('click',()=>{void loadProjects();});
localMcpElement('openAppSettings')?.addEventListener('click',()=>{void loadProjects();});
localMcpElement('appSettingsDialog')?.addEventListener('close',hideSecret);
void loadProjects();
