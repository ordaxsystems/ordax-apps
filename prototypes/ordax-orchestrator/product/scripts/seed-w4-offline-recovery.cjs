// Seed only a NEW, explicitly approved isolated OrdaX Lab E2E profile.
// This simulates a partially observed provider Run in SQLite. It never loads
// the provider, opens an Electron window, sends a prompt or copies credentials.
const fs=require('node:fs');
const {labStagedLocalAppData,labDatabasePath}=require('./e2e-lab-target.cjs');

(async()=>{
 const profile=labStagedLocalAppData();
 const dbPath=labDatabasePath();
 if(fs.existsSync(profile)||fs.existsSync(dbPath))
   throw Error('lab_w4_refuse_existing_profile');
 const {Store}=await import('../src/store.mjs');
 let store;
 try{
  store=new Store(dbPath);
  const done=store.createTask('W4 Offline Completed Fixture');
  store.appendMessage(done.id,'user','ORDAX_W4_DONE_LOCAL_ONLY');
  store.appendMessage(done.id,'assistant','ORDAX_W4_SYNTHETIC_COMPLETED_REPLY');
  store.checkpoint(done.id,'Synthetic completed checkpoint (local only)');
  const doneRun=store.startRun(done.id);
  store.finishRun(done.id,doneRun);
  const interrupted=store.createTask('W4 Offline Interrupted Fixture');
  store.checkpoint(interrupted.id,'Synthetic checkpoint before interruption');
  const {runId}=store.beginProviderRun(interrupted.id,'ORDAX_W4_INTERRUPTED_LOCAL_ONLY');
  const now=Date.now();
  // These timestamps are deliberately SYNTHETIC, not a provider receipt.
  // They model a crash after a possible send; the real App must fail closed.
  store.recordRunMetrics(interrupted.id,runId,'beta',{
    runStartedAt:now-3000,submitAttemptAt:now-2500,
    submittedAt:now-2000,firstDeltaAt:now-1500,observerUsed:'beta'
  });
  const n=q=>store.db.prepare(q).get().n;
  if(n('SELECT COUNT(*) n FROM tasks')!==2 ||
     n('SELECT COUNT(*) n FROM messages')!==3 ||
     n("SELECT COUNT(*) n FROM runs WHERE status='running'")!==1 ||
     n("SELECT COUNT(*) n FROM runs WHERE status='succeeded'")!==1)
    throw Error('lab_w4_offline_fixture_invalid');
  console.log(JSON.stringify({schema:'ordax.lab.w4-offline-seed.v1',
    synthetic:true,tasks:2,messages:3,runs:2,
    pendingRunStatus:'running',providerMessagesSent:0,W4Certified:false}));
 }finally{store?.close()}
})().catch(error=>{
 const code=String(error?.message||'');
 const allowed=new Set(['lab_w4_refuse_existing_profile','lab_w4_offline_fixture_invalid',
   'lab_e2e_staged_profile_required','lab_e2e_explicit_approval_required']);
 console.error(JSON.stringify({schema:'ordax.lab.w4-offline-seed.v1',pass:false,
   reason:allowed.has(code)?code:'lab_w4_offline_seed_failed'}));
 process.exitCode=2;
});