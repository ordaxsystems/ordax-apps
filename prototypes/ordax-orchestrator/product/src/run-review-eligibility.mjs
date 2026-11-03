// UI-only admission for an explicit review of a confirmed GPT Run.
// The existing orchestrator service remains authoritative for provenance,
// ownership, stale Runs and actual Groq dispatch.
export function reviewCandidateRun({task,binding,projectId,orchestratorId}={}) {
  const run=task?.latest_run;
  if(binding?.kind!=='work'||binding.project_id!==projectId||
     binding.orchestrator_id!==orchestratorId||!projectId||!orchestratorId)
    return null;
  if(run?.status!=='succeeded'||typeof run.id!=='string'||
     !/^run_[a-f0-9-]{36}$/i.test(run.id)||
     !/^https:\/\/chatgpt\.com\/c\//i.test(task?.chat_url||''))
    return null;
  return run.id;
}

// Never present a generic project analysis or an unverified provider reply
// as a review of the selected Run.
export function confirmedRunReview(receipt,runId) {
  const decision=receipt?.result?.reviewDecision;
  return receipt?.status==='succeeded' &&
    decision?.sourceRunId===runId &&
    decision?.reviewOnly===true &&
    decision?.externalEffectVerified===false &&
    decision?.automaticGPTSendAuthorized===false &&
    typeof decision?.observedExcerpt==='string' &&
    decision.observedExcerpt.length>=16 &&
    decision.observedExcerpt.length<=180;
}
