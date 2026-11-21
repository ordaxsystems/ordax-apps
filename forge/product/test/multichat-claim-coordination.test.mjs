import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';
import {FORGE_APP_MCP_OPERATIONS} from '../src/forge-loopback-mcp.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const read=name=>fs.readFileSync(path.join(here,'..',name),'utf8');

test('multichat coordination exposes claims and never an App-owned GPT dispatcher',()=>{
  const operations=new Set(ORCHESTRATOR_TOOLS.map(tool=>tool.operation));
  for(const operation of ['work_claim','work_progress','work_memory_set','work_plan','work_list','work_get'])
    assert.ok(operations.has(operation),operation);
  for(const operation of ['work_send','forjador_send','proposal_send','work_parallel_launch']){
    assert.equal(operations.has(operation),false,operation);
    assert.equal(FORGE_APP_MCP_OPERATIONS.includes(operation),false,operation);
  }
});

test('service contains no child-worker launch loop or provider dispatch core',()=>{
  const service=read('src/orchestrator-service.mjs');
  assert.doesNotMatch(service,/tickParallelDispatch|prepareParallelLaunch|dispatchCore|confirmAndSendProposal/);
  assert.doesNotMatch(service,/dispatch\(context,'work_send'|operation==='work_send'/);
  assert.match(service,/\['work_claim','work_progress','work_memory_set'\]/);
});

test('canonical GPT guidance coordinates independent chats through leases',()=>{
  const context=read('src/forge-executor-context.mjs');
  assert.match(context,/forge_work_plan/);
  assert.match(context,/forge_work_claim/);
  assert.match(context,/forge_work_progress/);
  assert.match(context,/forge_work_memory_set/);
  assert.match(context,/Each GPT chat independently acquires its chosen Task/);
  assert.match(context,/Forge never spawns child GPT workers/);
  assert.doesNotMatch(context,/forge_work_parallel_launch|raw work_send|available provider lanes/);
});
