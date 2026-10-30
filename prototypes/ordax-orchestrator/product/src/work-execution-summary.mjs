// Read-only projection of canonical Tasks and Runs. No speculative readiness,
// no new queues, no dispatch permissions and no inferred dependencies.
export function workExecutionSummary(works) {
  if(!Array.isArray(works)||works.some(w=>!w||typeof w.id!=='string'||
    typeof w.status!=='string'|| !Number.isSafeInteger(w.running_runs)||
    w.running_runs<0))throw Error('work_execution_summary_invalid');
  return works.map(w=>{
    const latest=w.latest_run_status??null;
    const active=w.running_runs>0;
    const uncertain=['uncertain','indeterminate','interrupted'].includes(latest);
    const needsReview=uncertain||['failed','error','interrupted'].includes(w.status)||
      ['failed','error'].includes(latest);
    const observed=active?'running':uncertain?'reconciliation_required':
      needsReview?'review_required':latest==='succeeded'?'last_run_succeeded':'no_confirmed_success';
    return Object.freeze({taskId:w.id,observed,active,needsReview,
      latestRunStatus:latest,automaticDispatchAllowed:false});
  });
}
