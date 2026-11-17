const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('forgeGit',{
  state:()=>ipcRenderer.invoke('fg:state'),
  connect:()=>ipcRenderer.invoke('fg:connect'),
  coreConnect:options=>ipcRenderer.invoke('fg:core-connect',options),
  coreRefresh:()=>ipcRenderer.invoke('fg:core-refresh'),
  coreSelect:projectId=>ipcRenderer.invoke('fg:core-select',projectId),
  coreSelectTask:taskId=>ipcRenderer.invoke('fg:core-select-task',taskId),
  coreSaveDraft:args=>ipcRenderer.invoke('fg:core-save-draft',args),
  coreDispatch:args=>ipcRenderer.invoke('fg:core-dispatch',args),
  coreDisconnect:()=>ipcRenderer.invoke('fg:core-disconnect'),
  select:id=>ipcRenderer.invoke('fg:tab',id),
  send:args=>ipcRenderer.invoke('fg:send',args),
  pauseAuto:id=>ipcRenderer.invoke('fg:auto-pause',id),
  refresh:()=>ipcRenderer.invoke('fg:refresh'),
  agentRefresh:id=>ipcRenderer.invoke('fg:agent-refresh',id),
  newChat:id=>ipcRenderer.invoke('fg:new-chat',id),
  notifyForjador:()=>ipcRenderer.invoke('fg:notify-forjador'),
  openUrl:url=>ipcRenderer.invoke('fg:open-url',url),
  onEvent:listener=>{
    const handler=(_event,data)=>listener(data);
    ipcRenderer.on('forge-git:event',handler);
    return ()=>ipcRenderer.removeListener('forge-git:event',handler);
  }
});