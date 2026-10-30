import {buildCoordinatorRequestContext,validateCoordinatorReply} from './coordinator-request-context.mjs';

export function createChatGPTPlanCoordinatorConversation({connection,isEnabled,store}={}) {
  if(!connection||typeof connection.infer!=='function'||typeof connection.isPlanAvailable!=='function'||
    typeof isEnabled!=='function'||!store?.db)
    throw Error('orchestrator_coordinator_ports_required');
  return Object.freeze({
    available:()=>isEnabled()===true&&connection.isPlanAvailable(),
    async send({taskId,mission,projectId,orchestratorId,analysisContext=null,prepareWork=false,
      workspaceObservation=null,repositoryUrl=null}) {
      if(isEnabled()!==true)throw Error('supervisor_disabled');
      if(!connection.isPlanAvailable())throw Error('chatgpt_not_connected');
      const request=buildCoordinatorRequestContext({store,taskId,mission,projectId,orchestratorId,
        analysisContext,prepareWork,workspaceObservation,repositoryUrl});
      let answer;
      try {answer=await connection.infer({messages:[{role:'system',content:request.system},...request.history]});}
      catch(error) {
        if(error?.orchestratorFailureCode)throw error;
        const failure=Error(/^chatgpt_[a-z0-9_]{1,80}$/i.test(String(error?.message||''))
          ?error.message:'chatgpt_inference_failed');
        failure.orchestratorFailureCode=failure.message;
        failure.orchestratorRequestOutcome='unknown';
        throw failure;
      }
      let reply;
      try {reply=validateCoordinatorReply(answer?.content,{prepareWork,errorPrefix:'chatgpt'});}
      catch(error) {
        const failure=Error(error.message);
        failure.orchestratorFailureCode=error.message;
        failure.orchestratorRequestOutcome='response_invalid';
        throw failure;
      }
      return {...reply,provider:'chatgpt_plan',model:answer.model};
    }
  });
}
