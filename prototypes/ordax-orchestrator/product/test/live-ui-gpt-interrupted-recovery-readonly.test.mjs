import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const file=fileURLToPath(new URL('../scripts/live-ui-gpt-interrupted-recovery-readonly.cjs',import.meta.url));
const script=fs.readFileSync(file,'utf8');

test('physical GPT recovery gate compiles and refuses missing explicit staged task scope',()=>{
  const syntax=spawnSync(process.execPath,['--check',file],{encoding:'utf8',timeout:5000});
  assert.equal(syntax.status,0,syntax.stderr);
  const rejected=spawnSync(process.execPath,[file],{
    encoding:'utf8',timeout:5000,
    env:{...process.env,ORDAX_LAB_E2E_TASK_ID:'',ORDAX_LAB_E2E_RECOVERY_READONLY:''}
  });
  assert.notEqual(rejected.status,0);
  assert.match(rejected.stderr,/lab_recovery_explicit_task_approval_required/);
  assert.doesNotMatch(rejected.stderr,/cookie|access.token|private.key/i);
});

test('physical recovery inspector requires a receipt and never imports, resends or prints the reply',()=>{
  assert.match(script,/ORDAX_LAB_E2E_RECOVERY_READONLY/);
  assert.match(script,/ORDAX_LAB_E2E_TASK_ID/);
  assert.match(script,/waitForLabAppMode\(evaluate\)/);
  assert.match(script,/kind='provider\.submission\.provenance'/);
  assert.match(script,/receipt\.run_id!==run\.id/);
  assert.match(script,/receipt\.message_id!==message\.id/);
  assert.match(script,/receipt\.conversation_id!==active\?\.id/);
  assert.match(script,/status='active'/);
  assert.match(script,/#inspectLinkedThread'\)\.click\(\)/);
  assert.match(script,/assert\.deepEqual\(after,before,'lab_recovery_mutated_canonical_ledger'\)/);
  assert.doesNotMatch(script,/#confirmLinkedReplyRecovery'\)\.click\(\)/);
  assert.doesNotMatch(script,/\.sendPrompt\(|\.requestSubmit\(|\.reconcileLinkedReply\(/);
  assert.doesNotMatch(script,/console\.log\(.*previewChars/);
  assert.match(script,/providerMessagesSent:0,repliesImported:0/);
});
