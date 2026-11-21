// Forge Task/claim -> existing Runtime-attested Product MCP read, with the
// existing Forge SQLite command ledger. NO new queue, grant, Git executor,
// repository store, filesystem broker, timer or background worker.
import {readDedicatedForgeProject} from './forge-dedicated-project.mjs';

const SCHEMA='ordax.forge.runtime-repository-proof/1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uncertain=reason=>({schema:SCHEMA,state:'uncertain',reason,
  verified:false,actionDispatched:false,actionCompleted:false,
  gitExecutionAuthorized:false,filesAccessible:false});

function assertCurrentScope(service,context,input){
  const scope=readDedicatedForgeProject(service.store);
  if(!scope||scope.projectId!==input.projectId)
    throw Error('forge_dedicated_project_required');
  service.task(input.projectId,input.taskId,'work');
  if(!service.db.prepare(
    'SELECT 1 FROM forge_work_repository_scope WHERE project_id=? AND task_id=? AND repository=? LIMIT 1'
  ).get(input.projectId,input.taskId,input.repository))
    throw Error('forge_task_repository_scope_not_assigned');
  const catalog=service.repositoryCatalogPort?.read();
  if(catalog?.available!==true||catalog.checkedOrigin!==true||
     !catalog.repositories.some(item=>item.repo===input.repository))
    throw Error('forge_ordax_catalog_verified_origin_required');
  service.requireAccess(context,'ordax_repository_probe',input.projectId);
  service.workClaims.assertTaskMutation(context,input);
}

function validateProjection(raw,input,prior){
  if(!raw||raw.schema!==SCHEMA||
     !['observed','pending','denied','uncertain'].includes(raw.state)||
     raw.gitExecutionAuthorized===true||raw.filesAccessible===true)
    return uncertain('ordax_runtime_repository_proof_invalid');
  if(raw.state==='observed'&&
     (raw.verified!==true||raw.actionCompleted!==true||
      raw.actionDispatched!==true||raw.repository!==input.repository||
      !UUID.test(raw.runtimeRequestId||'')||
      !UUID.test(raw.deviceId||'')||
      typeof raw.runtimeProjectSlug!=='string'))
    return uncertain('ordax_runtime_repository_proof_invalid');
  if(raw.state==='pending'&&
     (raw.verified!==false||raw.actionDispatched!==true||
      raw.repository!==input.repository||
      !UUID.test(raw.runtimeRequestId||'')||
      !UUID.test(raw.deviceId||'')))
    return uncertain('ordax_runtime_repository_proof_invalid');
  if(prior&&raw.state==='observed'&&
     (raw.deviceId!==prior.deviceId||
      raw.runtimeRequestId!==prior.runtimeRequestId))
    return uncertain('ordax_runtime_repository_receipt_changed');
  return {...raw,gitExecutionAuthorized:false,filesAccessible:false};
}

export async function runForgeOrdaxRepositoryProbe(service,context,input){
  if((input.action==='start'&&input.sourceCommandId!==undefined)||
     (input.action==='status'&&!input.sourceCommandId))
    throw Error('forge_runtime_repository_probe_action_invalid');
  let original=null,prior=null;
  const reservation=service.transaction(()=>{
    assertCurrentScope(service,context,input);
    // Replaying a completed status lookup must return its original receipt,
    // even if that lookup already reconciled the source pending command.
    const existing=service.db.prepare(`SELECT id FROM lab_command_receipts
      WHERE workspace_session_id=? AND actor_id=? AND client_id=? AND request_id=?`)
      .get(context.workspaceSessionId,context.actorId,context.clientId,input.requestId);
    if(existing)return service.reserve(context,'ordax_repository_probe',input);
    if(input.action==='status'){
      original=service.db.prepare(`SELECT * FROM lab_command_receipts
        WHERE id=? AND workspace_session_id=? AND actor_id=? AND client_id=?
          AND project_id=? AND operation='ordax_repository_probe'`)
        .get(input.sourceCommandId,context.workspaceSessionId,
          context.actorId,context.clientId,input.projectId);
      if(!original||original.status!=='uncertain')
        throw Error('forge_runtime_repository_receipt_not_pending');
      try{prior=JSON.parse(original.result||'null');}catch{}
      if(prior?.taskId!==input.taskId||prior.repository!==input.repository||
         prior.state!=='pending'||prior.actionDispatched!==true||
         !UUID.test(prior.runtimeRequestId||'')||!UUID.test(prior.deviceId||''))
        throw Error('forge_runtime_repository_receipt_invalid');
    }
    return service.reserve(context,'ordax_repository_probe',input);
  });
  if(reservation.existing)return reservation.existing;
  let proof;
  try {
    proof=typeof service.ordaxProductMcp?.repositoryProof==='function'
      ?await service.ordaxProductMcp.repositoryProof({
        repository:input.repository,mode:input.action,
        ...(prior?{runtimeRequestId:prior.runtimeRequestId,
          expectedDeviceId:prior.deviceId}:{})
      })
      :{schema:SCHEMA,state:'denied',reason:'forge_native_oauth_port_unavailable',
        verified:false,actionDispatched:false,actionCompleted:false};
  }catch{proof=uncertain('ordax_runtime_read_outcome_unconfirmed');}
  proof=validateProjection(proof,input,prior);
  const result={...proof,projectId:input.projectId,
    taskId:input.taskId,repository:input.repository,
    ...(input.sourceCommandId?{sourceCommandId:input.sourceCommandId}:{})};
  // Re-read the claim and exact receipt before accepting an external result.
  // An earlier unknown state can become verified ONLY by querying the original
  // Product request_id under the same signed client, device and repository.
  return service.transaction(()=>{
    assertCurrentScope(service,context,input);
    if(prior&&proof.state==='observed'){
      const changed=service.db.prepare(`UPDATE lab_command_receipts
        SET status='succeeded',result=?,updated_at=?
        WHERE id=? AND project_id=? AND workspace_session_id=?
          AND actor_id=? AND client_id=? AND status='uncertain'
          AND operation='ordax_repository_probe'`)
        .run(JSON.stringify({...prior,...proof,reconciled:true}),
          service.store.now(),input.sourceCommandId,input.projectId,
          context.workspaceSessionId,context.actorId,context.clientId).changes;
      if(changed!==1)throw Error('forge_runtime_repository_reconcile_changed');
    }
    // A known queued Runtime action is NOT a completed repository observation.
    // Retain its original uncertain receipt until an explicit status recheck.
    const status=proof.state==='observed'?'succeeded':
      proof.state==='pending'&&input.action==='start'?'uncertain':
      proof.state==='uncertain'&&input.action==='start'?'uncertain':
      proof.state==='pending'?'succeeded':'failed';
    return service.finish(reservation.commandId,result,status);
  });
}
