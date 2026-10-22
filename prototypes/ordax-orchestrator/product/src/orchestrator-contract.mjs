// One catalog for the App service, IPC and MCP projection. No authority here.
export const ORCHESTRATOR_CONTRACT = 'ordax.orchestrator/1';
const text = (maxLength, minLength = 1) => ({type:'string',minLength,maxLength});
const id = {...text(180),pattern:'^[A-Za-z0-9_-]+$'};
const requestId = {...text(120),pattern:'^[A-Za-z0-9_-]+$'};
const definitions = [
  ['status','Inspect local engine state and limitations.',{},[],true],
  ['projects_list','List accessible Lab projects.',{},[],true],
  ['project_create','Create an isolated Lab project. Does not create files or send prompts.',{name:text(140),objective:text(4000,0)},['name'],false],
  ['orchestrators_list','List coordinators of one project.',{projectId:id},['projectId'],true],
  ['orchestrator_create','Create a coordinator with persistent mission and its own local conversation.',{projectId:id,name:text(140),mission:text(4000)},['projectId','name','mission'],false],
  ['orchestrator_pause','Pause or resume coordination; does not cancel an already submitted provider request.',{projectId:id,orchestratorId:id,paused:{type:'boolean'}},['projectId','orchestratorId','paused'],false],
  ['continuity_status','Inspect durable post-run analysis, blockers and required reconciliation.',{projectId:id,orchestratorId:id},['projectId','orchestratorId'],true],
  ['continuity_set','Opt in or out of automatic analysis after confirmed work runs. Never authorizes GPT sends.',{projectId:id,orchestratorId:id,enabled:{type:'boolean'}},['projectId','orchestratorId','enabled'],false],
  ['work_create','Create a work conversation under a project/coordinator. No provider submission.',{projectId:id,orchestratorId:id,title:text(140)},['projectId','orchestratorId','title'],false],
  ['work_list','List work conversations, excluding the coordinator chat.',{projectId:id,orchestratorId:id},['projectId'],true],
  ['work_get','Inspect a scoped work and its provider segments without browser navigation.',{projectId:id,taskId:id},['projectId','taskId'],true],
  ['work_messages','Read a bounded page of persisted work or coordinator messages.',{projectId:id,taskId:id,before:text(1000),limit:{type:'integer',minimum:1,maximum:50}},['projectId','taskId'],true],
  ['work_send','Send one authorized prompt through the existing App executor. An uncertain command must never be replayed.',{projectId:id,taskId:id,content:text(6000),draftRevision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}},['projectId','taskId','content'],false],
  ['conversation_rotate','Prepare a new GPT segment for the same work. Does not send or bypass limits.',{projectId:id,taskId:id},['projectId','taskId'],false],
  ['orchestrator_chat','Send one message to the configured API coordinator. Records the reply; proposals do not execute automatically.',{projectId:id,orchestratorId:id,content:text(4000)},['projectId','orchestratorId','content'],false],
  ['orchestrator_analyze','Analyze a bounded set of recent conversations in this project with the configured coordinator. Records recommendations only; does not send to GPT.',{projectId:id,orchestratorId:id},['projectId','orchestratorId'],false],
  ['orchestrator_prepare','Prepare one proposed new work and initial draft with the coordinator API. No work or GPT submission until local review.',{projectId:id,orchestratorId:id,content:text(4000)},['projectId','orchestratorId','content'],false],
  ['proposals_list','Read pending work proposals for the selected coordinator.',{projectId:id,orchestratorId:id},['projectId','orchestratorId'],true],
  ['proposal_review','Approve creation of one local work with a saved draft, or reject it. Never submits to GPT.',{projectId:id,orchestratorId:id,actionId:id,approved:{type:'boolean'}},['projectId','orchestratorId','actionId','approved'],false],
  ['proposal_send','After native confirmation, submit the current draft of one prepared work through the existing executor. First send only; uncertain sends never replay.',{projectId:id,orchestratorId:id,actionId:id,draftRevision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}},['projectId','orchestratorId','actionId','draftRevision'],false],
  ['command_get','Inspect a previously accepted command without repeating it.',{commandId:id},['commandId'],true]
];
export const ORCHESTRATOR_TOOLS = Object.freeze(definitions.map(([operation,description,properties,required,readOnly]) => ({
  name:'orchestrator_'+operation,operation,description,readOnly,
  inputSchema:{type:'object',additionalProperties:false,
    properties:{...(!readOnly?{requestId}:{}),...properties},
    required:[...(!readOnly?['requestId']:[]),...required]},
  annotations:{readOnlyHint:readOnly,destructiveHint:false,idempotentHint:true,
    openWorldHint:['work_send','proposal_send','orchestrator_chat','orchestrator_analyze','orchestrator_prepare'].includes(operation)}
})));

export function validateOrchestratorInput(operation, input) {
  const tool=ORCHESTRATOR_TOOLS.find(item=>item.operation===operation);
  if(!tool)throw Error('orchestrator_unknown_operation');
  if(!input || typeof input!=='object' || Array.isArray(input) ||
    Object.keys(input).some(key=>!Object.hasOwn(tool.inputSchema.properties,key)))
    throw Error('orchestrator_invalid_input');
  const normalized={};
  for(const [key,schema] of Object.entries(tool.inputSchema.properties)) {
    const value=input[key];
    if(value===undefined) {
      if(tool.inputSchema.required.includes(key))throw Error('orchestrator_invalid_input');
      continue;
    }
    if(schema.type==='string') {
      if(typeof value!=='string' || value.includes('\0') || value.length>schema.maxLength ||
        value.trim().length<schema.minLength || (schema.pattern&&!new RegExp(schema.pattern).test(value)))
        throw Error('orchestrator_invalid_input');
      normalized[key]=value.trim();
    } else if(schema.type==='boolean') {
      if(typeof value!=='boolean')throw Error('orchestrator_invalid_input');
      normalized[key]=value;
    } else {
      if(!Number.isSafeInteger(value)||value<schema.minimum||value>schema.maximum)
        throw Error('orchestrator_invalid_input');
      normalized[key]=value;
    }
  }
  return {tool,input:normalized};
}
