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

/** Resolve the development profile without making it depend on the caller's cwd. */
export function resolveHostProfileRoot(productRoot, configuredRoot) {
  if(typeof productRoot!=='string'||!path.isAbsolute(productRoot))
    throw Error('host_product_root_must_be_absolute');
  if(configuredRoot===undefined||configuredRoot==='')return path.join(path.resolve(productRoot),'.host-profile');
  if(typeof configuredRoot!=='string'||!path.isAbsolute(configuredRoot))
    throw Error('host_profile_root_must_be_absolute');
  return path.resolve(configuredRoot);
}

/** One Node-host process may own a host profile at a time. */
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
      return async()=>{
        await handle.close().catch(()=>{});
        try {
          const current=JSON.parse(await fs.readFile(lockPath,'utf8'));
          if(current.pid===process.pid&&current.token===token)await fs.unlink(lockPath);
        } catch(error) {if(error?.code!=='ENOENT')throw error;}
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
