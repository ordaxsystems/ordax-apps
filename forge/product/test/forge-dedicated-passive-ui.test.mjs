import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';
import {createOrchestratorKernel} from '../src/orchestrator-kernel.mjs';
import {createTaskUiHandlers} from '../src/task-ui-handlers.mjs';
import {activateDedicatedForgeProject,dedicatedForgeMcpOperations}
  from '../src/forge-dedicated-project.mjs';
import {FORGE_APP_MCP_OPERATIONS} from '../src/forge-loopback-mcp.mjs';

test('dedicated renderer cannot create or edit Tasks; active project only is visible',async()=>{
  const store=new Store(':memory:');
  try{
    let kernel;
    kernel=createOrchestratorKernel({store,
      authorize:({context})=>context===kernel?.context});
    const old=await kernel.service.invoke(kernel.context,'project_create',{
      name:'Archived test project',requestId:'archived_scope_test'
    });
    const unrelated=store.createTask('unbound historical Task');
    const scope=activateDedicatedForgeProject(kernel.service);
    const coordinator=await kernel.service.invoke(kernel.context,
      'orchestrators_list',{projectId:scope.projectId});
    const coordinatorTask=coordinator.orchestrators[0].chat_task_id;
    const handlers=createTaskUiHandlers({store,
      dedicatedProjectId:()=>scope.projectId});
    const call=(channel,...args)=>{
      const fn=handlers.get(channel);
      assert.equal(typeof fn,'function',channel);
      return fn(null,...args);
    };
    const visible=call('ordax:tasks:list');
    assert.ok(visible.some(task=>task.id===coordinatorTask));
    assert.equal(visible.some(task=>task.id===unrelated.id),false);
    assert.equal(call('ordax:tasks:get',coordinatorTask).id,coordinatorTask);
    assert.throws(()=>call('ordax:tasks:get',unrelated.id),
      /forge_dedicated_project_scope_denied/);
    assert.throws(()=>call('ordax:tasks:open',unrelated.id),
      /forge_dedicated_project_scope_denied/);
    assert.throws(()=>call('ordax:workspace:navigation:set',{
      view:'coordinator',projectId:old.result.projectId,orchestratorId:null,taskId:null
    }),/forge_dedicated_project_scope_denied/);
    for(const [channel,arg] of [
      ['ordax:tasks:create','Unauthorised task'],
      ['ordax:tasks:rename',{taskId:coordinatorTask,title:'wrong'}],
      ['ordax:tasks:draft:set',{taskId:coordinatorTask,content:'wrong',revision:1}],
      ['ordax:tasks:rotate-conversation',coordinatorTask],
      ['ordax:tasks:memory:upsert',{taskId:coordinatorTask,item:{key:'wrong'}}],
      ['ordax:tasks:memory:candidates:scan',coordinatorTask]
    ])assert.throws(()=>call(channel,arg),/forge_dedicated_app_mcp_only/,channel);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM lab_projects')
      .get().n,2,'historical records remain');
    assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  }finally{store.close();}
});
test('dedicated MCP rejects old one-root Git, terminal and file operations before effects',async()=>{
  const store=new Store(':memory:');
  try{
    let kernel;
    kernel=createOrchestratorKernel({store,
      authorize:({context})=>context===kernel?.context});
    const scope=activateDedicatedForgeProject(kernel.service);
    const base={projectId:scope.projectId,taskId:'task_unused'};
    for(const [operation,args] of [
      ['project_file_read',{path:'README.md'}],
      ['project_file_write',{path:'README.md',content:'wrong',requestId:'single_root_write'}],
      ['project_worktree_review',{}],
      ['project_worktree_prepare',{requestId:'single_root_prepare'}],
      ['project_command_run',{command:'echo untrusted',requestId:'single_root_command'}],
      ['repository_observe',{}]
    ]){
      await assert.rejects(kernel.service.invoke(kernel.context,operation,
        operation==='repository_observe'?{projectId:scope.projectId}:{...base,...args}),
        /forge_dedicated_repository_executor_required/,operation);
    }
    const status=await kernel.service.invoke(kernel.context,'project_files_status',{
      projectId:scope.projectId});
    assert.equal(status.available,false);
    assert.equal(status.reason,'dedicated_repository_owner_port_required');
    const dev=await kernel.service.invoke(kernel.context,'project_development_status',{
      projectId:scope.projectId});
    assert.equal(dev.nativeProcessExecution,false);
    const discovered=await kernel.service.invoke(kernel.context,'forge_discover',{
      projectId:scope.projectId
    });
    assert.equal(discovered.development.available,false);
    assert.equal(discovered.limitations.shell,'ordax_mcp_repository_scoped_grant_required');
    assert.equal(discovered.limitations.externalFilesystem,
      'ordax_mcp_repository_scoped_grant_required');
    assert.equal(discovered.workspace.projectFileReadAvailable,false);
    const advertised=dedicatedForgeMcpOperations(store,FORGE_APP_MCP_OPERATIONS);
    for(const operation of ['project_file_read','project_file_write',
      'project_worktree_prepare','project_worktree_integrate','project_command_run',
      'repository_observe','work_accept'])
      assert.equal(advertised.includes(operation),false,operation);
    for(const operation of ['work_claim','work_progress','work_repositories',
      'work_repositories_set','project_repositories','work_create'])
      assert.equal(advertised.includes(operation),true,operation);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM lab_command_receipts')
      .get().n,0,'no receipt or unsafe effect was reserved');
  }finally{store.close();}
});
