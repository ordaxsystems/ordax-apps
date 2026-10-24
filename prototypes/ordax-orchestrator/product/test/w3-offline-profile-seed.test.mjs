import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
const script=fileURLToPath(new URL('../scripts/seed-w3-unsubmitted-offline.cjs',import.meta.url));
function seed(profile,approved='1') {
  const result=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:120000,
    env:{...process.env,ORDAX_LAB_E2E_LOCALAPPDATA:profile,
      ORDAX_LAB_E2E_APPROVED:approved,ORDAX_LAB_E2E_DEBUG_PORT:'9445'}});
  assert.ifError(result.error);
  return result;
}
test('W3 preflight seed is isolated, unsubmitted, immutable and creates no receipts',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-w3-seed-'));
  t.after(()=>fs.rmSync(temp,{force:true,recursive:true}));
  const profile=path.join(temp,'candidate-userdata-v0.2.0-alpha.2');
  const first=seed(profile);
  assert.equal(first.status,0,first.stderr);
  const receipt=JSON.parse(first.stdout.trim());
  assert.equal(receipt.synthetic,true);
  assert.equal(receipt.providerMessagesSent,0);
  assert.equal(receipt.receipts,0);
  assert.equal(receipt.W3Certified,false);
  const dbPath=path.join(profile,'OrdaX','OrchestratorLab','data','ordax-orchestrator-lab.sqlite');
  const db=new DatabaseSync(dbPath,{readOnly:true});
  try{
    assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks WHERE chat_url IS NOT NULL').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM messages').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM runs').get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM events WHERE kind='provider.submission.provenance'").get().n,0);
    assert.equal(db.prepare('PRAGMA quick_check(1)').get().quick_check,'ok');
  }finally{db.close()}
  const second=seed(profile);
  assert.equal(second.status,2);
  assert.match(second.stderr,/lab_w3_refuse_existing_profile/);
});
test('W3 preflight seed cannot create a profile without explicit staged approval',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-w3-unapproved-'));
  t.after(()=>fs.rmSync(temp,{force:true,recursive:true}));
  const profile=path.join(temp,'candidate-userdata-v0.2.0-alpha.2');
  const denied=seed(profile,'0');
  assert.equal(denied.status,2);
  assert.match(denied.stderr,/lab_e2e_explicit_approval_required/);
  assert.equal(fs.existsSync(profile),false);
});
test('W3 physical App script requires missing receipt before inspection and zero provider URL change',()=>{
  const source=fs.readFileSync(new URL('../scripts/live-ui-w3-offline-preflight.cjs',import.meta.url),'utf8');
  assert.match(source,/assert\.equal\(before\.receipts,0/);
  assert.match(source,/provider_submission_provenance_missing/);
  assert.match(source,/assert\.equal\(await providerUrl\(\),urlBefore/);
  assert.match(source,/assert\.deepEqual\(\{runs:after\.runs,messages:after\.messages,actions:after\.actions\}/);
  assert.match(source,/W3Certified:false/);
  // A valid composer must not bypass the receipt-first negative test.
  assert.doesNotMatch(source,/lab_w3_offline_precondition_not_safe/);
  assert.match(source,/urlBefore===before\.task\.chat_url/);
  assert.doesNotMatch(source,/window\.ordax\.providerStatus\(/);
  const discovery=source.slice(source.indexOf("preflightStage='task_selection'"),
    source.indexOf("preflightStage='task_click'"));
  assert.ok(discovery.includes("document.querySelectorAll"));
  assert.doesNotMatch(discovery,/item\.click\(/);
  assert.equal((source.match(/item\.click\(\)/g)||[]).length,1);
  assert.match(source,/preflightStage='task_click'/);
  assert.doesNotMatch(source,/sendPrompt\(|requestSubmit\(|\.reload\(/);
});
