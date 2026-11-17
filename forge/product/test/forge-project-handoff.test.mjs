import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {ForgeLocalWorkspaces} from '../src/forge-local-workspaces.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';
import {createOrchestratorMcp} from '../src/orchestrator-mcp.mjs';

function fixture(t) {
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const context={actorId:'owner',clientId:'desktop',
    workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,authorize:({context:c})=>c===context});
  let serial=0;
  const invoke=(operation,input={})=>service.invoke(context,operation,
    ORCHESTRATOR_TOOLS.find(tool=>tool.operation===operation)?.readOnly
      ?input:{requestId:'handoff_'+(++serial),...input});
  return {store,service,context,invoke};
}

test('project handoff restores bounded real context without promoting assistant claims',async t=>{
  const {store,invoke}=fixture(t);
  const p=(await invoke('project_quick_create',{creationNonce:'handoff_a'})).result;
  const work=(await invoke('work_create',{projectId:p.projectId,
    orchestratorId:p.orchestratorId,title:'Cardápio'})).result;
  const other=(await invoke('project_quick_create',{creationNonce:'handoff_other'})).result;
  store.appendMessage(other.chatTaskId,'assistant','SEGREDO DE OUTRO PROJETO');
  const source=store.appendMessage(p.chatTaskId,'assistant',
    'Decidimos fazer o cardápio em HTML e ainda não há arquivos verificados.');
  const proposal=(await invoke('project_memory_propose',{projectId:p.projectId,
    taskId:p.chatTaskId,sourceMessageId:source.id,category:'decision',
    key:'Linguagem',content:'Usar HTML no cardápio.',
    evidence:'Decidimos fazer o cardápio em HTML'})).result;
  store.memoryCandidates.review(p.chatTaskId,proposal.id,'accept');
  const runId=store.startRun(work.taskId);
  store.appendMessage(work.taskId,'user','Crie o cardápio');
  store.appendMessage(work.taskId,'assistant','Criei os arquivos. Sem confirmação independente.');
  store.finishRun(work.taskId,runId);
  for(let i=0;i<11;i++)store.appendMessage(work.taskId,'user','Mensagem '+i);
  const packet=await invoke('project_handoff',{projectId:p.projectId,taskId:work.taskId});
  assert.equal(packet.schema,'ordax.forge.project-handoff/1');
  assert.equal(packet.selectedTask.taskId,work.taskId);
  assert.equal(packet.counts.acceptedMemories,1);
  assert.equal(packet.acceptedMemory[0].sourceRef,source.id);
  assert.equal(packet.acceptedMemory[0].externalEffectVerified,false);
  assert.equal(packet.tasks.find(x=>x.taskId===work.taskId).lastRunStatus,'succeeded');
  assert.equal(packet.tasks.find(x=>x.taskId===work.taskId).completionVerified,false);
  assert.equal(packet.recentMessages.length,8);
  assert.equal(packet.limits.messagesTruncated,true);
  assert.equal(packet.nextSession.automaticSendAllowed,false);
  assert.equal(packet.workPlan.projectId,p.projectId);
  assert.ok(packet.workPlan.verificationRequired.includes(work.taskId));
  assert.equal(packet.continuation.taskId,work.taskId);
  assert.ok(packet.continuation.blockedReasons.includes('selected_task_acceptance_unverified'));
  assert.equal(packet.continuation.taskLeaseGranted,false);
  assert.equal(packet.provenance.physicalFilesInspected,false);
  assert.equal(JSON.stringify(packet).includes('SEGREDO DE OUTRO PROJETO'),false);
  await assert.rejects(invoke('project_handoff',{projectId:p.projectId,
    taskId:other.chatTaskId}),/orchestrator_task_unavailable/);
});

