// One read-only continuation admission view over the existing Forge Store
// projections. This is not a lease, a second planner or permission to send.
const unique=values=>[...new Set(values)];

export function forgeContinuationDecision({handoff,plan,taskId=null}={}) {
  if(handoff?.schema!=='ordax.forge.project-handoff/1'||
     typeof handoff.project?.id!=='string'||
     !plan||plan.projectId!==handoff.project.id||
     !Array.isArray(plan.workers)||!Array.isArray(plan.candidates))
    throw Error('forge_continuation_evidence_invalid');
  const projectId=handoff.project.id;
  const workers=plan.workers;
  const selected=taskId===null?null:workers.find(item=>item.taskId===taskId);
  if(taskId!==null&&handoff.selectedTask?.taskId!==taskId)
    throw Error('forge_continuation_task_scope_invalid');
  const blockers=[];
  // Coordinator chat is a valid handoff scope, but not an executable Work.
  if(taskId!==null&&!selected)blockers.push('selected_task_not_work');
  // Project-level uncertainty is a quarantine for unowned effects, not for
  // unrelated Tasks that have a complete, Task-scoped receipt. Require the
  // independent full-ledger aggregate; a missing or inconsistent projection
  // can never silently downgrade a project-wide block.
  const globalUnresolved=handoff.counts?.unresolvedCommands;
  const receiptAdmission=handoff.receiptAdmission;
  const scopedReceiptEvidence=taskId!==null&&
    Number.isSafeInteger(globalUnresolved)&&globalUnresolved>=0&&
    receiptAdmission?.schema==='ordax.forge.receipt-admission/1'&&
    receiptAdmission.projectId===projectId&&receiptAdmission.taskId===taskId&&
    receiptAdmission.source==='canonical_app_sqlite_lab_command_receipt_scope'&&
    Number.isSafeInteger(receiptAdmission.totalUnresolvedCommands)&&
    receiptAdmission.totalUnresolvedCommands===globalUnresolved&&
    Number.isSafeInteger(receiptAdmission.blockingUnresolvedCommands)&&
    receiptAdmission.blockingUnresolvedCommands>=0&&
    receiptAdmission.blockingUnresolvedCommands<=globalUnresolved&&
    Number.isSafeInteger(receiptAdmission.unrelatedTaskWorkReceipts)&&
    receiptAdmission.unrelatedTaskWorkReceipts>=0&&
    receiptAdmission.blockingUnresolvedCommands+
      receiptAdmission.unrelatedTaskWorkReceipts===globalUnresolved;
  if((!Number.isSafeInteger(globalUnresolved)||globalUnresolved<0)||
     (globalUnresolved>0&&(taskId===null||!scopedReceiptEvidence||
       receiptAdmission.blockingUnresolvedCommands>0)))
    blockers.push('unresolved_command_receipts');
  if(plan.workCount===0)blockers.push('plan_needs_reconciliation');
  if(taskId!==null&&selected){
    if(selected.state==='running')blockers.push('selected_task_occupied');
    if(selected.state==='uncertain')blockers.push('selected_task_uncertain');
    if(selected.state==='failed')blockers.push('selected_task_failed_needs_review');
    if(selected.verificationRequired)blockers.push('selected_task_acceptance_unverified');
    if(selected.state==='blocked'&&!selected.verificationRequired)
      blockers.push('selected_task_dependencies_or_scope_blocked');
  }
  // A candidate is only a scheduling suggestion; it is never a lease.
  // Check the chosen Task against the *whole* dependency graph, not a
  // truncated list of recent work or the last provider message.
  const candidates=plan.candidates.filter(id=>
    typeof id==='string'&&workers.some(w=>w.taskId===id));
  if(taskId!==null&&!candidates.includes(taskId)&&!blockers.length)
    blockers.push('selected_task_not_dispatchable');
  if(plan.executor?.availableSlots===0)blockers.push('executor_capacity_unavailable');
  const requiresSelection=taskId===null&&candidates.length>0;
  return Object.freeze({
    schema:'ordax.forge.continuation-decision/1',
    projectId,taskId,
    source:'canonical_app_sqlite_work_plan_and_handoff',
    candidateTaskIds:Object.freeze([...candidates]),
    blockedReasons:Object.freeze(unique(blockers)),
    requiresTaskSelection:requiresSelection,
    requiresReceiptReconciliation:blocksOnReceipts(blockers),
    unrelatedTaskWorkReceipts:scopedReceiptEvidence
      ?receiptAdmission.unrelatedTaskWorkReceipts:0,
    activeRuns:Number(plan.inFlight)||0,
    uncertainTaskIds:Object.freeze(workers.filter(w=>w.state==='uncertain').map(w=>w.taskId)),
    needsAcceptanceTaskIds:Object.freeze(workers.filter(w=>w.verificationRequired).map(w=>w.taskId)),
    // Read-only admission never grants an execution slot. Dispatch must use
    // the existing Forge receipts and live provider/session admission.
    automaticDispatchAllowed:false,
    taskLeaseGranted:false,
    githubLiveVerified:false,
    providerMessagesSent:0,
    nextStep:blockers.length?'reconcile_blockers':
      requiresSelection?'select_canonical_task':'request_authorized_core_dispatch'
  });
}
const blocksOnReceipts=blockers=>blockers.includes('unresolved_command_receipts')||
  blockers.includes('selected_task_uncertain');
