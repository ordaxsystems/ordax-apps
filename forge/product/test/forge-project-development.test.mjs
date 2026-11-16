import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {ForgeProjectDevelopment} from '../src/forge-project-development.mjs';
import {ForgeProjectFiles} from '../src/forge-project-files.mjs';
import {ForgeLocalWorkspaces} from '../src/forge-local-workspaces.mjs';
import {ForgeMcpOwnerTrust} from '../src/forge-mcp-owner-trust.mjs';
import {FORGE_APP_MCP_OPERATIONS} from '../src/forge-loopback-mcp.mjs';
import {createOrchestratorMcp} from '../src/orchestrator-mcp.mjs';

test('full Forge MCP catalog reuses app operations while preventing recursive GPT dispatch',()=>{
  assert.ok(FORGE_APP_MCP_OPERATIONS.length>40);
  for(const name of ['project_rename','project_delete','project_repository_set',
    'project_development_status','project_worktree_prepare','project_worktree_review',
    'project_worktree_verify','project_worktree_integrate','project_command_run','workspace_bind',
    'project_file_write','project_context','command_get'])
    assert.ok(FORGE_APP_MCP_OPERATIONS.includes(name),'tool missing '+name);
  for(const name of ['work_send','forjador_send','proposal_send','autonomous_dialogue_continue'])
    assert.equal(FORGE_APP_MCP_OPERATIONS.includes(name),false);
});

test('one native owner grant enables real terminal, Git and revoke through the same SQLite receipts',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-native-dev-'));
  const folder=path.join(dir,'project');fs.mkdirSync(folder);
  const store=new Store(':memory:');
  t.after(()=>{store.close();fs.rmSync(dir,{force:true,recursive:true})});
  const context={actorId:'owner',clientId:'desktop',workspaceSessionId:store.getWorkspaceSession().id};
  const workspaces=new ForgeLocalWorkspaces({store,documentsDirectory:dir});
  const trust=new ForgeMcpOwnerTrust({store,appIdentity:dir,
    scopeSignature:id=>{
      const bind=workspaces.binding(id);
      return bind?'owner-bound:'+bind.root+':'+bind.identity:'app-private:'+id;
    }});
  const development=new ForgeProjectDevelopment({store,workspaces,ownerTrust:trust});
  const svc=new OrchestratorService({store,development,
    authorize:({context:who})=>who===context});
  const created=await svc.invoke(context,'project_create',{
    name:'Native terminal E2E',requestId:'project_e2e_native_create'});
  const id=created.result.projectId;
  assert.equal((await svc.invoke(context,'project_development_status',{projectId:id})).available,false);
  workspaces.bindSelected(id,folder);
  assert.equal(development.status(id).ownerBoundWorkspace,true);
  assert.equal(development.status(id).available,false);
  await assert.rejects(svc.invoke(context,'project_command_run',{
    projectId:id,requestId:'before_native_approval',command:'echo NEVER_EXECUTE'
  }),/forge_development_owner_approval_required/);
  trust.trustApp();trust.trust(id);
  assert.equal(development.status(id).available,false,'historical MCP approval must not imply terminal approval');
  development.approve(id,{expectedScopeHash:trust.scopeHash(id)});
  assert.equal(development.status(id).available,true);
  const shell=await svc.invoke(context,'project_command_run',{
    projectId:id,requestId:'native_shell_one',command:'echo FORGE_NATIVE_TOOL_OK',
    timeoutMs:15000
  });
  assert.equal(shell.status,'succeeded');
  assert.equal(shell.result.exitCode,0);
  assert.match(shell.result.stdout,/FORGE_NATIVE_TOOL_OK/);
  assert.equal(shell.result.workspaceIsSandbox,false);
  assert.equal(shell.result.externalEffectsVerified,false);
  const previous=await svc.invoke(context,'project_command_run',{
    projectId:id,requestId:'native_shell_one',command:'echo FORGE_NATIVE_TOOL_OK',
    timeoutMs:15000
  });
  assert.equal(previous.commandId,shell.commandId);
  assert.equal(previous.status,'succeeded');
  const git=await svc.invoke(context,'project_command_run',{
    projectId:id,requestId:'native_git_version',command:'git --version',timeoutMs:15000
  });
  assert.equal(git.status,'succeeded');
  assert.match(git.result.stdout,/git version/i);
  await assert.rejects(svc.invoke(context,'project_command_run',{
    projectId:id,requestId:'native_directory_escape',command:'echo NOT_ALLOWED',
    workingDirectory:'../'
  }),/forge_development_directory_invalid/);
  // A revocation also stops an in-flight command rather than merely denying the next one.
  const slow=svc.invoke(context,'project_command_run',{
    projectId:id,requestId:'native_revoke_active',
    command:process.platform==='win32'?'ping -n 8 127.0.0.1 >NUL':'sleep 7',
    timeoutMs:15000
  });
  await new Promise(resolve=>setTimeout(resolve,650));
  development.revoke(id);
  await assert.rejects(slow,/forge_development_scope_changed/);
  const interrupted=store.db.prepare('SELECT status FROM lab_command_receipts WHERE request_id=?').get('native_revoke_active');
  assert.equal(interrupted.status,'uncertain');
  assert.equal(development.status(id).available,false);
  await assert.rejects(svc.invoke(context,'project_command_run',{
    projectId:id,requestId:'native_after_revoke',command:'echo NEVER_EXECUTE'
  }),/forge_development_owner_approval_required/);
  const mcp=createOrchestratorMcp({service:svc,getContext:()=>context,
    allowedOperations:FORGE_APP_MCP_OPERATIONS});
  await mcp.handle({jsonrpc:'2.0',id:1,method:'initialize',
    params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}});
  await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const listed=await mcp.handle({jsonrpc:'2.0',id:2,method:'tools/list'});
  assert.equal(listed.result.tools.some(x=>x.name==='forge_project_command_run'),true);
  assert.equal(listed.result.tools.some(x=>x.name==='forge_project_delete'),true);
  assert.equal(listed.result.tools.some(x=>x.name==='forge_work_send'),false);
});


