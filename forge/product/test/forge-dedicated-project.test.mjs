import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../src/store.mjs';
import {createOrchestratorKernel} from '../src/orchestrator-kernel.mjs';
import {createOrchestratorMcp} from '../src/orchestrator-mcp.mjs';
import {FORGE_APP_MCP_OPERATIONS} from '../src/forge-loopback-mcp.mjs';
import {activateDedicatedForgeProject,readDedicatedForgeProject,
  dedicatedForgeMcpOperations} from '../src/forge-dedicated-project.mjs';
import {createForgeOrdaxRepositoryCatalog} from '../src/forge-ordax-repository-catalog.mjs';

test('dedicated project is atomic, idempotent and hides archived projects without deleting them',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-dedicated-project-'));
  const file=path.join(dir,'forge.sqlite');
  const store=new Store(file);
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true})});
  let kernel;
  kernel=createOrchestratorKernel({store,
    authorize:({context})=>context===kernel?.context});
  const svc=kernel.service,ctx=kernel.context;
  const old=await svc.invoke(ctx,'project_create',{
    name:'Archived acceptance fixture',requestId:'acceptance_test_old_project'
  });
  assert.equal(old.status,'succeeded');
  const oldId=old.result.projectId;
  const before=store.db.prepare('SELECT COUNT(*) AS n FROM lab_projects').get().n;
  const dedicated=activateDedicatedForgeProject(svc);
  assert.equal(dedicated.name,'OrdaX OS');
  assert.equal(dedicated.mode,'dedicated');
  assert.equal(activateDedicatedForgeProject(svc).projectId,dedicated.projectId);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM lab_projects').get().n,before+1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM lab_projects WHERE id=?').get(oldId).n,1);
  const list=await svc.invoke(ctx,'projects_list');
  assert.deepEqual(list.projects.map(p=>p.id),[dedicated.projectId]);
  assert.equal(list.projectScope.projectId,dedicated.projectId);
  const scopedStatus=await svc.invoke(ctx,'status',{});
  assert.equal(scopedStatus.projectScope.projectId,dedicated.projectId);
  assert.equal(scopedStatus.tools.includes('forge_mission_create'),false);
  assert.equal(scopedStatus.tools.includes('forge_forge_discover'),false);
  assert.ok(scopedStatus.tools.includes('forge_discover'));
  const coordinators=await svc.invoke(ctx,'orchestrators_list',{projectId:dedicated.projectId});
  assert.equal(coordinators.orchestrators.length,1,'use existing coordinator authority, not second worker');
  assert.equal(coordinators.orchestrators[0].name,'Administrador OrdaX OS');
  const blocked={
    project_create:{name:'unwanted'},
    project_quick_create:{creationNonce:'00000000-0000-4000-8000-000000000001'},
    mission_create:{mission:'unwanted'},
    project_delete:{projectId:dedicated.projectId,confirmName:'OrdaX OS'},
    project_rename:{projectId:dedicated.projectId,name:'unwanted'},
    project_repository_set:{projectId:dedicated.projectId,repositoryUrl:''}
  };
  for(const [operation,input] of Object.entries(blocked)){
    await assert.rejects(svc.invoke(ctx,operation,{
      ...input,requestId:'blocked_'+operation
    }),/forge_dedicated_project_operation_unavailable/);
  }
  await assert.rejects(svc.invoke(ctx,'project_context',{projectId:oldId}),
    /forge_dedicated_project_scope_denied/);
  const created=await svc.invoke(ctx,'work_create',{
    projectId:dedicated.projectId,orchestratorId:coordinators.orchestrators[0].id,
    title:'OrdaX OS: validar projeto único',requestId:'ordax_test_work_create'
  });
  assert.equal(created.status,'succeeded');
  const same=await svc.invoke(ctx,'work_create',{
    projectId:dedicated.projectId,orchestratorId:coordinators.orchestrators[0].id,
    title:'OrdaX OS: validar projeto único',requestId:'ordax_test_work_create'
  });
  assert.equal(same.commandId,created.commandId);
  assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  assert.equal(readDedicatedForgeProject(store).projectId,dedicated.projectId);

  let nativeSessionOpens=0;
  svc.ordaxProductMcp={
    openNativeSession:async()=>{
      nativeSessionOpens++;
      return {schema:'ordax.forge.native-session/1',ready:false,
        reason:'forge_native_transport_rollout_required',
        actionDispatched:false,executionAuthorized:false};
    },
    devices:async()=>({
    schema:'ordax.forge.native-product-mcp/1',available:true,
    requiredProfile:'repository-catalog-read',
    devices:[{deviceId:'14cef8f4-3c06-4b1b-9e3a-42c74ef7dec5',
      reportedOnline:true,repositoryCatalogReadGranted:false,
      nativeTerminalGrantVisible:true,executionAuthorized:false}],
    executionAuthorized:false
  })};
  const nativeMcp=await svc.invoke(ctx,'ordax_devices',{projectId:dedicated.projectId});
  assert.equal(nativeMcp.available,true);
  assert.equal(nativeMcp.devices[0].repositoryCatalogReadGranted,false);
  assert.equal(nativeMcp.executionAuthorized,false);
  await assert.rejects(svc.invoke(ctx,'ordax_devices',{projectId:oldId}),
    /forge_dedicated_project_scope_denied/);
  svc.repositoryCatalogPort={read:()=>({schema:'ordax.forge.repository-catalog/1',
    available:true,checkedOrigin:true,repositories:[
      {repo:'ordaxsystems/ordax-os',capability:'catalog_only'},
      {repo:'ordaxsystems/ordax-apps',capability:'catalog_only'}
    ],executionAuthorized:false})};
  const lease=await svc.invoke(ctx,'work_claim',{
    projectId:dedicated.projectId,taskId:created.result.taskId,
    action:'acquire',chatLabel:'test-owner',requestId:'dedicated_repo_claim'
  });
  assert.equal(lease.status,'succeeded');
  const claim=lease.result;
  const mapping=await svc.invoke(ctx,'work_repositories_set',{
    projectId:dedicated.projectId,taskId:created.result.taskId,
    claimToken:claim.claimToken,claimGeneration:claim.claim.generation,
    requestId:'dedicated_repo_scope_once',
    repositories:['ordaxsystems/ordax-apps','ordaxsystems/ordax-os']
  });
  assert.equal(mapping.status,'succeeded');
  assert.deepEqual(mapping.result.repositories,
    ['ordaxsystems/ordax-apps','ordaxsystems/ordax-os']);
  assert.equal(mapping.result.executionAuthorized,false);
  const assigned=await svc.invoke(ctx,'work_repositories',{
    projectId:dedicated.projectId,taskId:created.result.taskId
  });
  assert.deepEqual(assigned.repositories,mapping.result.repositories);
  assert.equal(assigned.multiRepositoryWorktreeExecutionAvailable,false);
  const runtimeRequestId='33333333-3333-4333-8333-333333333333';
  const deviceId='14cef8f4-3c06-4b1b-9e3a-42c74ef7dec5';
  let nativeReads=0,checks=0;
  svc.ordaxProductMcp.repositoryProof=async({repository,mode='start',
      runtimeRequestId:resumeId,expectedDeviceId})=>{
    assert.equal(repository,'ordaxsystems/ordax-apps');
    if(mode==='status'){
      checks++;
      assert.equal(resumeId,runtimeRequestId);
      assert.equal(expectedDeviceId,deviceId);
      return {schema:'ordax.forge.runtime-repository-proof/1',
        state:'observed',verified:true,actionCompleted:true,
        actionDispatched:true,repository,deviceId,
        runtimeRequestId,source:'canonical_ordax_runtime_repository_catalog',
        runtimeProjectSlug:'apps',branch:'main',
        dirty:false,statusAvailable:true,
        gitExecutionAuthorized:false,filesAccessible:false};
    }
    nativeReads++;
    return {schema:'ordax.forge.runtime-repository-proof/1',
      state:'pending',verified:false,actionCompleted:false,
      actionDispatched:true,repository,deviceId,runtimeRequestId,
      gitExecutionAuthorized:false,filesAccessible:false};
  };
  const probeInput={projectId:dedicated.projectId,
    taskId:created.result.taskId,repository:'ordaxsystems/ordax-apps',
    action:'start',claimToken:claim.claimToken,
    claimGeneration:claim.claim.generation,
    requestId:'dedicated_native_repo_probe_start'};
  const pendingProbe=await svc.invoke(ctx,'ordax_repository_probe',probeInput);
  assert.equal(pendingProbe.status,'uncertain','queued Runtime reads are not verified completion');
  assert.equal(pendingProbe.result.state,'pending');
  assert.equal(pendingProbe.result.runtimeRequestId,runtimeRequestId);
  assert.equal(pendingProbe.result.verified,false);
  const replayProbe=await svc.invoke(ctx,'ordax_repository_probe',probeInput);
  assert.equal(replayProbe.commandId,pendingProbe.commandId);
  assert.equal(nativeReads,1,'Forge replay must not re-enqueue the remote read');
  await assert.rejects(svc.invoke(ctx,'ordax_repository_probe',{
    ...probeInput,repository:'ordaxsystems/ordax-runtime',
    requestId:'native_scope_denied'}),/forge_task_repository_scope_not_assigned/);
  await assert.rejects(svc.invoke(ctx,'ordax_repository_probe',{
    ...probeInput,requestId:'native_claim_denied',
    claimToken:'x'.repeat(43)}),/forge_work_claim_not_owned/);
  const resolved=await svc.invoke(ctx,'ordax_repository_probe',{
    ...probeInput,action:'status',sourceCommandId:pendingProbe.commandId,
    requestId:'dedicated_native_repo_probe_status'});
  assert.equal(resolved.status,'succeeded');
  assert.equal(resolved.result.state,'observed');
  assert.equal(resolved.result.gitExecutionAuthorized,false);
  assert.equal(checks,1);
  assert.equal(svc.getReceipt(ctx,pendingProbe.commandId).status,'succeeded');
  const statusReplay=await svc.invoke(ctx,'ordax_repository_probe',{
    ...probeInput,action:'status',sourceCommandId:pendingProbe.commandId,
    requestId:'dedicated_native_repo_probe_status'});
  assert.equal(statusReplay.commandId,resolved.commandId);
  assert.equal(checks,1,'status retries never duplicate the native status read');
  await assert.rejects(svc.invoke(ctx,'ordax_repository_probe',{
    ...probeInput,action:'status',sourceCommandId:pendingProbe.commandId,
    requestId:'dedicated_native_repo_probe_second_status'
  }),/forge_runtime_repository_receipt_not_pending/);
  const nativeInput={projectId:dedicated.projectId,
    taskId:created.result.taskId,
    claimToken:claim.claimToken,claimGeneration:claim.claim.generation,
    requestId:'dedicated_forge_native_session_once'};
  const nativeOpen=await svc.invoke(ctx,'ordax_native_session_open',nativeInput);
  assert.equal(nativeOpen.status,'failed','rollout gate is not a successful binding');
  assert.equal(nativeOpen.result.reason,'forge_native_transport_rollout_required');
  assert.equal(nativeOpen.result.executionAuthorized,false);
  assert.equal(nativeOpen.result.actionDispatched,false);
  const nativeReplay=await svc.invoke(ctx,'ordax_native_session_open',nativeInput);
  assert.equal(nativeReplay.commandId,nativeOpen.commandId);
  assert.equal(nativeSessionOpens,1,'an idempotent retry does not repeat a challenge');
  await assert.rejects(svc.invoke(ctx,'ordax_native_session_open',{
    ...nativeInput,claimToken:'x'.repeat(43),requestId:'bad_native_claim'
  }),/forge_work_claim_not_owned/);
  const diagnostic={projectId:dedicated.projectId,taskId:created.result.taskId,
    repository:'ordaxsystems/ordax-os',
    deviceId:'14cef8f4-3c06-4b1b-9e3a-42c74ef7dec5'};
  const terminalPreflight=await svc.invoke(ctx,'ordax_execution_preflight',{
    ...diagnostic,action:'terminal'
  });
  assert.equal(terminalPreflight.grantVisible,true);
  assert.equal(terminalPreflight.reason,
    'native_forge_runtime_session_binding_required');
  assert.equal(terminalPreflight.executionAuthorized,false);
  assert.equal(terminalPreflight.deviceSelectionVerified,false);
  assert.equal(terminalPreflight.receiptCreated,false);
  const catalogPreflight=await svc.invoke(ctx,'ordax_execution_preflight',{
    ...diagnostic,action:'repository_catalog'
  });
  assert.equal(catalogPreflight.reason,'owner_capability_grant_required');
  assert.equal(catalogPreflight.requiredProfile,'repository-catalog-read');
  await assert.rejects(svc.invoke(ctx,'ordax_execution_preflight',{
    ...diagnostic,repository:'ordaxsystems/ordax-runtime',action:'terminal'
  }),/forge_task_repository_scope_not_assigned/);
  const replay=await svc.invoke(ctx,'work_repositories_set',{
    projectId:dedicated.projectId,taskId:created.result.taskId,
    claimToken:claim.claimToken,claimGeneration:claim.claim.generation,
    requestId:'dedicated_repo_scope_once',
    repositories:['ordaxsystems/ordax-apps','ordaxsystems/ordax-os']
  });
  assert.equal(replay.commandId,mapping.commandId);
  await assert.rejects(svc.invoke(ctx,'work_repositories_set',{
    projectId:dedicated.projectId,taskId:created.result.taskId,
    claimToken:claim.claimToken,claimGeneration:claim.claim.generation,
    requestId:'dedicated_repo_scope_second',
    repositories:['ordaxsystems/ordax-os']
  }),/forge_task_repository_scope_already_set/);
  const remoteOps=dedicatedForgeMcpOperations(store,FORGE_APP_MCP_OPERATIONS);
  assert.ok(remoteOps.includes('project_repositories'));
  assert.ok(remoteOps.includes('ordax_devices'));
  assert.ok(remoteOps.includes('ordax_native_session_open'));
  assert.ok(remoteOps.includes('ordax_repository_probe'));
  assert.ok(remoteOps.includes('ordax_execution_preflight'));
  assert.ok(remoteOps.includes('work_repositories_set'));
  for(const operation of ['mission_create','project_rename','project_delete'])
    assert.equal(remoteOps.includes(operation),false);
  const mcp=createOrchestratorMcp({service:svc,getContext:()=>ctx,
    allowedOperations:remoteOps,allowedProjectId:dedicated.projectId});
  const init=await mcp.handle({jsonrpc:'2.0',id:1,method:'initialize',
    params:{protocolVersion:'2025-11-25',clientInfo:{name:'dedicated-test',version:'1'},
      capabilities:{}}});
  assert.ok(init.result);
  await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const statusThroughMcp=await mcp.handle({jsonrpc:'2.0',id:11,method:'tools/call',
    params:{name:'forge_status',arguments:{}}});
  assert.ok(statusThroughMcp.result?.structuredContent);
  const projectsThroughMcp=await mcp.handle({jsonrpc:'2.0',id:12,method:'tools/call',
    params:{name:'forge_projects_list',arguments:{}}});
  assert.deepEqual(projectsThroughMcp.result.structuredContent.projects.map(p=>p.id),
    [dedicated.projectId]);
  const tools=await mcp.handle({jsonrpc:'2.0',id:2,method:'tools/list'});
  assert.ok(tools.result.tools.some(x=>x.name==='forge_project_repositories'));
  assert.ok(tools.result.tools.some(x=>x.name==='forge_ordax_execution_preflight'));
  assert.ok(tools.result.tools.some(x=>x.name==='forge_ordax_native_session_open'));
  assert.ok(tools.result.tools.some(x=>x.name==='forge_ordax_repository_probe'));
  assert.equal(tools.result.tools.some(x=>x.name==='forge_mission_create'),false);
  const listCatalog=await mcp.handle({jsonrpc:'2.0',id:3,method:'tools/call',
    params:{name:'forge_project_repositories',arguments:{}}});
  assert.equal(listCatalog.result.structuredContent.repositories[0].repo,'ordaxsystems/ordax-os');
  const invalid=await mcp.handle({jsonrpc:'2.0',id:4,method:'tools/call',
    params:{name:'forge_project_repositories',arguments:{projectId:oldId}}});
  assert.ok(invalid.error);

  // The public Forge connector is already installed with projectId required.
  // Keep its remote tool schema unchanged; the Owner project gate is enforced
  // by the service, not by removing expected arguments at the gateway.
  const publicMcp=createOrchestratorMcp({service:svc,getContext:()=>ctx,
    allowedOperations:remoteOps});
  const publicInit=await publicMcp.handle({jsonrpc:'2.0',id:20,method:'initialize',
    params:{protocolVersion:'2025-11-25',clientInfo:{name:'existing-forge-connector',
      version:'1'},capabilities:{}}});
  assert.ok(publicInit.result);
  await publicMcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const publicTools=await publicMcp.handle({jsonrpc:'2.0',id:21,method:'tools/list'});
  const projectTool=publicTools.result.tools.find(tool=>tool.name==='forge_orchestrators_list');
  assert.ok(projectTool.inputSchema.required.includes('projectId'));
  const publicCall=await publicMcp.handle({jsonrpc:'2.0',id:22,method:'tools/call',
    params:{name:'forge_orchestrators_list',arguments:{projectId:dedicated.projectId}}});
  assert.equal(publicCall.result.structuredContent.orchestrators.length,1);
  const historicalCall=await publicMcp.handle({jsonrpc:'2.0',id:23,method:'tools/call',
    params:{name:'forge_orchestrators_list',arguments:{projectId:oldId}}});
  assert.equal(historicalCall.result?.isError,true);
});
test('dedicated project metadata fails closed instead of switching to an archived project',()=>{
  const s=new Store(':memory:');
  let k;
  k=createOrchestratorKernel({store:s,authorize:({context})=>context===k?.context});
  try{
    s.updateWorkspaceMetadata({forgeDedicatedProject:{
      schema:'ordax.forge.dedicated-project/1',key:'ordax-os',projectId:'project_wrong'
    }});
    assert.throws(()=>readDedicatedForgeProject(s),
      /forge_dedicated_project_binding_invalid/);
  }finally{s.close();}
});
test('OrdaX ownership catalogue is read-only and rejects an unrelated repository checkout',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-ordax-catalog-'));
  t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
  const checkout=path.join(dir,'GitHub','ordax-os');
  fs.mkdirSync(path.join(checkout,'docs','contracts'),{recursive:true});
  execFileSync('git',['init'],{cwd:checkout,windowsHide:true});
  execFileSync('git',['remote','add','origin','https://github.com/ordaxsystems/ordax-os.git'],
    {cwd:checkout,windowsHide:true});
  const source=path.join(checkout,'docs','contracts','repository-ownership.json');
  fs.writeFileSync(source,JSON.stringify({status:'canonical',repositories:{
    platform:{repo:'ordaxsystems/ordax-os',owns:['base']},
    apps:{repo:'ordaxsystems/ordax-apps',owns:['first-party']}
  }}));
  const broker=createForgeOrdaxRepositoryCatalog({documentsDirectory:dir});
  const result=broker.read();
  assert.equal(result.available,true);
  assert.equal(result.repositories.length,2);
  assert.equal(result.checkedOrigin,true);
  assert.equal(result.mainCommitVerified,false);
  assert.equal(result.executionAuthorized,false);
  assert.equal(result.repositories[1].repositoryAccessGranted,false);
  assert.equal(JSON.stringify(result).includes(dir),false,'never expose local Windows paths');
  execFileSync('git',['remote','set-url','origin','https://github.com/untrusted/other.git'],
    {cwd:checkout,windowsHide:true});
  const rejected=broker.read();
  assert.equal(rejected.available,false);
  assert.equal(rejected.executionAuthorized,false);
});
