import {readBoundedJsonResponse} from '../src/bounded-json-response.mjs';
import {parseStructuredModelObject} from '../src/structured-model-object.mjs';
import {GPT_REVIEW_FOLLOWUP_DECISIONS,GPT_REVIEW_TERMINAL_DECISIONS} from '../src/gpt-work-review.mjs';
import {buildCoordinatorRequestContext,validateCoordinatorReply} from './coordinator-request-context.mjs';

// Constrain planned work at the model boundary, then validate again with
// the canonical work-proposal policy (field limits, scope and no extra keys).
// Supported GPT-OSS models receive Groq strict structured output; other
// configured models use JSON object mode with the same local validation.
const JARVIS_TURN_SCHEMA=Object.freeze({
  type:'object',properties:{
    action:{type:'string',enum:['respond','delegate']},
    reply:{type:'string'}
  },required:['action','reply'],additionalProperties:false
});
const WORK_PROPOSAL_SCHEMA=Object.freeze({
  type:'object',properties:{
    title:{type:'string'},
    content:{type:'string'},
    reason:{type:'string'}
  },required:['title','content','reason'],additionalProperties:false
});
// Groq strict schema supports an inner anyOf, not a root anyOf. Binding
// decision and nextPrompt inside one union means it cannot generate a terminal
// decision alongside a provider-supplied executable follow-up prompt.
const reviewStep=(decisions,nextPromptType)=>({
  type:'object',properties:{
    decision:{type:'string',enum:[...decisions]},
    nextPrompt:{type:nextPromptType}
  },required:['decision','nextPrompt'],additionalProperties:false
});
const WORK_REVIEW_SCHEMA=Object.freeze({
  type:'object',properties:{
    runId:{type:'string'},
    step:{anyOf:[
      reviewStep(GPT_REVIEW_FOLLOWUP_DECISIONS,'string'),
      reviewStep(GPT_REVIEW_TERMINAL_DECISIONS,'null')
    ]},
    summary:{type:'string'},reason:{type:'string'},observedExcerpt:{type:'string'}
  },required:['runId','step','summary','reason','observedExcerpt'],
  additionalProperties:false
});
const groqJarvisFormat=model=>/^openai\/gpt-oss-(20b|120b)$/.test(model)
  ?{type:'json_schema',json_schema:{name:'ordax_jarvis_turn',strict:true,schema:JARVIS_TURN_SCHEMA}}
  :{type:'json_object'};
const groqProposalFormat=model=>/^openai\/gpt-oss-(20b|120b)$/.test(model)
  ?{type:'json_schema',json_schema:{name:'ordax_work_proposal',strict:true,schema:WORK_PROPOSAL_SCHEMA}}
  :{type:'json_object'};
// Exact, bounded citations from one already-redacted GPT Run. No fixed
// decision or answer: the coordinator chooses among verbatim evidence.
export function deriveGPTReviewQuoteCandidates(context){
  if(context?.phase!=='gpt_response_review')return [];
  const parts=[context.reviewEvidence?.answerStart,context.reviewEvidence?.answerEnd]
    .filter(part=>typeof part==='string'&&part.length>=20);
  const all=[];
  for(const part of parts){
    const lines=part.split(/\r?\n/).map(line=>line.trim()).filter(line=>line.length>=20);
    const choices=[];
    for(const index of [...new Set([0,Math.floor(lines.length/2),lines.length-1])]){
      const line=lines[index];
      if(!line)continue;
      const offset=index===lines.length-1?Math.max(0,line.length-140):
        index===0?0:Math.max(0,Math.floor((line.length-140)/2));
      const quote=line.slice(offset,offset+140).trim();
      if(quote.length>=20&&part.includes(quote)&&!choices.includes(quote))choices.push(quote);
    }
    if(!choices.length){
      const quote=part.slice(0,140).trim();
      if(quote.length>=20&&part.includes(quote))choices.push(quote);
    }
    for(const quote of choices)if(!all.includes(quote))all.push(quote);
  }
  return all.slice(0,6);
}
function groqReviewFormat(model,context){
  const runId=context?.reviewEvidence?.runId,quotes=deriveGPTReviewQuoteCandidates(context);
  if(typeof runId!=='string'||runId.length<1||runId.length>180||!quotes.length)
    throw coordinatorFailure('groq_review_context_invalid','rejected');
  if(!/^openai\/gpt-oss-(20b|120b)$/.test(model))return {type:'json_object'};
  const schema={...WORK_REVIEW_SCHEMA,properties:{...WORK_REVIEW_SCHEMA.properties,
    runId:{type:'string',enum:[runId]},observedExcerpt:{type:'string',enum:quotes}}};
  return {type:'json_schema',json_schema:{name:'ordax_gpt_work_review',strict:true,schema}};
}