test('Task worktrees isolate parallel agents while main remains the single clean integration root',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-worktree-e2e-'));
  const folder=path.join(dir,'project');fs.mkdirSync(folder);
  execFileSync('git',['init','-b','main'],{cwd:folder,stdio:'ignore'});
  execFileSync('git',['config','user.email','forge-test@ordax.local'],{cwd:folder});
  execFileSync('git',['config','user.name','Forge Test'],{cwd:folder});
  fs.writeFileSync(path.join(folder,'README.md'),'base\n','utf8');
  execFileSync('git',['add','README.md'],{cwd:folder});
  execFileSync('git',['commit','-m','base'],{cwd:folder,stdio:'ignore'});
  const baseHead=execFileSync('git',['rev-parse','HEAD'],{cwd:folder,encoding:'utf8'}).trim();

  const store=new Store(':memory:');
  t.after(()=>{store.close();fs.rmSync(dir,{force:true,recursive:true})});
  const context={actorId:'owner',clientId:'desktop',workspaceSessionId:store.getWorkspaceSession().id};
  const workspaces=new ForgeLocalWorkspaces({store,documentsDirectory:dir});
  const trust=new ForgeMcpOwnerTrust({store,appIdentity:dir,
    scopeSignature:id=>{
      const bind=workspaces.binding(id);
      return bind?'owner-bound:'+bind.root+':'+bind.identity:'app-private:'+id;
    }});
  const development=new ForgeProjectDevelopment({store,workspaces,ownerTrust:trust});
  const files=new ForgeProjectFiles({root:path.join(dir,'private-files'),
    workspaceLookup:(projectId,taskId=null)=>workspaces.rootForProject(projectId,taskId),
    requireOwnerBinding:true});
  const svc=new OrchestratorService({store,development,fileBroker:files,
    authorize:({context:who})=>who===context});

  const projectId=(await svc.invoke(context,'project_create',{
    name:'Parallel Git E2E',requestId:'worktree_project_create'})).result.projectId;
  workspaces.bindSelected(projectId,folder);
  trust.trustApp();trust.trust(projectId);
  development.approve(projectId,{expectedScopeHash:trust.scopeHash(projectId)});
  const orchestratorId=(await svc.invoke(context,'orchestrator_create',{
    projectId,name:'Integrator',mission:'Integrar agentes isolados',
    requestId:'worktree_orchestrator'})).result.orchestratorId;
  const taskA=(await svc.invoke(context,'work_create',{
    projectId,orchestratorId,title:'Agent A',requestId:'worktree_task_a'})).result.taskId;
  const taskB=(await svc.invoke(context,'work_create',{
    projectId,orchestratorId,title:'Agent B',requestId:'worktree_task_b'})).result.taskId;

  await assert.rejects(svc.invoke(context,'project_file_write',{
    projectId,taskId:taskA,path:'must-not-hit-main.txt',content:'blocked',
    requestId:'worktree_unprepared_write'}),/forge_worktree_task_unprepared/);
  await assert.rejects(svc.invoke(context,'project_command_run',{
    projectId,taskId:taskA,command:'git status --short',
    requestId:'worktree_unprepared_command'}),/forge_worktree_task_unprepared/);
  assert.equal(fs.existsSync(path.join(folder,'must-not-hit-main.txt')),false);

  const preparedA=await svc.invoke(context,'project_worktree_prepare',{
    projectId,taskId:taskA,requestId:'worktree_prepare_a'});
  const preparedB=await svc.invoke(context,'project_worktree_prepare',{
    projectId,taskId:taskB,requestId:'worktree_prepare_b'});
  assert.equal(preparedA.status,'succeeded');
  assert.equal(preparedB.status,'succeeded');
  assert.equal(preparedA.result.workspaceScope,'task_worktree');
  assert.equal(preparedB.result.workspaceScope,'task_worktree');
  assert.equal(preparedA.result.baseHeadSha,baseHead);
  assert.equal(preparedB.result.baseHeadSha,baseHead);
  assert.notEqual(preparedA.result.branchName,preparedB.result.branchName);

  const writeA=await svc.invoke(context,'project_file_write',{
    projectId,taskId:taskA,path:'agent-a.txt',content:'A\n',requestId:'worktree_write_a'});
  const writeB=await svc.invoke(context,'project_file_write',{
    projectId,taskId:taskB,path:'agent-b.txt',content:'B\n',requestId:'worktree_write_b'});
  assert.equal(writeA.result.source,'forge_task_worktree');
  assert.equal(writeB.result.source,'forge_task_worktree');
  assert.equal((await svc.invoke(context,'project_file_read',{
    projectId,taskId:taskA,path:'agent-a.txt'})).content,'A\n');
  assert.equal((await svc.invoke(context,'project_file_read',{
    projectId,taskId:taskB,path:'agent-b.txt'})).content,'B\n');
  await assert.rejects(svc.invoke(context,'project_file_read',{
    projectId,taskId:taskB,path:'agent-a.txt'}),/forge_file_not_found/);
  await assert.rejects(svc.invoke(context,'project_files_list',{
    projectId,directory:''}),/forge_task_workspace_required/);
  await assert.rejects(svc.invoke(context,'project_file_read',{
    projectId,taskId:taskA,path:'.forge-worktrees/'+taskB+'/agent-b.txt'}),
    /forge_file_internal_path_denied/);

  const branchA=await svc.invoke(context,'project_command_run',{
    projectId,taskId:taskA,command:'git branch --show-current',
    requestId:'worktree_branch_a',timeoutMs:15000});
  const branchB=await svc.invoke(context,'project_command_run',{
    projectId,taskId:taskB,command:'git branch --show-current',
    requestId:'worktree_branch_b',timeoutMs:15000});
  assert.equal(branchA.result.stdout.trim(),preparedA.result.branchName);
  assert.equal(branchB.result.stdout.trim(),preparedB.result.branchName);
  assert.equal(branchA.result.workspaceScope,'task_worktree');
  assert.equal(branchB.result.workspaceScope,'task_worktree');
  assert.equal(fs.existsSync(path.join(folder,'agent-a.txt')),false);
  assert.equal(fs.existsSync(path.join(folder,'agent-b.txt')),false);
  assert.equal(execFileSync('git',['status','--porcelain=v1','--untracked-files=all'],{
    cwd:folder,encoding:'utf8'}).trim(),'');
  assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});


