import {readBoundedJsonResponse} from '../src/bounded-json-response.mjs';
import {buildCoordinatorRequestContext,validateCoordinatorReply} from './coordinator-request-context.mjs';

function coordinatorFailure(code,outcome,httpStatus=null) {
  const error=Error(code);
  error.orchestratorFailureCode=code;
  error.orchestratorRequestOutcome=outcome;
  if(Number.isSafeInteger(httpStatus))error.orchestratorHttpStatus=httpStatus;
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
      workspaceObservation=null,repositoryUrl=null}) {
      if(isEnabled(projectId,orchestratorId)!==true)throw Error('supervisor_disabled');
      const apiKey=getApiKey();
      if(typeof apiKey!=='string'||!apiKey.trim()||/[\r\n]/.test(apiKey))throw Error('supervisor_api_key_missing');
      const request=buildCoordinatorRequestContext({store,taskId,mission,projectId,orchestratorId,
        analysisContext,prepareWork,workspaceObservation,repositoryUrl});
      let response;
      try {
        response=await fetchImpl('https://api.groq.com/openai/v1/chat/completions',{
          method:'POST',signal:AbortSignal.timeout(timeoutMs),
          headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
          body:JSON.stringify({model,temperature:0,max_completion_tokens:1200,
            messages:[{role:'system',content:request.system},...request.history]})
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
      if(parsed?.choices?.[0]?.finish_reason!=='stop')throw coordinatorFailure('groq_incomplete_response','response_invalid');
      const content=parsed?.choices?.[0]?.message?.content;
      try {return validateCoordinatorReply(content,{prepareWork,errorPrefix:'groq'});}
      catch(error) {throw coordinatorFailure(error.message,'response_invalid');}
    }
  });
}