function coordinatorFailure(code,outcome,httpStatus=null) {
  const error=Error(code);
  error.orchestratorFailureCode=code;
  error.orchestratorRequestOutcome=outcome;
  if(Number.isSafeInteger(httpStatus))error.orchestratorHttpStatus=httpStatus;
  return error;
}
// The provider shape is an API boundary, not a second review contract.
// Convert only an exact nested strict response into the existing canonical
// flat review object; OrchestratorService still independently validates Run,
// verbatim evidence, bounds, and the decision's permissions.
function flattenStrictReview(content) {
  let value;
  try {value=parseStructuredModelObject(content);}
  catch {throw coordinatorFailure('groq_review_invalid_json','response_invalid');}
  const rootKeys=['runId','step','summary','reason','observedExcerpt'];
  if(!value||typeof value!=='object'||Array.isArray(value)||
     Object.keys(value).length!==rootKeys.length||
     !rootKeys.every(key=>Object.hasOwn(value,key)))
    throw coordinatorFailure('groq_review_invalid_evidence','response_invalid');
  const step=value.step;
  if(!step||typeof step!=='object'||Array.isArray(step)||
     Object.keys(step).length!==2||
     !Object.hasOwn(step,'decision')||!Object.hasOwn(step,'nextPrompt'))
    throw coordinatorFailure('groq_review_invalid_next_step','response_invalid');
  const followup=GPT_REVIEW_FOLLOWUP_DECISIONS.includes(step.decision);
  const terminal=GPT_REVIEW_TERMINAL_DECISIONS.includes(step.decision);
  if(!(followup&&typeof step.nextPrompt==='string'||terminal&&step.nextPrompt===null))
    throw coordinatorFailure('groq_review_invalid_next_step','response_invalid');
  return JSON.stringify({runId:value.runId,decision:step.decision,
    summary:value.summary,reason:value.reason,
    observedExcerpt:value.observedExcerpt,nextPrompt:step.nextPrompt});
}

// Only fixed enums and bounded numbers enter command receipts. Never persist
// model text, provider metadata objects or unknown finish_reason strings.
const KNOWN_FINISH_REASONS=new Set(['length','content_filter','tool_calls','function_call']);
function incompleteGroqResponse(parsed,maxCompletionTokens){
  const raw=parsed?.choices?.[0]?.finish_reason;
  const reason=KNOWN_FINISH_REASONS.has(raw)?raw:'unknown';
  const error=coordinatorFailure(
    reason==='content_filter'?'groq_response_filtered':
    reason==='tool_calls'||reason==='function_call'?'groq_unexpected_tool_call':
    'groq_incomplete_response','response_invalid');
  error.orchestratorFinishReason=reason;
  error.orchestratorCompletionBudget=maxCompletionTokens;
  const used=parsed?.usage?.completion_tokens;
  if(Number.isSafeInteger(used)&&used>=0&&used<=1000000)
    error.orchestratorCompletionTokens=used;
  return error;
}

