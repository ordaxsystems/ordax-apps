import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

function processExists(pid) {
  try { process.kill(pid,0); return true; }
  catch(error) {
    if(error?.code==='ESRCH')return false;
    return true;
  }
}

/** Resolve an isolated Node-host profile independently of its current directory. */
export function resolveHostProfileRoot(productRoot, configuredRoot) {
  if(typeof productRoot!=='string'||!path.isAbsolute(productRoot))
    throw Error('host_product_root_must_be_absolute');
  if(configuredRoot===undefined||configuredRoot==='')return path.join(path.resolve(productRoot),'.host-profile');
  if(typeof configuredRoot!=='string'||!path.isAbsolute(configuredRoot))
    throw Error('host_profile_root_must_be_absolute');
  return path.resolve(configuredRoot);
}

/**
 * Exclusive process ownership of the existing Forge SQLite profile, shared by
 * Electron and the Node Host. This is a lifecycle gate, NOT a second lock store
 * or an execution authority. Acquire BEFORE constructing Store.
 *
 * Keep the historical host-process.lock pathname: existing Node hosts use it,
 * and a stale lock can be reclaimed only after its PID is confirmed absent.
 * Unknown or malformed ownership always fails closed. Never delete a live
 * owner's lock or create a second database to work around a conflict.
 */
export async function acquireHostProfileLock(dataRoot) {
  const root=path.resolve(dataRoot);
  await fs.mkdir(root,{recursive:true});
  const lockPath=path.join(root,'host-process.lock');
  for(let attempt=0;attempt<2;attempt++) {
    const token=randomUUID();
    let handle;
    try {
      handle=await fs.open(lockPath,'wx',0o600);
      await handle.writeFile(JSON.stringify({pid:process.pid,token,startedAt:new Date().toISOString()}),'utf8');
      await handle.sync();
      let released=false;
      return async()=>{
        if(released)return;
        // Only the process with the matching token may unlink the same lock.
        // Preserve the lock if another owner replaced it.
        let current;
        try {current=JSON.parse(await fs.readFile(lockPath,'utf8'));}
        catch(error) {if(error?.code==='ENOENT'){released=true;await handle.close();return;}throw error;}
        if(current.pid!==process.pid||current.token!==token)
          throw Error('forge_core_profile_lock_ownership_changed');
        await handle.close();
        await fs.unlink(lockPath);
        released=true;
      };
    } catch(error) {
      await handle?.close().catch(()=>{});
      if(error?.code!=='EEXIST')throw error;
      let existing;
      try {existing=JSON.parse(await fs.readFile(lockPath,'utf8'));}
      catch {throw Error('host_profile_lock_unverifiable');}
      if(!Number.isSafeInteger(existing?.pid)||existing.pid<1||typeof existing.token!=='string')
        throw Error('host_profile_lock_unverifiable');
      if(processExists(existing.pid))throw Error('host_profile_already_running');
      if(attempt!==0)throw Error('host_profile_lock_race');
      const latest=JSON.parse(await fs.readFile(lockPath,'utf8').catch(()=>'{"pid":-1}'));
      if(latest.pid!==existing.pid||latest.token!==existing.token)throw Error('host_profile_lock_race');
      await fs.unlink(lockPath);
    }
  }
  throw Error('host_profile_lock_unavailable');
}
