// A failed post-commit UI navigation must never reverse an already durable
// provider reply, trigger a retry, or conceal a useful failure diagnostic.
const safeReasons=new Set(['visible_draft_present','provider_url_mismatch']);
export async function observePostCommitNavigation({worker,chatUrl}={}) {
  if(!chatUrl)return {navigated:null};
  try {
    const observed=await worker.showConversation(chatUrl);
    if(observed?.navigated===true)return {navigated:true};
    return {navigated:false,reason:safeReasons.has(observed?.reason)
      ?observed.reason:'provider_navigation_not_confirmed'};
  } catch {
    // No exception text: provider/OS error messages may include private data.
    return {navigated:false,reason:'provider_navigation_failed'};
  }
}
