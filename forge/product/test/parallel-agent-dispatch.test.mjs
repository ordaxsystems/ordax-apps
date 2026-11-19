import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../src/store.mjs';
import {ForgeProjectDevelopment} from '../src/forge-project-development.mjs';
import {ForgeLocalWorkspaces} from '../src/forge-local-workspaces.mjs';
import {ForgeMcpOwnerTrust} from '../src/forge-mcp-owner-trust.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

function fixture(t,{lanes=2,withWorkspace=false}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-parallel-agents-'));
  const folder=path.join(dir,'repo');
  if(withWorkspace){
    fs.mkdirSync(folder);
    const git=(...args)=>execFileSync('git',args,{cwd:folder,encoding:'utf8'});
    git('init','-b','main');
    git('config','user.email','forge-test@ordax.local');
    git('config','user.name','Forge Test');
    git('config','core.autocrlf','false');
    fs.writeFileSync(path.join(folder,'README.md'),'base\\n');
    git('add','README.md');git('commit','-m','initial');
  }
  const store=new Store(path.join(dir,'forge.sqlite'));
  const context=Object.freeze({actorId:'owner',clientId:'desktop',
    workspaceSessionId:store.getWorkspaceSession().id});
  let seq=0,active=0,peak=0;
  const starts=[],holds=[];
  const provider={
    capacity:()=>({maxConcurrentSends:lanes,active,queued:0,pendingTasks:active,
      availableSlots:Math.max(0,lanes-active),closed:false}),
    busy:()=>active>=lanes,
    send:({taskId,content,draftRevision,authorSource})=>{
      const begun=store.beginProviderRun(taskId,content,{
        draftRevision,workerId:'test-agent-'+String(starts.length+1),
        observerMode:'auto',authorSource
      });
      active++;peak=Math.max(peak,active);
      starts.push({taskId,runId:begun.runId,content,authorSource});
      const hold=deferred();holds.push({hold,taskId,runId:begun.runId});
      return hold.promise.finally(()=>{active--;});
    }
  };
  const workspaces=withWorkspace?new ForgeLocalWorkspaces({store,documentsDirectory:dir}):null;
  const trust=withWorkspace?new ForgeMcpOwnerTrust({store,appIdentity:dir,
    scopeSignature:id=>{
      const binding=workspaces.binding(id);
      return binding?'owner-bound:'+binding.root+':'+binding.identity:'app-private:'+id;
    }}):null;
  const development=withWorkspace?new ForgeProjectDevelopment({
    store,workspaces,ownerTrust:trust
  }):null;
  const service=new OrchestratorService({
    store,provider,development,continuousExecutionByDefault:true,
    authorize:({context:ctx})=>ctx===context
  });
  const call=(operation,input={})=>service.invoke(context,operation,{
    ...(!ORCHESTRATOR_TOOLS.find(tool=>tool.operation===operation)?.readOnly
      ?{requestId:'request_'+(++seq)}:{}),...input
  });
  const complete=index=>{
    const item=holds[index];
    store.finishRun(item.taskId,item.runId);
    item.hold.resolve({confirmed:true,deliveryObserved:true,responseObserved:true,
      effectVerified:false,runId:item.runId});
  };
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const bindProject=projectId=>{
    if(!withWorkspace)throw Error('workspace_not_configured_for_fixture');
    workspaces.bindSelected(projectId,folder);
    trust.trustApp();trust.trust(projectId);
    development.approve(projectId,{expectedScopeHash:trust.scopeHash(projectId)});
  };
  return {store,service,context,call,starts,holds,complete,folder,bindProject,
    peak:()=>peak,active:()=>active};
}