test('handoff exposes unresolved commands without replay or external effects',async t=>{
  const {store,invoke,context,service}=fixture(t);
  const p=(await invoke('project_quick_create',{creationNonce:'handoff_uncertain'})).result;
  const now=store.now();
  store.db.prepare(`INSERT INTO lab_command_receipts
    (id,workspace_session_id,actor_id,client_id,request_id,project_id,
    operation,input_hash,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run('cmd_uncertain',context.workspaceSessionId,
    context.actorId,context.clientId,'unresolved',p.projectId,
    'forjador_send','sample_hash','uncertain',now,now);
  const before=store.db.prepare('SELECT COUNT(*) AS n FROM lab_command_receipts').get().n;
  const handoff=await invoke('project_handoff',{projectId:p.projectId});
  const after=store.db.prepare('SELECT COUNT(*) AS n FROM lab_command_receipts').get().n;
  assert.equal(before,after);
  assert.equal(handoff.unresolvedCommands[0].commandId,'cmd_uncertain');
  assert.equal(handoff.nextSession.checkUncertainReceiptsBeforeRetry,true);
  assert.equal(handoff.nextSession.automaticRotationPerformed,false);
  assert.ok(handoff.continuation.blockedReasons.includes('unresolved_command_receipts'));
  assert.ok(handoff.continuation.blockedReasons.includes('plan_needs_reconciliation'));
  assert.equal(handoff.continuation.automaticDispatchAllowed,false);
  await assert.rejects(service.invoke({...context,actorId:'attacker'},
    'project_handoff',{projectId:p.projectId}),/orchestrator_access_denied/);
  const mcp=createOrchestratorMcp({service,getContext:()=>context});
  await mcp.handle({jsonrpc:'2.0',id:1,method:'initialize',
    params:{protocolVersion:'2025-06-18',clientInfo:{name:'test',version:'1'},capabilities:{}}});
  await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const listed=await mcp.handle({jsonrpc:'2.0',id:2,method:'tools/list'});
  assert.ok(listed.result.tools.some(x=>x.name==='forge_project_handoff'));
});

test('independent Task continuation survives another Task provider uncertainty without replay',async t=>{
  const {store,invoke,context}=fixture(t);
  const p=(await invoke('project_quick_create',{creationNonce:'handoff_independent_receipts'})).result;
  const a=(await invoke('work_create',{projectId:p.projectId,
    orchestratorId:p.orchestratorId,title:'Frontend independent'})).result.taskId;
  const b=(await invoke('work_create',{projectId:p.projectId,
    orchestratorId:p.orchestratorId,title:'Tests uncertain'})).result.taskId;
  const now=store.now();
  const insert=(id,operation,status,result)=>store.db.prepare(`INSERT INTO lab_command_receipts
    (id,workspace_session_id,actor_id,client_id,request_id,project_id,
    operation,input_hash,status,result,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id,context.workspaceSessionId,context.actorId,context.clientId,id,p.projectId,
      operation,'sha',status,result===null?null:JSON.stringify(result),now,now);
  insert('other_task_uncertain','work_send','uncertain',{taskId:b});
  let packet=await invoke('project_handoff',{projectId:p.projectId,taskId:a});
  assert.equal(packet.counts.unresolvedCommands,1);
  assert.equal(packet.receiptAdmission.totalUnresolvedCommands,1);
  assert.equal(packet.receiptAdmission.unrelatedTaskWorkReceipts,1);
  assert.equal(packet.receiptAdmission.blockingUnresolvedCommands,0);
  assert.equal(packet.continuation.requiresReceiptReconciliation,false);
  assert.equal(packet.continuation.taskLeaseGranted,false);
  assert.equal(packet.continuation.automaticDispatchAllowed,false);
  assert.equal(packet.continuation.providerMessagesSent,0);
  assert.equal(packet.nextSession.checkUncertainReceiptsBeforeRetry,false);
  assert.equal(packet.continuation.blockedReasons.includes('unresolved_command_receipts'),false);
  assert.equal((await invoke('project_handoff',{projectId:p.projectId,taskId:b}))
    .continuation.requiresReceiptReconciliation,true);
  assert.equal((await invoke('project_handoff',{projectId:p.projectId}))
    .continuation.requiresReceiptReconciliation,true);
  insert('unknown_target_uncertain','work_send','uncertain',{reason:'provider_outcome_unknown'});
  packet=await invoke('project_handoff',{projectId:p.projectId,taskId:a});
  assert.equal(packet.receiptAdmission.blockingUnresolvedCommands,1);
  assert.equal(packet.continuation.requiresReceiptReconciliation,true);
  store.db.prepare("UPDATE lab_command_receipts SET status='succeeded' WHERE id=?")
    .run('unknown_target_uncertain');
  insert('unscoped_filesystem_uncertain','project_command_run','uncertain',{reason:'outcome_unknown'});
  packet=await invoke('project_handoff',{projectId:p.projectId,taskId:a});
  assert.equal(packet.receiptAdmission.blockingUnresolvedCommands,1);
  assert.equal(packet.continuation.requiresReceiptReconciliation,true);
  assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('handoff exposes only scoped recorded branch, never a live HEAD or PR claim',async t=>{
  const {store,invoke}=fixture(t);
  const project=(await invoke('project_quick_create',{creationNonce:'worktree_handoff'})).result;
  const work=(await invoke('work_create',{projectId:project.projectId,
    orchestratorId:project.orchestratorId,title:'Checkout A'})).result;
  const other=(await invoke('project_quick_create',{creationNonce:'other_worktree'})).result;
  const workspaces=new ForgeLocalWorkspaces({store,documentsDirectory:os.tmpdir()});
  workspaces.schema();
  const recordedRoot=path.join(os.tmpdir(),'test-worktree-'+work.taskId);
  const now=store.now();
  store.db.prepare(`INSERT INTO forge_task_worktrees
    (task_id,project_id,workspace_session_id,worktree_root,physical_identity,
     branch_name,base_head_sha,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(work.taskId,project.projectId,
      store.getWorkspaceSession().id,recordedRoot,'fake-identity',
      'forge/work-'+work.taskId,'a'.repeat(40),'active',now,now);
  const handoff=await invoke('project_handoff',{projectId:project.projectId,
    taskId:work.taskId});
  const branch=handoff.tasks.find(item=>item.taskId===work.taskId).branchEvidence;
  assert.equal(branch.branchName,'forge/work-'+work.taskId);
  assert.equal(branch.baseHeadSha,'a'.repeat(40));
  assert.equal(branch.worktreeStatus,'active');
  assert.equal(branch.provenance,'forge_task_worktrees_sqlite');
  assert.equal(branch.currentHeadVerified,false);
  assert.equal(branch.pullRequestVerified,false);
  assert.equal(handoff.continuation.taskLeaseGranted,false);
  assert.equal(JSON.stringify(handoff).includes(recordedRoot),false,
    'physical worktree root must never leak through MCP');
  const foreign=await invoke('project_handoff',{projectId:other.projectId});
  assert.equal(foreign.tasks.some(item=>item.branchEvidence!==null),false);
});
