import test from 'node:test';
import assert from 'node:assert/strict';
import {assessDevCutover} from '../src/dev-cutover-policy.mjs';
const digest='a'.repeat(64);
const verified={verified:true,status:'verified',contentDigest:digest};
const recovery={dataBackupReady:true,hashVerified:true,rollbackRuntimeDigest:digest};
test('no restart if current process cannot attest its loaded build',()=>{
 const result=assessDevCutover({currentBuild:{status:'unattested',verified:false},
  candidateBuild:verified,recovery,activeRuns:0});
 assert.equal(result.ready,false);
 assert.equal(result.reason,'current_runtime_unattested');
});
test('candidate, database, active-run and previous-code gates independently fail closed',()=>{
 assert.equal(assessDevCutover({currentBuild:verified,candidateBuild:null,recovery,activeRuns:0}).reason,'candidate_not_verified');
 assert.equal(assessDevCutover({currentBuild:verified,candidateBuild:verified,recovery,activeRuns:1}).reason,'active_or_unknown_runs');
 assert.equal(assessDevCutover({currentBuild:verified,candidateBuild:verified,recovery:null,activeRuns:0}).reason,'recovery_not_verified');
 assert.equal(assessDevCutover({currentBuild:verified,candidateBuild:verified,recovery:{...recovery,rollbackRuntimeDigest:null},activeRuns:0}).reason,'previous_code_not_preserved');
});
test('gate can pass only with identical preserved previous-runtime hash and verified database',()=>{
 const result=assessDevCutover({currentBuild:verified,candidateBuild:verified,recovery,activeRuns:0});
 assert.equal(result.ready,true);
 assert.equal(result.reason,'reversible_cutover_preconditions_met');
 assert.equal(result.restartPerformed,false);
});
