import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';

const operations=new Set(ORCHESTRATOR_TOOLS.map(tool=>tool.operation));

test('App-owned semantic Run review was removed from the executable contract',()=>{
  for(const operation of ['orchestrator_analyze','orchestrator_prepare','proposal_review','continuity_followup_prepare'])
    assert.equal(operations.has(operation),false,operation);
  assert.ok(operations.has('continuity_status'));
  assert.equal(ORCHESTRATOR_TOOLS.find(x=>x.operation==='continuity_status').readOnly,true);
});

test('historical continuation is projection-only and cannot invoke analysis',()=>{
  const continuation=fs.readFileSync(new URL('../src/lab-continuation.mjs',import.meta.url),'utf8');
  const service=fs.readFileSync(new URL('../src/orchestrator-service.mjs',import.meta.url),'utf8');
  assert.match(continuation,/legacyRecordOnly:true/);
  assert.doesNotMatch(continuation,/service\.invoke\(context,'orchestrator_analyze'|\btick\(|\bconfigure\(/);
  assert.doesNotMatch(service,/dispatchLocalCoordination|appOwnedRunReview|appOwnedAnalysisSummary/);
});

test('external-effect verification remains separate from a GPT response',()=>{
  const plan=fs.readFileSync(new URL('../src/work-plan-read-model.mjs',import.meta.url),'utf8');
  assert.match(plan,/effectVerified/);
  assert.match(plan,/verificationRequired/);
});
