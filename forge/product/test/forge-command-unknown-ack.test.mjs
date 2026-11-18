import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';
import {createOrchestratorMcp} from '../src/orchestrator-mcp.mjs';

function fixture(t){
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const context={actorId:'owner',clientId:'desktop',workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,authorize:({context:c})=>c===context});
  service.development={status:()=>({ownerApproved:true,available:true})};
  let serial=0;
  const invoke=(operation,input={})=>service.invoke(context,operation,
    ORCHESTRATOR_TOOLS.find(tool=>tool.operation===operation)?.readOnly
      ?input:{requestId:'native_review_'+(++serial),...input});
  return {store,context,service,invoke};
}
function seed(f,{id,projectId,operation='project_command_run',status='uncertain',
  result=null,at='2026-11-17T10:00:00.000Z'}){
  f.store.db.prepare('INSERT INTO lab_command_receipts (id,workspace_session_id,actor_id,client_id,request_id,project_id,operation,input_hash,status,result,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id,f.context.workspaceSessionId,f.context.actorId,f.context.clientId,id,
      projectId,operation,'a'.repeat(64),status,
      result===null?null:JSON.stringify(result),at,at);
}
test('native Owner quarantine: immutable original, one reviewed receipt, scoped continuation',async t=>{
  const f=fixture(t);
  const p=(await f.invoke('project_quick_create',{creationNonce:'review_project'})).result;
  seed(f,{id:'command_uncertain_target',projectId:p.projectId,
    result:{reason:'forge_development_command_outcome_uncertain',externalEffectsVerified:false}});
  seed(f,{id:'command_later_project_health',projectId:p.projectId,
    status:'succeeded',at:'2026-11-18T10:00:00.000Z',
    result:{projectId:p.projectId,completed:true,exitCode:0,
      commandOutcome:'exit_zero',workspaceScope:'project_root'}});
  const before=f.store.db.prepare('SELECT * FROM lab_command_receipts WHERE id=?')
    .get('command_uncertain_target');
  assert.equal((await f.invoke('project_handoff',{projectId:p.projectId})).counts.unresolvedCommands,1);
  const input={projectId:p.projectId,commandId:'command_uncertain_target',
    acknowledgeUnknownEffects:true,requestId:'native_review_accepted_1',
    note:'O efeito continua desconhecido. Reconheço o risco e não vou repetir esse comando.'};
  await assert.rejects(f.invoke('command_close_unverified',input),/native_owner_required/);
  const ack=f.service.closeUnverifiedCommand(f.context,input,{nativeOwnerConfirmed:true});
  assert.equal(ack.status,'succeeded');
  assert.equal(ack.result.disposition,'abandon_unverified');
  assert.equal(ack.result.originalStatus,'uncertain');
  assert.equal(ack.result.evidenceCommandId,'command_later_project_health');
  assert.equal(ack.result.externalEffectsVerified,false);
  assert.equal(ack.result.replayAllowed,false);
  assert.deepEqual(f.service.closeUnverifiedCommand(f.context,input,{nativeOwnerConfirmed:true}),ack);
  assert.throws(()=>f.service.closeUnverifiedCommand(f.context,
    {...input,requestId:'another_review'},{nativeOwnerConfirmed:true}),/already_closed/);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM lab_command_receipts WHERE id=?')
    .get('command_uncertain_target'),before);
  const original=await f.invoke('command_get',{commandId:'command_uncertain_target'});
  assert.equal(original.status,'uncertain');
  assert.equal(original.requiresReconciliation,false);
  assert.equal(original.reviewedUnknownOutcome,true);
  assert.equal(original.externalEffectsVerified,false);
  const handoff=await f.invoke('project_handoff',{projectId:p.projectId});
  assert.equal(handoff.counts.unresolvedCommands,0);
  assert.deepEqual(handoff.unresolvedCommands,[]);
  assert.equal(handoff.continuation.requiresReceiptReconciliation,false);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
test('uncertain sends, missing evidence, foreign project and MCP-origin acknowledgements fail closed',async t=>{
  const f=fixture(t);
  const a=(await f.invoke('project_quick_create',{creationNonce:'review_scope_a'})).result;
  const b=(await f.invoke('project_quick_create',{creationNonce:'review_scope_b'})).result;
  seed(f,{id:'command_missing_proof',projectId:a.projectId,
    result:{reason:'forge_development_command_outcome_uncertain',externalEffectsVerified:false}});
  seed(f,{id:'command_provider_send',projectId:a.projectId,operation:'work_send',
    result:{reason:'provider_result_unknown'}});
  const input={projectId:a.projectId,commandId:'command_missing_proof',
    requestId:'native_review_missing_proof',
    note:'Resultado ainda desconhecido e sem prova independente suficiente para reclassificar.',
    acknowledgeUnknownEffects:true};
  assert.throws(()=>f.service.closeUnverifiedCommand(f.context,input,
    {nativeOwnerConfirmed:true}),/independent_evidence_missing/);
  assert.throws(()=>f.service.closeUnverifiedCommand(f.context,
    {...input,projectId:b.projectId},{nativeOwnerConfirmed:true}),/scope_or_status_invalid/);
  assert.throws(()=>f.service.closeUnverifiedCommand(f.context,
    {...input,commandId:'command_provider_send'},{nativeOwnerConfirmed:true}),/scope_or_status_invalid/);
  assert.throws(()=>f.service.closeUnverifiedCommand(f.context,
    {...input,acknowledgeUnknownEffects:false},{nativeOwnerConfirmed:true}),/acknowledgement_required/);
  assert.equal((await f.invoke('project_handoff',{projectId:a.projectId})).counts.unresolvedCommands,2);
  const mcp=createOrchestratorMcp({service:f.service,getContext:()=>f.context});
  await mcp.handle({jsonrpc:'2.0',id:1,method:'initialize',
    params:{protocolVersion:'2025-11-25',clientInfo:{name:'test',version:'1'},capabilities:{}}});
  await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const listed=await mcp.handle({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
  assert.equal(listed.result.tools.some(x=>x.name==='forge_command_close_unverified'),false);
});