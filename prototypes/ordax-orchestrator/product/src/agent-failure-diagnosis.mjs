// Strict app-evidence triage. A language model may explain the diagnosis,
// but NEVER override provider delivery provenance or authorize a resend.
const asCode = value => {
  const s=String(value||'').toLowerCase();
  return /^[a-z][a-z0-9_]{1,80}$/.test(s)?s:'unclassified_error';
};
const loading=new Set([
  'composer_not_found','provider_navigation_timeout','provider_observation_timeout',
  'provider_waiting','provider_hydrating','provider_health_pending','provider_load_pending'
]);
const blocked=new Set([
  'chatgpt_draft_present','composer_focus_not_observed','chatgpt_auth_required',
  'chatgpt_conversation_load_failed','provider_context_attachment_upload_unconfirmed',
  'provider_session_unavailable','orchestrator_paused','provider_send_not_ready',
  'provider_navigation_state_unknown','chatgpt_login_required','provider_access_denied'
]);
export function diagnoseAgentFailure({code,stage='unknown',deliveryState='unknown',health=null,
  ageMs=0}={}) {
  const failureCode=asCode(code),stageName=asCode(stage);
  const delivery=['not_submitted','submitted','uncertain'].includes(deliveryState)
    ?deliveryState:'unknown';
  const evidence={
    code:failureCode,stage:stageName,deliveryState:delivery,
    healthState:typeof health?.page_state==='string' ? asCode(health.page_state):'not_observed',
    elapsedMs:Number.isFinite(ageMs)&&ageMs>=0?Math.min(600000,Math.round(ageMs)):0
  };
  if(delivery!=='not_submitted')return Object.freeze({
    category:'delivery_unconfirmed',severity:'stop',replayAllowed:false,autoRetry:false,
    operatorAction:'inspect_linked_thread_and_provenance',evidence
  });
  if(health?.page_state==='conversation_load_failed'||blocked.has(failureCode))
    return Object.freeze({category:'confirmed_pre_submit_blocker',severity:'stop',
      replayAllowed:false,autoRetry:false,operatorAction:'repair_session_or_composer',evidence});
  if(loading.has(failureCode) || ['loading','hydrating','pending','connecting'].includes(health?.page_state))
    return Object.freeze({category:'transient_pre_submit_wait',severity:'wait',
      replayAllowed:false,autoRetry:false,operatorAction:'observe_health_again_without_dispatch',evidence});
  return Object.freeze({category:'confirmed_pre_submit_failure',severity:'stop',
    replayAllowed:false,autoRetry:false,operatorAction:'inspect_failure_and_fix_root_cause',evidence});
}
export function describeAgentDiagnosticForGroq(diagnosis) {
  if(!diagnosis||typeof diagnosis!=='object'||!diagnosis.evidence)throw Error('diagnosis_invalid');
  return Object.freeze({kind:diagnosis.category,policyAction:diagnosis.operatorAction,
    mayResend:false,mayClaimRecovery:false,observations:diagnosis.evidence});
}
