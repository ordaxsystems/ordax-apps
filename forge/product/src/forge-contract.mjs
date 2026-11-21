// One catalog for the App service, IPC and MCP projection. No authority here.
import {normalizeGitHubRepositoryUrl} from './remote-repository-context.mjs';
export const ORCHESTRATOR_CONTRACT = 'ordax.forge/1';
const text = (maxLength, minLength = 1) => ({type:'string',minLength,maxLength});
const id = {...text(180),pattern:'^[A-Za-z0-9_-]+$'};
const requestId = {...text(120),pattern:'^[A-Za-z0-9_-]+$'};
const claimProof={claimToken:{...text(43),pattern:'^[A-Za-z0-9_-]{43}$'},claimGeneration:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}};
const definitions = [
  ['status','Inspect local engine state and limitations.',{},[],true],
  ['projects_list','List accessible Forge projects.',{},[],true],
  ['app_view_status','Inspect the real Forge window and preview state, including whether it is minimized. No screenshot, project creation or focus change.',{},[],true],
  ['app_view_capture','Capture only the Forge application renderer pixels, never the Windows desktop. Does not raise or focus the window; native overlay Views are excluded.',{},[],true],
  ['app_ui_inspect','Inspect the real Forge Electron app shell, including while minimized, returning visible controls, headings and scroll panes. No input values, foreground focus changes or external provider windows.',{},[],true],
  ['app_ui_click','Click a previously inspected control in the real Forge Electron app shell (projects, administrators, Tasks, dialogs) without focusing the window. Exact DOM revision, control index and label are required; stores an idempotent receipt. No arbitrary JS or CSS selector.',{expectedRevision:{...text(64),pattern:'^[a-f0-9]{64}$'},controlIndex:{type:'integer',minimum:0,maximum:119},expectedLabel:text(120)},['expectedRevision','controlIndex','expectedLabel'],false],
  ['app_ui_fill','Fill a previously inspected non-sensitive text field or choose a listed option in the real Forge Electron shell. Preserves exact content but never echoes it. Password, token, payment, OTP, file, hidden or read-only controls are excluded; effect gets an idempotent receipt.',{expectedRevision:{...text(64),pattern:'^[a-f0-9]{64}$'},controlIndex:{type:'integer',minimum:0,maximum:119},expectedLabel:text(120),value:text(2000,0)},['expectedRevision','controlIndex','expectedLabel','value'],false],
  ['app_ui_scroll','Scroll one inspected native Forge pane by a bounded offset without focusing or scrolling the GPT provider window. Requires exact DOM revision and idempotent request ID.',{expectedRevision:{...text(64),pattern:'^[a-f0-9]{64}$'},scrollIndex:{type:'integer',minimum:0,maximum:23},deltaY:{type:'integer',minimum:-1200,maximum:1200}},['expectedRevision','scrollIndex','deltaY'],false],

  ['project_view_capture','Capture a verified project HTML preview or the exact currently open Task View, including its state after DOM interactions. Active View requires matching Task, asset and source SHA; never creates a second session or captures another project.',{projectId:id,target:{...text(20),pattern:'^(project_index|task_artifact|active_task_view)$'},taskId:id,assetId:id},['projectId','target'],true],
  ['project_view_probe','Safely test a visible button in a fresh isolated, network-denied preview clone and return screenshot and controls after the click. Never interacts with the live Forge View, publishes a site, modifies files or persists UI state. Requires source SHA-256 and exact observed control index/label to reject stale actions.',{projectId:id,target:{...text(20),pattern:'^(project_index|task_artifact)$'},taskId:id,assetId:id,expectedSha256:{...text(64),pattern:'^[a-f0-9]{64}$'},controlIndex:{type:'integer',minimum:0,maximum:39},expectedLabel:text(100)},['projectId','target','expectedSha256','controlIndex','expectedLabel'],true],
  ['project_view_live_inspect','Inspect the actual open native project View (not a clone), including visible buttons and headings, even while Forge is minimized. No input values or screenshot; requires the exact project, Task and asset identity.',{projectId:id,taskId:id,assetId:id},['projectId','taskId','assetId'],true],
  ['project_view_live_click','Click one previously inspected button in the actual open native View, preserving page state without focusing the Forge window. Requires exact source identity and observed DOM revision; creates an idempotent SQLite command receipt. The View is network-isolated; this neither edits project files nor publishes a website.',{projectId:id,taskId:id,assetId:id,expectedRevision:{...text(64),pattern:'^[a-f0-9]{64}$'},controlIndex:{type:'integer',minimum:0,maximum:39},expectedLabel:text(100)},['projectId','taskId','assetId','expectedRevision','controlIndex','expectedLabel'],false],
  ['project_view_live_fill','Fill a previously inspected visible text/search/email/URL/telephone/number field or textarea in the existing native View, without changing window focus. Password, OTP, payment, file and hidden fields are excluded. Does not submit forms, send network requests, edit project files or echo field values. A durable SQLite receipt prevents replay.',{projectId:id,taskId:id,assetId:id,expectedRevision:{...text(64),pattern:'^[a-f0-9]{64}$'},controlIndex:{type:'integer',minimum:0,maximum:39},expectedLabel:text(100),value:text(500,0)},['projectId','taskId','assetId','expectedRevision','controlIndex','expectedLabel','value'],false],
  ['project_preflight','Inspect project-scoped local evidence and external capability blockers without a provider request, GitHub read, grant or GPT send.',{projectId:id,orchestratorId:id},['projectId','orchestratorId'],true],
  ['forge_discover','Read the actual Forge app capabilities and authorized current project. Start here to avoid assuming folder access, completed operations, or deployment.',{projectId:id},['projectId'],true],
  ['project_context','Discover the canonical Forge execution protocol, selected project identity, workspace grant state and work availability. Does not read or create files, grant access or send GPT.',{projectId:id},['projectId'],true],
  ['project_repositories','Read the OrdaX OS repository ownership catalogue from its canonical local contract. Catalogue is metadata only: it does not grant local Git, Runtime, GitHub or filesystem access.',{projectId:id},['projectId'],true],
  ['ordax_devices','Read OrdaX Platform device/grant visibility for the native Forge OAuth client, through the canonical Product MCP. Does not select a device, authorize a grant, access repositories, invoke Runtime or dispatch any action.',{projectId:id},['projectId'],true],
  ['ordax_native_session_open','Request a native Forge OAuth device-session challenge through the existing OrdaX Product MCP/Platform. Requires an active Task claim and idempotent requestId. Only the canonical Owner can select the device, only Runtime confirmation can attest it. NEVER dispatches a computer action, grants permissions or sends an OpenAI session marker.',{projectId:id,taskId:id,...claimProof},['projectId','taskId','claimToken','claimGeneration'],false],
  ['ordax_execution_preflight','READ ONLY. Compare one explicitly assigned Task/repository against the Forge OAuth client device grant snapshot and its native session-binding blocker. deviceId is a candidate for diagnostic comparison, never an execution target or Owner selection. This tool never dispatches effects, binds devices or grants access.',{projectId:id,taskId:id,repository:{...text(128),pattern:'^ordaxsystems/[a-z0-9-]{2,101}$'},deviceId:{...text(36),pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'},action:{type:'string',enum:['repository_catalog','terminal','text_read','text_write']}},['projectId','taskId','repository','deviceId','action'],true],
  ['project_memory','Read canonical memory of a Forge project. To read the separate Forge Git App checkpoint in this authorized Windows profile, use projectId forge_git; this is App owner-only, not local Forge SQLite memory. Data only; no GPT send, file edit or live GitHub request.',{projectId:id},['projectId'],true],
  ['project_memory_propose','Stage a GPT Administrator note for human review, citing an exact excerpt from an already persisted assistant message of this project. Never updates canon or certifies files. No GPT send.',{projectId:id,taskId:id,...claimProof,sourceMessageId:id,category:{...text(20),pattern:'^(goal|constraint|decision|entity|structure|fact|open_loop|reference)$'},key:text(160),content:text(8000),evidence:text(600)},['projectId','taskId','sourceMessageId','category','key','content','evidence'],false],
  ['project_administrator_snapshot','Read a bounded project-wide evidence snapshot of works, GPT Runs, unresolved commands, accepted notes and pending suggestions. Not a semantic model review or proof of file changes.',{projectId:id},['projectId'],true],
  ['project_handoff','Read a bounded project handoff from canonical SQLite: tasks, message excerpts, accepted decisions, pending receipts and an optional selected task. No GPT send, session rotation, model summary or filesystem proof.',{projectId:id,taskId:id},['projectId'],true],
  ['project_activity','Read bounded persisted project activity and derived active/idle Task state from canonical SQLite events, claims, Runs and messages. No timer, notification, scheduler or GPT wake.',{projectId:id},['projectId'],true],
  ['project_files_status','Inspect the Forge project workspace or an explicitly scoped Task worktree. Never grants or reveals an external path.',{projectId:id,taskId:id},['projectId'],true],
  ['project_development_status','Read the owner-approved development permission and optional Task worktree scope. Commands run as the logged-in Windows user, not in a sandbox.',{projectId:id,taskId:id},['projectId'],true],
  ['project_worktree_prepare','Create and bind one isolated Git worktree for an existing Work Task using the current clean project HEAD. Reuses the owner-approved terminal, same SQLite and repository; branch/path are derived by Forge, not model input.',{projectId:id,taskId:id,...claimProof},['projectId','taskId'],false],
  ['project_worktree_review','Inspect one active Task worktree against the current clean main repository: exact heads, changed file names and ahead/behind counts. No merge, file write, GPT send or Git mutation.',{projectId:id,taskId:id},['projectId','taskId'],true],
  ['project_worktree_verify','Run one explicit verification command in an active Task worktree using the existing owner-approved terminal. Verification succeeds only when the command exits zero and both main/worktree remain clean on the exact same Git heads before and after. Never merges.',{projectId:id,taskId:id,...claimProof,command:text(8000),timeoutMs:{type:'integer',minimum:1000,maximum:1800000}},['projectId','taskId','command'],false],
  ['project_worktree_integrate','Integrate one reviewed Task worktree into the clean main repository. Requires exact reviewed main/branch heads plus successful project_worktree_verify receipts recorded on that same branch head. Conflicts are aborted and never auto-resolved.',{projectId:id,taskId:id,...claimProof,expectedBranchHeadSha:{...text(40),pattern:'^[a-f0-9]{40}$'},expectedMainHeadSha:{...text(40),pattern:'^[a-f0-9]{40}$'},verificationReceiptIds:{type:'array',items:id,minItems:1,maxItems:16}},['projectId','taskId','expectedBranchHeadSha','expectedMainHeadSha','verificationReceiptIds'],false],
  ['work_accept','Accept a previously integrated Task only after its canonical integration, verified Task worktree receipts, latest succeeded GPT Run, and fresh native tests on a clean integrated main HEAD. Stores one durable acceptance receipt; no provider send, deployment or product certification.',{projectId:id,taskId:id,...claimProof,integrationReceiptId:id,expectedIntegratedHeadSha:{...text(40),pattern:'^[a-f0-9]{40}$'},testCommand:text(8000),timeoutMs:{type:'integer',minimum:1000,maximum:1800000}},['projectId','taskId','integrationReceiptId','expectedIntegratedHeadSha','testCommand'],false],
  ['project_command_run','Run a real terminal command in the owner-bound workspace or an explicitly scoped Task worktree. Requires one-time native Owner approval; no per-command confirmation. This command inherits Windows user privileges, so the project folder is a working directory, NOT a sandbox. Successful Task-scoped commands record the exact Git HEAD observed after completion for Integrator verification. Avoid secrets in commands and output.',{projectId:id,taskId:id,...claimProof,command:text(8000),workingDirectory:text(1000,0),timeoutMs:{type:'integer',minimum:1000,maximum:1800000}},['projectId','command'],false],
  ['project_files_list','List up to 100 entries in the project workspace or explicitly scoped Task worktree using relative paths; rejects internal worktree administration, traversal and reparse points.',{projectId:id,taskId:id,directory:text(240,0)},['projectId'],true],
  ['project_file_read','Read one UTF-8 file up to 64 KiB in the authorized project workspace or Task worktree, with SHA-256. No arbitrary disk access.',{projectId:id,taskId:id,path:text(240)},['projectId','path'],true],
  ['project_file_write','Create or replace one UTF-8 file up to 64 KiB inside the Forge-bound project workspace or explicitly scoped Task worktree. Existing files require previous SHA-256; writes receive durable receipts and checked readback. Never chooses a folder or grants access.',{projectId:id,taskId:id,...claimProof,path:text(240),content:text(65536,0),expectedSha256:{...text(64),pattern:'^[a-f0-9]{64}$'}},['projectId','path','content'],false],
  ['repository_observe','Read bounded GitHub HEAD metadata only after the owner port verifies and rechecks a project-scoped grant; cache only historical metadata in the App Store. No live authorization, file content, PR mutation or GPT send.',{projectId:id},['projectId'],true],
  ['workspace_status','Inspect verified project-local workspace bindings and capability availability. No filesystem access.',{projectId:id},['projectId'],true],
  ['workspace_snapshot','Read a bounded Runtime-verified workspace summary through a project-scoped resource grant.',{projectId:id,bindingId:id},['projectId','bindingId'],true],
  ['workspace_bind','Bind a preauthorized opaque Runtime resource to a project. Never accepts a filesystem path or grants authority.',{projectId:id,deviceId:id,resourceId:{...text(180),pattern:'^resource_[A-Za-z0-9_-]{8,160}$'}},['projectId','deviceId','resourceId'],false],
  ['project_create','Create an isolated Forge project and optionally bind its canonical GitHub repository URL. No repository contents are read.',{name:text(140),objective:text(4000,0),repositoryUrl:text(300,0)},['name'],false],
  ['project_quick_create','Create one empty Forge project and its Forjador chat with no name, goal, GPT work, prompt or provider send required.',{creationNonce:id},['creationNonce'],false],
  ['project_auto_title','Suggest the title of a still-untitled Forge project from its first persisted user chat message. Does not overwrite a user title, call another model or send GPT.',{projectId:id},['projectId'],false],
  ['mission_create','Atomically create a project, coordinator and first work conversation with the mission saved as a draft. Does not submit to GPT.',{name:text(140,0),mission:text(4000),repositoryUrl:text(300,0)},['mission'],false],
  ['project_rename','Rename one accessible project. Does not alter its repository or work.',{projectId:id,name:text(140)},['projectId','name'],false],
  ['project_delete','Permanently delete one confirmed project and its App-owned conversations. Blocks running or uncertain effects, active observation and resource bindings. Never removes external filesystem projects.',{projectId:id,confirmName:text(140)},['projectId','confirmName'],false],
  ['project_observation_set','Persist or revoke explicit project-level intent to begin read-only observation. Never starts a scheduler, authenticates GitHub, submits GPT or grants authority.',{projectId:id,enabled:{type:'boolean'}},['projectId','enabled'],false],
  ['project_repository_set','Set or clear the project GitHub remote reference. This stores a URL only and does not read or write the repository.',{projectId:id,repositoryUrl:text(300,0)},['projectId','repositoryUrl'],false],
  ['orchestrators_list','List coordinators of one project.',{projectId:id},['projectId'],true],
  ['orchestrator_create','Create a coordinator with persistent mission and its own local conversation.',{projectId:id,name:text(140),mission:text(4000)},['projectId','name','mission'],false],
  ['orchestrator_pause','Pause or resume coordination; does not cancel an already submitted provider request.',{projectId:id,orchestratorId:id,paused:{type:'boolean'}},['projectId','orchestratorId','paused'],false],
  ['continuity_status','Inspect durable post-run analysis, blockers and required reconciliation.',{projectId:id,orchestratorId:id},['projectId','orchestratorId'],true],
  ['autonomous_dialogue_status','Read the latest bounded one-mission dialogue; no external effects.',{projectId:id,orchestratorId:id},['projectId','orchestratorId'],true],
  ['work_claim','Atomically acquire, renew or release the sole Task lease in canonical SQLite. A chat label is caller-supplied and not verified ChatGPT identity; other chats can see ownership, but only a holder with the secret token can update progress. Never sends GPT.',{projectId:id,taskId:id,action:{type:'string',pattern:'^(acquire|renew|release)$',minLength:5,maxLength:8},chatLabel:text(100),claimToken:{type:'string',minLength:43,maxLength:43,pattern:'^[A-Za-z0-9_-]{43}$'},generation:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}},['projectId','taskId','action'],false],
  ['work_progress','Persist progress/heartbeat for an exclusively claimed Task. Does not assert filesystem changes, GPT completion, or verified effects.',{projectId:id,taskId:id,claimToken:{type:'string',minLength:43,maxLength:43,pattern:'^[A-Za-z0-9_-]{43}$'},generation:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},kind:{type:'string',pattern:'^(progress|checkpoint|blocked|result)$',minLength:6,maxLength:10},summary:text(2000)},['projectId','taskId','claimToken','generation','kind','summary'],false],
  ['work_memory_set','Write an unverified GPT note to the existing project memory table under the claimed Task; visible to other chats via project_memory and handoff. Never certifies external effects.',{projectId:id,taskId:id,claimToken:{type:'string',minLength:43,maxLength:43,pattern:'^[A-Za-z0-9_-]{43}$'},generation:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},category:{type:'string',pattern:'^(entity|structure|fact|decision|constraint|goal|open_loop|reference)$',minLength:4,maxLength:12},key:text(160),content:text(8000)},['projectId','taskId','claimToken','generation','category','key','content'],false],
  ['work_repositories','Read the OrdaX OS repositories explicitly associated with one Task. This is assignment metadata, not authorization to run Git or read files.',{projectId:id,taskId:id},['projectId','taskId'],true],
  ['work_repositories_set','Associate one claimed Task with 1–16 canonical OrdaX OS repository identities; immutable after first assignment, without opening worktrees, grants or executing commands.',{projectId:id,taskId:id,...claimProof,repositories:{type:'array',items:{type:'string',pattern:'^ordaxsystems/[a-z0-9-]{2,101}$'},minItems:1,maxItems:16}},['projectId','taskId','claimToken','claimGeneration','repositories'],false],
  ['work_create','Create a work conversation under a project/coordinator. No provider submission.',{projectId:id,orchestratorId:id,title:text(140)},['projectId','orchestratorId','title'],false],
  ['work_batch_create','Atomically register 2–16 independent work conversations with one coordinator. No GPT send or authorization grant.',{projectId:id,orchestratorId:id,titles:{type:'array',items:text(140),minItems:2,maxItems:16}},['projectId','orchestratorId','titles'],false],
  ['work_draft_set','Set the explicit initial prompt draft for one unstarted work. Local state only; never submits GPT.',{projectId:id,taskId:id,...claimProof,content:text(6000),draftRevision:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}},['projectId','taskId','content','draftRevision'],false],
  ['work_dependency_set','Replace prerequisite work IDs for one existing work, without dispatching.',{projectId:id,taskId:id,...claimProof,dependsOn:{type:'array',items:id,maxItems:64}},['projectId','taskId','dependsOn'],false],
  ['work_list','List work conversations, excluding the coordinator chat.',{projectId:id,orchestratorId:id},['projectId'],true],
  ['work_plan','Inspect bounded dependency readiness of all works in one project, without approving or dispatching any message.',{projectId:id,maxParallel:{type:'integer',minimum:1,maximum:32}},['projectId'],true],
  ['work_get','Inspect a scoped work and its provider segments without browser navigation.',{projectId:id,taskId:id},['projectId','taskId'],true],
  ['work_messages','Read a bounded page of persisted work or coordinator messages.',{projectId:id,taskId:id,before:text(1000),limit:{type:'integer',minimum:1,maximum:50}},['projectId','taskId'],true],
  ['conversation_rotate','Prepare a new GPT segment for the same work. Does not send or bypass limits.',{projectId:id,taskId:id,...claimProof},['projectId','taskId'],false],
  ['work_failover_prepare','Prepare a replacement GPT session only after the previous work attempt is terminally failed and all effects are reconciled. Rotates the same Task, preserves canonical state and emits a fencing generation; sends zero GPT messages.',{projectId:id,taskId:id,...claimProof},['projectId','taskId'],false],
  ['proposals_list','Read pending work proposals for the selected coordinator.',{projectId:id,orchestratorId:id},['projectId','orchestratorId'],true],
  ['command_get','Inspect a previously accepted command without repeating it.',{commandId:id},['commandId'],true]
];
export const ORCHESTRATOR_TOOLS = Object.freeze(definitions.map(([operation,description,properties,required,readOnly]) => ({
  name:operation.startsWith('forge_')?operation:'forge_'+operation,operation,description,readOnly,
  inputSchema:{type:'object',additionalProperties:false,
    properties:{...(!readOnly?{requestId}:{}),...properties},
    required:[...(!readOnly?['requestId']:[]),...required]},
  annotations:{readOnlyHint:readOnly,destructiveHint:['work_accept','project_delete','project_command_run','project_worktree_verify','project_worktree_integrate','app_ui_click'].includes(operation),
    idempotentHint:!['project_command_run','project_worktree_verify'].includes(operation),
    openWorldHint:['project_command_run','project_worktree_verify','app_ui_click','app_ui_fill'].includes(operation)}
})));

