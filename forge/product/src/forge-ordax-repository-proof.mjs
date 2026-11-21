// Interpret ONLY the bounded, Runtime-attested Product MCP repository catalog.
// Project names remain device-local slugs, never GitHub or filesystem grants.
// This module owns no OAuth, action queue, terminal, repository store or UI.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPOSITORY=/^ordaxsystems\/ordax-[a-z0-9-]{2,101}$/;
const SLUG=/^[a-z0-9][a-z0-9_-]{0,80}$/;
const BRANCH=/^[A-Za-z0-9._\/-]{1,140}$/;
const ACTION='workspace.repository_catalog';

export function canonicalOrdaxRepositoryRemote(remote){
  if(typeof remote!=='string'||remote.length>350)return null;
  const trimmed=remote.trim();
  const match=/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)(ordaxsystems\/ordax-[a-z0-9-]{2,101})(?:\.git)?$/i.exec(trimmed);
  return match&&REPOSITORY.test(match[1].toLowerCase())
    ?match[1].toLowerCase():null;
}

export function forgeRuntimeRepositoryProof({payload,repository,deviceId}={}){
  const schema='ordax.forge.runtime-repository-proof/1';
  const base={schema,repository,deviceId,verified:false,
    gitExecutionAuthorized:false,filesAccessible:false,
    actionCompleted:false};
  const denied=reason=>({...base,state:'denied',reason,
    actionDispatched:false});
  const uncertain=reason=>({...base,state:'uncertain',reason,
    outcomeUnconfirmed:true});
  if(typeof repository!=='string'||!REPOSITORY.test(repository)||
     typeof deviceId!=='string'||!UUID.test(deviceId))
    return denied('forge_runtime_repository_scope_invalid');
  if(!payload||typeof payload!=='object'||Array.isArray(payload))
    return uncertain('ordax_runtime_response_invalid');
  if(payload.ok===false){
    const publicReason=new Set(['product_grant_not_resolved',
      'central_session_pending','central_session_owner_selection_required',
      'product_project_scope_not_found','product_device_offline',
      'product_device_runtime_not_ready','product_mcp_retry_correlation_invalid',
      'product_attested_device_mismatch','trusted_operation_required']);
    return denied(publicReason.has(payload.error)
      ?payload.error:'ordax_runtime_read_denied');
  }
  if(payload.ok!==true||!UUID.test(payload.request_id||''))
    return uncertain('ordax_runtime_request_receipt_invalid');
  const requestId=payload.request_id.toLowerCase();
  const action=payload.action;
  if(!action||action.name!==ACTION||
    typeof action.device_id!=='string'||
    action.device_id.toLowerCase()!==deviceId.toLowerCase())
    return uncertain('ordax_runtime_action_identity_invalid');
  if(payload.pending===true&&['queued','leased','running'].includes(action.status))
    return {...base,state:'pending',runtimeRequestId:requestId,
      runtimeStatus:action.status,actionDispatched:true,
      reason:'ordax_runtime_read_pending'};
  if(action.status!=='succeeded')
    return denied(['failed','cancelled','expired'].includes(action.status)
      ?'ordax_runtime_read_failed':'ordax_runtime_action_status_invalid');
  const result=action.result;
  const projects=result?.data?.projects;
  if(result?.ok!==true||!Array.isArray(projects)||projects.length>1000)
    return uncertain('ordax_runtime_catalog_result_invalid');
  let match=null;
  const slugs=new Set();
  for(const entry of projects){
    if(!entry||typeof entry!=='object'||Array.isArray(entry)||
       typeof entry.slug!=='string'||!SLUG.test(entry.slug)||
       slugs.has(entry.slug)||!entry.repository||
       typeof entry.repository!=='object'||Array.isArray(entry.repository))
      return uncertain('ordax_runtime_catalog_result_invalid');
    slugs.add(entry.slug);
    const remote=canonicalOrdaxRepositoryRemote(entry.repository.remote);
    if(remote!==repository)continue;
    if(match)return denied('ordax_runtime_repository_binding_ambiguous');
    if(entry.repository.is_repository!==true)return denied('ordax_runtime_repository_not_verified');
    match=entry;
  }
  if(!match)return denied('ordax_runtime_repository_not_granted_or_installed');
  const branch=match.repository.branch;
  if(typeof branch!=='string'||!BRANCH.test(branch)||
     branch.includes('..')||branch.startsWith('/')||branch.endsWith('/'))
    return uncertain('ordax_runtime_catalog_branch_invalid');
  return {...base,state:'observed',verified:true,
    source:'canonical_ordax_runtime_repository_catalog',
    deviceId:deviceId.toLowerCase(),runtimeRequestId:requestId,
    runtimeProjectSlug:match.slug,branch,
    // Missing status is unknown, not proof of a clean Git checkout.
    dirty:typeof match.repository.dirty==='boolean'
      ?match.repository.dirty:null,
    statusAvailable:match.repository.status_available===true,
    actionDispatched:true,actionCompleted:true,
    // Observation never grants future file, terminal, Git or repository write.
    gitExecutionAuthorized:false,filesAccessible:false};
}
