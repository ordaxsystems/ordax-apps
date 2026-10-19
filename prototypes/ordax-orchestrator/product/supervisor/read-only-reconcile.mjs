import { authorizeLocalSupervisorTask, validateSupervisorDecision } from './coordinator.mjs';
import { canonicalProviderChatUrl } from '../src/conversation-policy.mjs';
import { assessProviderConversationEvidence } from '../src/provider-conversation-reconciliation.mjs';

// No DB updates, events, sends or retries. Browser inspection may navigate to
// the already-linked provider thread, but never modifies its messages.
export async function inspectSupervisorChatReadOnly({store,worker,taskId,actionId}) {
  if (typeof taskId !== 'string' || !taskId || taskId.length>180 ||
      typeof actionId !== 'string' || !/^action_[a-z0-9-]{8,}$/i.test(actionId)) {
    throw new Error('invalid_reconciliation_request');
  }
  const authorize=()=>authorizeLocalSupervisorTask({
    store,actorId:'lab-owner',tenantId:null,environment:'internal',taskId,operation:'review'
  });
  if (!authorize()) throw new Error('supervisor_access_denied');
  const row=store.db.prepare(
    "SELECT id,status,payload,result FROM action_ledger WHERE id=? AND task_id=? AND action_type='supervisor.plan'"
  ).get(actionId,taskId);
  if (!row) throw new Error('supervisor_action_not_found');
  const scope=JSON.parse(row.payload);
  if (scope.actorId!=='lab-owner' || scope.environment!=='internal' ||
      scope.tenantId!==null) throw new Error('supervisor_access_denied');
  const basic={actionId,taskId,persistedStatus:row.status,requiresReconciliation:true};
  if (!['dispatching','indeterminate'].includes(row.status)) {
    return {...basic,kind:'unavailable',reason:'action_not_dispatched_uncertain'};
  }
  const decision=JSON.parse(row.result||'null')?.decision;
  if (!decision) return {...basic,kind:'unavailable',reason:'legacy_decision_missing'};
  const validated=validateSupervisorDecision(decision,taskId);
  if (validated.type!=='send_message') return {...basic,kind:'unavailable',reason:'not_message_action'};
  const task=store.getTaskExecutionSnapshot(taskId);
  const url=canonicalProviderChatUrl(task?.chat_url);
  if (!url) return {...basic,kind:'unavailable',reason:'canonical_chat_url_missing'};
  if (typeof worker?.inspectConversationReadOnly!=='function') {
    return {...basic,kind:'unavailable',reason:'provider_inspector_unavailable'};
  }
  let observed;
  try {observed=await worker.inspectConversationReadOnly(url);}
  catch {return {...basic,kind:'unavailable',reason:'provider_inspection_failed'};}
  // Re-check ownership and concurrent action/URL changes after async navigation.
  if (!authorize()) throw new Error('supervisor_access_denied');
  const current=store.db.prepare(
    'SELECT status,payload,result FROM action_ledger WHERE id=? AND task_id=?'
  ).get(actionId,taskId);
  const latest=store.getTaskExecutionSnapshot(taskId);
  if (!current || current.status!==row.status || current.payload!==row.payload ||
      current.result!==row.result ||
      canonicalProviderChatUrl(latest?.chat_url)!==url) {
    return {...basic,kind:'unavailable',reason:'reconciliation_state_changed'};
  }
  const evaluation=assessProviderConversationEvidence({
    expectedUrl:url,expectedMessage:validated.content,observed
  });
  return {...basic,...evaluation};
}
