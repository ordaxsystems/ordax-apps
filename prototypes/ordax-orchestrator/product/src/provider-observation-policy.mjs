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

// Read-only response-status evidence from the current provider document.
// A 403 is evidence of a refused request, NOT proof that the person failed
// to authenticate. No URL, cookie, payload or account information is retained.
export function classifyProviderAccessRestriction({
  forbiddenCount=0,composerReady=false
}={}) {
  if(!Number.isSafeInteger(forbiddenCount)||forbiddenCount<0)return null;
  if(composerReady!==true && forbiddenCount>=3)return 'backend_http_403_observed';
  return null;
}

// A DOM observation is a preliminary safety gate, NOT proof of account
// identity. Do not submit any text while login is missing or ambiguous.
export function assertProviderSendReadiness(health) {
  if(health?.verification_required===true)throw new Error('chatgpt_verification_required');
  if(health?.provider_access_problem==='backend_http_403_observed')
    throw new Error('chatgpt_provider_backend_access_restricted');
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
  'navigation_or_draft_blocked','provider_url_mismatch'
]);
export function safeHistoricalThreadFailure(reason) {
  const name=typeof reason==='string' ? reason : '';
  return READONLY_FAILURES.has(name) ? name : 'provider_inspection_unavailable';
}