export function createGroqCoordinatorConversation({getApiKey,isEnabled,store,
  fetchImpl=globalThis.fetch,model='openai/gpt-oss-20b',timeoutMs=25000}={}) {
  if(typeof getApiKey!=='function'||typeof isEnabled!=='function'||!store?.db||
    typeof fetchImpl!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000||
    typeof model!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(model))
    throw Error('orchestrator_coordinator_ports_required');
  return Object.freeze({
    available:(projectId,orchestratorId)=>isEnabled(projectId,orchestratorId)===true&&Boolean(getApiKey()),
    async send({taskId,mission,projectId,orchestratorId,analysisContext=null,prepareWork=false,
      workspaceObservation=null,repositoryUrl=null,delegateWork=false,completionProfile='standard'}) {
      if(isEnabled(projectId,orchestratorId)!==true)throw Error('supervisor_disabled');
      const apiKey=getApiKey();
      if(typeof apiKey!=='string'||!apiKey.trim()||/[\r\n]/.test(apiKey))throw Error('supervisor_api_key_missing');
      if(!['standard','narrative','narrative_recovery','technical_review'].includes(completionProfile))
        throw Error('orchestrator_completion_profile_invalid');
      const narrative=['narrative','narrative_recovery'].includes(completionProfile);
      const technicalReview=completionProfile==='technical_review';
      // Strict technical review can require both hidden reasoning and a
      // complete, bounded JSON decision. Raise this lane's ceiling only;
      // ordinary chat and story budgets retain their established limits.
      // A live Windows admin chat exhausted its entire 1,200-token allowance
      // on GPT-OSS reasoning and returned finish_reason=length. Keep normal
      // conversation bounded below narrative and technical-review lanes while
      // allocating enough room for a complete, verifiable response.
      const maxCompletionTokens=completionProfile==='narrative_recovery'?3200:
        technicalReview?3600:narrative?2600:prepareWork?1800:2400;
      const request=buildCoordinatorRequestContext({store,taskId,mission,projectId,orchestratorId,
        analysisContext,prepareWork,workspaceObservation,repositoryUrl});
      const responseFormat=prepareWork?groqProposalFormat(model):
        technicalReview?groqReviewFormat(model,analysisContext):delegateWork?groqJarvisFormat(model):null;
      const standardChat=completionProfile==='standard'&&!prepareWork;
      const strictReview=technicalReview&&/^openai\/gpt-oss-(20b|120b)$/.test(model);
      const outputInstructions=technicalReview
        ?strictReview
          ?' FORMATO ESTRITO: devolva as chaves runId, step, summary, reason, observedExcerpt. '+
            'step e {decision,nextPrompt}; decisoes de continuacao/correcao exigem nextPrompt '+
            'como instrucao textual concreta (no minimo 20 caracteres). Decisoes de verificacao, '+
            'candidato a conclusao ou bloqueio exigem nextPrompt null. O schema JSON anyOf '+
            'obriga essa correspondencia. Nunca coloque decision nem nextPrompt na raiz.'
          :' FORMATO JSON: devolva exatamente runId,decision,summary,reason,observedExcerpt,nextPrompt '+
            'na raiz. Para continuar ou corrigir, nextPrompt deve ter pelo menos 20 caracteres; '+
            'para verificar, concluir como candidato ou bloquear, use nextPrompt null.'
        :delegateWork?' FORMATO OBRIGATÓRIO JSON: responda somente com action e reply. '+
          'action=delegate somente quando o usuário pede explicitamente que uma tarefa técnica, '+
          'site, código, arquivo ou outro artefato seja produzido ou corrigido pelo GPT. '+
          'action=respond para perguntas, análise, esclarecimentos ou conversa. '+
          'A classificação NÃO é autorização: esta chamada nunca executa o GPT. '+
          'Se action=delegate, reply deve ser uma breve confirmação de intenção, '+
          'sem código ou artefato e sem alegar execução; o App decide se a missão poderá iniciar. '+
          'Se action=respond, reply é a resposta natural curta ao usuário. '+
          'Não inclua outros campos, markdown JSON, ferramentas ou autorizações inventadas.'
        :'';
      let response;
      try {
        response=await fetchImpl('https://api.groq.com/openai/v1/chat/completions',{
          method:'POST',signal:AbortSignal.timeout(timeoutMs),
          headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
          body:JSON.stringify({model,temperature:narrative?0.2:0,
            max_completion_tokens:maxCompletionTokens,
            ...(responseFormat?{response_format:responseFormat}:{}),
            ...((prepareWork||technicalReview||standardChat)&&/^openai\/gpt-oss-(20b|120b)$/.test(model)
              ?{reasoning_format:'hidden'}:{}),
            ...((narrative||prepareWork||technicalReview||standardChat)&&/^openai\/gpt-oss-(20b|120b)$/.test(model)
              ?{reasoning_effort:'low'}:{}),
            messages:[{role:'system',content:request.system+outputInstructions},...request.history]})
        });
      } catch(error) {
        const timedOut=error?.name==='TimeoutError'||error?.name==='AbortError';
        throw coordinatorFailure(timedOut?'groq_request_timeout':'groq_network_unavailable','unknown');
      }
      if(!response?.ok) {
        const httpStatus=Number.isSafeInteger(response?.status)?response.status:null;
        const code=httpStatus===401||httpStatus===403?'groq_auth_rejected':httpStatus===429?'groq_rate_limited':
          httpStatus!==null&&httpStatus>=500?'groq_service_unavailable':'groq_request_rejected';
        throw coordinatorFailure(code,'rejected',httpStatus);
      }
      let parsed;
      try {parsed=await readBoundedJsonResponse(response,{maxBytes:64000,errorCode:'orchestrator_reply_invalid'});}
      catch {throw coordinatorFailure('groq_invalid_response','response_invalid');}
      if(parsed?.choices?.[0]?.finish_reason!=='stop')
        throw incompleteGroqResponse(parsed,maxCompletionTokens);
      const content=strictReview
        ?flattenStrictReview(parsed?.choices?.[0]?.message?.content)
        :parsed?.choices?.[0]?.message?.content;
      try {return validateCoordinatorReply(content,{prepareWork,delegateWork,errorPrefix:'groq'});}
      catch(error) {throw coordinatorFailure(error.message,'response_invalid');}
    }
  });
}
