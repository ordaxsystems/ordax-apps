import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const {w3OfflineFailure}=require('../scripts/w3-offline-error-report.cjs');

test('W3 E2E exposes a safe fixed stage and reason for provider UI timeout',()=>{
  assert.deepEqual(w3OfflineFailure(new Error('lab_w3_ui_timeout'),'inspection_result'),{
    schema:'ordax.lab.w3-offline-preflight.v1',
    pass:false,
    reason:'lab_w3_ui_timeout',
    stage:'inspection_result'
  });
});

test('W3 E2E refuses arbitrary error text, credentials or dynamic stage injection',()=>{
  const raw='https://chatgpt.com/c/private?access_token=secret user@example.com';
  const report=w3OfflineFailure(new Error(raw),raw);
  assert.equal(report.reason,'lab_w3_offline_inspection_unavailable');
  assert.equal(report.stage,'unknown');
  assert.doesNotMatch(JSON.stringify(report),/access_token|secret|private|@|https:/);
});

test('W3 E2E distinguishes read-only startup discovery failures without disclosing detail',()=>{
  const result=w3OfflineFailure(new Error('ECONNREFUSED 127.0.0.1'),'lab_ui_target');
  assert.equal(result.stage,'lab_ui_target');
  assert.equal(result.reason,'lab_w3_offline_inspection_unavailable');
  assert.deepEqual(Object.keys(result).sort(),['pass','reason','schema','stage']);
});

test('W3 E2E stage reporting remains connected to the real App-only preflight',()=>{
  const source=readFileSync(new URL('../scripts/live-ui-w3-offline-preflight.cjs',import.meta.url),'utf8');
  assert.match(source,/preflightStage='app_profile'/);
  assert.match(source,/preflightStage='inspection_result'/);
  assert.match(source,/preflightStage='final_profile_check'/);
  assert.match(source,/w3OfflineFailure\(error,preflightStage\)/);
  assert.doesNotMatch(source,/sendPrompt\(|requestSubmit\(/);
});
