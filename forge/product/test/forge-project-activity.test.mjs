import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';
import {FORGE_APP_MCP_OPERATIONS} from '../src/forge-loopback-mcp.mjs';

function fixture(t){
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const context={actorId:'owner',clientId:'desktop',workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,authorize:({context:who})=>who===context});
  let seq=0;
  const invoke=(operation,input={})=>service.invoke(context,operation,
    ORCHESTRATOR_TOOLS.find(tool=>tool.operation===operation)?.readOnly
      ?input:{requestId:'activity_'+(++seq),...input});
  return {store,context,service,invoke};
}

test('project activity derives active and idle state from canonical SQLite without a scheduler',async t=>{
  const f=fixture(t);
  assert.ok(FORGE_APP_MCP_OPERATIONS.includes('project_activity'));
  const tool=ORCHESTRATOR_TOOLS.find(x=>x.operation==='project_activity');
  assert.equal(tool?.readOnly,true);

  const project=(await f.invoke('project_quick_create',{creationNonce:'activity_project'})).result;
  const work=(await f.invoke('work_create',{
    projectId:project.projectId,orchestratorId:project.orchestratorId,title:'Activity target'
  })).result;

  let view=await f.invoke('project_activity',{projectId:project.projectId});
  assert.equal(view.schema,'ordax.forge.project-activity/1');
  let item=view.tasks.find(x=>x.taskId===work.taskId);
  assert.equal(item.state,'idle');
  assert.equal(item.claim,null);
  assert.ok(item.lastActivityAt);
  assert.equal(view.notificationPreparation.storageReady,true);
  assert.equal(view.notificationPreparation.automaticWakeEnabled,false);
  assert.equal(view.notificationPreparation.notificationsEnabled,false);
  assert.equal(view.notificationPreparation.backgroundSchedulerEnabled,false);
  assert.equal(view.notificationPreparation.idleDerivedAtReadTime,true);

  const claimed=await f.invoke('work_claim',{
    projectId:project.projectId,taskId:work.taskId,action:'acquire',chatLabel:'GPT activity test'
  });
  assert.equal(claimed.result.status,'acquired');
  const token=claimed.result.claimToken,generation=claimed.result.claim.generation;
  await f.invoke('work_progress',{
    projectId:project.projectId,taskId:work.taskId,claimToken:token,generation,
    kind:'checkpoint',summary:'Persisted checkpoint'
  });

  view=await f.invoke('project_activity',{projectId:project.projectId});
  item=view.tasks.find(x=>x.taskId===work.taskId);
  assert.equal(item.state,'active');
  assert.equal(item.claim.state,'occupied');
  assert.equal(item.claim.chatLabel,'GPT activity test');
  assert.equal(item.claim.chatIdentityVerified,false);
  assert.equal(item.claim.lastProgress,'Persisted checkpoint');
  assert.equal(item.idleSince,null);
  assert.ok(view.recentActivity.some(x=>
    x.taskId===work.taskId&&x.kind==='forge.work_progress.recorded'));

  await f.invoke('work_claim',{
    projectId:project.projectId,taskId:work.taskId,action:'release',
    claimToken:token,generation
  });
  view=await f.invoke('project_activity',{projectId:project.projectId});
  item=view.tasks.find(x=>x.taskId===work.taskId);
  assert.equal(item.state,'idle');
  assert.equal(item.claim.state,'released');
  assert.ok(item.idleSince);
  assert.equal(view.counts.active,0);
  assert.ok(view.counts.idle>=1);
  assert.ok(view.recentActivity.some(x=>
    x.taskId===work.taskId&&x.kind==='forge.work_claim.released'));
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
