// W3 negative test fixture: one local user turn + a canonical conversation link.
// No actual ChatGPT submission, network call, cookie, or historic receipt.
const fs=require('node:fs');
const {labStagedLocalAppData,labDatabasePath}=require('./e2e-lab-target.cjs');
(async()=>{
  const profile=labStagedLocalAppData(),dbPath=labDatabasePath();
  if(fs.existsSync(profile)||fs.existsSync(dbPath))
    throw new Error('lab_w3_refuse_existing_profile');
  const {Store}=await import('../src/store.mjs');
  const store=new Store(dbPath);
  try {
    const task=store.createTask('P5 W3 Offline Preflight Fixture');
    store.appendMessage(task.id,'user','ORDAX_W3_LOCAL_UNSUBMITTED_FIXTURE');
    store.setChatUrl(task.id,'https://chatgpt.com/c/11111111-2222-4333-8444-555555555555');
    const count=sql=>store.db.prepare(sql).get().n;
    if(count('SELECT COUNT(*) n FROM tasks')!==1 ||
      count('SELECT COUNT(*) n FROM messages')!==1 ||
      count('SELECT COUNT(*) n FROM runs')!==0 ||
      count("SELECT COUNT(*) n FROM events WHERE kind='provider.submission.provenance'")!==0)
      throw Error('lab_w3_fixture_invalid');
    console.log(JSON.stringify({schema:'ordax.lab.w3-unsubmitted-seed.v1',
      synthetic:true,receipts:0,runs:0,tasks:1,providerMessagesSent:0,W3Certified:false}));
  }finally{store.close()}
})().catch(error=>{
  const allowed=new Set(['lab_w3_refuse_existing_profile','lab_w3_fixture_invalid',
    'lab_e2e_staged_profile_required','lab_e2e_explicit_approval_required']);
  console.error(JSON.stringify({schema:'ordax.lab.w3-unsubmitted-seed.v1',pass:false,
    reason:allowed.has(error?.message)?error.message:'lab_w3_seed_failed'}));
  process.exitCode=2;
});
