import fs from 'node:fs';
import path from 'node:path';

// Local App cache only. Called after the canonical SQLite project_delete commit.
// Explicit ledger paths, strict asset filenames and non-symlink containment
// prevent deletion of external workspaces, arbitrary files or other projects.
const taskPattern=/^task_[a-zA-Z0-9-]{8,160}$/;
const assetPattern=/^asset_[a-zA-Z0-9-]{8,160}\.(?:png|jpg|jpeg|webp|gif|avif|html)$/i;
const equalPath=(left,right)=>process.platform==='win32'
  ?path.resolve(left).toLowerCase()===path.resolve(right).toLowerCase()
  :path.resolve(left)===path.resolve(right);

export function pruneDeletedProjectAssets({assetsRoot,taskIds,assetPaths}) {
  if(!Array.isArray(taskIds)||!Array.isArray(assetPaths))
    throw Error('orchestrator_asset_cleanup_scope_invalid');
  const root=path.resolve(assetsRoot);
  const info=fs.lstatSync(root);
  if(!info.isDirectory()||info.isSymbolicLink())
    throw Error('orchestrator_asset_cleanup_root_untrusted');
  // Compare real paths in the SAME canonical namespace: on Windows CI,
  // realpathSync.native may use a different spelling or extended-length root
  // from path.resolve, even for a safe directory with no reparse points.
  const realRoot=fs.realpathSync.native(root);
  const allowed=new Set(taskIds);
  if(allowed.size!==taskIds.length||[...allowed].some(id=>typeof id!=='string'||!taskPattern.test(id)))
    throw Error('orchestrator_asset_cleanup_tasks_invalid');
  const result={filesRemoved:0,foldersRemoved:0,filesPending:0,entriesRemaining:0};
  for(const storedPath of assetPaths) {
    if(typeof storedPath!=='string') {result.filesPending++;continue;}
    const taskId=path.basename(path.dirname(storedPath));
    const filename=path.basename(storedPath);
    const folder=path.join(root,taskId);
    const expected=path.join(folder,filename);
    if(!allowed.has(taskId)||!assetPattern.test(filename)||!equalPath(storedPath,expected)) {
      result.filesPending++;continue;
    }
    try {
      const folderStat=fs.lstatSync(folder);
      if(!folderStat.isDirectory()||folderStat.isSymbolicLink()) {
        result.filesPending++;continue;
      }
      const realFolder=fs.realpathSync.native(folder);
      if(!equalPath(realFolder,path.join(realRoot,taskId))) {
        result.filesPending++;continue;
      }
      const fileStat=fs.lstatSync(expected);
      if(!fileStat.isFile()||fileStat.isSymbolicLink()) {
        result.filesPending++;continue;
      }
      fs.unlinkSync(expected);
      result.filesRemoved++;
    }catch(error) {
      // A missing recorded file is already clean; an inaccessible or altered
      // path stays pending rather than broadening deletion authority.
      if(error?.code!=='ENOENT')result.filesPending++;
    }
  }
  for(const taskId of allowed) {
    const folder=path.join(root,taskId);
    try{
      const stat=fs.lstatSync(folder);
      if(!stat.isDirectory()||stat.isSymbolicLink()||
         !equalPath(fs.realpathSync.native(folder),path.join(realRoot,taskId))) {
        result.entriesRemaining++;continue;
      }
      const entries=fs.readdirSync(folder);
      if(entries.length){result.entriesRemaining+=entries.length;continue;}
      fs.rmdirSync(folder);result.foldersRemoved++;
    }catch(error){if(error?.code!=='ENOENT')result.entriesRemaining++;}
  }
  return result;
}
