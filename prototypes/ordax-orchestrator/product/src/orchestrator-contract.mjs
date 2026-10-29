// One catalog for the App service, IPC and MCP projection. No authority here.
import {normalizeGitHubRepositoryUrl} from './remote-repository-context.mjs';
export const ORCHESTRATOR_CONTRACT = 'ordax.orchestrator/1';
const text = (maxLength, minLength = 1) => ({type:'string',minLength,maxLength});
const id = {...text(180),pattern:'^[A-Za-z0-9_-]+$'};
const requestId = {...text(120),pattern:'^[A-Za-z0-9_-]+$'};
const definitions = [
  ['status','Inspect local engine state and limitations.',{},[],true],
  ['projects_list','List accessible Lab projects.',{},[],true],
  ['workspace_status','Inspect verified project-local workspace bindings and capability availability. No filesystem access.',{projectId:id},['projectId'],true],
  ['workspace_snapshot','Read a bounded Runtime-verified workspace summary through a project-scoped resource grant.',{projectId:id,bindingId:id},['projectId','bindingId'],true],
  ['workspace_bind','Bind a preauthorized opaque Runtime resource to a project. Never accepts a filesystem path or grants authority.',{projectId:id,deviceId:id,resourceId:{...text(180),pattern:'^resource_[A-Za-z0-9_-]{8,160}$'}},['projectId','deviceId','resourceId'],false],
  ['project_create','Create an isolated Lab project and optionally bind its canonical GitHub repository URL. No repository contents are read.',{name:text(140),objective:text(4000,0),repositoryUrl:text(300,0)},['name'],false],
  ['mission_create','Atomically create a project, coordinator and first work conversation with the mission saved as a draft. Does not submit to GPT.',{name:text(140,0),mission:text(4000),repositoryUrl:text(300,0)},['mission'],false],
  ['project_rename','Rename one accessible project. Does not alter its repository or work.',{projectId:id,name:text(140)},['projectId','name'],false],
  ['project_repository_set','Set or clear the project GitHub remote reference. This stores a URL only and does not read or write the repository.',{projectId:id,repositoryUrl:text(300,0)},['projectId','repositoryUrl'],false],
  ['orchestrators_list','List coordinators of one project.',{projectId:id},['projectId'],true],
  ['orchestrator_create','Create a coordinator with persistent mission and its own local conversation.',{projectId:id,name:text(140),mission:text(4000)},['projectId','name','mission'],false],
  ['orchestrator_pause','Pause or resume coordination; does not cancel an already submitted provider request.',{projectId:id,orchestratorId:id,paused:{type:'boolean'}},['projectId','orchestratorId','paused'],false],
  ['continuity_status','Inspect durable post-run analysis, blockers and required reconciliation.',{projectId:id,orchestratorId:id},['projectId','orchestratorId'],true],
  ['continuity_set','Opt in or out of automatic analysis after confirmed work runs. Never authorizes GPT sends.',{projectId:id,orchestratorId:id,enabled:{type:'boolean'}},['projectId','orchestratorId','enabled'],false],
  ['continuity_proposals_set','Opt in or out of at most two advisory next-work proposals after confirmed analyses. No GPT sends.',{projectId:id,orchestratorId:id,enabled:{type:'boolean'}},['projectId','orchestratorId','enabled'],false],
  ['autonomous_dialogue_status','Read the latest bounded one-mission dialogue; no external effects.',{projectId:id,orchestratorId:id},['projectId','orchestratorId'],true],
  ['autonomous_dialogue_start','Authorize a bounded autonomous dialogue (2 GPT sends), or a two-cycle narrative (4 GPT sends) in the existing provider; no system effects.',{projectId:id,orchestratorId:id,mission:text(4000),mode:{...text(8),pattern:'^(?:dialogue|story),
  ['work_create','Create a work conversation under a project/coordinator. No provider submission.',{projectId:id,orchestratorId:id,title:text(140)},['projectId','orchestratorId','title'],false],
  ['work_list','List work conversations, excluding the coordinator chat.',{projectId:id,orchestratorId:id},['projectId'],true],
  ['work_get','Inspect a scoped work and its provider segments without browser navigation.',{projectId:id,taskId:id},['projectId','taskId'],true],
  ['work_messages','Read a bounded page of persisted work or coordinator messages.',{projectId:id,taskId:id,before:text(1000),limit:{type:'integer',minimum:1,maximum:50}},['projectId','taskId'],true],
  ['work_send','Send one authorized prompt through the existing App executor. An uncertain command must never be replayed.',{projectId:id,taskId:id,content:text(6000),draftRevision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}},['projectId','taskId','content'],false],
  ['conversation_rotate','Prepare a new GPT segment for the same work. Does not send or bypass limits.',{projectId:id,taskId:id},['projectId','taskId'],false],
  ['orchestrator_chat','Send one message to the primary ChatGPT Web executor and persist its observed reply in the logical project conversation. Groq may answer only after an allowlisted health failure proves GPT did not receive the message; uncertain sends are never replayed.',{projectId:id,orchestratorId:id,content:text(4000),draftRevision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}},['projectId','orchestratorId','content'],false],
  ['orchestrator_analyze','Analyze a bounded set of recent conversations in this project with the configured coordinator. Records recommendations only; does not send to GPT.',{projectId:id,orchestratorId:id},['projectId','orchestratorId'],false],
  ['orchestrator_prepare','Prepare one proposed new work and initial draft with the coordinator API. No work or GPT submission until local review.',{projectId:id,orchestratorId:id,content:text(4000),draftRevision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}},['projectId','orchestratorId','content'],false],
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
    openWorldHint:['work_send','proposal_send','orchestrator_chat','orchestrator_analyze','orchestrator_prepare','autonomous_dialogue_start'].includes(operation)}
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
  if(Object.hasOwn(normalized,'repositoryUrl'))
    normalized.repositoryUrl=normalizeGitHubRepositoryUrl(normalized.repositoryUrl);
  return {tool,input:normalized};
}
}},['projectId','orchestratorId','mission'],false],
  ['work_create','Create a work conversation under a project/coordinator. No provider submission.',{projectId:id,orchestratorId:id,title:text(140)},['projectId','orchestratorId','title'],false],
  ['work_list','List work conversations, excluding the coordinator chat.',{projectId:id,orchestratorId:id},['projectId'],true],
  ['work_get','Inspect a scoped work and its provider segments without browser navigation.',{projectId:id,taskId:id},['projectId','taskId'],true],
  ['work_messages','Read a bounded page of persisted work or coordinator messages.',{projectId:id,taskId:id,before:text(1000),limit:{type:'integer',minimum:1,maximum:50}},['projectId','taskId'],true],
  ['work_send','Send one authorized prompt through the existing App executor. An uncertain command must never be replayed.',{projectId:id,taskId:id,content:text(6000),draftRevision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}},['projectId','taskId','content'],false],
  ['conversation_rotate','Prepare a new GPT segment for the same work. Does not send or bypass limits.',{projectId:id,taskId:id},['projectId','taskId'],false],
  ['orchestrator_chat','Send one message to the primary ChatGPT Web executor and persist its observed reply in the logical project conversation. Groq may answer only after an allowlisted health failure proves GPT did not receive the message; uncertain sends are never replayed.',{projectId:id,orchestratorId:id,content:text(4000),draftRevision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}},['projectId','orchestratorId','content'],false],
  ['orchestrator_analyze','Analyze a bounded set of recent conversations in this project with the configured coordinator. Records recommendations only; does not send to GPT.',{projectId:id,orchestratorId:id},['projectId','orchestratorId'],false],
  ['orchestrator_prepare','Prepare one proposed new work and initial draft with the coordinator API. No work or GPT submission until local review.',{projectId:id,orchestratorId:id,content:text(4000),draftRevision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}},['projectId','orchestratorId','content'],false],
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
    openWorldHint:['work_send','proposal_send','orchestrator_chat','orchestrator_analyze','orchestrator_prepare','autonomous_dialogue_start'].includes(operation)}
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
  if(Object.hasOwn(normalized,'repositoryUrl'))
    normalized.repositoryUrl=normalizeGitHubRepositoryUrl(normalized.repositoryUrl);
  return {tool,input:normalized};
}
