import test from 'node:test';
import assert from 'node:assert/strict';
import {assertForgeGitTransport} from '../authority-policy.mjs';

test('only conversation entrypoint may send, through Forge MCP',()=>{
  assert.deepEqual(assertForgeGitTransport({agentId:'forjador'}),{
    role:'forjador',requiresMcp:true,ownsProjectState:false,
    ownsWorkRuns:false,ownsGit:false
  });
  for(const agentId of ['agent-1','agent-2','unknown'])
    assert.throws(()=>assertForgeGitTransport({agentId}),
      /forge_core_owns_work_dispatch/);
});
test('app cannot run its former autonomous task scheduler',()=>{
  assert.throws(()=>assertForgeGitTransport({agentId:'forjador',autoContinue:true}),
    /forge_core_owns_continuity/);
  assert.throws(()=>assertForgeGitTransport({agentId:'forjador',continuation:true}),
    /forge_core_owns_continuity/);
});
