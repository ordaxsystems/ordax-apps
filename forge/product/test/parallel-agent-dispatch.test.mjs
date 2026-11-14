import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

function fixture(t,{lanes=2}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-parallel-agents-'));
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
  const service=new OrchestratorService({
    store,provider,continuousExecutionByDefault:true,
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
  return {store,service,context,call,starts,holds,complete,peak:()=>peak,active:()=>active};
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
