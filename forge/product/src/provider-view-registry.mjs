/**
 * Ephemeral, process-local routing authority for embedded provider views.
 * Not a Task/Run ledger, queue, or alternate persistence authority.
 */
export function createProviderViewRegistry() {
  const byId=new Map();
  const byWorker=new WeakMap();
  const activeRuns=new Map();
  return Object.freeze({
    register(worker) {
      const webContents=worker?.view?.webContents;
      const id=webContents?.id;
      if(!worker||typeof worker!=='object'||!webContents||
        !Number.isSafeInteger(id)||id<=0||
        (typeof webContents.isDestroyed==='function'&&webContents.isDestroyed()))
        throw Error('provider_view_registration_invalid');
      if(byWorker.has(worker)||byId.has(id))
        throw Error('provider_view_registration_conflict');
      byWorker.set(worker,id);
      byId.set(id,worker);
      return id;
    },
    resolve(sender) {
      const id=sender?.id;
      if(!Number.isSafeInteger(id)||id<=0)return null;
      const owner=byId.get(id);
      // An integer alone does not authenticate a WebContents sender.
      return owner?.view?.webContents===sender&&
        !(typeof sender.isDestroyed==='function'&&sender.isDestroyed())
        ?owner:null;
    },
    unregister(worker) {
      const id=byWorker.get(worker);
      if(id===undefined)return false;
      activeRuns.delete(worker);
      byWorker.delete(worker);
      if(byId.get(id)===worker)byId.delete(id);
      return true;
    },
    // The routing context is the SAME object held by the existing run cycle.
    // It grants no submission authority and records no provider receipt.
    bindRun(worker,run) {
      const id=byWorker.get(worker);
      if(id===undefined||byId.get(id)!==worker||
        worker.view.webContents.isDestroyed?.())
        throw Error('provider_run_worker_unregistered');
      if(!run||typeof run!=='object'||
        !['taskId','runId'].every(key=>
          typeof run[key]==='string'&&/^[a-zA-Z0-9_-]{1,180}$/.test(run[key]))||
        !Number.isSafeInteger(run.startedAt)||run.startedAt<=0)
        throw Error('provider_run_context_invalid');
      if(activeRuns.has(worker))throw Error('provider_run_worker_occupied');
      for(const existing of activeRuns.values()){
        if(existing.runId===run.runId||existing.taskId===run.taskId)
          throw Error('provider_run_context_conflict');
      }
      // Lock the canonical identity on the very same Run object. Progress
      // timestamps may change, but a sender cannot become another Task/Run.
      for(const key of ['taskId','runId','startedAt']){
        Object.defineProperty(run,key,{
          value:run[key],enumerable:true,writable:false,configurable:false
        });
      }
      activeRuns.set(worker,run);
      return run;
    },
    runForWorker(worker){
      const id=byWorker.get(worker);
      return id!==undefined&&byId.get(id)===worker&&
        !worker.view.webContents.isDestroyed?.()
        ?activeRuns.get(worker)||null:null;
    },
    runForSender(sender){
      const owner=byId.get(sender?.id);
      return owner?.view?.webContents===sender&&
        !sender?.isDestroyed?.()?activeRuns.get(owner)||null:null;
    },
    unbindRun(worker,runId) {
      const active=activeRuns.get(worker);
      if(!active||active.runId!==runId)return false;
      activeRuns.delete(worker);
      return true;
    },
    get activeRunCount(){return activeRuns.size;},
    get size(){return byId.size;}
  });
}
