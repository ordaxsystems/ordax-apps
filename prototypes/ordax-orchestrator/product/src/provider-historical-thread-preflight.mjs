import { canonicalProviderChatUrl } from './conversation-policy.mjs';

// Read-only W3 is allowed to inspect the ALREADY OPEN linked chat even when
// historical composer-based session heuristics are inconclusive. Navigation
// to a different provider URL requires a recently observed usable session.
// No branch in this policy authenticates, navigates, retries or sends anything.
// After one authorized read-only navigation, a missing DOM can coexist with
// newly observed first-party backend restrictions. Report that observation
// rather than a generic DOM timeout. Never infer a cause, retry or authenticate.
export function classifyHistoricalThreadPostNavigation({observation,health}={}) {
  if (observation?.available!==false || observation?.reason!=='thread_dom_not_ready')
    return observation;
  const reason=health?.provider_access_problem==='backend_http_429_observed'
    ? 'provider_rate_limited_observed'
    : health?.provider_access_problem==='backend_http_403_observed'
      ? 'provider_access_restricted_observed' : null;
  return reason ? {...observation,reason} : observation;
}

export function assessHistoricalThreadPreflight({expectedUrl,health}={}) {
  const expected=canonicalProviderChatUrl(expectedUrl);
  if(!expected)return {allowed:false,reason:'canonical_chat_url_missing'};
  if(!health||health.connected!==true||health.health_observed!==true)
    return {allowed:false,reason:'provider_health_unavailable'};
  if(health.verification_required===true)
    return {allowed:false,reason:'provider_verification_required'};
  if(health.provider_access_problem==='backend_http_429_observed')
    return {allowed:false,reason:'provider_rate_limited_observed'};
  if(health.provider_access_problem==='backend_http_403_observed')
    return {allowed:false,reason:'provider_access_restricted_observed'};
  if(health.auth_state==='anonymous')return {allowed:false,reason:'provider_login_required'};
  if(health.auth_state==='authenticating')
    return {allowed:false,reason:'provider_authentication_in_progress'};
  const alreadyAtTarget=canonicalProviderChatUrl(health.url)===expected;
  if(!alreadyAtTarget && (health.auth_state!=='session_present' || health.composer_ready!==true))
    return {allowed:false,reason:'provider_session_not_observed'};
  return {allowed:true,reason:alreadyAtTarget?'already_at_linked_thread':'session_observed_for_navigation'};
}
