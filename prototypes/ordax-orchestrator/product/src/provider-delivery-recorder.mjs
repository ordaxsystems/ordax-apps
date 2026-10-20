import {canonicalProviderChatUrl} from './conversation-policy.mjs';

// One receipt observer per Run. An existing conversation must remain at the
// expected canonical permalink; fresh conversations acquire theirs after send.
// This never submits, retries, navigates, or manufactures evidence of delivery.
export function createProviderDeliveryRecorder({startsFresh,expectedChatUrl,onDeliveryObserved}={}) {
  const expected=canonicalProviderChatUrl(expectedChatUrl);
  let recorded=false;
  return async ({currentUrl,submittedAt}={}) => {
    if(recorded || typeof onDeliveryObserved!=='function' ||
       !Number.isSafeInteger(submittedAt) || submittedAt<=0) return false;
    const current=canonicalProviderChatUrl(currentUrl);
    if(!current || (!startsFresh && (!expected || current!==expected))) return false;
    await onDeliveryObserved({chatUrl:current,submittedAt});
    recorded=true;
    return true;
  };
}
