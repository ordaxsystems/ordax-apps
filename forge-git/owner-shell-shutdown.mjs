// Release only the transport resources owned by Forge Git. Projects, Runs,
 // provider dispatch and continuity remain in the canonical Forge Core.
export function createForgeGitShutdown({workers,disconnectCore,stopWatcher}={}){
  if(!(workers instanceof Map)||typeof disconnectCore!=='function'||
      typeof stopWatcher!=='function')
    throw Error('forge_git_shutdown_ports_required');
  let completed=false;
  return ()=>{
    if(completed)return Object.freeze({alreadyClosed:true,closedViews:0,failures:0});
    completed=true;
    let failures=0,closedViews=0;
    try{stopWatcher();}catch{failures++;}
    try{disconnectCore();}catch{failures++;}
    // WebContentsView is not a BrowserWindow. Closing the parent window alone
    // does NOT destroy embedded guest webContents in Electron, leaving an
    // invisible process holding the one-instance lock and the GPT session.
    for(const worker of workers.values()){
      const contents=worker?.view?.webContents;
      try{
        if(contents&&contents.isDestroyed?.()!==true){
          // The owner has already closed the application window. Prevent a
          // hidden beforeunload dialogue from holding an invisible process.
          contents.close({waitForBeforeUnload:false});
          closedViews++;
        }
      }catch{failures++;}
    }
    workers.clear();
    return Object.freeze({alreadyClosed:false,closedViews,failures});
  };
}
