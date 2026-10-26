// Shared timeout semantics for already-issued provider observations.
// This does NOT cancel an HTTP navigation, replay a request, or assert that
// a navigation/response completed. The caller must treat timeout as unknown.
export async function observeWithin(work,{timeoutMs=5000,code='provider_observation_timeout'}={}) {
  if(typeof work!=='function')throw new TypeError('observation_work_required');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)
    throw new Error('invalid_observation_timeout');
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(new Error(code)),timeoutMs);
      })
    ]);
  }finally {
    if(timer)clearTimeout(timer);
  }
}

export function normalizeProviderFailure(error,{stage='unknown',submitAttemptAt=null,submissionConfirmedAt=null}={}) {
  const raw=String(error?.message||error||'');
  const candidate=raw.split(':').at(-1)?.trim()||'';
  const failureCode=/^[a-z][a-z0-9_]{1,80}$/i.test(candidate)
    ?candidate:'provider_send_unconfirmed';
  const failureStage=/^[a-z][a-z0-9_-]{0,40}$/i.test(String(stage))
    ?String(stage):'unknown';
  const failure=new Error(`${failureStage}:${failureCode}`);
  failure.providerDeliveryState=Number.isSafeInteger(submissionConfirmedAt)&&submissionConfirmedAt>0
    ?'submitted':submitAttemptAt?'uncertain':'not_submitted';
  failure.providerFailureStage=failureStage;
  failure.providerFailureCode=failureCode;
  return failure;
}

export function classifyProviderAuthObservation({url,page}={}) {
  const current=String(url||'');
  if(/^https:\/\/(?:accounts\.google\.com|auth\.openai\.com)\//i.test(current) ||
     /^https:\/\/chatgpt\.com\/auth\//i.test(current))
    return 'authenticating';
  if(!page||typeof page!=='object')return 'unknown';
  if(page.hasLogin===true && page.hasSignup===true)return 'anonymous';
  // UI heuristics provide an indication only; not verified session identity.
  if(page.composer===true && page.hasLogin!==true && page.hasSignup!==true)
    return 'session_present';
  return 'unknown';
}

// First-party browser resource timing contains only observed status codes.
// 429 does not prove which endpoint failed, the cause of missing content,
// or any account-specific limit. Never treat it as an invitation to retry.
export function classifyProviderAccessRestriction({
  forbiddenCount=0,rateLimitedCount=0,composerReady=false
}={}) {
  if(!Number.isSafeInteger(forbiddenCount)||forbiddenCount<0||
     !Number.isSafeInteger(rateLimitedCount)||rateLimitedCount<0)return null;
  if(composerReady===true)return null;
  if(rateLimitedCount>0)return 'backend_http_429_observed';
  if(forbiddenCount>=3)return 'backend_http_403_observed';
  return null;
}

// A DOM observation is a preliminary safety gate, NOT proof of account
// identity. Do not submit any text while login is missing or ambiguous.
export function assertProviderSendReadiness(health) {
  if(health?.page_state==='conversation_load_failed')
    throw new Error('chatgpt_conversation_load_failed');
  if(health?.response_generation_active===true)
    throw new Error('chatgpt_response_in_progress');
  if(health?.provider_response_failure==='chatgpt_response_retry_required')
    throw new Error('chatgpt_response_retry_required');
  if(health?.provider_response_failure==='chatgpt_response_error_observed')
    throw new Error('chatgpt_response_error_observed');
  if(health?.verification_required===true)throw new Error('chatgpt_verification_required');
  if(health?.provider_access_problem==='backend_http_403_observed')
    throw new Error('chatgpt_provider_backend_access_restricted');
  if(health?.provider_access_problem==='backend_http_429_observed')
    throw new Error('chatgpt_provider_rate_limited_observed');
  if(health?.auth_state==='authenticating')throw new Error('chatgpt_authentication_in_progress');
  if(health?.auth_state==='anonymous')throw new Error('chatgpt_login_required');
  if(health?.auth_state!=='session_present'||health?.composer_ready!==true||
     health?.health_observed===false)
    throw new Error('chatgpt_session_not_observed');
  return true;
}


// A loadURL timeout is NOT evidence that navigation failed or succeeded.
// An in-flight navigation may leave the previous document visible. Permit
// progress only when the requested URL is already active, its main frame
// has stopped loading and the required authenticated-composer UI is observed.
// Never use this for login pages, background/unknown state or implicit retries.
export function canAcceptObservedNavigationAfterTimeout({
  expectedUrl,actualUrl,requireComposer,mainFrameLoading,
  composerFound,composerFormReady,authState,healthObserved
}={}) {
  if(requireComposer!==true||mainFrameLoading!==false||
     composerFound!==true||composerFormReady!==true||
     authState!=='session_present'||healthObserved!==true)return false;
  try{
    const wanted=new URL(expectedUrl),actual=new URL(actualUrl);
    if(wanted.protocol!=='https:'||wanted.hostname!=='chatgpt.com'||
       wanted.username||wanted.password||wanted.port||wanted.hash||
       actual.protocol!=='https:'||actual.hostname!=='chatgpt.com'||
       actual.username||actual.password||actual.port)return false;
    return wanted.origin===actual.origin && wanted.pathname===actual.pathname &&
      wanted.search===actual.search;
  }catch{return false;}
}


// Narrow exception for READ-ONLY observation, never for message submission:
// Electron may leave loadURL's Promise pending after its main frame has stopped.
// This only authorizes looking at the rendered DOM, not asserting delivery.
export function canInspectHistoricalThreadAfterNavigationTimeout({
  expectedUrl,actualUrl,mainFrameLoading
}={}) {
  if(mainFrameLoading!==false)return false;
  try {
    const expected=new URL(expectedUrl),actual=new URL(actualUrl);
    if(expected.protocol!=='https:'||actual.protocol!=='https:'||
       expected.hostname!=='chatgpt.com'||actual.hostname!=='chatgpt.com'||
       expected.username||expected.password||actual.username||actual.password||
       expected.port||actual.port||expected.hash||actual.hash)return false;
    const pathPattern=/^\/c\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i;
    if(!pathPattern.test(expected.pathname)||!pathPattern.test(actual.pathname))
      return false;
    return expected.origin===actual.origin &&
      expected.pathname.replace(/\/$/,'')===actual.pathname.replace(/\/$/,'') &&
      expected.search===actual.search;
  } catch {return false;}
}

// Only operator-facing, allowlisted states; never propagate raw exceptions,
// provider URLs, message content, account data, headers or cookie values.
const READONLY_FAILURES=new Set([
  'provider_navigation_timeout','provider_composer_observation_timeout',
  'chatgpt_draft_present','provider_view_unavailable',
  'provider_conversation_observation_timeout','provider_health_observation_timeout',
  'thread_dom_not_ready','observation_failed','thread_navigation_changed',
  'provider_conversation_load_failed',
  'navigation_or_draft_blocked','provider_url_mismatch',
  'provider_readonly_debugger_unavailable','provider_readonly_dom_evaluation_rejected',
  'provider_readonly_dom_evaluation_timeout',
  'provider_health_unavailable','provider_verification_required',
  'provider_rate_limited_observed','provider_access_restricted_observed',
  'provider_login_required','provider_authentication_in_progress',
  'provider_session_not_observed'
]);
export function safeHistoricalThreadFailure(reason) {
  const name=typeof reason==='string' ? reason : '';
  return READONLY_FAILURES.has(name) ? name : 'provider_inspection_unavailable';
}
