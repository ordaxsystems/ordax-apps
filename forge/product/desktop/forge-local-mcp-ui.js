// One Forge application authorization + one product account + one remote gateway.
// The loopback MCP below is optional development access; ChatGPT never depends
// on that listener or on a local tunnel.
const localMcpElement=id=>document.getElementById(id);
const APP_SCOPE='forge_app';
const api=window.ordax;

const mcpStart=localMcpElement('forgeLocalMcpStart');
const mcpStop=localMcpElement('forgeLocalMcpStop');
const mcpRevoke=localMcpElement('forgeLocalMcpRevoke');
const mcpResume=localMcpElement('forgeLocalMcpResume');
const workspaceProject=localMcpElement('forgeLocalMcpProject');
const mcpState=localMcpElement('forgeLocalMcpState');
const mcpCredentials=localMcpElement('forgeLocalMcpCredentials');
const mcpToken=localMcpElement('forgeLocalMcpToken');
const mcpUrl=localMcpElement('forgeLocalMcpUrl');

const remoteState=localMcpElement('forgeRemoteGatewayState');
const productConnect=localMcpElement('forgeProductConnect');
const productReconnect=localMcpElement('forgeProductReconnect');
const productDisconnect=localMcpElement('forgeProductDisconnect');

const localUsable=typeof api?.forgeLocalMcpStatus==='function'&&
  typeof api?.forgeLocalMcpStart==='function'&&
  typeof api?.forgeLocalMcpRevoke==='function'&&
  typeof api?.forgeLocalMcpResumeEnable==='function'&&
  typeof api?.forgeLocalMcpResumeDisable==='function'&&
  typeof api?.forgeLocalMcpStop==='function';
const remoteUsable=typeof api?.forgeProductAuthStatus==='function'&&
  typeof api?.forgeProductAuthConnect==='function'&&
  typeof api?.forgeProductAuthReconnect==='function'&&
  typeof api?.forgeProductAuthDisconnect==='function';

let busy=false,lastStatus=null;
const appActive=status=>status?.running===true&&status?.scopes?.length===1&&
  status.scopes[0]===APP_SCOPE;

function hideLocalSecret(){
  if(mcpToken)mcpToken.value='';
  if(mcpUrl)mcpUrl.value='';
  if(mcpCredentials)mcpCredentials.hidden=true;
}
function setLocalState(message){if(mcpState)mcpState.textContent=message;}
function setRemoteState(message,state=''){
  if(!remoteState)return;
  remoteState.textContent=message;
  remoteState.dataset.state=state;
}
function syncControls(){
  const active=appActive(lastStatus);
  const trusted=lastStatus?.appTrusted===true;
  const autoResume=lastStatus?.autoResumeApp===true;
  const account=lastStatus?.productAccount||{};
  const gateway=lastStatus?.remoteGateway||{};

  if(mcpStart){
    mcpStart.disabled=busy||!localUsable||active;
    mcpStart.textContent=trusted?'Reativar listener local':'Autorizar MCP do Forge';
  }
  if(mcpRevoke)mcpRevoke.disabled=busy||!localUsable||(!trusted&&!active);
  if(mcpResume){
    mcpResume.textContent=autoResume?'Desativar reconexão do listener':'Manter listener após reinício';
    mcpResume.disabled=busy||!localUsable||
      (!autoResume&&(!active||!lastStatus?.autoResumeAvailable));
  }
  if(mcpStop)mcpStop.disabled=busy||!localUsable||!active;

  if(productConnect){
    productConnect.hidden=account.connected;
    productConnect.disabled=busy||!remoteUsable||account.connected||!trusted||account.authPending===true;
    productConnect.textContent=account.authPending===true?'Conectando no navegador…':'Entrar com Conta OrdaX';
  }
  if(productReconnect){
    productReconnect.hidden=!account.connected||gateway.running===true;
    productReconnect.disabled=busy||!trusted;
  }
  if(productDisconnect){
    productDisconnect.hidden=!account.connected;
    productDisconnect.disabled=busy;
  }
}
function renderRemote(){
  const trusted=lastStatus?.appTrusted===true;
  const account=lastStatus?.productAccount||{};
  const gateway=lastStatus?.remoteGateway||{};
  if(!remoteUsable){
    setRemoteState('Conexão Forge MCP remota indisponível nesta instalação.','blocked');
    return;
  }
  if(!trusted){
    setRemoteState('Autorize o MCP do Forge antes de conectar a Conta OrdaX.','blocked');
    return;
  }
  if(!account.connected){
    setRemoteState(account.authPending
      ?'Conclua a entrada da Conta OrdaX no navegador para conectar esta instância.'
      :'Conta OrdaX ainda não conectada. A entrada é feita no navegador e a sessão fica protegida pelo Windows.',
      account.authPending?'pending':'blocked');
    return;
  }
  const identity=account.email||'Conta OrdaX';
  if(gateway.running&&gateway.connected){
    setRemoteState(identity+' · Forge MCP conectado ao gateway canônico. Instância '+String(gateway.instanceId||'').slice(0,8)+'…','ready');
  }else if(gateway.running){
    setRemoteState(identity+' · gateway iniciando/reconectando'+
      (gateway.lastError?' ('+gateway.lastError+')':'')+'.','pending');
  }else{
    setRemoteState(identity+' conectada, mas o gateway está offline. Use Reconectar gateway.','blocked');
  }
}
async function refreshMcp(){
  if(!localUsable){
    lastStatus=null;
    setLocalState('Listener MCP local indisponível nesta instalação.');
    renderRemote();syncControls();return;
  }
  try{
    lastStatus=await api.forgeLocalMcpStatus();
    const active=appActive(lastStatus);
    if(active){
      setLocalState('Listener MCP local ativo em 127.0.0.1 para desenvolvimento. '+
        (lastStatus.autoResumeBlocked?'Reconexão automática bloqueada; confira a autorização.':''));
    }else{
      hideLocalSecret();
      setLocalState(lastStatus.appTrusted
        ?'MCP do Forge autorizado. Listener local desligado; o gateway remoto funciona independentemente dele.'
        :'MCP do Forge ainda não autorizado.');
    }
    renderRemote();syncControls();
  }catch{
    lastStatus=null;hideLocalSecret();
    setLocalState('Não foi possível verificar o estado do Forge MCP.');
    setRemoteState('Não foi possível verificar Conta/gateway.','blocked');
    syncControls();
  }
}
async function loadProjects(){
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
  }catch{}
  await refreshMcp();
}