test('one durable launch fans out prepared Works only after the parent Run settles',async t=>{
  const f=fixture(t,{lanes:2});
  const projectId=(await f.call('project_create',{name:'Multiagent',objective:'Parallel agents'})).result.projectId;
  const owner=(await f.call('orchestrator_create',{
    projectId,name:'Forjador',mission:'Coordinate independent specialists'
  })).result;
  await f.call('autonomous_continuous_set',{
    projectId,orchestratorId:owner.orchestratorId,enabled:true
  });
  const batch=await f.call('work_batch_create',{
    projectId,orchestratorId:owner.orchestratorId,titles:['Frontend','Tests']
  });
  const [front,tester]=batch.result.taskIds;
  await f.call('work_draft_set',{projectId,taskId:front,
    content:'Implement the frontend independently and verify your local changes.',draftRevision:1});
  await f.call('work_draft_set',{projectId,taskId:tester,
    content:'Inspect the project and build independent focused tests.',draftRevision:1});

  const parentRun=f.store.startRun(owner.chatTaskId,'parent-agent','auto');
  const launch=await f.call('work_parallel_launch',{projectId,taskIds:[front,tester]});
  assert.equal(launch.status,'succeeded');
  assert.equal(launch.result.providerMessagesSent,0);
  assert.equal(launch.result.dispatchQueued,true);
  assert.deepEqual(launch.result.waitForRunIds,[parentRun]);
  assert.equal(f.starts.length,0,'tool call itself cannot recursively launch GPT');

  assert.equal((await f.service.tickParallelDispatch(f.context)).state,'idle');
  assert.equal(f.starts.length,0,'parent Run still owns the current GPT turn');

  f.store.finishRun(owner.chatTaskId,parentRun);
  const dispatch=f.service.tickParallelDispatch(f.context);
  await tick();await tick();
  assert.equal(f.active(),2);
  assert.equal(f.peak(),2);
  assert.deepEqual(new Set(f.starts.map(item=>item.taskId)),new Set([front,tester]));
  assert.deepEqual(new Set(f.starts.map(item=>item.authorSource)),new Set(['orchestrator']));
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM runs WHERE status='running'").get().n,2);

  f.complete(0);f.complete(1);
  const result=await dispatch;
  assert.equal(result.state,'dispatched');
  assert.equal(result.requested,2);
  assert.equal(result.fulfilled,2);
  assert.equal(result.rejected,0);
  assert.equal(f.store.db.prepare(
    "SELECT COUNT(*) n FROM lab_command_receipts WHERE operation='work_send' AND status='succeeded'"
  ).get().n,2);
  assert.equal(f.store.db.prepare(
    "SELECT COUNT(*) n FROM messages WHERE role='user' AND author_source='orchestrator' AND task_id IN (?,?)"
  ).get(front,tester).n,2);
  assert.equal((await f.service.tickParallelDispatch(f.context)).state,'idle');
  assert.equal(f.starts.length,2,'completed child receipts prevent replay');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('four-lane pool starts four agents concurrently and admits the fifth only after capacity returns',async t=>{
  const f=fixture(t,{lanes:4});
  const projectId=(await f.call('project_create',{name:'Pool4',objective:'Bounded four-agent fanout'})).result.projectId;
  const owner=(await f.call('orchestrator_create',{
    projectId,name:'Forjador',mission:'Coordinate five independent fronts'
  })).result;
  await f.call('autonomous_continuous_set',{
    projectId,orchestratorId:owner.orchestratorId,enabled:true
  });
  const batch=await f.call('work_batch_create',{
    projectId,orchestratorId:owner.orchestratorId,
    titles:['Agent A','Agent B','Agent C','Agent D','Agent E']
  });
  for(let i=0;i<batch.result.taskIds.length;i++)
    await f.call('work_draft_set',{projectId,taskId:batch.result.taskIds[i],
      content:'Independent specialist objective '+String(i+1),draftRevision:1});
  await f.call('work_parallel_launch',{projectId,taskIds:batch.result.taskIds});

  const firstWave=f.service.tickParallelDispatch(f.context);
  await tick();await tick();
  assert.equal(f.active(),4);
  assert.equal(f.peak(),4);
  assert.equal(f.starts.length,4);
  assert.equal(f.store.db.prepare(
    "SELECT COUNT(*) n FROM lab_command_receipts WHERE operation='work_send' AND status='running'"
  ).get().n,4);
  for(let i=0;i<4;i++)f.complete(i);
  const firstResult=await firstWave;
  assert.equal(firstResult.requested,4);
  assert.equal(firstResult.fulfilled,4);

  const secondWave=f.service.tickParallelDispatch(f.context);
  await tick();await tick();
  assert.equal(f.active(),1);
  assert.equal(f.starts.length,5);
  assert.equal(f.starts[4].taskId,batch.result.taskIds[4]);
  f.complete(4);
  const secondResult=await secondWave;
  assert.equal(secondResult.requested,1);
  assert.equal(secondResult.fulfilled,1);
  assert.equal((await f.service.tickParallelDispatch(f.context)).state,'idle');
  assert.equal(f.store.db.prepare(
    "SELECT COUNT(*) n FROM lab_command_receipts WHERE operation='work_send' AND status='succeeded'"
  ).get().n,5);
});

test('parallel launch freezes child draft bytes and turns a changed snapshot into a terminal failed child receipt',async t=>{
  const f=fixture(t,{lanes:2});
  const projectId=(await f.call('project_create',{name:'Freeze',objective:'No stale child prompts'})).result.projectId;
  const owner=(await f.call('orchestrator_create',{
    projectId,name:'Forjador',mission:'Freeze launch inputs'
  })).result;
  await f.call('autonomous_continuous_set',{
    projectId,orchestratorId:owner.orchestratorId,enabled:true
  });
  const batch=await f.call('work_batch_create',{
    projectId,orchestratorId:owner.orchestratorId,titles:['A','B']
  });
  const [a,b]=batch.result.taskIds;
  await f.call('work_draft_set',{projectId,taskId:a,content:'Original A',draftRevision:1});
  await f.call('work_draft_set',{projectId,taskId:b,content:'Original B',draftRevision:1});
  await f.call('work_parallel_launch',{projectId,taskIds:[a,b]});

  // Simulate an external local editor racing after authorization. The launch
  // must never silently send these changed bytes.
  f.store.setDraft(a,'Changed after launch',2);
  const dispatch=f.service.tickParallelDispatch(f.context);
  await tick();await tick();
  assert.equal(f.starts.length,1);
  assert.equal(f.starts[0].taskId,b);
  f.complete(0);
  await dispatch;
  const failed=f.store.db.prepare(`SELECT status,result FROM lab_command_receipts
    WHERE operation='work_send' AND status='failed'`).get();
  assert.equal(failed.status,'failed');
  assert.equal(JSON.parse(failed.result).reason,'parallel_launch_snapshot_changed');
  assert.equal(f.store.messages(a).length,0);
  assert.equal((await f.service.tickParallelDispatch(f.context)).state,'idle');
  assert.equal(f.starts.length,1);
});

test('DAG launch keeps dependent GPT Work queued until a real integrated Git acceptance',async t=>{
  const f=fixture(t,{lanes:2,withWorkspace:true});
  const projectId=(await f.call('project_create',{
    name:'Verified DAG multiagent',objective:'Only accepted integration unlocks dependent GPT'
  })).result.projectId;
  f.bindProject(projectId);
  const orchestratorId=(await f.call('orchestrator_create',{
    projectId,name:'Forjador',mission:'Coordinate implementation, tests and dependent review'
  })).result.orchestratorId;
  await f.call('autonomous_continuous_set',{projectId,orchestratorId,enabled:true});
  const batch=(await f.call('work_batch_create',{projectId,orchestratorId,
    titles:['Implementation','Dependent review','Independent documentation']
  })).result.taskIds;
  const [implementation,review,docs]=batch;
  await f.call('work_dependency_set',{projectId,taskId:review,dependsOn:[implementation]});
  for(const [i,taskId] of batch.entries())
    await f.call('work_draft_set',{projectId,taskId,
      content:'Complete the scoped GPT work milestone '+String(i+1),draftRevision:1});
  const launch=await f.call('work_parallel_launch',{projectId,taskIds:batch});
  assert.equal(launch.status,'succeeded');
  assert.equal(launch.result.dispatchQueued,true);
  assert.equal(launch.result.providerMessagesSent,0);
  assert.equal(f.starts.length,0);
  const first=f.service.tickParallelDispatch(f.context);
  await tick();await tick();
  assert.deepEqual(new Set(f.starts.map(x=>x.taskId)),new Set([implementation,docs]));
  assert.equal(f.starts.some(x=>x.taskId===review),false);
  f.complete(0);f.complete(1);
  assert.equal((await first).fulfilled,2);
  assert.equal((await f.service.tickParallelDispatch(f.context)).state,'idle',
    'GPT response alone does not verify code nor unblock a dependent agent');
  assert.equal(f.starts.length,2);
  assert.equal(f.service.projectPlan(projectId,4).workers.find(x=>x.taskId===implementation).effectVerified,false);

  const prepared=await f.call('project_worktree_prepare',{projectId,taskId:implementation});
  assert.equal(prepared.status,'succeeded');
  const branch=path.join(f.folder,'.forge-worktrees',implementation);
  fs.mkdirSync(path.join(branch,'test'),{recursive:true});
  fs.writeFileSync(path.join(branch,'test','feature.test.mjs'),
    "import test from 'node:test'; import assert from 'node:assert/strict'; test('build',()=>assert.equal(2+2,4));\\n");
  execFileSync('git',['add','test/feature.test.mjs'],{cwd:branch});
  execFileSync('git',['commit','-m','verified implementation'],{cwd:branch});
  const scopedReview=await f.call('project_worktree_review',{projectId,taskId:implementation});
  const verified=await f.call('project_worktree_verify',{projectId,taskId:implementation,
    command:'node --test test/feature.test.mjs',timeoutMs:30000});
  assert.equal(verified.status,'succeeded');
  assert.equal(verified.result.verified,true);
  const integrated=await f.call('project_worktree_integrate',{
    projectId,taskId:implementation,
    expectedBranchHeadSha:scopedReview.branchHeadSha,
    expectedMainHeadSha:scopedReview.mainHeadSha,
    verificationReceiptIds:[verified.commandId]
  });
  assert.equal(integrated.status,'succeeded');
  const acceptance=await f.call('work_accept',{
    projectId,taskId:implementation,integrationReceiptId:integrated.commandId,
    expectedIntegratedHeadSha:integrated.result.integratedHeadSha,
    testCommand:'node --test test/feature.test.mjs',timeoutMs:30000
  });
  assert.equal(acceptance.status,'succeeded');
  assert.equal(acceptance.result.accepted,true);
  assert.equal(f.service.projectPlan(projectId,4).workers.find(x=>x.taskId===implementation).effectVerified,true);

  const second=f.service.tickParallelDispatch(f.context);
  await tick();await tick();
  assert.equal(f.starts.length,3);
  assert.equal(f.starts[2].taskId,review);
  assert.equal(f.starts[2].authorSource,'orchestrator');
  f.complete(2);
  assert.equal((await second).fulfilled,1);
  assert.equal((await f.service.tickParallelDispatch(f.context)).state,'idle');
  assert.equal(f.store.db.prepare(
    "SELECT COUNT(*) n FROM lab_command_receipts WHERE operation='work_parallel_launch' AND status='succeeded'"
  ).get().n,1,'the original launch remains the one durable authority');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('more than 32 fully consumed historical launches never starve a new independent batch',async t=>{
  const f=fixture(t,{lanes:2});
  const projectId=(await f.call('project_create',{
    name:'Long-lived Forge',objective:'No arbitrary lifetime limit for new agents'
  })).result.projectId;
  const orchestratorId=(await f.call('orchestrator_create',{
    projectId,name:'Forjador',mission:'Long-running multiagent coordinator'
  })).result.orchestratorId;
  await f.call('autonomous_continuous_set',{projectId,orchestratorId,enabled:true});
  const oldDate='2020-01-01T00:00:00.000Z';
  const oldHash='a'.repeat(64);
  const insert=f.store.db.prepare(`INSERT INTO lab_command_receipts(
    id,workspace_session_id,actor_id,client_id,request_id,project_id,operation,
    input_hash,status,result,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  for(let i=0;i<40;i++){
    const oldId='archived_launch_'+String(i).padStart(2,'0');
    const childId='archived_child_'+String(i).padStart(2,'0');
    insert.run(oldId,f.context.workspaceSessionId,f.context.actorId,f.context.clientId,
      oldId,projectId,'work_parallel_launch',oldHash,'succeeded',
      JSON.stringify({orchestratorId,tasks:[{
        taskId:'historic_work_'+i,requestId:childId,
        content:'Historic completed work',draftRevision:1,contentSha256:oldHash
      }],waitForRunIds:[]}),oldDate,oldDate);
    insert.run(childId,f.context.workspaceSessionId,f.context.actorId,f.context.clientId,
      childId,projectId,'work_send',oldHash,'succeeded',
      JSON.stringify({taskId:'historic_work_'+i}),oldDate,oldDate);
  }
  const batch=(await f.call('work_batch_create',{
    projectId,orchestratorId,titles:['Fresh agent A','Fresh agent B']
  })).result.taskIds;
  for(const taskId of batch)
    await f.call('work_draft_set',{projectId,taskId,
      content:'Dispatch this new work even after forty completed launches.',draftRevision:1});
  const launch=await f.call('work_parallel_launch',{projectId,taskIds:batch});
  assert.equal(launch.status,'succeeded');
  const work=f.service.tickParallelDispatch(f.context);
  await tick();await tick();
  assert.deepEqual(new Set(f.starts.map(x=>x.taskId)),new Set(batch));
  f.complete(0);f.complete(1);
  assert.equal((await work).fulfilled,2);
  assert.equal((await f.service.tickParallelDispatch(f.context)).state,'idle');
  assert.equal(f.starts.length,2,'no duplicate messages after the new launch settles');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
