import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';

const operations=new Set(ORCHESTRATOR_TOOLS.map(tool=>tool.operation));

test('shared memory is a Forge MCP/storage capability, not a Forjador send side effect',()=>{
  for(const operation of ['project_memory','project_memory_propose','work_memory_set'])
    assert.ok(operations.has(operation),operation);
  assert.equal(operations.has('forjador_send'),false);
  assert.equal(operations.has('work_send'),false);
});

test('claimed Task memory is described as shared unverified GPT context',()=>{
  const contract=fs.readFileSync(new URL('../src/forge-contract.mjs',import.meta.url),'utf8');
  assert.match(contract,/\['work_memory_set','Write an unverified GPT note/);
  assert.match(contract,/visible to other chats via project_memory and handoff/);
  assert.match(contract,/Never certifies external effects/);
});

test('App service has no provider-backed memory/chat path',()=>{
  const service=fs.readFileSync(new URL('../src/orchestrator-service.mjs',import.meta.url),'utf8');
  const kernel=fs.readFileSync(new URL('../src/orchestrator-kernel.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(service,/\bthis\.provider\b|startDevAutonomousForjador|operation==='forjador_send'|dispatchCore/);
  assert.doesNotMatch(kernel,/\bprovider\s*=|confirmProposal|continuousExecutionByDefault/);
});