mcpStart?.addEventListener('click',async()=>{
  if(busy||!localUsable)return;
  busy=true;hideLocalSecret();syncControls();
  try{
    const enabled=await api.forgeLocalMcpStart();
    if(enabled?.running&&enabled?.scope===APP_SCOPE&&enabled?.token&&enabled?.endpoint){
      mcpUrl.value=enabled.endpoint;mcpToken.value=enabled.token;mcpCredentials.hidden=false;
    }else if(enabled?.declined)setLocalState('Autorização do Forge cancelada.');
  }catch{setLocalState('Não foi possível autorizar/ativar o Forge MCP.');}
  finally{busy=false;await refreshMcp();}
});
mcpStop?.addEventListener('click',async()=>{
  if(busy||!localUsable)return;
  busy=true;syncControls();
  try{await api.forgeLocalMcpStop();hideLocalSecret();}
  catch{setLocalState('Não foi possível confirmar o encerramento do listener.');}
  finally{busy=false;await refreshMcp();}
});
mcpRevoke?.addEventListener('click',async()=>{
  if(busy||!localUsable)return;
  busy=true;syncControls();
  try{await api.forgeLocalMcpRevoke();hideLocalSecret();}
  catch{setLocalState('Não foi possível revogar a autorização do Forge.');}
  finally{busy=false;await refreshMcp();}
});
mcpResume?.addEventListener('click',async()=>{
  if(busy||!localUsable)return;
  busy=true;syncControls();
  try{
    const info=await api.forgeLocalMcpStatus();
    if(info.autoResumeApp)await api.forgeLocalMcpResumeDisable();
    else await api.forgeLocalMcpResumeEnable();
  }catch{setLocalState('Reconexão do listener não disponível neste perfil Windows.');}
  finally{busy=false;await refreshMcp();}
});

productConnect?.addEventListener('click',async()=>{
  if(busy||!remoteUsable)return;
  busy=true;syncControls();
  setRemoteState('Abrindo a Conta OrdaX no navegador…','pending');
  try{await api.forgeProductAuthConnect();}
  catch(error){
    setRemoteState(String(error?.message||'Não foi possível conectar a Conta OrdaX.').slice(0,160),'blocked');
  }finally{busy=false;await refreshMcp();}
});
productReconnect?.addEventListener('click',async()=>{
  if(busy||!remoteUsable)return;
  busy=true;syncControls();
  try{await api.forgeProductAuthReconnect();}
  catch(error){setRemoteState(String(error?.message||'Não foi possível reconectar.').slice(0,160),'blocked');}
  finally{busy=false;await refreshMcp();}
});
productDisconnect?.addEventListener('click',async()=>{
  if(busy||!remoteUsable)return;
  busy=true;syncControls();
  try{await api.forgeProductAuthDisconnect();}
  catch{setRemoteState('Não foi possível desconectar a Conta OrdaX.','blocked');}
  finally{busy=false;await refreshMcp();}
});

localMcpElement('settingsTabConnections')?.addEventListener('click',()=>{void loadProjects();});
localMcpElement('openAppSettings')?.addEventListener('click',()=>{void loadProjects();});
if(typeof api?.onForgeRemoteGatewayChanged==='function')
  api.onForgeRemoteGatewayChanged(()=>{if(!busy)void refreshMcp();});
localMcpElement('appSettingsDialog')?.addEventListener('close',()=>{
  hideLocalSecret();
  syncControls();
});
void loadProjects();
