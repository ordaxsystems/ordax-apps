import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';
import {FORGE_APP_MCP_OPERATIONS} from '../src/forge-loopback-mcp.mjs';
import {createOrchestratorMcp} from '../src/orchestrator-mcp.mjs';
import {observeMcpToolCall} from '../src/forge-mcp-observation.mjs';

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
  assert.equal(item.claim.coordinationIdentity,null);
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


test('project activity distinguishes observed gateway coordination without inventing GPT chat identity',async t=>{
  const f=fixture(t);
  const project=(await f.invoke('project_quick_create',{creationNonce:'activity_gateway'})).result;
  const work=(await f.invoke('work_create',{
    projectId:project.projectId,orchestratorId:project.orchestratorId,title:'Remote gateway work'
  })).result;
  const mcp=createOrchestratorMcp({
    service:f.service,getContext:()=>f.context,
    afterToolInvoke:({operation,output,transportReceipt})=>{
      observeMcpToolCall({
        store:f.store,operation,output,ingress:'remote_gateway',transportReceipt
      });
      return output;
    }
  });
  await mcp.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{
    protocolVersion:'2025-11-25',clientInfo:{name:'activity-test',version:'1'},capabilities:{}
  }});
  await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const gateway={
    gatewayRequestId:'61000000-0000-4000-8000-000000000001',
    gatewayAttemptId:'61000000-0000-4000-8000-000000000002',
    gatewayAgentInstanceId:'61000000-0000-4000-8000-000000000003',
    leaseStartObserved:true
  };
  const claimed=await mcp.handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{
    name:'forge_work_claim',arguments:{
      projectId:project.projectId,taskId:work.taskId,action:'acquire',
      chatLabel:'Remote Chat A',requestId:'activity_remote_claim'
    }
  }},gateway);
  assert.equal(claimed.result.structuredContent.status,'succeeded');
  assert.equal(claimed.result.structuredContent.result.status,'acquired');

  const view=await f.invoke('project_activity',{projectId:project.projectId});
  const item=view.tasks.find(x=>x.taskId===work.taskId);
  assert.equal(item.state,'active');
  assert.equal(item.claim.chatLabel,'Remote Chat A');
  assert.equal(item.claim.coordinationIdentity.kind,'gateway_agent_instance');
  assert.equal(item.claim.coordinationIdentity.mcpToolCallObserved,true);
  assert.equal(item.claim.coordinationIdentity.mcpIngress,'remote_gateway');
  assert.equal(item.claim.coordinationIdentity.gatewayLeaseStartObserved,true);
  assert.equal(item.claim.coordinationIdentity.gatewayRequestId,gateway.gatewayRequestId);
  assert.equal(item.claim.coordinationIdentity.gatewayAttemptId,gateway.gatewayAttemptId);
  assert.equal(item.claim.coordinationIdentity.gatewayAgentInstanceId,gateway.gatewayAgentInstanceId);
  assert.equal(item.claim.coordinationIdentity.gptRunIdentityVerified,false);
  assert.equal(item.claim.coordinationIdentity.chatIdentityVerified,false);
  assert.equal(view.coordinationSessions.length,1);
  assert.equal(view.coordinationSessions[0].taskId,work.taskId);
  assert.equal(view.coordinationSessions[0].chatIdentityVerified,false);
  assert.equal(view.coordinationSessions[0].coordinationIdentity.gatewayAgentInstanceId,
    gateway.gatewayAgentInstanceId);
  assert.equal(JSON.stringify(view).includes(claimed.result.structuredContent.result.claimToken),false);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
