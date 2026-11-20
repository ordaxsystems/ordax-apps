import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';
import {assertPassiveUiOperation,assertPassiveUiMcpMessage,
  PASSIVE_UI_STORAGE_OPERATIONS} from '../src/forge-passive-ui-policy.mjs';

test('App native renderer can read canonical data, but not execute GPT, agents or terminal',()=>{
  for(const tool of ORCHESTRATOR_TOOLS.filter(x=>x.readOnly))
    assert.doesNotThrow(()=>assertPassiveUiOperation(tool.operation),tool.operation);
  for(const name of PASSIVE_UI_STORAGE_OPERATIONS)
    assert.doesNotThrow(()=>assertPassiveUiOperation(name),name);
  assert.doesNotThrow(()=>assertPassiveUiOperation('mission_create'),
    'creating a project with a mission draft is storage, never GPT execution');
  for(const blocked of ['work_send','forjador_send','proposal_send','project_command_run',
    'project_file_write','project_worktree_verify','project_worktree_integrate',
    'work_parallel_launch','work_accept','autonomous_continuous_set',
    'autonomous_dialogue_continue','continuity_set','orchestrator_analyze',
    'orchestrator_prepare','project_delete','work_claim','work_progress','work_memory_set']){
    assert.throws(()=>assertPassiveUiOperation(blocked),/forge_passive_app_mcp_only/,blocked);
  }
  assert.throws(()=>assertPassiveUiOperation('unknown'),/forge_passive_ui_operation_unknown/);
});

test('MCP protocol bridge from renderer cannot bypass the passive UI boundary',()=>{
  assert.doesNotThrow(()=>assertPassiveUiMcpMessage({method:'tools/list'}));
  assert.doesNotThrow(()=>assertPassiveUiMcpMessage({method:'tools/call',
    params:{name:'forge_work_list'}}));
  for(const name of ['forge_project_command_run','forge_work_send','forge_forjador_send',
    'forge_work_claim','forge_project_file_write']){
    assert.throws(()=>assertPassiveUiMcpMessage({method:'tools/call',params:{name}}),
      /forge_passive_app_mcp_only/,name);
  }
});

test('Electron main only reconciles old runs; it does not schedule autonomous GPT cycles',()=>{
  const root=fileURLToPath(new URL('../desktop/main.mjs',import.meta.url));
  const main=fs.readFileSync(root,'utf8');
  assert.match(main,/assertPassiveUiOperation\(payload\?\.operation\)/);
  assert.match(main,/assertPassiveUiMcpMessage\(message\)/);
  const sendBlock=main.slice(main.indexOf("registerUiHandler('ordax:tasks:send'"),
    main.indexOf('// GPT Web is the sole execution model.'));
  assert.match(sendBlock,/forge_passive_app_mcp_only/);
  assert.doesNotMatch(sendBlock,/runTask\(|orchestratorService\.invoke\(/);
  assert.doesNotMatch(main,/\.autonomous\.tick\(/);
  assert.doesNotMatch(main,/\.continuation\.tick\(/);
  assert.doesNotMatch(main,/\.tickParallelDispatch\(/);
  assert.doesNotMatch(main,/startDevAutonomousForjador\(/);
});
