import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {createOrchestratorMcp} from '../src/orchestrator-mcp.mjs';
import {readForgeGitMemory} from '../src/forge-git-memory-view.mjs';
import {openProjectMemory,memoryFile} from '../../../forge-git/project-memory.mjs';

function fixture(t){
  const appDataRoot=mkdtempSync(path.join(os.tmpdir(),'forge-git-mcp-projection-'));
  t.after(()=>rmSync(appDataRoot,{recursive:true,force:true}));
  const directory=path.join(appDataRoot,'OrdaX','ForgeGit');
  return {appDataRoot,directory,canonical:openProjectMemory(directory)};
}
// Historical v1 bytes are a read-only migration fixture. Forge Git is not
// authorized to recreate these agent, Git, plan, or event writes.
function seedHistoricalFixture(directory,canonical){
  const state=canonical.snapshot();
  state.observed={base:'main',sha:'f'.repeat(40),at:'2026-11-16T19:30:00Z'};
  const worker=state.agents.find(agent=>agent.id==='agent-2');
  worker.branch='forge-git/agent-2-2b64f1cd';
  worker.lastHead='a'.repeat(40);
  worker.chatUrl='https://chatgpt.com/c/secret-connection';
  worker.task='Sensitive prompt not for MCP';
  worker.autoContinue=true;worker.autoRounds=2;
  state.events=[{kind:'github_revision',agent:'agent-2',sha:'a'.repeat(40),
    detail:'GitHub verified commit',forCoordinator:true}];
  state.inbox=[{id:'legacy_event',delivered:false}];
  mkdirSync(directory,{recursive:true});
  const file=memoryFile(directory);
  writeFileSync(file,JSON.stringify(state));
  return {file,state};
}

test('MCP projects a historical Forge Git display checkpoint read-only without copying, writing or new authority',t=>{
  const {appDataRoot,directory,canonical}=fixture(t);
  const {file,state}=seedHistoricalFixture(directory,canonical);
  const before=readFileSync(file,'utf8');
  const view=readForgeGitMemory(appDataRoot);
  assert.equal(view.schema,'ordax.forge-git.memory-view/1');
  assert.equal(view.available,true);
  assert.equal(view.repository,state.repository);
  assert.equal(view.revision,state.revision);
  assert.equal(view.agents.find(a=>a.id==='agent-2').lastHead,'a'.repeat(40));
  assert.equal(view.pendingForCoordinator,1);
  assert.equal(view.events.at(-1).sha,'a'.repeat(40));
  assert.equal(view.observed.head,'f'.repeat(40));
  assert.equal(view.liveGithubChecked,false);
  assert.doesNotMatch(JSON.stringify(view),/secret-connection|Sensitive prompt|autoGoal|chatUrl/);
  assert.equal(readFileSync(file,'utf8'),before,'MCP projection must not mutate historical bytes');
  const reopened=openProjectMemory(directory);
  assert.throws(()=>reopened.patch('agent-2',{lastHead:'b'.repeat(40)}),
    /forge_core_owns_historical_agent/);
  assert.throws(()=>reopened.patch('forjador',{lastHead:'b'.repeat(40)}),
    /forge_core_owns_project_memory/);
  assert.equal(typeof reopened.observe,'undefined');
  assert.equal(typeof reopened.event,'undefined');
  assert.equal(readFileSync(file,'utf8'),before);
});

test('MCP projection fails closed on missing and invalid historical memory',t=>{
  const appDataRoot=mkdtempSync(path.join(os.tmpdir(),'forge-git-mcp-unavailable-'));
  t.after(()=>rmSync(appDataRoot,{recursive:true,force:true}));
  const missing=readForgeGitMemory(appDataRoot);
  assert.equal(missing.available,false);
  assert.equal(missing.reason,'forge_git_not_initialized');
  assert.throws(()=>readForgeGitMemory('relative-folder'),/forge_git_profile_invalid/);
  const {appDataRoot:ownedProfile,directory,canonical}=fixture(t);
  const {file,state}=seedHistoricalFixture(directory,canonical);
  writeFileSync(file,JSON.stringify({...state,repository:'https://example.com/not-a-repo'}));
  assert.throws(()=>readForgeGitMemory(ownedProfile),/forge_git_memory_invalid/);
});

test('Native owner MCP reuses forge_project_memory read-only without expanding tool catalog',async t=>{
  const {appDataRoot,directory,canonical}=fixture(t);
  seedHistoricalFixture(directory,canonical);
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const context={actorId:'owner',clientId:'app',
    workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,authorize:({context:who})=>who===context});
  const mcp=createOrchestratorMcp({service,getContext:()=>context,
    allowedOperations:['project_memory']});
  const init={jsonrpc:'2.0',id:1,method:'initialize',
    params:{protocolVersion:'2025-11-25',capabilities:{},
      clientInfo:{name:'test',version:'1'}}};
  await mcp.handle(init);
  await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const listing=await mcp.handle({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
  assert.deepEqual(listing.result.tools.map(x=>x.name),['forge_project_memory']);
  const withoutPort=await mcp.handle({jsonrpc:'2.0',id:3,method:'tools/call',
    params:{name:'forge_project_memory',arguments:{projectId:'forge_git'}}});
  assert.equal(withoutPort.result.isError,true);
  service.forgeGitMemoryPort={
    isOwnerContext:who=>who===context,
    read:()=>readForgeGitMemory(appDataRoot)
  };
  const response=await mcp.handle({jsonrpc:'2.0',id:4,method:'tools/call',
    params:{name:'forge_project_memory',arguments:{projectId:'forge_git'}}});
  assert.equal(response.result.structuredContent.observed.head,'f'.repeat(40));
  assert.equal(response.result.structuredContent.available,true);
  assert.equal(response.result.structuredContent.liveGithubChecked,false);
  const bad=await mcp.handle({jsonrpc:'2.0',id:5,method:'tools/call',
    params:{name:'forge_project_memory',arguments:{projectId:'other'}}});
  assert.equal(bad.result.isError,true);
  const noAuth={...context,actorId:'foreign'};
  const unauthorized=createOrchestratorMcp({service,getContext:()=>noAuth,
    allowedOperations:['project_memory']});
  await unauthorized.handle(init);
  await unauthorized.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const blocked=await unauthorized.handle({jsonrpc:'2.0',id:6,method:'tools/call',
    params:{name:'forge_project_memory',arguments:{projectId:'forge_git'}}});
  assert.ok(blocked.error||blocked.result?.isError===true);
});