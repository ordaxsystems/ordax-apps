import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';

const operations=new Set(ORCHESTRATOR_TOOLS.map(tool=>tool.operation));

test('semantic follow-up is decided by GPT chats, not an App continuation engine',()=>{
  for(const operation of [
    'continuity_set','continuity_followup_prepare','autonomous_dialogue_continue',
    'orchestrator_analyze','orchestrator_prepare'
  ]) assert.equal(operations.has(operation),false,operation);
  for(const operation of ['work_create','work_dependency_set','work_plan','work_claim','work_progress'])
    assert.ok(operations.has(operation),operation);
});

test('historical continuation and autonomous ledgers expose no tick/start/continue methods',()=>{
  const continuation=fs.readFileSync(new URL('../src/lab-continuation.mjs',import.meta.url),'utf8');
  const autonomous=fs.readFileSync(new URL('../src/autonomous-dialogue.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(continuation,/\btick\(|\bconfigure\(|tickPeriodic\(/);
  assert.doesNotMatch(autonomous,/\bstart\(context|continueTechnical\(|setContinuousExecution\(|\btick\(/);
  assert.match(continuation,/legacyRecordOnly:true/);
  assert.match(autonomous,/legacyRecordOnly:true/);
});

test('new continuation is expressed as durable work and claims',()=>{
  const context=fs.readFileSync(new URL('../src/forge-executor-context.mjs',import.meta.url),'utf8');
  assert.match(context,/forge_work_plan/);
  assert.match(context,/forge_work_claim/);
  assert.match(context,/forge_work_progress/);
  assert.match(context,/forge_work_memory_set/);
});
