// Only the first-party Forge Git application document owns privileged IPC.
// An embedded GPT provider view, child frame, or another Electron window must
// never invoke the Core grant, draft or native owner-dispatch channels.
export function assertForgeGitUiSender(event,window){
  const webContents=window?.webContents;
  if(!webContents||
     typeof window?.isDestroyed!=='function'||window.isDestroyed()||
     typeof webContents.isDestroyed!=='function'||webContents.isDestroyed()||
     !webContents.mainFrame||
     event?.sender!==webContents||
     event?.senderFrame!==webContents.mainFrame||
     (typeof event.senderFrame?.isDestroyed==='function'&&event.senderFrame.isDestroyed()))
    throw Error('forge_git_untrusted_ipc_sender');
}
