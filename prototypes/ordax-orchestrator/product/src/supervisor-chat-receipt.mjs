// Transport-specific evidence adapter. A response observation is NOT proof of
// local file changes, tests, execution by Runtime, or any other side effect.
// No message is sent and nothing is persisted by this module.
export function chatReceiptFromRunTask(reply) {
  const result = reply?.result;
  const runId = typeof result?.runId === 'string' && /^run_[a-z0-9-]{8,}$/i.test(result.runId)
    ? result.runId : null;
  // submittedAt is recorded only after submitExactlyOnce observed UI delivery.
  const stamp = result?.metrics?.submittedAt;
  const deliveryObserved = Number.isSafeInteger(stamp) && stamp > 0;
  const observation = result?.observedAt;
  const responseObserved = typeof observation === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(observation) &&
    Number.isFinite(Date.parse(observation));
  return {
    confirmed: Boolean(runId && deliveryObserved && responseObserved),
    deliveryObserved,
    responseObserved,
    runId,
    effectVerified:false
  };
}

export function requireConfirmedChatReceipt(receipt) {
  if (!receipt || receipt.confirmed !== true || receipt.deliveryObserved !== true ||
      receipt.responseObserved !== true || receipt.effectVerified !== false ||
      typeof receipt.runId !== 'string' || !/^run_[a-z0-9-]{8,}$/i.test(receipt.runId)) {
    throw new Error('chat_receipt_incomplete');
  }
  return { runId:receipt.runId, transport:{
    delivery_observed:true, response_observed:true, effect_verified:false
  } };
}
