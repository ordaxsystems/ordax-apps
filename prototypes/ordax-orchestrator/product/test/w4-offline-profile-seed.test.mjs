import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

const seed=new URL('../scripts/seed-w4-offline-recovery.cjs',import.meta.url);
function spawn(profile,approved='1') {
 return spawnSync(process.execPath,[fileURLToPath(seed)],{
   env:{...process.env,ORDAX_LAB_E2E_LOCALAPPDATA:profile,
     ORDAX_LAB_E2E_APPROVED:approved,ORDAX_LAB_E2E_DEBUG_PORT:'9445'},
   encoding:'utf8',timeout:30000
 });
}
test('W4 offline seed creates only synthetic interrupted and completed Runs, exactly once',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-w4-offline-seed-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const profile=path.join(root,'candidate-userdata-v0.2.0-alpha.2');
 const dbPath=path.join(profile,'OrdaX','OrchestratorLab','data','ordax-orchestrator-lab.sqlite');
 const first=spawn(profile);
 assert.equal(first.status,0,first.stderr.slice(0,350));
 const receipt=JSON.parse(first.stdout.trim());
 assert.equal(receipt.synthetic,true);
 assert.equal(receipt.providerMessagesSent,0);
 assert.equal(receipt.W4Certified,false);
 const db=new DatabaseSync(dbPath,{readOnly:true});
 let counts;
 try{
  const get=sql=>db.prepare(sql).get().n;
  counts={
   tasks:get('SELECT COUNT(*) n FROM tasks'),
   messages:get('SELECT COUNT(*) n FROM messages'),
   succeeded:get("SELECT COUNT(*) n FROM runs WHERE status='succeeded'"),
   running:get("SELECT COUNT(*) n FROM runs WHERE status='running'"),
   interrupted:get("SELECT COUNT(*) n FROM runs WHERE status='interrupted'"),
   confirmedSubmission:get("SELECT COUNT(*) n FROM runs WHERE metrics LIKE '%submitted_at%'"),
   provisional:get('SELECT COUNT(*) n FROM run_provisional_outputs')
  };
 }finally{db.close()}
 assert.equal(counts.tasks,2);
 assert.equal(counts.messages,3);
 assert.equal(counts.succeeded,1);
 assert.equal(counts.running,1);
 assert.equal(counts.interrupted,0);
 assert.equal(counts.confirmedSubmission,1);
 assert.equal(counts.provisional,1);
 const second=spawn(profile);
 assert.equal(second.status,2);
 assert.match(second.stderr,/lab_w4_refuse_existing_profile/);
 const unchanged=new DatabaseSync(dbPath,{readOnly:true});
 try{
  assert.equal(unchanged.prepare('SELECT COUNT(*) n FROM messages').get().n,3);
  assert.equal(unchanged.prepare('SELECT COUNT(*) n FROM runs').get().n,2);
 }finally{unchanged.close()}
});
test('W4 offline seed rejects missing owner approval before creating a profile',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-w4-seed-denied-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const profile=path.join(root,'candidate-userdata-v0.2.0-alpha.2');
 const result=spawn(profile,'0');
 assert.equal(result.status,2);
 assert.match(result.stderr,/lab_e2e_explicit_approval_required/);
 assert.equal(fs.existsSync(profile),false);
});