async function integrationFixture(t,prefix){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),prefix));
  const folder=path.join(dir,'project');fs.mkdirSync(folder);
  execFileSync('git',['init','-b','main'],{cwd:folder,stdio:'ignore'});
  execFileSync('git',['config','user.email','forge-test@ordax.local'],{cwd:folder});
  execFileSync('git',['config','user.name','Forge Test'],{cwd:folder});
  execFileSync('git',['config','core.autocrlf','false'],{cwd:folder});
  fs.writeFileSync(path.join(folder,'README.md'),'base\n','utf8');
  fs.writeFileSync(path.join(folder,'shared.txt'),'base\n','utf8');
  execFileSync('git',['add','README.md','shared.txt'],{cwd:folder});
  execFileSync('git',['commit','-m','base'],{cwd:folder,stdio:'ignore'});
  const store=new Store(':memory:');
  t.after(()=>{store.close();fs.rmSync(dir,{force:true,recursive:true})});
  const context={actorId:'owner',clientId:'desktop',workspaceSessionId:store.getWorkspaceSession().id};
  const workspaces=new ForgeLocalWorkspaces({store,documentsDirectory:dir});
  const trust=new ForgeMcpOwnerTrust({store,appIdentity:dir,
    scopeSignature:id=>{
      const bind=workspaces.binding(id);
      return bind?'owner-bound:'+bind.root+':'+bind.identity:'app-private:'+id;
    }});
  const development=new ForgeProjectDevelopment({store,workspaces,ownerTrust:trust});
  const files=new ForgeProjectFiles({root:path.join(dir,'private-files'),
    workspaceLookup:(projectId,taskId=null)=>workspaces.rootForProject(projectId,taskId),
    requireOwnerBinding:true});
  const svc=new OrchestratorService({store,development,fileBroker:files,
    authorize:({context:who})=>who===context});
  const projectId=(await svc.invoke(context,'project_create',{
    name:'Integrator E2E',requestId:prefix+'project'})).result.projectId;
  workspaces.bindSelected(projectId,folder);
  trust.trustApp();trust.trust(projectId);
  development.approve(projectId,{expectedScopeHash:trust.scopeHash(projectId)});
  const orchestratorId=(await svc.invoke(context,'orchestrator_create',{
    projectId,name:'Integrator',mission:'Validar e integrar branches verificadas',
    requestId:prefix+'orchestrator'})).result.orchestratorId;
  return {dir,folder,store,context,workspaces,development,svc,projectId,orchestratorId};
}

