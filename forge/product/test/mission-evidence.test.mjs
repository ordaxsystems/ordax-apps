import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateMissionEvidence} from '../src/mission-evidence.mjs';
const req=[{id:'correctness',description:'Resultado correto'},{id:'provenance',description:'Fontes observadas'}];
const checks=[{id:'correctness',status:'passed',method:'deterministic',evidenceIds:['run:1']},
{id:'provenance',status:'passed',method:'independent_review',evidenceIds:['review:2']}];
const run=(execution={status:'succeeded'},requirements=req,items=checks)=>
 evaluateMissionEvidence({execution,requirements,checks:items});
test('coding: green execution does not certify an unverified regression',()=>{
 const result=run({status:'succeeded'},req,checks.slice(0,1));
 assert.equal(result.verified,false);assert.equal(result.outcome,'verification_incomplete');
});
test('research: claims without source review are not accepted',()=>{
 const result=run({status:'succeeded'},req,[checks[0],
 {...checks[1],status:'failed',evidenceIds:['review:unsupported']}]);
 assert.equal(result.outcome,'requirements_failed');
});
test('mathematics: incorrect result cannot be masked by successful transport',()=>{
 assert.equal(run({status:'succeeded'},req,[{...checks[0],status:'failed'},checks[1]]).verified,false);
});
test('creative writing: independent review plus explicit evidence can approve',()=>{
 assert.equal(run().outcome,'verified');
});
test('application operation: uncertain delivery can never be marked verified',()=>{
 assert.equal(run({status:'uncertain'}).outcome,'execution_not_confirmed');
 assert.equal(run({status:'blocked'}).verified,false);
});
test('multi-project: checks cannot be attached to unknown or duplicate criteria',()=>{
 assert.throws(()=>run({status:'succeeded'},req,[...checks,checks[0]]),/mission_check_invalid/);
 assert.throws(()=>run({status:'succeeded'},req,[{...checks[0],id:'foreign'},checks[1]]),/mission_check_invalid/);
});
test('untrusted model output cannot fabricate check evidence',()=>{
 assert.throws(()=>run({status:'succeeded'},req,[{...checks[0],evidenceIds:[]},checks[1]]),/mission_check_invalid/);
 assert.throws(()=>run({status:'succeeded'},req,[{...checks[0],status:'success'},checks[1]]),/mission_check_invalid/);
});
test('incomplete inspection remains explicitly unverified',()=>{
 assert.equal(run({status:'succeeded'},req,[{...checks[0],status:'not_evaluated',evidenceIds:[]},checks[1]]).outcome,'verification_incomplete');
});
