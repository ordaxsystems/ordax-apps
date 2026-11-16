import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {createOrchestratorMcp} from '../src/orchestrator-mcp.mjs';
import {readForgeGitMemory} from '../src/forge-git-memory-view.mjs';
import {openProjectMemory,memoryFile} from '../../../forge-git/project-memory.mjs';

function fixture(t){
 const appDataRoot=mkdtempSync(path.join(os.tmpdir(),'forge-git-mcp-projection-'));
 t.after(()=>rmSync(appDataRoot,{recursive:true,force:true}));
 const canonical=openProjectMemory(path.join(appDataRoot,'OrdaX','ForgeGit'));
 return {appDataRoot,canonical};
}
test('MCP reads the same persisted Forge Git checkpoint without copying or writing',t=>{
 const {appDataRoot,canonical}=fixture(t);
 canonical.patch('agent-2',{branch:'forge-git/agent-2-2b64f1cd',
   lastHead:'a'.repeat(40),chatUrl:'https://chatgpt.com/c/secret-connection',
   task:'Sensitive prompt not for MCP',autoContinue:true,autoRounds:2});
 canonical.event({kind:'github_revision',agent:'agent-2',
   sha:'a'.repeat(40),detail:'GitHub verified commit',forCoordinator:true});
 const file=memoryFile(path.join(appDataRoot,'OrdaX','ForgeGit'));
 const before=readFileSync(file,'utf8');
 const view=readForgeGitMemory(appDataRoot);
 assert.equal(view.schema,'ordax.forge-git.memory-view/1');
 assert.equal(view.available,true);
 assert.equal(view.repository,canonical.snapshot().repository);
 assert.equal(view.revision,canonical.snapshot().revision);
 assert.equal(view.agents.find(a=>a.id==='agent-2').lastHead,'a'.repeat(40));
 assert.equal(view.pendingForCoordinator,1);
 assert.equal(view.events.at(-1).sha,'a'.repeat(40));
 assert.equal(view.liveGithubChecked,false);
 assert.doesNotMatch(JSON.stringify(view),/secret-connection|Sensitive prompt|autoGoal|chatUrl/);
 assert.equal(readFileSync(file,'utf8'),before,'the MCP projection must not mutate Forge Git memory');
 canonical.patch('agent-2',{lastHead:'b'.repeat(40)});
 assert.equal(readForgeGitMemory(appDataRoot).agents.at(-1).lastHead,'b'.repeat(40));
});
test('MCP projection fails closed on unavailable or invalid memory',t=>{
 const appDataRoot=mkdtempSync(path.join(os.tmpdir(),'forge-git-mcp-unavailable-'));
 t.after(()=>rmSync(appDataRoot,{recursive:true,force:true}));
 const missing=readForgeGitMemory(appDataRoot);
 assert.equal(missing.available,false);
 assert.equal(missing.reason,'forge_git_not_initialized');
 assert.throws(()=>readForgeGitMemory('relative-folder'),/forge_git_profile_invalid/);
 const {appDataRoot:ownedProfile,canonical}=fixture(t);
 const canonicalFile=memoryFile(path.join(ownedProfile,'OrdaX','ForgeGit'));
 const invalid={...canonical.snapshot(),repository:'https://example.com/not-a-repo'};
 writeFileSync(canonicalFile,JSON.stringify(invalid));
 assert.throws(()=>readForgeGitMemory(ownedProfile),/forge_git_memory_invalid/);
});
test('Native owner MCP publishes one scoped Forge Git memory tool and can read it',async t=>{
 const {appDataRoot,canonical}=fixture(t);
 canonical.observe({base:'main',sha:'f'.repeat(40),at:'2026-11-16T19:30:00Z'});
 const store=new Store(':memory:');
 t.after(()=>store.close());
 const context={actorId:'owner',clientId:'app',
   workspaceSessionId:store.getWorkspaceSession().id};
 const service=new OrchestratorService({store,authorize:({context:who})=>who===context});
 const mcp=createOrchestratorMcp({service,getContext:()=>context,
   allowedOperations:['forge_git_memory']});
 // Not installed in a headless/remote owner without the native app projection.
 const init={jsonrpc:'2.0',id:1,method:'initialize',
   params:{protocolVersion:'2025-11-25',capabilities:{},
     clientInfo:{name:'test',version:'1'}}};
 await mcp.handle(init);
 await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
 const empty=await mcp.handle({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
 assert.ok(!empty.result.tools.some(x=>x.name==='forge_git_memory'));
 service.forgeGitMemoryPort={read:()=>readForgeGitMemory(appDataRoot)};
 const list=await mcp.handle({jsonrpc:'2.0',id:3,method:'tools/list',params:{}});
 assert.deepEqual(list.result.tools.map(x=>x.name),['forge_git_memory']);
 const response=await mcp.handle({jsonrpc:'2.0',id:4,method:'tools/call',
   params:{name:'forge_git_memory',arguments:{}}});
 assert.equal(response.result.structuredContent.observed.head,'f'.repeat(40));
 assert.equal(response.result.structuredContent.available,true);
 const bad=await mcp.handle({jsonrpc:'2.0',id:5,method:'tools/call',
   params:{name:'forge_git_memory',arguments:{projectId:'other'}}});
 assert.equal(bad.result.isError,true);
});