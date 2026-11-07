// One catalog for the App service, IPC and MCP projection. No authority here.
import {normalizeGitHubRepositoryUrl} from './remote-repository-context.mjs';
export const ORCHESTRATOR_CONTRACT = 'ordax.forge/1';
const text = (maxLength, minLength = 1) => ({type:'string',minLength,maxLength});
const id = {...text(180),pattern:'^[A-Za-z0-9_-]+$'};
const requestId = {...text(120),pattern:'^[A-Za-z0-9_-]+$'};
const definitions = [
  ['status','Inspect local engine state and limitations.',{},[],true],
  ['projects_list','List accessible Forge projects.',{},[],true],
  ['project_preflight','Inspect project-scoped local evidence and external capability blockers without a provider request, GitHub read, grant or GPT send.',{projectId:id,orchestratorId:id},['projectId','orchestratorId'],true],
  ['forge_discover','Read the actual Forge app capabilities and authorized current project. Start here to avoid assuming folder access, completed operations, or deployment.',{projectId:id},['projectId'],true],
  ['project_context','Discover the canonical Forge execution protocol, selected project identity, workspace grant state and work availability. Does not read or create files, grant access or send GPT.',{projectId:id},['projectId'],true],
  ['project_memory','Read bounded canonical memory and pending suggestions across all project conversations. Every item retains its source; provider replies are never proof of filesystem effects. No model call.',{projectId:id},['projectId'],true],
  ['project_memory_propose','Stage a GPT Administrator note for human review, citing an exact excerpt from an already persisted assistant message of this project. Never updates canon or certifies files. No GPT send.',{projectId:id,taskId:id,sourceMessageId:id,category:{...text(20),pattern:'^(goal|constraint|decision|entity|structure|fact|open_loop|reference)$'},key:text(160),content:text(8000),evidence:text(600)},['projectId','taskId','sourceMessageId','category','key','content','evidence'],false],
  ['project_administrator_snapshot','Read a bounded project-wide evidence snapshot of works, GPT Runs, unresolved commands, accepted notes and pending suggestions. Not a semantic model review or proof of file changes.',{projectId:id},['projectId'],true],
  ['project_handoff','Read a bounded project handoff from canonical SQLite: tasks, message excerpts, accepted decisions, pending receipts and an optional selected task. No GPT send, session rotation, model summary or filesystem proof.',{projectId:id,taskId:id},['projectId'],true],
  ['project_files_status','Inspect the single Forge project workspace: owner-bound Windows folder when verified, otherwise legacy private sandbox. Never grants an external path.',{projectId:id},['projectId'],true],
  ['project_files_list','List up to 100 entries in the currently bound project workspace using relative paths; rejects traversal and reparse points.',{projectId:id,directory:text(240,0)},['projectId'],true],
  ['project_file_read','Read one UTF-8 file up to 64 KiB in the authorized project workspace, with SHA-256. No arbitrary disk access.',{projectId:id,path:text(240)},['projectId','path'],true],
  ['project_file_write','Create or replace one UTF-8 file up to 64 KiB inside the Forge-bound project workspace. Existing files require previous SHA-256; writes receive durable receipts and checked readback. Never chooses a folder or grants access.',{projectId:id,path:text(240),content:text(65536,0),expectedSha256:{...text(64),pattern:'^[a-f0-9]{64}$'}},['projectId','path','content'],false],
  ['repository_observe','Read bounded GitHub HEAD metadata only after the owner port verifies and rechecks a project-scoped grant; cache only historical metadata in the App Store. No live authorization, file content, PR mutation or GPT send.',{projectId:id},['projectId'],true],
  ['workspace_status','Inspect verified project-local workspace bindings and capability availability. No filesystem access.',{projectId:id},['projectId'],true],
  ['workspace_snapshot','Read a bounded Runtime-verified workspace summary through a project-scoped resource grant.',{projectId:id,bindingId:id},['projectId','bindingId'],true],
  ['workspace_bind','Bind a preauthorized opaque Runtime resource to a project. Never accepts a filesystem path or grants authority.',{projectId:id,deviceId:id,resourceId:{...text(180),pattern:'^resource_[A-Za-z0-9_-]{8,160}$'}},['projectId','deviceId','resourceId'],false],
  ['project_create','Create an isolated Forge project and optionally bind its canonical GitHub repository URL. No repository contents are read.',{name:text(140),objective:text(4000,0),repositoryUrl:text(300,0)},['name'],false],
  ['project_quick_create','Create one empty Forge project and its Forjador chat with no name, goal, GPT work, prompt or provider send required.',{creationNonce:id},['creationNonce'],false],
  ['project_auto_title','Suggest the title of a still-untitled Forge project from its first persisted user chat message. Does not overwrite a user title, call Groq or send GPT.',{projectId:id},['projectId'],false],
  ['mission_create','Atomically create a project, coordinator and first work conversation with the mission saved as a draft. Does not submit to GPT.',{name:text(140,0),mission:text(4000),repositoryUrl:text(300,0)},['mission'],false],
  ['project_rename','Rename one accessible project. Does not alter its repository or work.',{projectId:id,name:text(140)},['projectId','name'],false],
  ['project_delete','Permanently delete one confirmed project and its App-owned conversations. Blocks running or uncertain effects, active observation and resource bindings. Never removes external filesystem projects.',{projectId:id,confirmName:text(140)},['projectId','confirmName'],false],
  ['project_observation_set','Persist or revoke explicit project-level intent to begin read-only observation. Never starts a scheduler, authenticates GitHub, submits GPT or grants authority.',{projectId:id,enabled:{type:'boolean'}},['projectId','enabled'],false],
  ['project_repository_set','Set or clear the project GitHub remote reference. This stores a URL only and does not read or write the repository.',{projectId:id,repositoryUrl:text(300,0)},['projectId','repositoryUrl'],false],
  ['orchestrators_list','List coordinators of one project.',{projectId:id},['projectId'],true],
  ['orchestrator_create','Create a coordinator with persistent mission and its own local conversation.',{projectId:id,name:text(140),mission:text(4000)},['projectId','name','mission'],false],
  ['orchestrator_pause','Pause or resume coordination; does not cancel an already submitted provider request.',{projectId:id,orchestratorId:id,paused:{type:'boolean'}},['projectId','orchestratorId','paused'],false],
  ['continuity_status','Inspect durable post-run analysis, blockers and required reconciliation.',{projectId:id,orchestratorId:id},['projectId','orchestratorId'],true],
  ['continuity_set','Opt in or out of automatic analysis after confirmed work runs. Never authorizes GPT sends.',{projectId:id,orchestratorId:id,enabled:{type:'boolean'}},['projectId','orchestratorId','enabled'],false],
  ['continuity_proposals_set','Opt in or out of at most two advisory next-work proposals after confirmed analyses. No GPT sends.',{projectId:id,orchestratorId:id,enabled:{type:'boolean'}},['projectId','orchestratorId','enabled'],false],
  ['continuity_followup_prepare','Prepare the exact evidence-backed next prompt on the original GPT work Task after an explicit user action. Does not submit; may rotate a canonical conversation only when the reviewed decision requires it.',{projectId:id,orchestratorId:id,reviewRunId:id},['projectId','orchestratorId','reviewRunId'],false],
  ['autonomous_dialogue_status','Read the latest bounded one-mission dialogue; no external effects.',{projectId:id,orchestratorId:id},['projectId','orchestratorId'],true],
  ['autonomous_dialogue_start','Authorize one bounded mission: semantic technical work (up to 2 GPT sends with Groq review of each real response), legacy dialogue (2 sends), or story (4 scenes). Uses the existing provider; never certifies external effects.',{projectId:id,orchestratorId:id,mission:text(4000),mode:{...text(10),pattern:'^(dialogue|story|technical)$'}},['projectId','orchestratorId','mission'],false],
  ['autonomous_dialogue_continue','Explicitly authorize the next bounded two-send technical cycle using the exact previous Groq decision and confirmed GPT Run. Never replay an uncertain send or certify external effects.',{projectId:id,orchestratorId:id,sourceMissionId:id},['projectId','orchestratorId','sourceMissionId'],false],
  ['work_create','Create a work conversation under a project/coordinator. No provider submission.',{projectId:id,orchestratorId:id,title:text(140)},['projectId','orchestratorId','title'],false],
  ['work_batch_create','Atomically register 2–16 independent work conversations with one coordinator. No GPT send or authorization grant.',{projectId:id,orchestratorId:id,titles:{type:'array',items:text(140),maxItems:16}},['projectId','orchestratorId','titles'],false],
  ['work_dependency_set','Replace prerequisite work IDs for one existing work, without dispatching.',{projectId:id,taskId:id,dependsOn:{type:'array',items:id,maxItems:64}},['projectId','taskId','dependsOn'],false],
  ['work_list','List work conversations, excluding the coordinator chat.',{projectId:id,orchestratorId:id},['projectId'],true],
  ['work_plan','Inspect bounded dependency readiness of all works in one project, without approving or dispatching any message.',{projectId:id,maxParallel:{type:'integer',minimum:1,maximum:32}},['projectId'],true],
  ['work_get','Inspect a scoped work and its provider segments without browser navigation.',{projectId:id,taskId:id},['projectId','taskId'],true],
  ['work_messages','Read a bounded page of persisted work or coordinator messages.',{projectId:id,taskId:id,before:text(1000),limit:{type:'integer',minimum:1,maximum:50}},['projectId','taskId'],true],
  ['work_send','Send one authorized prompt through the existing App executor. An uncertain command must never be replayed.',{projectId:id,taskId:id,content:text(6000),draftRevision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}},['projectId','taskId','content'],false],
  ['conversation_rotate','Prepare a new GPT segment for the same work. Does not send or bypass limits.',{projectId:id,taskId:id},['projectId','taskId'],false],
  ['orchestrator_chat','Legacy optional Groq coordination. For local user creation requests with delegateWork enabled, the assistant may classify the intent and start the existing bounded autonomous work executor; all decisions and receipts remain scoped and durable.',{projectId:id,orchestratorId:id,content:text(4000),delegateWork:{type:'boolean'},draftRevision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}},['projectId','orchestratorId','content'],false],
  ['forjador_send','Send one normal Forjador chat turn directly to the GPT executor in the same project conversation, without a Groq request. Uses canonical Run and command receipts; uncertain delivery is never replayed.',{projectId:id,orchestratorId:id,content:text(4000),draftRevision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}},['projectId','orchestratorId','content'],false],
  ['orchestrator_analyze','Review recent project work, or interpret one receipt-backed GPT Run and propose an evidence-grounded next step. Recommendations only; no GPT submission.',{projectId:id,orchestratorId:id,reviewRunId:id},['projectId','orchestratorId'],false],
  ['orchestrator_prepare','Prepare one proposed new work and initial draft with the coordinator API. No work or GPT submission until local review.',{projectId:id,orchestratorId:id,content:text(4000),draftRevision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}},['projectId','orchestratorId','content'],false],
  ['proposals_list','Read pending work proposals for the selected coordinator.',{projectId:id,orchestratorId:id},['projectId','orchestratorId'],true],
  ['proposal_review','Approve creation of one local work with a saved draft, or reject it. Never submits to GPT.',{projectId:id,orchestratorId:id,actionId:id,approved:{type:'boolean'}},['projectId','orchestratorId','actionId','approved'],false],
  ['proposal_send','After native confirmation, submit the current draft of one prepared work through the existing executor. First send only; uncertain sends never replay.',{projectId:id,orchestratorId:id,actionId:id,draftRevision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}},['projectId','orchestratorId','actionId','draftRevision'],false],
  ['command_get','Inspect a previously accepted command without repeating it.',{commandId:id},['commandId'],true]
];
export const ORCHESTRATOR_TOOLS = Object.freeze(definitions.map(([operation,description,properties,required,readOnly]) => ({
  name:operation.startsWith('forge_')?operation:'forge_'+operation,operation,description,readOnly,
  inputSchema:{type:'object',additionalProperties:false,
    properties:{...(!readOnly?{requestId}:{}),...properties},
    required:[...(!readOnly?['requestId']:[]),...required]},
  annotations:{readOnlyHint:readOnly,destructiveHint:operation==='project_delete',idempotentHint:true,
    openWorldHint:['work_send','proposal_send','forjador_send','orchestrator_chat','orchestrator_analyze','orchestrator_prepare','autonomous_dialogue_start','autonomous_dialogue_continue'].includes(operation)}
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
      // Preserve exact bytes of file content and exact relative path syntax;
      // silently trimming either would bypass validation or alter source code.
      normalized[key]=((operation.startsWith('project_file_')&&['content','path'].includes(key))||
        (operation==='project_files_list'&&key==='directory'))?value:value.trim();
    } else if(schema.type==='array') {
      const item=schema.items;
      if(!Array.isArray(value)||value.length>schema.maxItems||
        new Set(value).size!==value.length||value.some(entry=>
          typeof entry!=='string'||entry.includes('\0')||
          entry.length>item.maxLength||entry.trim().length<item.minLength||
          (item.pattern&&!new RegExp(item.pattern).test(entry))))
        throw Error('orchestrator_invalid_input');
      normalized[key]=[...value];
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
