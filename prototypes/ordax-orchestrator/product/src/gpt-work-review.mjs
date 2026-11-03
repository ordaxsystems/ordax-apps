import {parseStructuredModelObject} from './structured-model-object.mjs';

// A Groq review classifies one real GPT response. It proposes a next step,
// never certifies a repository effect or authorizes a provider submission.
export const GPT_REVIEW_FOLLOWUP_DECISIONS=Object.freeze([
  'continue_same_conversation','new_conversation','new_work','request_correction'
]);
export const GPT_REVIEW_TERMINAL_DECISIONS=Object.freeze([
  'verify_external_effect','candidate_complete','blocked'
]);
export const GPT_REVIEW_DECISIONS=Object.freeze([
  ...GPT_REVIEW_FOLLOWUP_DECISIONS,...GPT_REVIEW_TERMINAL_DECISIONS
]);
const decisions=new Set(GPT_REVIEW_DECISIONS);
const followups=new Set(GPT_REVIEW_FOLLOWUP_DECISIONS);
const bounded=(value,max,min=0)=>typeof value==='string'&&value.trim().length>=min&&value.trim().length<=max;
export function interpretGPTWorkReview(raw,{runId,observedAnswer}={}){
  if(!bounded(raw,9000,5)||!bounded(runId,180,1)||!bounded(observedAnswer,2500,20))
    throw Error('gpt_review_evidence_missing');
  // The same strict JSON/fence grammar applies to model proposals and reviews.
  let value;
  try{value=parseStructuredModelObject(raw);}catch{throw Error('gpt_review_invalid_json')}
  if(!value||Array.isArray(value)||typeof value!=='object'||
    Object.keys(value).some(key=>!['runId','decision','summary','reason','observedExcerpt','nextPrompt'].includes(key))||
    value.runId!==runId||!decisions.has(value.decision)||
    !bounded(value.summary,600,20)||!bounded(value.reason,700,20)||
    !bounded(value.observedExcerpt,180,16)||!observedAnswer.includes(value.observedExcerpt))
    throw Error('gpt_review_invalid_evidence');
  const hasNext=followups.has(value.decision);
  if(hasNext?!bounded(value.nextPrompt,2200,20):
    !(value.nextPrompt===null||value.nextPrompt===undefined||value.nextPrompt===''))
    throw Error('gpt_review_invalid_next_step');
  return Object.freeze({
    sourceRunId:runId,decision:value.decision,summary:value.summary.trim(),
    reason:value.reason.trim(),observedExcerpt:value.observedExcerpt,
    nextPrompt:hasNext?value.nextPrompt.trim():null,
    reviewOnly:true,externalEffectVerified:false,automaticGPTSendAuthorized:false
  });
}
