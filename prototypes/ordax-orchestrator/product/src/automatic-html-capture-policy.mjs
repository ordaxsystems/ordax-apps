// The classifier is deterministic. It is NOT a proof that a provider
// attachment exists. The canonical capture function still verifies the
// finished Run, linked thread, official download card, local bytes and SHA.
export function shouldAttemptAutomaticHtmlCapture({authorSource,runId,text}={}) {
  return authorSource==='orchestrator'&&
    typeof runId==='string'&&runId.startsWith('run_')&&
    typeof text==='string'&&text.length>0&&
    text.toLowerCase().includes('index.html');
}
