import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const require=createRequire(import.meta.url);
const {summarize}=require('../scripts/live-w3-readiness.cjs');
const script=fs.readFileSync(new URL('../scripts/live-w3-readiness.cjs',import.meta.url),'utf8');

test('W3 readiness refuses empty staged profile',()=>{
  assert.deepEqual(summarize().reason,'no_linked_task');
  assert.equal(summarize().ready,false);
  assert.equal(summarize().W3Certified,false);
});
test('W3 readiness refuses linked thread without recorded receipt',()=>{
  const x=summarize({linkedTasks:1,latestReceiptTasks:0,health:{auth:'session_present',observed:true}});
  assert.equal(x.reason,'missing_latest_submission_receipt');
  assert.equal(x.providerMessagesSent,0);
});
test('W3 readiness refuses unavailable login and restricted provider',()=>{
  const base={linkedTasks:1,latestReceiptTasks:1};
  assert.equal(summarize({...base,health:{auth:'login_required'}}).reason,'provider_login_required');
  assert.equal(summarize({...base,health:{auth:'session_present',restriction:true,observed:true}}).reason,'provider_restricted');
  assert.equal(summarize({...base,health:{auth:'unknown'}}).reason,'provider_health_unknown');
});
test('ready means only prerequisites, never W3 certification',()=>{
  const x=summarize({linkedTasks:1,latestReceiptTasks:1,health:{auth:'session_present',observed:true}});
  assert.equal(x.reason,'ready_for_manual_w3');
  assert.equal(x.ready,true);
  assert.equal(x.W3Certified,false);
});
test('readiness runner cannot send, navigate, or alter SQLite',()=>{
  assert.match(script,/waitForLabAppMode\(evaluate\)/);
  assert.match(script,/new DatabaseSync\(filename,\{readOnly:true\}\)/);
  assert.doesNotMatch(script,/sendPrompt\(|requestSubmit\(|\.reload\(|showConversation\(|\.navigate\(|\.exec\(|\.run\(/);
});
