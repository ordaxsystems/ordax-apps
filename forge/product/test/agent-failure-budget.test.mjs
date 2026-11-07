import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseAgentFailure,describeAgentDiagnosticForGroq} from '../src/agent-failure-diagnosis.mjs';

test('pending hydration is not mistaken for failed or delivered GPT message',()=>{
 const d=diagnoseAgentFailure({code:'composer_not_found',stage:'preflight',
  deliveryState:'not_submitted',health:{page_state:'hydrating'},ageMs:15000});
 assert.equal(d.severity,'wait');assert.equal(d.autoRetry,false);
 assert.equal(d.replayAllowed,false);assert.equal(d.evidence.elapsedMs,15000);
});
test('persistent loading expires into actionable root-cause diagnosis',()=>{
 const d=diagnoseAgentFailure({code:'composer_not_found',stage:'preflight',
  deliveryState:'not_submitted',health:{page_state:'loading'},ageMs:45000});
 assert.equal(d.severity,'stop');assert.equal(d.category,'pre_submit_load_deadline_exceeded');
 assert.equal(d.operatorAction,'inspect_navigation_or_session_root_cause');
});
test('unknown or possibly delivered submission always overrides loading hints',()=>{
 for(const deliveryState of ['submitted','uncertain','unknown']){
   const d=diagnoseAgentFailure({code:'provider_navigation_timeout',stage:'sending_b',
    deliveryState,health:{page_state:'loading'},ageMs:100});
   assert.equal(d.category,'delivery_unconfirmed');
   assert.equal(d.replayAllowed,false);assert.equal(d.autoRetry,false);
   const g=describeAgentDiagnosticForGroq(d);
   assert.equal(g.mayResend,false);assert.equal(g.mayClaimRecovery,false);
 }
});
test('auth/login failure is a blocker, not wait or retry',()=>{
 const d=diagnoseAgentFailure({code:'chatgpt_auth_required',stage:'preflight',
  deliveryState:'not_submitted',ageMs:1000});
 assert.equal(d.category,'confirmed_pre_submit_blocker');
 assert.equal(d.severity,'stop');
});