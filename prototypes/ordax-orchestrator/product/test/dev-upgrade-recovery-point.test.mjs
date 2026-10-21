import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../src/store.mjs';

const script=fileURLToPath(new URL('../scripts/create-dev-recovery-point.cjs',import.meta.url));
function call(profile,approval='1') {
  return spawnSync(process.execPath,[script],{encoding:'utf8',timeout:40000,
    env:{...process.env,ORDAX_LAB_E2E_LOCALAPPDATA:profile,
      ORDAX_LAB_E2E_APPROVED:approval,ORDAX_LAB_E2E_DEBUG_PORT:'9445'}});
}
function fixture(t) {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-preupgrade-'));
  const profile=path.join(temp,'candidate-userdata-v0.2.0-alpha.2');
  const dbFile=path.join(profile,'OrdaX','OrchestratorLab','data','ordax-orchestrator-lab.sqlite');
  const store=new Store(dbFile);
  t.after(()=>{store.close();fs.rmSync(temp,{recursive:true,force:true});});
  return {store,profile,dbFile};
}
test('preflight makes a consistent online SQLite plus asset backup without changing open source',t=>{
 const {store,profile,dbFile}=fixture(t);
 const task=store.createTask('Source must survive upgrade');
 const run=store.beginProviderRun(task.id,'Synthetic');
 store.appendMessage(task.id,'assistant','Completed synthetic answer');
 store.finishRun(task.id,run.runId);
 const assetDir=path.join(profile,'OrdaX','OrchestratorLab','data','assets','task_123');
 fs.mkdirSync(assetDir,{recursive:true});
 fs.writeFileSync(path.join(assetDir,'one.png'),Buffer.from('synthetic asset content'));
 const output=call(profile);
 assert.equal(output.status,0,output.stderr);
 const receipt=JSON.parse(output.stdout.trim());
 assert.equal(receipt.schema,'ordax.lab.dev-recovery-point.v1');
 assert.equal(receipt.dataBackupReady,true);
 assert.equal(receipt.readyForControlledRestart,false);
 assert.equal(receipt.requiresRuntimeAttestation,true);
 assert.equal(receipt.providerMessagesSent,0);
 assert.equal(receipt.assetCount,1);
 assert.equal(receipt.counts.tasks,1);
 assert.equal(receipt.counts.messages,2);
 const recovery=receipt.snapshotDir;
 assert.ok(recovery.startsWith(profile+path.sep));
 const manifest=JSON.parse(fs.readFileSync(path.join(recovery,'manifest.json'),'utf8'));
 const backup=fs.readFileSync(path.join(recovery,'snapshot.sqlite'));
 assert.equal(createHash('sha256').update(backup).digest('hex'),manifest.sha256);
 assert.equal(manifest.installedRuntimeCommit,'not_attested');
 assert.equal(manifest.requiresRuntimeAttestation,true);
 assert.equal(manifest.capturesBrowserCredentials,false);
 assert.equal(manifest.assets.length,1);
 assert.equal(fs.readFileSync(path.join(recovery,'assets','task_123','one.png'),'utf8'),'synthetic asset content');
 const recovered=new DatabaseSync(path.join(recovery,'snapshot.sqlite'),{readOnly:true});
 try{
  assert.equal(recovered.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal(recovered.prepare('SELECT COUNT(*) n FROM messages').get().n,2);
 }finally{recovered.close()}
 assert.equal(store.db.prepare('SELECT COUNT(*) n FROM messages').get().n,2);
 assert.equal(fs.existsSync(dbFile),true);
});
test('preflight refuses active provider Run before creating any recovery directory',t=>{
 const {store,profile}=fixture(t);
 const task=store.createTask('Pending');
 store.beginProviderRun(task.id,'Uncertain transport');
 const output=call(profile);
 assert.equal(output.status,2);
 assert.match(output.stderr,/upgrade_active_run_blocked/);
 assert.equal(fs.existsSync(path.join(profile,'OrdaX','OrchestratorLab','recovery')),false);
});
test('preflight refuses missing explicit staged permission before touching any profile',t=>{
 const {profile}=fixture(t);
 const output=call(profile,'0');
 assert.equal(output.status,2);
 assert.match(output.stderr,/lab_e2e_explicit_approval_required/);
 assert.equal(fs.existsSync(profile),true);
  assert.equal(fs.existsSync(path.join(profile,'OrdaX','OrchestratorLab','recovery')),false);
});
