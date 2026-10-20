// Fixed public diagnostic contract for read-only staged W3 checks.
// Never expose raw CDP exceptions, provider URLs, prompts or account data.
const STAGES=new Set([
  'initialization','fixture_snapshot','lab_ui_target','cdp_connection',
  'app_profile','provider_health','provider_url_baseline',
  'task_selection','task_panel','inspection_click','inspection_result',
  'postconditions','final_profile_check','complete'
]);
const FAILURES=new Set([
  'lab_w3_ui_timeout','lab_w3_ui_observation_failed',
  'lab_w3_cdp_connect_timeout','lab_w3_cdp_connection_failed',
  'lab_w3_offline_precondition_not_safe','lab_w3_offline_already_at_linked_thread',
  'lab_w3_offline_task_missing_in_app','lab_w3_offline_inspection_button_disabled',
  'lab_w3_offline_inspection_not_terminal','lab_w3_offline_preflight_not_observed',
  'lab_w3_offline_false_certification','lab_w3_offline_unexpected_navigation',
  'lab_w3_offline_mutated_ledger','lab_w3_offline_fixture_missing'
]);
function w3OfflineFailure(error,stage) {
  const code=typeof error?.message==='string'?error.message:'';
  return {
    schema:'ordax.lab.w3-offline-preflight.v1',
    pass:false,
    reason:FAILURES.has(code)?code:'lab_w3_offline_inspection_unavailable',
    stage:STAGES.has(stage)?stage:'unknown'
  };
}
module.exports={w3OfflineFailure};