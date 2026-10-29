/**
 * Ephemeral, process-local routing authority for embedded provider views.
 * Not a Task/Run ledger, queue, or alternate persistence authority.
 */
export function createProviderViewRegistry() {
  const byId=new Map();
  const byWorker=new WeakMap();
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
      byWorker.delete(worker);
      if(byId.get(id)===worker)byId.delete(id);
      return true;
    },
    get size(){return byId.size;}
  });
}