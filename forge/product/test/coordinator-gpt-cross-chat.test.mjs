import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';
import {FORGE_APP_MCP_OPERATIONS} from '../src/forge-loopback-mcp.mjs';

const operations=new Set(ORCHESTRATOR_TOOLS.map(tool=>tool.operation));

test('cross-chat coordination is Task-claim based, not App-dispatched GPT',()=>{
  for(const operation of ['work_plan','work_claim','work_progress','work_memory_set','work_list','project_memory'])
    assert.ok(operations.has(operation),operation);
  for(const operation of ['work_send','forjador_send','proposal_send','orchestrator_analyze','orchestrator_prepare'])
    assert.equal(operations.has(operation),false,operation);
  for(const operation of ['work_claim','work_progress','work_memory_set'])
    assert.ok(FORGE_APP_MCP_OPERATIONS.includes(operation),operation);
});

test('service contains no cross-chat provider dispatch or local coordinator brain',()=>{
  const source=fs.readFileSync(new URL('../src/orchestrator-service.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/dispatchCore|confirmAndSendProposal|startDevAutonomousForjador|dispatchLocalCoordination/);
  assert.doesNotMatch(source,/operation==='work_send'|operation==='forjador_send'|operation==='orchestrator_analyze'/);
});

test('GPT execution guidance tells independent chats to claim durable Tasks',()=>{
  const source=fs.readFileSync(new URL('../src/forge-executor-context.mjs',import.meta.url),'utf8');
  assert.match(source,/forge_work_claim/);
  assert.match(source,/forge_work_progress/);
  assert.match(source,/forge_work_memory_set/);
  assert.match(source,/Each GPT chat independently acquires its chosen Task/);
  assert.match(source,/Forge never spawns child GPT workers/);
});