function normalizedFlatArrayObject(schema,entry) {
  // Accept only the flat, strict shape declared by the MCP contract.
  if(schema.type!=='object'||schema.additionalProperties!==false||
    !entry||typeof entry!=='object'||Array.isArray(entry)||
    Object.keys(entry).some(key=>!Object.hasOwn(schema.properties,key))||
    schema.required.some(key=>!Object.hasOwn(entry,key)))
    throw Error('orchestrator_invalid_input');
  const normalized={};
  for(const [key,prop] of Object.entries(schema.properties)) {
    const value=entry[key];
    if(value===undefined)continue;
    if(prop.type==='string') {
      if(typeof value!=='string'||value.includes('\0')||
        value.length>prop.maxLength||value.trim().length<prop.minLength||
        (prop.pattern&&!new RegExp(prop.pattern).test(value)))
        throw Error('orchestrator_invalid_input');
      normalized[key]=value.trim();
    } else if(prop.type==='integer') {
      if(!Number.isSafeInteger(value)||value<prop.minimum||value>prop.maximum)
        throw Error('orchestrator_invalid_input');
      normalized[key]=value;
    } else throw Error('orchestrator_invalid_input');
  }
  return normalized;
}

function validateInputAgainstTool(tool,operation,input) {
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
        (operation==='project_files_list'&&key==='directory')||
        (operation==='project_view_live_fill'&&key==='value')||
        (operation==='app_ui_fill'&&key==='value'))?value:value.trim();
    } else if(schema.type==='array') {
      const item=schema.items;
      if(!Array.isArray(value)||value.length>schema.maxItems)
        throw Error('orchestrator_invalid_input');
      if(item.type==='object') {
        const objects=value.map(entry=>normalizedFlatArrayObject(item,entry));
        if(new Set(objects.map(entry=>entry.taskId)).size!==objects.length)
          throw Error('orchestrator_invalid_input');
        normalized[key]=objects;
      } else {
        if(new Set(value).size!==value.length||value.some(entry=>
          typeof entry!=='string'||entry.includes('\0')||
          entry.length>item.maxLength||entry.trim().length<item.minLength||
          (item.pattern&&!new RegExp(item.pattern).test(entry))))
          throw Error('orchestrator_invalid_input');
        normalized[key]=[...value];
      }
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

export function validateOrchestratorInput(operation,input) {
  const tool=ORCHESTRATOR_TOOLS.find(item=>item.operation===operation);
  if(!tool)throw Error('orchestrator_unknown_operation');
  return validateInputAgainstTool(tool,operation,input);
}

// Not an MCP/API catalog entry. The existing canonical validation rules are
// reused for the single trusted Electron Owner IPC flow.
const NATIVE_COMMAND_REVIEW_TOOL=Object.freeze({
  operation:'command_close_unverified',
  inputSchema:{
    properties:{requestId,projectId:id,commandId:id,
      acknowledgeUnknownEffects:{type:'boolean'},note:text(600,40)},
    required:['requestId','projectId','commandId','acknowledgeUnknownEffects','note']
  }
});
export function validateNativeCommandReviewInput(input){
  return validateInputAgainstTool(NATIVE_COMMAND_REVIEW_TOOL,
    'command_close_unverified',input).input;
}
