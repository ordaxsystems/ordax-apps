// Explicit operator preflight for upgrading a staged OrdaX Orchestrator Lab.
// SQLite online backup: no stopping Electron, no credentials, no provider calls.
// Never restores data or changes the source database.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync,backup}=require('node:sqlite');
const {labStagedLocalAppData,labDatabasePath}=require('./e2e-lab-target.cjs');

function readState(db) {
 const integrity=db.prepare('PRAGMA integrity_check').all();
 if(integrity.length!==1 || integrity[0].integrity_check!=='ok')
   throw Error('upgrade_source_integrity_failed');
 const n=q=>db.prepare(q).get().n;
 return {
  tasks:n('SELECT COUNT(*) n FROM tasks'),
  messages:n('SELECT COUNT(*) n FROM messages'),
  runs:n('SELECT COUNT(*) n FROM runs'),
  activeRuns:n("SELECT COUNT(*) n FROM runs WHERE status='running'"),
  events:n('SELECT COUNT(*) n FROM events'),
  checkpoints:n('SELECT COUNT(*) n FROM checkpoints')
 };
}
function fingerprint(folder) {
 return crypto.createHash('sha256').update(path.normalize(path.resolve(folder)).toLowerCase()).digest('hex');
}
function copyOwnedAssets(sourceRoot,destination) {
 const items=[], quota={count:0,bytes:0};
 if(!fs.existsSync(sourceRoot))return items;
 if(!fs.lstatSync(sourceRoot).isDirectory())throw Error('upgrade_assets_invalid');
 function visit(folder,relative='') {
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})) {
   if(entry.isSymbolicLink())throw Error('upgrade_assets_symlink_refused');
   const rel=path.join(relative,entry.name), src=path.join(folder,entry.name);
   if(entry.isDirectory()) {visit(src,rel);continue;}
   if(!entry.isFile())throw Error('upgrade_assets_invalid');
   const size=fs.statSync(src).size;
   quota.count++;quota.bytes+=size;
   if(quota.count>5000||quota.bytes>512*1024*1024)
     throw Error('upgrade_assets_quota_exceeded');
   const dst=path.join(destination,rel);
   fs.mkdirSync(path.dirname(dst),{recursive:true,mode:0o700});
   fs.copyFileSync(src,dst,fs.constants.COPYFILE_EXCL);
   const original=fs.readFileSync(src),copy=fs.readFileSync(dst);
   const hash=buf=>crypto.createHash('sha256').update(buf).digest('hex');
   if(hash(original)!==hash(copy))throw Error('upgrade_asset_copy_mismatch');
   items.push({path:rel.replace(/\\/g,'/'),bytes:size,sha256:hash(copy)});
  }
 }
 visit(sourceRoot);
 return items;
}
async function main() {
 const profile=labStagedLocalAppData();
 const source=labDatabasePath();
 if(!fs.existsSync(source) || !fs.statSync(source).isFile())
   throw Error('upgrade_source_database_missing');
 const root=path.join(profile,'OrdaX','OrchestratorLab','recovery');
 const db=new DatabaseSync(source,{readOnly:true});
 let state;
 try {state=readState(db);}
 finally {db.close();}
 if(state.activeRuns!==0) throw Error('upgrade_active_run_blocked');
 // A unique, private recovery point prevents stale rollback data being
 // mistaken for this session. No browser profile/cookies are copied.
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 const name='preupgrade-'+new Date().toISOString().replace(/[:.]/g,'-')+
   '-'+crypto.randomUUID().slice(0,8);
 const directory=path.join(root,name);
 fs.mkdirSync(directory,{recursive:false,mode:0o700});
 const provisional=path.join(directory,'snapshot.sqlite.tmp');
 const final=path.join(directory,'snapshot.sqlite');
 try {
  const online=new DatabaseSync(source,{readOnly:true});
  try {await backup(online,provisional);}
  finally {online.close();}
  const snapDb=new DatabaseSync(provisional,{readOnly:true});
  let snapshot;
  try {snapshot=readState(snapDb);}
  finally {snapDb.close();}
  if(snapshot.activeRuns!==0) throw Error('upgrade_snapshot_active_run_blocked');
  // Assets are stored outside SQLite. Preserve their bytes alongside the
  // transactional database, without copying browser cookies/credentials.
  const assets=copyOwnedAssets(
    path.join(profile,'OrdaX','OrchestratorLab','data','assets'),
    path.join(directory,'assets'));
  // Source may change harmlessly while Electron stays open. The online
  // snapshot is transactional, so only the snapshot's own integrity matters.
  fs.renameSync(provisional,final);
  const payload=fs.readFileSync(final);
  const manifest={
   schema:'ordax.lab.dev-recovery-point.v1',
   sourceProfileFingerprint:fingerprint(profile),
   createdAt:new Date().toISOString(),
   sourceDbWasReadOnly:true,
   sourceActiveRunsAtPreflight:state.activeRuns,
   snapshot,assets,
   sha256:crypto.createHash('sha256').update(payload).digest('hex'),
   bytes:payload.length,
   restorePerformed:false,
   capturesBrowserCredentials:false,
   installedRuntimeCommit:'not_attested',
   requiresRuntimeAttestation:true
  };
  fs.writeFileSync(path.join(directory,'manifest.json'),
    JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({schema:manifest.schema,
    dataBackupReady:true,readyForControlledRestart:false,
    requiresRuntimeAttestation:true,restorePerformed:false,
    snapshotDir:directory,counts:manifest.snapshot,assetCount:assets.length,hashVerified:true,
    providerMessagesSent:0,installedRuntimeCommit:'not_attested'}));
 } catch(e) {
  // Only delete files this invocation created, never another recovery point.
  try {fs.rmSync(directory,{recursive:true,force:true});}catch{}
  throw e;
 }
}
main().catch(error=>{
 const allow=new Set(['lab_e2e_staged_profile_required',
  'lab_e2e_explicit_approval_required','upgrade_source_database_missing',
  'upgrade_source_integrity_failed','upgrade_active_run_blocked',
  'upgrade_snapshot_active_run_blocked']);
 console.error(JSON.stringify({schema:'ordax.lab.dev-recovery-point.v1',
  ok:false,reason:allow.has(error?.message)?error.message:'upgrade_preflight_failed'}));
 process.exitCode=2;
});