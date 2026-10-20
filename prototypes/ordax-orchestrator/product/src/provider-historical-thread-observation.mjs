import { canonicalProviderChatUrl } from './conversation-policy.mjs';
import { observeWithin, safeHistoricalThreadFailure } from './provider-observation-policy.mjs';

// Read-only React hydration observation. The caller navigates at most once.
// Missing DOM may be retried; a hung observation is never re-issued.
export async function waitForHistoricalThreadDom({
  expectedUrl,read,now=Date.now,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  timeoutMs=8000,pollMs=250
}={}) {
  const expected=canonicalProviderChatUrl(expectedUrl);
  if(!expected || typeof read!=='function')
    throw new Error('invalid_thread_observation_request');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000 ||
     !Number.isSafeInteger(pollMs)||pollMs<1||pollMs>1000)
    throw new Error('invalid_thread_observation_bounds');
  const deadline=now()+timeoutMs;
  while(true) {
    const remaining=deadline-now();
    if(remaining<=0) return {available:false,url:expected,reason:'thread_dom_not_ready'};
    let snapshot;
    try {
      snapshot=await observeWithin(read,{timeoutMs:Math.min(2000,remaining),
        code:'provider_conversation_observation_timeout'});
    } catch(error) {
      // A non-settling renderer observation may still be pending.
      // Never queue another DOM evaluation after timeout or rejection.
      return {available:false,url:expected,reason:safeHistoricalThreadFailure(error?.message)};
    }
    if(!snapshot || canonicalProviderChatUrl(snapshot.url)!==expected)
      return {available:false,url:expected,reason:'thread_navigation_changed'};
    if(snapshot.available===true && snapshot.domReliable===true &&
       Array.isArray(snapshot.messages) && snapshot.messages.length>0)
      return snapshot;
    await sleep(Math.min(pollMs,Math.max(0,deadline-now())));
  }
}