test('Integrator merges only a reviewed Task head with successful verification receipts',async t=>{
  const f=await integrationFixture(t,'forge-integrator-success-');
  const taskId=(await f.svc.invoke(f.context,'work_create',{
    projectId:f.projectId,orchestratorId:f.orchestratorId,title:'Feature agent',
    requestId:'integrator_success_task'})).result.taskId;
  const prepared=await f.svc.invoke(f.context,'project_worktree_prepare',{
    projectId:f.projectId,taskId,requestId:'integrator_success_prepare'});
  const write=await f.svc.invoke(f.context,'project_file_write',{
    projectId:f.projectId,taskId,path:'feature.txt',content:'verified feature\n',
    requestId:'integrator_success_write'});
  assert.equal(write.status,'succeeded');
  const commit=await f.svc.invoke(f.context,'project_command_run',{
    projectId:f.projectId,taskId,
    command:'git add feature.txt && git commit -m agent-feature',
    requestId:'integrator_success_commit',timeoutMs:30000});
  assert.equal(commit.status,'succeeded');
  assert.equal(commit.result.exitCode,0,JSON.stringify(commit.result));
  assert.match(commit.result.gitHeadSha,/^[a-f0-9]{40}$/);

  let review=await f.svc.invoke(f.context,'project_worktree_review',{
    projectId:f.projectId,taskId});
  assert.equal(review.integratable,true);
  assert.equal(review.mainClean,true);
  assert.equal(review.worktreeClean,true);
  assert.equal(review.aheadCount,1);
  assert.equal(review.branchHeadSha,commit.result.gitHeadSha);
  assert.equal(review.mainHeadSha,prepared.result.baseHeadSha);
  assert.deepEqual(review.changedFiles,[{status:'A',paths:['feature.txt']}]);

  const staleBranchHead=review.branchHeadSha;
  const mutatingVerify=await f.svc.invoke(f.context,'project_worktree_verify',{
    projectId:f.projectId,taskId,command:'git commit --allow-empty -m verify-mutated',
    requestId:'integrator_mutating_verify',timeoutMs:30000});
  assert.equal(mutatingVerify.status,'failed');
  assert.equal(mutatingVerify.result.verified,false);
  assert.equal(mutatingVerify.result.verificationReason,'forge_worktree_branch_changed');
  assert.equal(mutatingVerify.result.reviewedBranchHeadSha,staleBranchHead);
  assert.equal(Object.hasOwn(mutatingVerify.result,'verifiedBranchHeadSha'),false);
  review=await f.svc.invoke(f.context,'project_worktree_review',{
    projectId:f.projectId,taskId});
  assert.notEqual(review.branchHeadSha,staleBranchHead);
  assert.equal(review.mainHeadSha,prepared.result.baseHeadSha);
  assert.equal(review.aheadCount,2);

  const verify=await f.svc.invoke(f.context,'project_worktree_verify',{
    projectId:f.projectId,taskId,command:'git diff --check',
    requestId:'integrator_success_verify',timeoutMs:30000});
  assert.equal(verify.status,'succeeded');
  assert.equal(verify.result.verified,true);
  assert.equal(verify.result.verifiedBranchHeadSha,review.branchHeadSha);

  await assert.rejects(f.svc.invoke(f.context,'project_worktree_integrate',{
    projectId:f.projectId,taskId,expectedBranchHeadSha:review.branchHeadSha,
    expectedMainHeadSha:review.mainHeadSha,verificationReceiptIds:[commit.commandId],
    requestId:'integrator_wrong_receipt'}),/forge_worktree_verification_receipt_invalid/);
  const wrong=f.store.db.prepare('SELECT status FROM lab_command_receipts WHERE request_id=?')
    .get('integrator_wrong_receipt');
  assert.equal(wrong.status,'failed');

  const integrated=await f.svc.invoke(f.context,'project_worktree_integrate',{
    projectId:f.projectId,taskId,expectedBranchHeadSha:review.branchHeadSha,
    expectedMainHeadSha:review.mainHeadSha,verificationReceiptIds:[verify.commandId],
    requestId:'integrator_success_merge'});
  assert.equal(integrated.status,'succeeded');
  assert.equal(integrated.result.status,'integrated');
  assert.equal(integrated.result.cleanupPending,false);
  assert.deepEqual(integrated.result.verificationReceiptIds,[verify.commandId]);
  assert.match(integrated.result.integratedHeadSha,/^[a-f0-9]{40}$/);
  assert.notEqual(integrated.result.integratedHeadSha,review.mainHeadSha);
  assert.equal(fs.readFileSync(path.join(f.folder,'feature.txt'),'utf8'),'verified feature\n');
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:f.folder,encoding:'utf8'}).trim(),
    integrated.result.integratedHeadSha);
  assert.equal(execFileSync('git',['status','--porcelain=v1','--untracked-files=all'],{
    cwd:f.folder,encoding:'utf8'}).trim(),'');
  const row=f.workspaces.taskWorktree(f.projectId,taskId);
  assert.equal(row.status,'integrated');
  assert.equal(row.integratedHeadSha,integrated.result.integratedHeadSha);
  assert.equal(fs.existsSync(path.join(f.folder,'.forge-worktrees',taskId)),false);
  assert.equal(execFileSync('git',['branch','--list',prepared.result.branchName],{
    cwd:f.folder,encoding:'utf8'}).trim(),'');
  await assert.rejects(f.svc.invoke(f.context,'project_worktree_review',{
    projectId:f.projectId,taskId}),/forge_worktree_task_unprepared/);
  const replay=await f.svc.invoke(f.context,'project_worktree_integrate',{
    projectId:f.projectId,taskId,expectedBranchHeadSha:review.branchHeadSha,
    expectedMainHeadSha:review.mainHeadSha,verificationReceiptIds:[verify.commandId],
    requestId:'integrator_success_merge'});
  assert.equal(replay.commandId,integrated.commandId);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('Integrator aborts a conflicting Task merge and restores main without auto-resolution',async t=>{
  const f=await integrationFixture(t,'forge-integrator-conflict-');
  const taskA=(await f.svc.invoke(f.context,'work_create',{
    projectId:f.projectId,orchestratorId:f.orchestratorId,title:'Conflict A',
    requestId:'integrator_conflict_task_a'})).result.taskId;
  const taskB=(await f.svc.invoke(f.context,'work_create',{
    projectId:f.projectId,orchestratorId:f.orchestratorId,title:'Conflict B',
    requestId:'integrator_conflict_task_b'})).result.taskId;
  await f.svc.invoke(f.context,'project_worktree_prepare',{
    projectId:f.projectId,taskId:taskA,requestId:'integrator_conflict_prepare_a'});
  await f.svc.invoke(f.context,'project_worktree_prepare',{
    projectId:f.projectId,taskId:taskB,requestId:'integrator_conflict_prepare_b'});

  const originalA=await f.svc.invoke(f.context,'project_file_read',{
    projectId:f.projectId,taskId:taskA,path:'shared.txt'});
  const originalB=await f.svc.invoke(f.context,'project_file_read',{
    projectId:f.projectId,taskId:taskB,path:'shared.txt'});
  await f.svc.invoke(f.context,'project_file_write',{
    projectId:f.projectId,taskId:taskA,path:'shared.txt',content:'A wins first\n',
    expectedSha256:originalA.sha256,requestId:'integrator_conflict_write_a'});
  await f.svc.invoke(f.context,'project_file_write',{
    projectId:f.projectId,taskId:taskB,path:'shared.txt',content:'B conflicts\n',
    expectedSha256:originalB.sha256,requestId:'integrator_conflict_write_b'});
  const commitA=await f.svc.invoke(f.context,'project_command_run',{
    projectId:f.projectId,taskId:taskA,command:'git add shared.txt && git commit -m change-A',
    requestId:'integrator_conflict_commit_a',timeoutMs:30000});
  const commitB=await f.svc.invoke(f.context,'project_command_run',{
    projectId:f.projectId,taskId:taskB,command:'git add shared.txt && git commit -m change-B',
    requestId:'integrator_conflict_commit_b',timeoutMs:30000});
  assert.equal(commitA.result.exitCode,0,JSON.stringify(commitA.result));
  assert.equal(commitB.result.exitCode,0,JSON.stringify(commitB.result));

  const reviewA=await f.svc.invoke(f.context,'project_worktree_review',{
    projectId:f.projectId,taskId:taskA});
  const verifyA=await f.svc.invoke(f.context,'project_worktree_verify',{
    projectId:f.projectId,taskId:taskA,command:'git diff --check',
    requestId:'integrator_conflict_verify_a',timeoutMs:30000});
  const mergeA=await f.svc.invoke(f.context,'project_worktree_integrate',{
    projectId:f.projectId,taskId:taskA,expectedBranchHeadSha:reviewA.branchHeadSha,
    expectedMainHeadSha:reviewA.mainHeadSha,verificationReceiptIds:[verifyA.commandId],
    requestId:'integrator_conflict_merge_a'});
  assert.equal(mergeA.status,'succeeded');
  const mainAfterA=mergeA.result.integratedHeadSha;
  assert.equal(fs.readFileSync(path.join(f.folder,'shared.txt'),'utf8'),'A wins first\n');

  const reviewB=await f.svc.invoke(f.context,'project_worktree_review',{
    projectId:f.projectId,taskId:taskB});
  assert.equal(reviewB.mainHeadSha,mainAfterA);
  assert.equal(reviewB.behindCount>=1,true);
  const verifyB=await f.svc.invoke(f.context,'project_worktree_verify',{
    projectId:f.projectId,taskId:taskB,command:'git diff --check',
    requestId:'integrator_conflict_verify_b',timeoutMs:30000});
  assert.equal(verifyB.status,'succeeded');
  await assert.rejects(f.svc.invoke(f.context,'project_worktree_integrate',{
    projectId:f.projectId,taskId:taskB,expectedBranchHeadSha:reviewB.branchHeadSha,
    expectedMainHeadSha:reviewB.mainHeadSha,verificationReceiptIds:[verifyB.commandId],
    requestId:'integrator_conflict_merge_b'}),/forge_worktree_merge_conflict/);
  const failed=f.store.db.prepare('SELECT status,result FROM lab_command_receipts WHERE request_id=?')
    .get('integrator_conflict_merge_b');
  assert.equal(failed.status,'failed');
  assert.equal(JSON.parse(failed.result).reason,'forge_worktree_merge_conflict');
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:f.folder,encoding:'utf8'}).trim(),mainAfterA);
  assert.equal(execFileSync('git',['status','--porcelain=v1','--untracked-files=all'],{
    cwd:f.folder,encoding:'utf8'}).trim(),'');
  assert.equal(fs.readFileSync(path.join(f.folder,'shared.txt'),'utf8'),'A wins first\n');
  assert.equal(f.workspaces.taskWorktree(f.projectId,taskB).status,'active');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
