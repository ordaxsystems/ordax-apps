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

// Render only a scoped receipt projection read from the canonical Store.
// Missing, mismatched, failed or unknown reads never authorize a Groq request.
export function runReviewButtonState({runId,receipt,attempted=false,busy=false}={}) {
  if(!runId)return {enabled:false,message:''};
  if(busy)return {enabled:false,message:'Revisão em andamento; nenhum novo envio permitido.'};
  if(attempted)return {enabled:false,message:'Revisão já solicitada nesta sessão. Consulte o histórico.'};
  if(!receipt||receipt.runId!==runId)
    return {enabled:false,message:'Não foi possível confirmar os recibos deste Run. Nenhum envio autorizado.'};
  switch(receipt.status) {
    case 'not_requested':return {enabled:true,message:''};
    case 'succeeded':return {enabled:false,message:'Revisão Groq já registrada para este Run. Efeitos externos não comprovados.'};
    case 'running':return {enabled:false,message:'Revisão em andamento; aguarde o recibo.'};
    case 'uncertain':return {enabled:false,message:'Revisão com resultado incerto; reconciliação necessária, sem reenvio.'};
    case 'failed':return {enabled:false,message:'Revisão anterior falhou; consulte os recibos antes de uma recuperação controlada.'};
    default:return {enabled:false,message:'Estado da revisão desconhecido; nenhum envio autorizado.'};
  }
}

// A late read from another Task, project, Run or navigation epoch never
// re-enables the current button. No cached status is authoritative.
export function runReviewLookupCurrent(request,active) {
  return Boolean(request&&active&&
    ['lookup','epoch','taskId','runId','projectId','orchestratorId']
      .every(key=>request[key]===active[key]));
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
