// Canonical Store/runs is the sole owner of execution state. This helper is
// read-only and refuses any later send for a Task with an unreconciled
// potentially submitted prior Run. It never queries or submits to ChatGPT.
export function listTaskUncertainTransportRuns(store,taskId) {
  if (!store?.db || typeof taskId !== 'string' || !/^task_[a-z0-9-]{8,}$/i.test(taskId))
    throw new Error('invalid_task_reconciliation_scope');
  const rows=store.db.prepare(
    "SELECT id,status,error,metrics FROM runs WHERE task_id=? AND status IN ('failed','interrupted') ORDER BY started_at DESC,id DESC"
  ).all(taskId);
  const uncertain=[];
  for(const row of rows) {
    let metrics=null;
    try {metrics=JSON.parse(row.metrics||'null');}catch{/* unknown metrics do not prove safety */}
    const startedSubmit=Boolean(metrics?.submit_attempt_at);
    const confirmedSubmit=Boolean(metrics?.submitted_at);
    const explicitNoSubmission=metrics?.provider_delivery_state==='not_submitted' &&
      !startedSubmit && !confirmedSubmit;
    if(row.status==='interrupted' || !explicitNoSubmission) {
      uncertain.push({
        runId:row.id,
        status:row.status,
        submitAttemptObserved:startedSubmit,
        submitConfirmationObserved:confirmedSubmit,
        // A positive submission observation is NOT proof of response/effect.
        requiresReconciliation:true
      });
    }
  }
  return uncertain;
}

export function assertTaskHasNoUncertainTransport(store,taskId) {
  const uncertain=listTaskUncertainTransportRuns(store,taskId);
  if(uncertain.length)throw new Error('task_submission_reconciliation_required');
  return true;
}
