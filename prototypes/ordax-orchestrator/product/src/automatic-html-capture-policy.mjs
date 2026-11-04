import {classifyUnambiguousSiteCreation,classifyExistingSiteChange} from './natural-site-intent.mjs';

// An attempt to INSPECT an existing GPT attachment is safe after one confirmed
// Run. The model need not say "index.html": users don't know file formats.
// Existence still requires an official attachment card, verified thread,
// bytes, hash, and the canonical Store/Run binding before any UI claim.
export function shouldAttemptAutomaticHtmlCapture({authorSource,runId,text,userRequest}={}) {
  return authorSource==='orchestrator'&&
    typeof runId==='string'&&runId.startsWith('run_')&&
    typeof text==='string'&&text.trim().length>0&&
    (text.toLowerCase().includes('index.html')||
      classifyUnambiguousSiteCreation(userRequest)?.artifact==='html'||
      classifyExistingSiteChange(userRequest)?.artifact==='html');
}
