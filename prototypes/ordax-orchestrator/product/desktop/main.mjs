import { app, BrowserWindow, ipcMain, protocol, net, dialog, safeStorage, Tray, Menu, shell } from 'electron';
import path from 'node:path';import { SupervisorCoordinator, authorizeLocalSupervisorTask, listLocalSupervisorRecoverable } from '../supervisor/coordinator.mjs';
import { inspectSupervisorChatReadOnly } from '../supervisor/read-only-reconcile.mjs';
import { chatReceiptFromRunTask } from '../src/supervisor-chat-receipt.mjs';
import { bindObservedSubmittedConversation } from '../src/provider-submitted-conversation.mjs';
import { recordProviderSubmissionProvenance, recordProviderSubmissionIntent, findProviderSubmissionProvenance, providerPromptDigest } from '../src/provider-submission-provenance.mjs';
import { inspectProviderLinkedThread, reconcileProviderLinkedReply, recoverFailedProviderSubmission, recoverVisibleLinkedProviderSubmission } from '../src/provider-linked-thread-recovery.mjs';
import { assertTaskHasNoUncertainTransport } from '../src/provider-uncertain-run-policy.mjs';
import { assertProviderSendReadiness, normalizeProviderFailure } from '../src/provider-observation-policy.mjs';
import { assertContinuationContextReady } from '../src/continuation-context.mjs';
import { safeTaskNavigationReason } from '../src/task-navigation-status.mjs';
import { createGroqSupervisorPlanner } from '../supervisor/groq-planner.mjs';
import { testGroqApiKey } from '../src/groq-key-health.mjs';
import { createLocalGroqCredential } from '../src/local-supervisor-credential.mjs';
import { createOrchestratorKernel } from '../src/orchestrator-kernel.mjs';
import {withForjadorMcpMention,mentionWasRequested,FORJADOR_MCP_MENTION} from '../src/provider-mcp-mention.mjs';
import { createProviderAwareTaskOpener, createTaskUiHandlers } from '../src/task-ui-handlers.mjs';
import { ORCHESTRATOR_TOOLS } from '../src/orchestrator-contract.mjs';
import { createOrchestratorRuntimeBridge,attachOrchestratorRuntimePipes,resolveOrchestratorRuntimeTransport,openOrchestratorRuntimeStreams } from '../src/orchestrator-runtime-bridge.mjs';
import { createGroqCoordinatorConversation } from '../supervisor/groq-conversation.mjs';
import { observePostCommitNavigation } from '../src/provider-post-commit-navigation.mjs';

import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { Store, MESSAGE_PAGE_SIZE } from '../src/store.mjs';
import {ForgeProjectFiles} from '../src/forge-project-files.mjs';
import {ForgeLocalWorkspaces,resolveForgeWorkspaceDocumentsDirectory} from '../src/forge-local-workspaces.mjs';
import {forgeFreshConversationContext} from '../src/forge-fresh-conversation-context.mjs';
import {createOrchestratorMcp} from '../src/orchestrator-mcp.mjs';
import {createForgeLoopbackMcp} from '../src/forge-loopback-mcp.mjs';
import {ForgeMcpOwnerTrust} from '../src/forge-mcp-owner-trust.mjs';
import { planProviderConversation, assessProviderRotation, canonicalProviderChatUrl } from '../src/conversation-policy.mjs';
import { EmbeddedChatWorker } from './embedded-worker.mjs';
import {IsolatedInteractiveHtmlPreview} from './isolated-interactive-preview.mjs';
import { createProviderViewRegistry } from '../src/provider-view-registry.mjs';
import { backgroundResidencyAllowed,backgroundStartupAllowed,backgroundModeRequested } from '../src/background-residency-policy.mjs';
import { createProviderExecutionScheduler } from '../src/provider-execution-scheduler.mjs';
import { normalizeProviderViewBounds } from '../src/provider-view-bounds.mjs';
import { createProviderProvisionalRecorder } from '../src/provider-provisional-recorder.mjs';
import { resolveLabUserRoot, labProfileFingerprint } from '../src/lab-profile-binding.mjs';
import { PRODUCT_NAME } from '../src/product-brand.mjs';
import { pruneDeletedProjectAssets } from '../src/project-assets-cleanup.mjs';
import { verifyRuntimeManifest } from '../src/runtime-build-identity.mjs';
import { assertTaskHandoffCoversOmissions, buildProviderContextAttachmentNotice, validateProviderContextAttachment } from '../src/provider-context-attachment.mjs';
import { removeStaleTaskHandoffFiles, removeTaskHandoffFile, resolveTaskHandoffRoot, writeTaskHandoffFile } from '../src/task-handoff-file.mjs';
import {verifyLocalHtmlArtifact,readVerifiedLocalHtmlArtifact,assertLocalArtifactPath} from '../src/provider-html-artifact.mjs';
import {shouldAttemptAutomaticHtmlCapture} from '../src/automatic-html-capture-policy.mjs';

if (process.env.ORDAX_DESKTOP_DEBUG === '1') {
  app.commandLine.appendSwitch('remote-debugging-port', '9445');
}

const runtimeTransportRequest=resolveOrchestratorRuntimeTransport();
app.setName(PRODUCT_NAME);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const hostBrowserMode=!app.isPackaged&&(process.env.ORDAX_HOST_BROWSER_UI==='1'||process.argv.includes('--host-browser'));
let createHostBrowserServer=null;
if(hostBrowserMode)({createHostBrowserServer} = await import('../host/host-browser-server.mjs'));
const hostStartupLog=stage=>{
  if(!hostBrowserMode||process.env.ORDAX_HOST_BROWSER_DEBUG!=='1')return;
  const line=JSON.stringify({stage,at:new Date().toISOString()})+'\n';
  try { fs.appendFileSync(path.join(userRoot,'host-startup.log'),line,{encoding:'utf8'}); } catch {}
  process.stderr.write(`[OrdaX host] ${stage}\n`);
};
// Capture an immutable proof VALUE at startup, before any SQLite is opened.
// A missing manifest is legacy/unattested, never presented as a verified build.
const runtimeBuildProof=verifyRuntimeManifest(root,
  process.versions.electron && process.defaultApp!==true
    ? {manifestPath:path.join(process.resourcesPath,'runtime-build.json')}
    : undefined);
if(runtimeBuildProof.status==='invalid') throw new Error('lab_runtime_build_integrity_failed');
const {userRoot,staged:stagedProfile} = resolveLabUserRoot({
  argv:process.argv,
  localAppData:process.env.LOCALAPPDATA ||
    path.join(process.env.USERPROFILE || root, 'AppData', 'Local')
});
fs.mkdirSync(userRoot,{recursive:true});
hostStartupLog('profile_ready');
app.setPath('userData', userRoot);
const groqCredential=createLocalGroqCredential({userRoot,safeStorage});

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  hostStartupLog('single_instance_lock_unavailable');
  app.exit(0);
  process.exit(0);
} else {
  hostStartupLog('single_instance_lock_acquired');
  app.on('second-instance', (_event,commandLine) => {
    if(hostBrowserMode||commandLine?.includes('--ordax-background-start'))return;
    // Reuse the single UI-opening path even if the previous window crashed.
    // Windows autostart can create a hidden window: second launch must show it.
    showCanonicalWindow();
  });
}


const dataRoot = path.join(userRoot, 'data');
const assetsRoot = path.join(dataRoot, 'assets');
// Provider uploads must use a short per-profile path. Placing the generated
// context artifact under the staged userData tree can exceed Windows MAX_PATH,
// causing Chromium to fire file-input events while silently selecting no file.
const handoffRoot = resolveTaskHandoffRoot({tempRoot:app.getPath('temp'),userRoot});
fs.mkdirSync(assetsRoot, { recursive: true });
fs.mkdirSync(handoffRoot, { recursive: true });

protocol.registerSchemesAsPrivileged([
  { scheme: 'ordax-asset', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

const store = new Store(path.join(dataRoot, 'ordax-orchestrator-lab.sqlite'));
// Canonical project path lives in the existing SQLite, not another store.
// Real user workspaces use the Windows-known Documents directory; existing
// app-private files remain untouched until explicitly reconciled.
const forgeLocalWorkspaces=new ForgeLocalWorkspaces({
  // A staged DEV profile must not create test projects in the Owner's real
  // Documents folder. Its source and workspace both remain under the
  // independent staged candidate tree, away from the production SQLite.
  store,documentsDirectory:resolveForgeWorkspaceDocumentsDirectory({
    staged:stagedProfile,userRoot,windowsDocuments:app.getPath('documents')}),
  legacyRoot:path.join(dataRoot,'project-files'),
  forbiddenRoots:[userRoot,path.dirname(process.execPath),process.env.SystemRoot,
    process.env.ProgramFiles,process.env.ProgramData,process.env['ProgramFiles(x86)']]
    .filter(value=>typeof value==='string'&&path.isAbsolute(value))
});
const forgeProjectFiles=new ForgeProjectFiles({root:path.join(dataRoot,'project-files'),
  workspaceLookup:projectId=>forgeLocalWorkspaces.rootForProject(projectId),
  requireOwnerBinding:true});

const stagedLab=process.argv.includes('--ordax-lab-staged-approved');
const backgroundSupported=process.platform==='win32'&&app.isPackaged&&!hostBrowserMode&&!stagedLab;
let backgroundOptedIn=backgroundSupported&&
  store.getWorkspaceSession()?.metadata?.keep_running_in_background===true;
let backgroundTray=null,backgroundTrayPending=null,quittingIntentionally=false;
const backgroundStartupRequested=process.argv.includes('--ordax-background-start');
function showCanonicalWindow(){
  if(!win||win.isDestroyed()){void createWindow().then(window=>{window.show();window.focus();}).catch(()=>hostStartupLog('window_recovery_failed'));return;}
  if(win.isMinimized())win.restore();
  win.show();win.focus();
}
const canonicalLoginItem=()=>({path:process.execPath,args:['--ordax-background-start']});
function updateLoginStartup(enabled) {
  if(!backgroundSupported)return false;
  try {
    const item=canonicalLoginItem();
    app.setLoginItemSettings({openAtLogin:enabled,...item});
    // Electron compares the *complete* executable + args identity.
    // Omitting args here would misreport an enabled run key as disabled.
    return app.getLoginItemSettings(item).openAtLogin===enabled;
  }catch{return false;}
}
async function ensureBackgroundTray() {
  if(!backgroundSupported)return false;
  if(backgroundTray)return true;
  if(backgroundTrayPending)return backgroundTrayPending;
  backgroundTrayPending=(async()=>{
    try {
      const icon=await app.getFileIcon(process.execPath,{size:'small'});
      if(!icon||icon.isEmpty())return false;
      const tray=new Tray(icon);
      tray.setToolTip(PRODUCT_NAME+' — em segundo plano');
      tray.setContextMenu(Menu.buildFromTemplate([
        {label:'Abrir '+PRODUCT_NAME,click:showCanonicalWindow},
        {type:'separator'},
        {label:'Sair do '+PRODUCT_NAME,click:()=>{quittingIntentionally=true;app.quit();}}
      ]));
      tray.on('double-click',showCanonicalWindow);
      backgroundTray=tray;
      return true;
    }catch{return false;}
  })();
  try{return await backgroundTrayPending}
  finally{backgroundTrayPending=null}
}
function backgroundState(){
  let startupEnabled=false;
  if(backgroundSupported) {
    try {startupEnabled=app.getLoginItemSettings(canonicalLoginItem()).openAtLogin===true;}catch {}
  }
  return {supported:backgroundSupported,optedIn:backgroundOptedIn,
    resident:backgroundResidencyAllowed({optedIn:backgroundOptedIn,
      hostMode:hostBrowserMode,trayReady:Boolean(backgroundTray),
      quitting:quittingIntentionally,platform:process.platform,packaged:app.isPackaged}),
    startupEnabled,requiresWindowsUserSession:true,unattended24hCertified:false};
}

const recoveredRunCount = store.recoverInterruptedRuns();
store.updateWorkspaceMetadata({
  last_started_at: new Date().toISOString(),
  recovered_runs_on_start: recoveredRunCount,
  sqlite_open_retries: store.openRetryCount
});

removeStaleTaskHandoffFiles(handoffRoot);

function migrateExternalAssetPaths() {
  const safeRoot = path.resolve(assetsRoot) + path.sep;
  const rows = store.db.prepare('SELECT id,task_id,local_path FROM message_assets').all();
  let migrated = 0;
  for (const row of rows) {
    const source = path.resolve(String(row.local_path || ''));
    if (source.startsWith(safeRoot) || !fs.existsSync(source)) continue;
    const ext = path.extname(source) || '.bin';
    const dir = path.join(assetsRoot, row.task_id);
    const destination = path.join(dir, `${row.id}${ext}`);
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(destination)) fs.copyFileSync(source, destination);
    store.db.prepare('UPDATE message_assets SET local_path=? WHERE id=?').run(destination, row.id);
    migrated++;
  }
  return migrated;
}

const migratedAssetCount = migrateExternalAssetPaths();
if (migratedAssetCount) store.updateWorkspaceMetadata({ migrated_legacy_assets: migratedAssetCount });

const MIME_EXT = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/avif', 'avif']
]);

let win;
let worker;
let interactiveHtmlPreview=null;
const providerViews=createProviderViewRegistry();
let windowCreationPromise=null;
let hostBrowserServer=null;
const hostBrowserRequest=Symbol('authenticated-host-browser-request');
const uiHandlers=new Map();
function registerUiHandler(channel,handler) {
  if(typeof channel!=='string'||typeof handler!=='function'||uiHandlers.has(channel))
    throw new Error('ui_handler_registration_invalid');
  uiHandlers.set(channel,handler);
  ipcMain.handle(channel,handler);
}
const HOST_EVENT_BY_CHANNEL=Object.freeze({
  'ordax:orchestrator:changed':'orchestrator-changed',
  'ordax:task:run-started':'run-started',
  'ordax:task:stage':'task-stage',
  'ordax:task:stream':'task-stream',
  'ordax:task:provider-navigation':'task-provider-navigation',
  'ordax:task:reconciled':'task-reconciled'
});
function emitRendererEvent(channel,payload) {
  if(win&&!win.isDestroyed())win.webContents.send(channel,payload);
  const hostEvent=HOST_EVENT_BY_CHANNEL[channel];
  if(hostEvent)hostBrowserServer?.publish(hostEvent,payload);
}
let chatVisible = false;
let providerViewBounds = null;
let liveRun = null;
const persistedObserverMode = store.getWorkspaceSession()?.metadata?.observer_mode;
let observerMode = ['auto','fast','beta'].includes(persistedObserverMode) ? persistedObserverMode : 'auto';
let workerPreload = { ready:false, url:null, at:null };
let providerHealthInFlight = null;
let providerHealthCache = null;
let providerScheduler = null;

// Replaces the former global promise chain. The existing provider worker
// remains the only physical lane until isolated multi-view E2E is verified.
function enqueueExecution(taskId,operation) {
  if(!providerScheduler)return Promise.reject(Error('provider_worker_unavailable'));
  return providerScheduler.enqueue(String(taskId),operation);
}

function assetUrl(id) {
  return `ordax-asset://local/${encodeURIComponent(id)}`;
}

function decorateMessages(messages) {
  return messages.map(message => ({
    ...message,
    assets: (message.assets || []).map(asset =>
      asset.kind==='image'?{...asset,url:assetUrl(asset.id)}:{...asset,url:null})
  }));
}

function decorateTask(task) {
  return task ? { ...task, messages:decorateMessages(task.messages) } : null;
}

function getTaskView(id) {
  return decorateTask(store.getTask(String(id), { messageLimit:MESSAGE_PAGE_SIZE }));
}

function persistImages(taskId, messageId, images = [], writtenPaths = null) {
  if (!images.length) return [];
  const dir = path.join(assetsRoot, taskId);
  fs.mkdirSync(dir, { recursive: true });
  const out = [];

  for (const image of images) {
    const ext = MIME_EXT.get(image.mimeType);
    const bytes = Buffer.from(image.base64 || '', 'base64');
    if (!ext || !bytes.length || bytes.length > 30 * 1024 * 1024) continue;

    const id = `asset_${randomUUID()}`;
    const localPath = path.join(dir, `${id}.${ext}`);
    fs.writeFileSync(localPath, bytes, { flag: 'wx' });
    if (writtenPaths) writtenPaths.push(localPath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const asset = store.addAsset(taskId, messageId, {
      id,
      kind: 'image',
      mimeType: image.mimeType,
      localPath,
      alt: image.alt || 'Imagem do ChatGPT',
      width: image.width,
      height: image.height,
      sha256
    });
    out.push({ ...asset, url: assetUrl(asset.id) });
  }

  return out;
}

async function runTask(taskId, prompt, { newSession = false, draftRevision = null, allowCoordinatorTask = false, authorSource='human' } = {}, runWorker) {
  // An execution is always owned by the physical worker selected by the
  // canonical scheduler, never by whichever view happens to be visible.
  if(!runWorker||providerViews.resolve(runWorker?.view?.webContents)!==runWorker)
    throw Error('provider_run_worker_unregistered');
  orchestratorService.assertProviderTaskAvailable(taskId,{allowCoordinator:allowCoordinatorTask});
  // Before appending another user message or starting another Run, require
  // reconciliation of any earlier uncertain transport effect on this Task.
  // The single existing Store is authoritative; this performs no replay.
  assertTaskHasNoUncertainTransport(store,taskId);
  const task = store.getTaskExecutionSnapshot(taskId);
  if (!task) throw new Error('task_not_found');

  const conversationPlan = planProviderConversation(task, {
    forceNew:newSession,nextPromptBytes:Buffer.byteLength(withForjadorMcpMention(String(prompt||'').trim(),{authorSource}),'utf8')
  });
  const needsContinuation = Boolean(conversationPlan.newSession && task.has_messages);
  const checkpointVersion = task.checkpoint_version;
  let continuationPacket = needsContinuation ? store.buildContinuationPacket(taskId,prompt) : null;
  if (continuationPacket) assertContinuationContextReady(continuationPacket);
  let contextManifest=continuationPacket?.manifest || null;
  let handoffSnapshot=null;
  let contextAttachmentNotice='';
  if(contextManifest?.attachmentUseful===true){
    const buildSnapshot=manifest=>store.buildTaskHandoffSnapshot(taskId,{
      request:prompt,includeMessageIds:manifest.omittedMessageIds||[]
    });
    handoffSnapshot=buildSnapshot(contextManifest);
    const estimatedNotice=buildProviderContextAttachmentNotice({
      filename:handoffSnapshot.filename,filePath:path.join(handoffRoot,handoffSnapshot.filename),
      sha256:handoffSnapshot.manifest.sha256,taskId:taskId,
      checkpointVersion:handoffSnapshot.manifest.checkpointVersion,
      byteLength:handoffSnapshot.manifest.byteLength
    });
    const boundedPromptChars=16000-estimatedNotice.length-
      (authorSource==='orchestrator'?FORJADOR_MCP_MENTION.length+2:0);
    if(boundedPromptChars<1024)throw new Error('task_handoff_prompt_budget_exhausted');
    continuationPacket=store.buildContinuationPacket(taskId,prompt,{maxChars:boundedPromptChars});
    assertContinuationContextReady(continuationPacket);
    contextManifest=continuationPacket.manifest;
    handoffSnapshot=buildSnapshot(contextManifest);
    assertTaskHandoffCoversOmissions(contextManifest,handoffSnapshot.manifest);
    contextAttachmentNotice=buildProviderContextAttachmentNotice({
      filename:handoffSnapshot.filename,filePath:path.join(handoffRoot,handoffSnapshot.filename),
      sha256:handoffSnapshot.manifest.sha256,taskId:taskId,
      checkpointVersion:handoffSnapshot.manifest.checkpointVersion,
      byteLength:handoffSnapshot.manifest.byteLength
    });
  }
  // The Forjador's GPT work turns request the already-installed OrdaX MCP.
  // Mentioning an app does not grant access or prove a tool was executed.
  // A fresh Task chat inherits approved editorial context of its project.
  // Established Task segments keep their existing checkpoint/handoff path.
  const projectContext=!task.has_messages
    ?forgeFreshConversationContext(store,taskId):null;
  const providerPrompt = withForjadorMcpMention(
    (projectContext?.text||'')+(continuationPacket?.prompt || prompt)+contextAttachmentNotice,{authorSource}
  );
  if(contextManifest&&contextAttachmentNotice){
    if(providerPrompt.length>16000)throw new Error('task_handoff_prompt_budget_exceeded');
    contextManifest={...contextManifest,maxChars:16000,promptChars:providerPrompt.length,promptSha256:providerPromptDigest(providerPrompt)};
  }
  // Authoritative, fresh, read-only readiness gate BEFORE any Task/Run/message
  // mutation or draft clearing. A signed-out/unknown provider creates no Run.
  // Worker.sendPrompt independently checks again immediately before editing.
  try { assertProviderSendReadiness(await runWorker.health()); }
  catch(error) { throw normalizeProviderFailure(error,{stage:'health'}); }
  if(liveRun)throw Error('orchestrator_executor_busy');
  const contextAttachment=handoffSnapshot?writeTaskHandoffFile(handoffRoot,handoffSnapshot):null;
  // No provider interaction happens until this atomic transaction commits.
  // The message, draft-clear and Run must never be persisted separately.
  let begun;
  try {
    begun=store.beginProviderRun(taskId, prompt, {
      draftRevision,workerId:'electron-embedded-chatgpt',observerMode,authorSource
    });
  } catch(error) {
    if(contextAttachment)try{removeTaskHandoffFile(handoffRoot,contextAttachment.filePath);}catch{}
    throw error;
  }
  const { userMessage, runId } = begun;
  let contextAttachmentReceipt=null;
  const runContext = { taskId, runId, startedAt:Date.now(), firstDeltaAt:null };
  liveRun = runContext;
  const provisional=createProviderProvisionalRecorder({
    save:(text,source)=>store.saveRunProvisionalOutput(taskId,runId,text,source)
  });
  const heartbeat = setInterval(() => store.heartbeatRun(taskId, runId), 5000);

  try {
    providerViews.bindRun(runWorker,runContext);
    if (win && !win.isDestroyed()) emitRendererEvent('ordax:task:run-started', { taskId, runId, userMessage });
    const projectId=store.db.prepare('SELECT project_id FROM lab_task_bindings WHERE task_id=? LIMIT 1')
      .get(taskId)?.project_id||null;
    lastGptDispatch={projectId,taskId,runId,authorSource,
      originalRequest:prompt,composedPrompt:providerPrompt,
      preparedAt:new Date().toISOString(),deliveryObserved:false};
    const result = await runWorker.sendPrompt({
      prompt:providerPrompt,chatUrl:task.chat_url,newSession:conversationPlan.newSession,
      contextAttachment,
      onContextAttachmentObserved:receipt=>{
        if(providerViews.runForWorker(runWorker)!==runContext)throw new Error('context_attachment_run_context_changed');
        const durableReceipt={
          format:handoffSnapshot.manifest.format,deliveryState:'uploaded',
          taskId:handoffSnapshot.manifest.taskId,filename:receipt.filename,
          sha256:receipt.sha256,byteLength:receipt.byteLength,
          checkpointVersion:receipt.checkpointVersion,uploadedAt:receipt.uploadedAt,
          memoryIds:handoffSnapshot.manifest.memoryIds,
          recentMessageIds:handoffSnapshot.manifest.recentMessageIds,
          historicalMessageIds:handoffSnapshot.manifest.historicalMessageIds
        };
        store.event(taskId,'provider.context_attachment.uploaded',{
          run_id:runId,filename:durableReceipt.filename,sha256:durableReceipt.sha256,
          byte_length:durableReceipt.byteLength,checkpoint_version:durableReceipt.checkpointVersion,
          uploaded_at:durableReceipt.uploadedAt,memory_ids:durableReceipt.memoryIds,
          recent_message_ids:durableReceipt.recentMessageIds,
          historical_message_ids:durableReceipt.historicalMessageIds
        });
        contextAttachmentReceipt=durableReceipt;
      },
      onProvisionalProgress:({text,source})=>{
        if(providerViews.runForWorker(runWorker)===runContext)provisional.capture(text,source);
      },
      onMcpSelectionObserved:selection=>{
        if(providerViews.runForWorker(runWorker)!==runContext)return;
        const selectedState=['selection_visible','name_visible_unverified','not_observed','unavailable']
          .includes(selection?.state)?selection.state:'unavailable';
        const mentionRequested=mentionWasRequested(providerPrompt);
        const state=selectedState==='not_observed'&&mentionRequested?'mention_requested':selectedState;
        try {store.event(taskId,'provider.mcp.selection_observed',{
          run_id:runId,state,mention_requested:mentionRequested,
          selection_observed:selectedState==='selection_visible',invocation_verified:false
        });}catch{/* diagnostic cannot affect delivery */}
        emitRendererEvent('ordax:provider:mcp-observed',{state,taskId,runId});
      },
      onSubmissionIntent:({intentAt,chatUrl,baselineUserMessageId,baselineUserMessagePresent,baselinePromptMatches})=>{
        if(providerViews.runForWorker(runWorker)!==runContext)throw new Error('submission_run_context_changed');
        const requireRecordedIntent=intent=>{
          if(intent.recorded)return intent;
          // The reason is a closed-set local validation code, never the prompt,
          // provider URL or any private identity. Recording diagnostics must
          // not change the original fail-closed submit outcome.
          const reason=['intent_incomplete','intent_reference_missing','intent_already_recorded']
            .includes(intent.reason)?intent.reason:'intent_unavailable';
          try {store.event(taskId,'provider.submission.intent_rejected',{run_id:runId,reason});}
          catch {/* The send remains blocked even if diagnostics cannot persist. */}
          throw new Error('provider_submission_intent_not_recorded');
        };
        if(conversationPlan.newSession) {
          // A fresh GPT chat has no permalink before its first accepted send.
          // Persist the exact dispatch intent against the official empty home
          // and the previous task link; recovery can bind a new URL only after
          // the unique prompt and one complete response are observed twice.
          const intent=recordProviderSubmissionIntent({
            store,taskId,runId,messageId:userMessage.id,providerPrompt,
            chatUrl,intentAt,baselineUserMessageId,baselineUserMessagePresent,baselinePromptMatches,
            newSession:true,previousConversationId:conversationPlan.previousConversationId,
            previousChatUrl:task.chat_url,
            contextCheckpointVersion:needsContinuation?checkpointVersion:null
          });
          return requireRecordedIntent(intent);
        }
        const expected=canonicalProviderChatUrl(task.chat_url);
        if(!expected||canonicalProviderChatUrl(chatUrl)!==expected)
          throw new Error('provider_submission_intent_target_mismatch');
        const intent=recordProviderSubmissionIntent({
          store,taskId,runId,messageId:userMessage.id,providerPrompt,
          chatUrl:expected,intentAt,baselineUserMessageId,baselineUserMessagePresent,baselinePromptMatches
        });
        return requireRecordedIntent(intent);
      },
      onDeliveryObserved:({chatUrl,submittedAt}) => {
        if (providerViews.runForWorker(runWorker)!==runContext) throw new Error('submission_run_context_changed');
        const binding=bindObservedSubmittedConversation({
          store,taskId,runId,chatUrl,submittedAt,
          plannedNewSession:conversationPlan.newSession,
          checkpointVersion:needsContinuation ? checkpointVersion : null
        });
        // Persist the exact provider-prompt digest only after observed delivery.
        // Failure to record this optional evidence cannot trigger a resend.
        try {
          recordProviderSubmissionProvenance({
            store,taskId,runId,messageId:userMessage.id,providerPrompt,
            chatUrl,submittedAt,contextManifest,contextAttachmentReceipt
          });
        } catch {
          // The provider already accepted the send. Never fail or retry it
          // merely because optional local provenance could not be recorded.
          try { store.event(taskId,'provider.submission.provenance_unavailable',{run_id:runId}); }
          catch { /* Preserve transport result; reconcile conservatively. */ }
        }
        if(lastGptDispatch?.runId===runId)
          lastGptDispatch={...lastGptDispatch,deliveryObserved:true};
        return binding;
      }
    });
    const rotationOutcome = assessProviderRotation(conversationPlan, task.chat_url, result.chatUrl);
    const confirmedChatUrl = canonicalProviderChatUrl(result.chatUrl);
    // An observed answer is still persisted, but a home/share/login URL must
    // never become the durable conversation identifier. No automatic resend.
    const bound = confirmedChatUrl
      ? store.setChatUrl(taskId, confirmedChatUrl, needsContinuation ? checkpointVersion : null)
      : null;
    if (!confirmedChatUrl) {
      store.rotateConversation(taskId, 'provider_url_unconfirmed');
      store.event(taskId, 'provider.conversation.url_unconfirmed', {
        reason: result.chatUrl ? 'not_a_chat_permalink' : 'missing_url',
        previous_conversation_id: conversationPlan.previousConversationId
      });
    }
    if (conversationPlan.automaticRotation && rotationOutcome === 'rotated' && bound?.id !== conversationPlan.previousConversationId) {
      store.event(taskId, 'provider.conversation.auto_rotated', {
        reason:conversationPlan.reason,
        previous_conversation_id:conversationPlan.previousConversationId,
        new_conversation_id:bound?.id || null,
        previous_completed_turns:conversationPlan.completedTurns
      });
    } else if (conversationPlan.automaticRotation) {
      // Preserve the successful response; never resend a prompt merely because
      // the provider returned the same conversation URL.
      store.event(taskId, 'provider.conversation.rotation_unconfirmed', {
        reason:rotationOutcome,
        previous_conversation_id:conversationPlan.previousConversationId,
        previous_completed_turns:conversationPlan.completedTurns
      });
    }
    const runMetrics = store.recordRunMetrics(taskId, runId, observerMode, { ...(result.metrics || {}), runStartedAt: runContext.startedAt });
    provisional.flush();
    // File bytes live outside SQLite. Track new writes so an SQL rollback
    // does not leave unnecessary assets in a normal (non-crash) failure.
    const writtenPaths = [];
    let assets;
    try {
      ({ assets } = store.commitObservedProviderReply(taskId, runId, {
        text:result.text || '', observedAt:result.observedAt,
        chatUrl:confirmedChatUrl, observerMode, runMetrics,
        attachAssets:(messageId)=>persistImages(taskId, messageId,
          result.images || [], writtenPaths)
      }));
    } catch (commitError) {
      for (const assetPath of writtenPaths) {
        try { fs.unlinkSync(assetPath); } catch { /* Orphan is never in the committed asset ledger. */ }
      }
      throw commitError;
    }
    const postCommitNavigation=await observePostCommitNavigation({worker:runWorker,chatUrl:confirmedChatUrl});
    if(postCommitNavigation.navigated===false)
      emitRendererEvent('ordax:task:provider-navigation',{
        taskId,provider_navigation:'post_commit_failed',
        provider_navigation_reason:postCommitNavigation.reason
      });
    return { result: { ...result, runId, assets,
      ...(postCommitNavigation.navigated===false?{postCommitNavigation}:{}) },
      task:getTaskView(taskId) };
  } catch (error) {
    // Persist the last pending observed text, never as a confirmed message.
    provisional.flush();
    if (runWorker.lastFailureMetrics) {
      try { store.recordRunMetrics(taskId, runId, observerMode, {
        ...runWorker.lastFailureMetrics,
        runStartedAt:runContext.startedAt
      }); } catch { /* preserve original failure */ }
    }
    store.finishRun(taskId, runId, String(error?.message || error));
    if(error?.providerFailureCode==='send_confirmation_unknown'&&error?.providerDeliveryState==='uncertain') {
      const recovered=await recoverFailedProviderSubmission({store,worker:runWorker,taskId,runId}).catch(()=>null);
      if(recovered?.reconciled===true||recovered?.reason==='already_reconciled')
        return {result:{runId,recovered:true},task:getTaskView(taskId)};
    }
    throw error;
  } finally {
    providerViews.unbindRun(runWorker,runId);
    if (liveRun===runContext) liveRun = null;
    clearInterval(heartbeat);
    if(contextAttachment)try{removeTaskHandoffFile(handoffRoot,contextAttachment.filePath);}catch{}
  }
}

function layoutViews() {
  if (!win || !worker) return;
  const [width,height]=win.getContentSize();
  const bounds=providerViewBounds?normalizeProviderViewBounds(providerViewBounds,{
    contentWidth:width,contentHeight:height,zoomFactor:win.webContents.getZoomFactor()
  }):null;
  worker.view.setBounds(bounds||{x:0,y:0,width:1,height:1});
  worker.view.setVisible(Boolean(chatVisible&&bounds));
  interactiveHtmlPreview?.relayout();
}

async function createWindow() {
  if(windowCreationPromise)return windowCreationPromise;
  if(win&&!win.isDestroyed())return win;
  const creation=Promise.resolve().then(createWindowOnce);
  windowCreationPromise=creation;
  try{return await creation;}
  finally{if(windowCreationPromise===creation)windowCreationPromise=null;}
}

async function createWindowOnce() {
  hostStartupLog('window_create_begin');
  win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1160,
    minHeight: 700,
    title: PRODUCT_NAME,
    backgroundColor: '#0b0e13',
    autoHideMenuBar: true,
    show:!hostBrowserMode&&!backgroundStartupAllowed({optedIn:backgroundOptedIn,
      hostMode:hostBrowserMode,trayReady:true,requestedHidden:backgroundStartupRequested,
      platform:process.platform,packaged:app.isPackaged}),
    webPreferences: {
      backgroundThrottling:false,
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });

  // HTML previews are child frames of this privileged first-party renderer.
  // Even a scriptless sandbox may contain clickable external links. Deny
  // cross-document child-frame navigation and popups at the Electron boundary.
  // In-page hash links remain available for static navigation.
  win.webContents.on('will-frame-navigate',details=>{
    if(!details.isMainFrame&&
       !['about:blank','about:srcdoc'].includes(details.url))
      details.preventDefault();
  });
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));

  interactiveHtmlPreview=new IsolatedInteractiveHtmlPreview(()=>win);
  worker = new EmbeddedChatWorker();
  providerViews.register(worker);
  providerScheduler=createProviderExecutionScheduler({lanes:[{id:'primary',worker}]});
  const registeredScheduler=providerScheduler;
  const registeredWorker=worker;
  registeredWorker.view.webContents.once('destroyed',()=>{
    providerViews.unregister(registeredWorker);
    registeredScheduler.close('provider_worker_destroyed');
  });
  hostStartupLog('worker_constructed');
  worker.setObserverMode(observerMode);
  worker.setStageSink(({ stage, at }) => {
    const routed=providerViews.runForWorker(registeredWorker);
    if (!routed || !win || win.isDestroyed()) return;
    emitRendererEvent('ordax:task:stage', {
      taskId:routed.taskId, runId:routed.runId, stage, at, runStartedAt:routed.startedAt
    });
  });
  worker.setFastStreamSink(delta => {
    const routed=providerViews.runForWorker(registeredWorker);
    if (!routed || !win || win.isDestroyed()) return;
    emitRendererEvent('ordax:task:stream', { taskId:routed.taskId, runId:routed.runId, ...delta, mirrorAt:Date.now(), runStartedAt:routed.startedAt });
  });

  // Native WebContentsView defaults to visible. Hide the embedded provider
  // BEFORE awaiting the App renderer, or it can cover a still-loading UI.
  win.contentView.addChildView(worker.view);
  hostStartupLog('provider_view_attached');
  layoutViews();
  win.on('resize', layoutViews);
  win.on('closed',()=>{interactiveHtmlPreview?.close();interactiveHtmlPreview=null;});
  win.on('maximize', layoutViews);
  win.on('unmaximize', layoutViews);
  // The user can close Electron while a provider request was accepted but
  // its reply is unknown. Persist the SAME interruption transaction used on
  // startup before destroying the window. No provider retry/cancel/API call.
  // A late response cannot be committed: finishRun requires status=running.
  win.on('session-end',()=>{quittingIntentionally=true;});
  win.on('close', event => {
    if(backgroundResidencyAllowed({optedIn:backgroundOptedIn,
      hostMode:hostBrowserMode,trayReady:Boolean(backgroundTray),
      quitting:quittingIntentionally,platform:process.platform,packaged:app.isPackaged})) {
      event.preventDefault();
      win.hide();
      return;
    }
    if (!liveRun) {registeredScheduler.close();return;}
    try {
      const interrupted = store.recoverInterruptedRuns('app_shutdown');
      registeredScheduler.close();
      providerViews.unbindRun(worker,liveRun.runId);
      liveRun = null;
      if (interrupted) hostStartupLog('inflight_run_interrupted_on_close');
    } catch {
      // Never let a failed SQLite transition silently discard an in-flight Run.
      event.preventDefault();
      hostStartupLog('inflight_shutdown_recovery_failed');
    }
  });

  // A dead App renderer must never look like a successfully started product.
  // Report only local, sanitized shell failure codes, never provider content.
  let shellFailureReported=false;
  const reportShellFailure=code=>{
    if(shellFailureReported || !win || win.isDestroyed())return;
    shellFailureReported=true;
    dialog.showMessageBox(win,{
      type:'error',
      title:PRODUCT_NAME+' — falha na interface',
      message:'A interface do aplicativo não pôde ser carregada.',
      detail:'Código local: '+code+'. Nenhuma tarefa foi enviada. Feche esta janela e reinicie o '+PRODUCT_NAME+'.',
      buttons:['Entendi'],defaultId:0
    }).catch(()=>{});
  };
  win.webContents.on('render-process-gone',(_event,details)=>{
    const reason=['crashed','oom','killed','integrity-failure','launch-failed','abnormal-exit']
      .includes(details?.reason)?details.reason:'unavailable';
    reportShellFailure('renderer_'+reason);
  });
  win.webContents.on('did-fail-load',(_event,errorCode,_description,_url,isMainFrame)=>{
    if(isMainFrame && errorCode!==-3)
      reportShellFailure('ui_load_'+Number(errorCode||0));
  });
  if(hostBrowserMode) {
    hostBrowserServer=createHostBrowserServer({
      productRoot:root,assetsRoot,
      invoke:async(_method,channel,args,{session:hostSession}={})=>{
        if(!hostSession)throw new Error('host_session_required');
        const handler=uiHandlers.get(channel);
        if(!handler)throw new Error('ui_handler_unavailable');
        const event=Object.freeze({sender:win.webContents,[hostBrowserRequest]:true});
        return handler(event,...args);
      },
      readAsset:async id=>store.getAsset(String(id)),
      onShutdown:()=>app.quit()
    });
    const {url}=await hostBrowserServer.listen();
    process.stdout.write(`ORDAX_HOST_BROWSER_URL=${url}\n`);
    hostStartupLog('server_listening');
    await win.loadURL('about:blank');
  }
  else {
    try { await win.loadFile(path.join(here, 'ui.html')); }
    catch { reportShellFailure('ui_load_rejected'); return; }
  }
  hostStartupLog('app_shell_loaded');
  layoutViews();
  if(hostBrowserMode) {
    hostStartupLog('provider_worker_load_started');
    void worker.load('https://chatgpt.com/').catch(()=>hostStartupLog('provider_worker_load_failed'));
  }
  else {
    // The provider is an external dependency. Its navigation must not hold
    // the OrdaX shell's startup promise or make app.whenReady quit the app.
    // The worker keeps the failure in status(); the operator can retry from
    // the provider pane after the App has loaded.
    void worker.load('https://chatgpt.com/').catch(()=>{});
  }
  hostStartupLog('window_create_complete');
  return win;
}

ipcMain.on('ordax:worker:preload-ready', (event, payload) => {
  if (providerViews.resolve(event.sender)!==worker) return;
  workerPreload = { ready:true, url:String(payload?.url || ''), at:Number(payload?.at || Date.now()) };
});

ipcMain.on('ordax:worker:stream', (event, snapshot) => {
  const fromWorker=providerViews.resolve(event.sender);
  const routed=providerViews.runForSender(event.sender);
  if (fromWorker!==worker || !routed || !win || win.isDestroyed()) return;
  const delta = fromWorker.acceptStreamSnapshot(snapshot);
  if (!delta) return;
  const mirrorAt = Date.now();
  if (!routed.firstDeltaAt) routed.firstDeltaAt = delta.firstDeltaAt || mirrorAt;
  emitRendererEvent('ordax:task:stream', { taskId:routed.taskId, runId:routed.runId, source:'beta', ...delta, mirrorAt, runStartedAt:routed.startedAt });
});

const sharedTaskHandlers=createTaskUiHandlers({
  store,decorateTask,decorateMessages,getTaskView,isRunActive:()=>Boolean(liveRun),
  onOpenTask:createProviderAwareTaskOpener({
    isChatVisible:()=>chatVisible,
    showConversation:url=>worker.showConversation(url),
    safeTaskNavigationReason,
    onNavigationResult:result=>emitRendererEvent('ordax:task:provider-navigation',result)
  })
});
for(const [channel,handler] of sharedTaskHandlers)registerUiHandler(channel,handler);
// A first-party OrdaX App action, not the ChatGPT direct-mode UI.
// Inspection is read-only; recovery is a second explicit action that rechecks
// the exact provider evidence and atomically reconciles the local ledger.
registerUiHandler('ordax:tasks:inspect-linked-thread', async (event, requestedId) => {
  requireTrustedSupervisorRenderer(event);
  if (liveRun) return {kind:'unavailable',reason:'run_active',threadRendered:false,requiresReconciliation:true};
  return inspectProviderLinkedThread({store,worker,taskId:requestedId});
});
registerUiHandler('ordax:tasks:reconcile-linked-reply', async (event, payload={}) => {
  requireTrustedSupervisorRenderer(event);
  if(liveRun)throw new Error('provider_reply_recovery_run_active');
  const result=await reconcileProviderLinkedReply({
    store,worker,taskId:payload?.taskId,responseSha256:payload?.responseSha256
  });
  if(result?.reconciled===true)
    await finalizeReconciledSiteDelivery(String(payload?.taskId||''),{captureMissing:true})
      .catch(()=>{});
  return result;
});
let htmlArtifactCaptureBusy=false;
// Canonical capture operation: both automatic post-Run completion and the
// existing manual fallback use this SAME path, Store and result attribution.
// It only downloads first-party output, never sends a prompt or creates a Run.
async function captureConfirmedHtmlArtifact(requestedId) {
  if(hostBrowserMode||htmlArtifactCaptureBusy||liveRun||worker?.active||
     providerScheduler?.snapshot()?.pendingTasks)
    throw Error('provider_html_capture_unavailable');
  const taskId=String(requestedId||'');
  const task=store.getTask(taskId);
  if(!task?.chat_url||!canonicalProviderChatUrl(task.chat_url))
    throw Error('provider_html_task_unbound');
  const run=store.db.prepare(
    'SELECT id,status FROM runs WHERE task_id=? ORDER BY started_at DESC LIMIT 1'
  ).get(taskId);
  if(run?.status!=='succeeded'||
     !store.db.prepare('SELECT 1 FROM conversation_completed_runs WHERE run_id=? AND task_id=?')
       .get(run.id,taskId))
    throw Error('provider_html_run_not_confirmed');
  const response=store.db.prepare(
    "SELECT id,content FROM messages WHERE task_id=? AND role='assistant' ORDER BY sequence DESC LIMIT 1"
  ).get(taskId);
  if(!response||typeof response.content!=='string'||!response.content.trim())
    throw Error('provider_html_response_not_attributable');
  const previous=store.db.prepare(
    "SELECT id,local_path,sha256 FROM message_assets WHERE task_id=? AND message_id=? AND kind='file' AND mime_type='text/html' ORDER BY created_at DESC LIMIT 1"
  ).get(taskId,response.id);
  if(previous){
    const proof=verifyLocalHtmlArtifact(assertLocalArtifactPath(assetsRoot,previous.local_path));
    if(proof.sha256!==previous.sha256)throw Error('provider_html_existing_asset_changed');
    return {verified:true,alreadyStored:true,filename:'index.html',
      bytes:proof.bytes,sha256:proof.sha256,task:getTaskView(taskId)};
  }
  htmlArtifactCaptureBusy=true;
  const dir=path.join(assetsRoot,taskId);
  fs.mkdirSync(dir,{recursive:true});
  // Refuse a maliciously replaced/symlinked Task directory even when its
  // lexical path is under the private asset root.
  assertLocalArtifactPath(fs.realpathSync.native(assetsRoot),fs.realpathSync.native(dir));
  const assetId='asset_'+randomUUID();
  const filePath=assertLocalArtifactPath(assetsRoot,path.join(dir,assetId+'.html'));
  try{
    // Navigate and attribute the existing linked GPT thread using the
    // canonical read-only inspector. A filename in a model answer is not
    // evidence: require one completed reply bound to this exact Task/Run.
    const inspection=await inspectProviderLinkedThread({store,worker,taskId});
    if(inspection?.kind!=='response_candidate'||inspection.threadRendered!==true||
       inspection.inspectionReason!=='thread_rendered')
      throw Error('provider_html_thread_unverified');
    if(liveRun||worker.active||providerScheduler?.snapshot()?.pendingTasks)
      throw Error('provider_html_capture_unavailable');
    const downloaded=await worker.downloadLinkedHtmlArtifact({
      chatUrl:task.chat_url,expectedAnswer:response.content,
      destinationPath:filePath,filename:'index.html'
    });
    if(downloaded?.filename!=='index.html')throw Error('provider_html_download_receipt_invalid');
    const proof=verifyLocalHtmlArtifact(filePath);
    if(proof.bytes!==downloaded.downloadedBytes)
      throw Error('provider_html_download_size_mismatch');
    store.db.exec('BEGIN IMMEDIATE');
    try{
      store.addAsset(taskId,response.id,{id:assetId,kind:'file',
        mimeType:'text/html',localPath:filePath,alt:'index.html',sha256:proof.sha256});
      store.event(taskId,'provider.artifact.html_verified',{
        run_id:run.id,asset_id:assetId,bytes:proof.bytes,sha256:proof.sha256,
        scope:'private_local_file',browser_tested:false,published:false
      });
      store.db.exec('COMMIT');
    }catch(error){
      if(store.db.isTransaction)store.db.exec('ROLLBACK');
      throw error;
    }
    return {verified:true,alreadyStored:false,filename:'index.html',
      bytes:proof.bytes,sha256:proof.sha256,task:getTaskView(taskId)};
  }catch(error){
    try{fs.unlinkSync(filePath)}catch{}
    throw error;
  }finally{htmlArtifactCaptureBusy=false;}
}
registerUiHandler('ordax:tasks:html-artifact:save',async(event,requestedId)=>{
  requireTrustedSupervisorRenderer(event);
  return captureConfirmedHtmlArtifact(requestedId);
});
registerUiHandler('ordax:tasks:html-artifact:reveal',(event,payload={})=>{
  requireTrustedSupervisorRenderer(event);
  const taskId=String(payload?.taskId||''),assetId=String(payload?.assetId||'');
  const asset=store.getAsset(assetId);
  if(!asset||asset.task_id!==taskId||asset.kind!=='file'||asset.mime_type!=='text/html')
    throw Error('provider_html_asset_not_found');
  const real=fs.realpathSync.native(assertLocalArtifactPath(assetsRoot,asset.local_path));
  assertLocalArtifactPath(fs.realpathSync.native(assetsRoot),real);
  const proof=verifyLocalHtmlArtifact(real);
  if(proof.sha256!==asset.sha256)throw Error('provider_html_asset_integrity_failed');
  shell.showItemInFolder(real);
  return {verified:true,filename:'index.html',sha256:proof.sha256};
});
// Same verified Task/message/file authority for static and interactive previews.
// The native WebContentsView only receives bytes from this validation path.
function readVerifiedHtmlPreview(payload={}) {
  if(hostBrowserMode)throw Error('html_preview_unavailable_in_host');
  const taskId=String(payload?.taskId||''),assetId=String(payload?.assetId||'');
  const asset=store.getAsset(assetId);
  if(!asset||asset.task_id!==taskId||asset.kind!=='file'||
     asset.mime_type!=='text/html'||!store.getTask(taskId))
    throw Error('html_preview_asset_unverified');
  const root=fs.realpathSync.native(assetsRoot);
  const real=fs.realpathSync.native(assertLocalArtifactPath(assetsRoot,asset.local_path));
  assertLocalArtifactPath(root,real);
  const proof=readVerifiedLocalHtmlArtifact(real);
  if(proof.sha256!==asset.sha256)throw Error('html_preview_integrity_mismatch');
  return Object.freeze({verified:true,taskId,assetId,filename:'index.html',
    sha256:proof.sha256,bytes:proof.bytes,html:proof.html});
}
registerUiHandler('ordax:tasks:html-artifact:preview',(event,payload={})=>{
  requireTrustedSupervisorRenderer(event);
  return readVerifiedHtmlPreview(payload);
});
registerUiHandler('ordax:preview:interactive:open',async(event,payload={})=>{
  requireTrustedSupervisorRenderer(event);
  if(!interactiveHtmlPreview)throw Error('interactive_preview_unavailable');
  const proof=readVerifiedHtmlPreview(payload);
  return interactiveHtmlPreview.open(proof);
});
registerUiHandler('ordax:preview:interactive:bounds',async(event,rect)=>{
  requireTrustedSupervisorRenderer(event);
  if(!interactiveHtmlPreview)return {visible:false};
  const positioned=interactiveHtmlPreview.bounds(rect);
  if(!positioned.visible)return positioned;
  const identity=interactiveHtmlPreview.owner;
  if(!identity)return positioned;
  try{
    const key={taskId:identity.taskId,assetId:identity.assetId};
    if(!interactiveHtmlPreview.renderReceiptRecorded){
      const observation=await interactiveHtmlPreview.observeRender();
      if(!observation||interactiveHtmlPreview.owner!==identity)return positioned;
      // Always rehash current bytes after rendering, never trust a past file.
      const proof=readVerifiedHtmlPreview(key);
      if(proof.sha256!==observation.sha256)return positioned;
      const receipt=orchestratorService.autonomous.recordBrowserRenderObservation(observation);
      if(receipt?.browserRenderObserved!==true||
         interactiveHtmlPreview.owner!==identity)return positioned;
      interactiveHtmlPreview.renderReceiptRecorded=true;
    }
    const proof=readVerifiedHtmlPreview(key);
    if(proof.sha256!==identity.sha256||
       interactiveHtmlPreview.owner!==identity)return positioned;
    const result={...positioned,browserRenderObserved:true,sha256:proof.sha256};
    if(!interactiveHtmlPreview.controlsReceiptRecorded){
      const observation=await interactiveHtmlPreview.observeControls(proof.html);
      if(observation&&interactiveHtmlPreview.owner===identity){
        // A changed file, project or Run invalidates the DOM control test.
        const current=readVerifiedHtmlPreview(key);
        if(current.sha256===observation.sha256){
          const recorded=orchestratorService.autonomous.recordBrowserControlsObservation(observation);
          if(recorded?.browserControls&&interactiveHtmlPreview.owner===identity)
            interactiveHtmlPreview.controlsReceiptRecorded=true;
        }
      }
    }
    if(interactiveHtmlPreview.controlsReceiptRecorded)
      result.browserControls=interactiveHtmlPreview.controlObservation?.report||null;
    return result;
  }catch{/* Missing/altered proof never creates a positive receipt. */}
  return positioned;
});
registerUiHandler('ordax:preview:interactive:close',(event,taskId)=>{
  requireTrustedSupervisorRenderer(event);
  if(interactiveHtmlPreview&&(!taskId||interactiveHtmlPreview.owner?.taskId===taskId))
    interactiveHtmlPreview.close();
  return {closed:true};
});
registerUiHandler('ordax:lab:interactive-preview:probe',async(event,payload={})=>{
  requireTrustedSupervisorRenderer(event);
  if(process.env.ORDAX_DESKTOP_DEBUG!=='1')
    throw Error('interactive_preview_probe_debug_only');
  if(!interactiveHtmlPreview)throw Error('interactive_preview_unavailable');
  return interactiveHtmlPreview.debugProbe(payload);
});
// Exact-profile attestation for Lab E2E: expose only an allowlisted hash, not
// filesystem paths, credentials or application data. This is read-only.
registerUiHandler('ordax:lab:build-proof', event => {
  requireTrustedSupervisorRenderer(event);
  return runtimeBuildProof;
});
registerUiHandler('ordax:lab:profile-proof', event => {
  requireTrustedSupervisorRenderer(event);
  return {schema:'ordax.lab.profile-proof.v1',
    fingerprint:labProfileFingerprint(app.getPath('userData'))};
});
registerUiHandler('ordax:provider:status', async () => {
  const base = worker.status();
  if (base.active) {
    const cached = providerHealthCache || { composer_ready:false, verification_required:false, auth_state:'loading' };
    return { ...cached, ...base, observer_mode:observerMode, worker_preload:workerPreload, health_pending:Boolean(providerHealthInFlight) };
  }
  if (!providerHealthInFlight) {
    providerHealthInFlight = worker.health()
      .then(status => { providerHealthCache = status; return status; })
      .finally(() => { providerHealthInFlight = null; });
  }
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), 900));
  const fresh = await Promise.race([providerHealthInFlight, timeout]);
  const status = fresh || providerHealthCache || { ...base, composer_ready:false, verification_required:false, auth_state:'loading' };
  return { ...status, observer_mode:observerMode, worker_preload:workerPreload, health_pending:!fresh };
});
registerUiHandler('ordax:provider:observer-mode:get', () => observerMode);
registerUiHandler('ordax:provider:observer-mode:set', (_event, mode) => {
  const next = String(mode || '').toLowerCase();
  if (!['auto','fast','beta'].includes(next)) throw new Error('invalid_observer_mode');
  observerMode = next;
  worker.setObserverMode(next);
  store.updateWorkspaceMetadata({ observer_mode: next });
  return next;
});
registerUiHandler('ordax:provider:diagnostic', async event => {
  requireTrustedSupervisorRenderer(event);
  // Read-only provider UI inspection; no API key, chat submission or disk write.
  return worker.inspectDiagnosticReadOnly();
});
registerUiHandler('ordax:forjador:groq-prompt', (event,projectId) => {
  requireTrustedSupervisorRenderer(event);
  if(typeof projectId!=='string'||!projectId)return null;
  // Both are local, read-only, last request only; no keys, storage or replay.
  const groq=lastGroqModelRequest?.projectId===projectId?lastGroqModelRequest:null;
  const gpt=lastGptDispatch?.projectId===projectId?lastGptDispatch:null;
  return groq||gpt?{groq,gpt}:null;
});
registerUiHandler('ordax:provider:mcp-selection', async event => {
  requireTrustedSupervisorRenderer(event);
  // UI markers are diagnostic, never proof of a selected tool invocation.
  if(hostBrowserMode)return {state:'unavailable',selectionObserved:false,invocationVerified:false};
  return worker.inspectMcpSelectionReadOnly();
});
registerUiHandler('ordax:provider:view-bounds', (event,rect) => {
  requireTrustedSupervisorRenderer(event);
  if(hostBrowserMode)throw new Error('provider_view_unavailable_on_host');
  providerViewBounds=rect&&typeof rect==='object'?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null;
  layoutViews();
  return Boolean(providerViewBounds&&chatVisible);
});
registerUiHandler('ordax:provider:navigate', async (event,direction) => {
  requireTrustedSupervisorRenderer(event);
  if(!['back','forward'].includes(direction))throw new Error('provider_navigation_invalid');
  if(liveRun||worker.active)throw new Error('provider_navigation_during_run_blocked');
  return worker.navigateHistory(direction);
});
registerUiHandler('ordax:provider:login', event => {
  requireTrustedSupervisorRenderer(event);
  if(hostBrowserMode)throw new Error('provider_login_requires_app_view');
  return worker.login();
});
registerUiHandler('ordax:provider:home', event => {
  requireTrustedSupervisorRenderer(event);
  if(liveRun||worker.active)throw new Error('provider_navigation_during_run_blocked');
  return worker.newChat();
});
registerUiHandler('ordax:provider:reload', async event => {
  requireTrustedSupervisorRenderer(event);
  if (liveRun || worker.active) throw new Error('provider_reload_during_run_blocked');
  return worker.reloadCurrentPage();
});
registerUiHandler('ordax:chat:visible', (event, visible) => {
  requireTrustedSupervisorRenderer(event);
  if(hostBrowserMode&&visible)throw new Error('provider_login_requires_app_view');
  chatVisible=Boolean(visible);
  layoutViews();
  return chatVisible&&Boolean(providerViewBounds);
});
registerUiHandler('ordax:tasks:send', async (event, { taskId, content, newSession = false, draftRevision = null, requestId = null }) => {
  requireTrustedSupervisorRenderer(event);
  const prompt = String(content || '').trim();
  if (!prompt) throw new Error('content_required');
  const binding=store.db.prepare('SELECT project_id FROM lab_task_bindings WHERE task_id=?').get(String(taskId));
  if(binding) {
    if(newSession)throw Error('orchestrator_explicit_rotation_required');
    const receipt=await orchestratorService.invoke(localOrchestratorContext,'work_send',{
      projectId:binding.project_id,taskId:String(taskId),content:prompt,
      requestId:requestId||randomUUID(),...(draftRevision!==null?{draftRevision}:{})});
    if(receipt.status==='failed')throw Error(receipt.result?.failureCode||'orchestrator_provider_not_submitted');
    if(receipt.status!=='succeeded')throw Error('orchestrator_reconciliation_required');
    return {task:getTaskView(taskId),command:receipt};
  }
  return enqueueExecution(String(taskId),runWorker => runTask(String(taskId), prompt, { newSession: Boolean(newSession), draftRevision },runWorker));
});


// LAB ONLY. No automatic model or chat execution while disabled.
let labSupervisor = null;
// The UI may prepare a key, but only an explicit dev enable flag permits a
// model call. Stored secrets never travel back through IPC.
const currentGroqKey=()=>groqCredential.read()||process.env.GROQ_API_KEY||null;
// Readable protected Groq key is the sole advisory availability source.
// Background project continuation and GPT sends retain separate authorizations.
const coordinatorChatEnabled=()=>Boolean(currentGroqKey());
// Normal Forjador chat is GPT-first. Groq remains an optional analytical port;
// an available Web worker is not proof of user login or a selected MCP app.
const coordinatorChatStatus=()=>({enabled:Boolean(worker),configured:Boolean(worker),
  groqConfigured:Boolean(currentGroqKey()),provider:'chatgpt_web',executionSurface:'electron'});
function requireLabSupervisor() {
  if (process.env.ORDAX_LAB_SUPERVISOR_ENABLE !== '1') throw new Error('supervisor_disabled');
  const apiKey=currentGroqKey();
  if (!apiKey) throw new Error('supervisor_api_key_missing');
  if (!labSupervisor) {
    labSupervisor = new SupervisorCoordinator({
      store, enabled:true, environment:"internal", actorId:"lab-owner",
      planner:createGroqSupervisorPlanner({ apiKey }),
      authorizeTask: scope => authorizeLocalSupervisorTask({ store, ...scope }),
      chat:{ send:async ({ taskId,content }) => {
        const reply = await enqueueExecution(taskId,runWorker => runTask(taskId,content,{newSession:false},runWorker));
        return chatReceiptFromRunTask(reply);
      } }
    });
  }
  return labSupervisor;
}

// Only the Lab's trusted local UI or authenticated host session can invoke supervisor IPC.
function requireTrustedSupervisorRenderer(event) {
  const trustedHostRequest=event?.[hostBrowserRequest]===true&&hostBrowserMode&&Boolean(hostBrowserServer);
  if (!win || win.isDestroyed() || event?.sender !== win.webContents ||
      (!trustedHostRequest&&(
      !event?.senderFrame || event.senderFrame !== win.webContents.mainFrame ||
      event.senderFrame.url !== pathToFileURL(path.join(here, 'ui.html')).href))) {
    throw new Error('supervisor_ipc_sender_denied');
  }
}

async function confirmInActiveUi({title,message,detail,approveLabel='Confirmar',cancelLabel='Cancelar'}) {
  if(hostBrowserMode) {
    if(!hostBrowserServer)return false;
    return hostBrowserServer.confirm({title,message,detail,approveLabel,cancelLabel});
  }
  const choice=await dialog.showMessageBox(win,{type:'question',title,message,detail,
    buttons:[approveLabel,cancelLabel],defaultId:1,cancelId:1,noLink:true});
  return choice.response===0;
}

// One App service for native UI and the MCP adapter. The fixed identity is
// local-only; it is NOT exported as authentication for a remote MCP endpoint.
let localOrchestratorContext=null;
// Latest exact Groq model messages kept only in memory for the owner DEV
// inspector. No API keys, authorization headers, disk logs or remote MCP.
let lastGroqModelRequest=null;
let lastGptDispatch=null;
let runtimeOrchestratorBridge=null;
let closeRuntimeOrchestratorPipe=null;
const orchestratorKernel=createOrchestratorKernel({
  store,version:app.getVersion(),fileBroker:forgeProjectFiles,
  // Reuse the exact preview's path, symlink, structure and SHA-256 verifier.
  // Never return HTML bytes to Groq or grant arbitrary file reads.
  verifyLocalArtifact:({taskId,assetId})=>{
    const proof=readVerifiedHtmlPreview({taskId,assetId});
    return {verified:true,sha256:proof.sha256,bytes:proof.bytes,
      verification:'local_bytes_and_structure'};
  },
  // Destructive project deletion is authorized only from the local UI owner,
  // never delegated through the Runtime MCP bridge (even if a remote grant exists).
  authorize:({context,operation})=>context===localOrchestratorContext||
    (!['project_delete','forjador_send'].includes(operation)&&
      runtimeOrchestratorBridge?.allows(context,operation)===true),
  confirmProposalSend:async({title,content})=>confirmInActiveUi({
    title:'Confirmar primeiro envio ao ChatGPT',message:title,
    detail:'Mensagem exata a enviar:\n\n'+content+'\n\nSerá enviada uma única mensagem pelo executor do App. Uma resposta observada não comprova alterações em arquivos ou outros efeitos.',
    approveLabel:'Enviar ao ChatGPT'
  }),
  confirmProposal:async({proposal})=>confirmInActiveUi({
    title:'Revisar nova frente',message:proposal.title,
    detail:proposal.reason+'\n\nPrimeira mensagem (rascunho):\n'+proposal.content+'\n\nEsta ação cria uma frente local e salva o rascunho. Não envia ao ChatGPT.',
    approveLabel:'Criar frente com rascunho'
  }),
  provider:{busy:()=>Boolean(liveRun||worker?.active||providerScheduler?.snapshot().pendingTasks),
    ready:async()=>{assertProviderSendReadiness(await worker.health());return true;},
    send:async({taskId,content,draftRevision,taskKind,authorSource='human'})=>{
      const execution=await enqueueExecution(taskId,runWorker=>runTask(taskId,content,{
        newSession:false,draftRevision,allowCoordinatorTask:taskKind==='orchestrator',authorSource
      },runWorker));
      // Completion is the ONLY automatic capture trigger. An interrupted
      // Run, model proposal, failed send or historical recovery never triggers
      // a download, and a missing official file card never becomes a result.
      if(shouldAttemptAutomaticHtmlCapture({
        authorSource,runId:execution?.result?.runId,text:execution?.result?.text,userRequest:content
      })){
        let verifiedSha=null;
        try{
          const captured=await captureConfirmedHtmlArtifact(taskId);
          if(captured?.verified){
            verifiedSha=captured.sha256;
            execution.task=getTaskView(taskId);
          }
        }catch{
          // No file card or an invalid download cannot be called a site
          // delivery. A GPT answer is preserved; no repeat send is allowed.
          try{store.event(taskId,'provider.artifact.auto_capture_unavailable',{
            run_id:execution.result.runId,reason:'attachment_not_verified'
          });}catch{}
        }
        try{
          orchestratorService.recordSiteDelivery({
            taskId,runId:execution.result.runId,
            verified:Boolean(verifiedSha),sha256:verifiedSha
          });
          notifyOrchestratorChanged();
        }catch{
          // A delivery notification never changes the already confirmed
          // provider Run or launches a second provider request.
        }
      }
      return chatReceiptFromRunTask(execution);
    }},
  coordinator:createGroqCoordinatorConversation({store,getApiKey:currentGroqKey,
    isEnabled:coordinatorChatEnabled,
    onModelRequest:payload=>{lastGroqModelRequest=payload;}})
});
localOrchestratorContext=orchestratorKernel.context;
const {service:orchestratorService,mcp:localOrchestratorMcp}=orchestratorKernel;
const forgeMcpTrusted=new ForgeMcpOwnerTrust({store,
  scopeSignature:projectId=>{
    const binding=forgeLocalWorkspaces.binding(projectId);
    if(!binding)return 'app-private:'+projectId;
    if(!forgeLocalWorkspaces.status(projectId).verified)
      throw Error('forge_mcp_trust_workspace_unverified');
    return 'owner-bound:'+binding.root+':'+binding.identity;
  }
});
const forgeLocalMcp=createForgeLoopbackMcp({
  createMcp:({projectId,allowedOperations})=>createOrchestratorMcp({
    service:orchestratorService,getContext:()=>localOrchestratorContext,
    version:app.getVersion(),allowedProjectId:projectId,allowedOperations
  }),
  authorizeProject:projectId=>{
    try{orchestratorService.requireAccess(localOrchestratorContext,
      'project_file_read',projectId);
      return forgeMcpTrusted.isTrusted(projectId);
    }catch{return false;}
  }
});
orchestratorService.autonomous.setNotifier(()=>notifyOrchestratorChanged());
orchestratorService.recoverInterruptedCommands();
// Off by default. This inherited private pipe is NOT a public MCP endpoint.
// A Runtime launcher must supply the first bootstrap AFTER canonical owner
// authorization and verify the returned build/profile identity independently.
if(runtimeTransportRequest) {
  if(process.env.ORDAX_LAB_RUNTIME_BRIDGE_ENABLE!=='1')
    throw Error('orchestrator_host_launch_not_authorized');
  runtimeOrchestratorBridge=createOrchestratorRuntimeBridge({service:orchestratorService,
    workspaceSessionId:store.getWorkspaceSession().id,buildProof:runtimeBuildProof,
    profileFingerprint:labProfileFingerprint(app.getPath('userData'))});
  const streams=openOrchestratorRuntimeStreams(runtimeTransportRequest);
  const detach=attachOrchestratorRuntimePipes({...streams,bridge:runtimeOrchestratorBridge});
  closeRuntimeOrchestratorPipe=()=>{detach();streams.close();};
}
// Capture the App-owned asset scope before the SQLite deletion cascades. This
// never includes external project paths or arbitrary computer files.
function projectAssetCleanupScope(projectId){
  if(typeof projectId!=='string'||!projectId.startsWith('project_'))return null;
  const taskIds=store.db.prepare('SELECT task_id FROM lab_task_bindings WHERE project_id=?').all(projectId)
    .map(row=>row.task_id);
  const assetPaths=store.db.prepare(`SELECT a.local_path FROM message_assets a
    JOIN lab_task_bindings b ON b.task_id=a.task_id WHERE b.project_id=?`).all(projectId)
    .map(row=>row.local_path);
  return {assetsRoot,taskIds,assetPaths};
}
function withDeletedProjectAssetCleanup(receipt,scope){
  if(receipt?.status!=='succeeded'||receipt?.result?.deleted!==true||!scope?.taskIds.length)return receipt;
  let localAssetCleanup;
  try{localAssetCleanup=pruneDeletedProjectAssets(scope);}
  catch{localAssetCleanup={filesRemoved:0,foldersRemoved:0,
    filesPending:scope.assetPaths.length,entriesRemaining:scope.taskIds.length};}
  return {...receipt,result:{...receipt.result,localAssetCleanup}};
}
// Local folder authority is created only by the trusted Windows owner UI.
// Model-provided paths, MCP calls and a stored GitHub URL cannot create grants.
registerUiHandler('ordax:forge:workspace:status',(event,projectId)=>{
  requireTrustedSupervisorRenderer(event);
  if(hostBrowserMode)throw Error('forge_workspace_native_ui_only');
  orchestratorService.requireAccess(localOrchestratorContext,'project_files_status',projectId);
  return forgeLocalWorkspaces.status(projectId);
});
registerUiHandler('ordax:forge:workspace:create',(event,projectId)=>{
  requireTrustedSupervisorRenderer(event);
  if(hostBrowserMode)throw Error('forge_workspace_native_ui_only');
  orchestratorService.requireAccess(localOrchestratorContext,'project_file_write',projectId);
  return forgeLocalWorkspaces.createDefault(projectId);
});
registerUiHandler('ordax:forge:workspace:choose',async(event,projectId)=>{
  requireTrustedSupervisorRenderer(event);
  if(hostBrowserMode)throw Error('forge_workspace_native_ui_only');
  orchestratorService.requireAccess(localOrchestratorContext,'project_file_write',projectId);
  const current=forgeLocalWorkspaces.status(projectId);
  if(current.configured)throw Error('forge_workspace_already_bound');
  const chosen=await dialog.showOpenDialog(win,{
    title:'Selecionar a pasta oficial deste projeto Forge',
    // Staged verification must never open the owner's real Documents by
    // default. The native owner may choose a folder explicitly only after
    // the ordinary binding and overlap checks.
    defaultPath:stagedProfile
      ?(fs.existsSync(forgeLocalWorkspaces.base)
        ?forgeLocalWorkspaces.base:path.dirname(userRoot))
      :app.getPath('documents'),
    properties:['openDirectory'],
    buttonLabel:'Vincular esta pasta'
  });
  if(chosen.canceled||chosen.filePaths.length!==1)return {cancelled:true};
  // Local authorized UI can select a directory, but cannot add authority
  // to another project or mutate the root after a prior successful grant.
  orchestratorService.requireAccess(localOrchestratorContext,'project_file_write',projectId);
  return forgeLocalWorkspaces.bindSelected(projectId,chosen.filePaths[0]);
});
registerUiHandler('ordax:forge:workspace:migrate',async(event,projectId)=>{
  requireTrustedSupervisorRenderer(event);
  if(hostBrowserMode)throw Error('forge_workspace_native_ui_only');
  orchestratorService.requireAccess(localOrchestratorContext,'project_file_write',projectId);
  const status=forgeLocalWorkspaces.status(projectId);
  if(status.configured||!status.legacyMigrationRequired)
    throw Error('forge_workspace_migration_not_applicable');
  const accepted=await confirmInActiveUi({
    title:'Migrar arquivos antigos do Forge',
    message:'Mover os arquivos privados anteriores para a pasta oficial deste projeto?',
    detail:'Os arquivos serão MOVIMENTADOS (não copiados) para Documentos/Forge. O Forge verifica SHA-256 e vincula a pasta ao projeto existente no mesmo SQLite. A operação não altera conversas, credenciais ou outros projetos. Se a pasta estiver em outro disco ou a verificação falhar, o movimento será bloqueado ou revertido.',
    approveLabel:'Migrar arquivos'
  });
  if(!accepted)return {cancelled:true};
  orchestratorService.requireAccess(localOrchestratorContext,'project_file_write',projectId);
  return forgeLocalWorkspaces.migrateLegacy(projectId);
});
// Local MCP is explicitly enabled only from the trusted Electron settings UI.
// Activation returns a one-time bearer token; status never returns it.
registerUiHandler('ordax:forge:local-mcp:status',event=>{
  requireTrustedSupervisorRenderer(event);
  if(hostBrowserMode)throw Error('forge_mcp_local_ui_only');
  return {...forgeLocalMcp.status(),trustedProjects:forgeMcpTrusted.trustedProjects()};
});
registerUiHandler('ordax:forge:local-mcp:start',async(event,projectId)=>{
  requireTrustedSupervisorRenderer(event);
  if(hostBrowserMode)throw Error('forge_mcp_local_ui_only');
  orchestratorService.requireAccess(localOrchestratorContext,'project_file_read',projectId);
  if(!forgeMcpTrusted.isTrusted(projectId)&&
      !await confirmInActiveUi({title:'Habilitar MCP Forge local',
    message:'Confiar neste projeto para futuras conexões MCP locais até revogar?',
    detail:'Conexão exclusiva a 127.0.0.1, chave temporária, vale até revogar ou fechar o Forge; a chave permanece somente na memória e a confiança fica no SQLite sem tokens. Permite leitura e escrita somente no workspace atual deste projeto, quando vinculado e verificado. Não concede acesso a outras pastas, não publica na internet e não conecta automaticamente ao GPT Web.',
    approveLabel:'Confiar e habilitar'}))return {running:false,declined:true};
  const previouslyTrusted=forgeMcpTrusted.isTrusted(projectId);
  if(!previouslyTrusted)forgeMcpTrusted.trust(projectId);
  try{return {...await forgeLocalMcp.start(projectId),trusted:true};}
  catch(error){if(!previouslyTrusted)forgeMcpTrusted.revoke(projectId);throw error;}
});
// One loopback endpoint can host multiple owner-authorized projects, but
// never grants a second project implicitly or shares its bearer/session.
registerUiHandler('ordax:forge:local-mcp:add',async(event,projectId)=>{
  requireTrustedSupervisorRenderer(event);
  if(hostBrowserMode)throw Error('forge_mcp_local_ui_only');
  orchestratorService.requireAccess(localOrchestratorContext,'project_file_read',projectId);
  if(!forgeLocalMcp.status().running)throw Error('forge_mcp_not_active');
  if(!forgeMcpTrusted.isTrusted(projectId)&&
      !await confirmInActiveUi({title:'Autorizar projeto no MCP Forge',
    message:'Confiar também neste projeto para futuras conexões MCP locais?',
    detail:'O servidor local permanece na mesma porta. Este projeto terá token e sessões exclusivos até revogação ou fechamento do Forge. A autorização não inclui outros projetos, não publica na internet e não conecta automaticamente ao GPT Web.',
    approveLabel:'Confiar neste projeto'}))return {declined:true};
  orchestratorService.requireAccess(localOrchestratorContext,'project_file_read',projectId);
  const previouslyTrusted=forgeMcpTrusted.isTrusted(projectId);
  if(!previouslyTrusted)forgeMcpTrusted.trust(projectId);
  try{return {...forgeLocalMcp.addProject(projectId),trusted:true};}
  catch(error){if(!previouslyTrusted)forgeMcpTrusted.revoke(projectId);throw error;}
});
registerUiHandler('ordax:forge:local-mcp:revoke',async(event,projectId)=>{
  requireTrustedSupervisorRenderer(event);
  if(hostBrowserMode)throw Error('forge_mcp_local_ui_only');
  // An unavailable project must never prevent the Owner from revoking trust.
  if(forgeLocalMcp.status().scopes.includes(projectId))
    await forgeLocalMcp.revokeProject(projectId);
  const forgotten=forgeMcpTrusted.revoke(projectId);
  return {...forgeLocalMcp.status(),...forgotten,
    trustedProjects:forgeMcpTrusted.trustedProjects()};
});
registerUiHandler('ordax:forge:local-mcp:stop',async event=>{
  requireTrustedSupervisorRenderer(event);
  if(hostBrowserMode)throw Error('forge_mcp_local_ui_only');
  return forgeLocalMcp.stop();
});
registerUiHandler('ordax:orchestrator:invoke',async(event,payload)=>{
  requireTrustedSupervisorRenderer(event);
  const scope=payload?.operation==='project_delete'?projectAssetCleanupScope(payload?.input?.projectId):null;
  const receipt=await orchestratorService.invoke(localOrchestratorContext,payload?.operation,payload?.input??{});
  let result=withDeletedProjectAssetCleanup(receipt,scope);
  // New projects receive a real workspace at the Windows Documents known
  // folder. The DB project survives a filesystem failure, but the UI must
  // report the failure, never claim a workspace that was not verified.
  if(['project_create','project_quick_create','mission_create'].includes(payload?.operation)&&
      receipt?.status==='succeeded'&&typeof receipt?.result?.projectId==='string'){
    let workspaceSetup;
    try{workspaceSetup=forgeLocalWorkspaces.createDefault(receipt.result.projectId);}
    catch(error){workspaceSetup={configured:false,blocked:true,
      reason:String(error?.message||'forge_workspace_creation_failed').slice(0,120)};}
    result={...result,result:{...result.result,workspaceSetup}};
  }
  if(ORCHESTRATOR_TOOLS.some(t=>t.operation===payload?.operation&&!t.readOnly)&&win&&!win.isDestroyed())
    emitRendererEvent('ordax:orchestrator:changed');
  return result;
});
// Local protocol conformance/host integration entrypoint, never arbitrary eval.
registerUiHandler('ordax:orchestrator:mcp',async(event,message)=>{
  requireTrustedSupervisorRenderer(event);
  const deleting=message?.method==='tools/call'&&message?.params?.name==='orchestrator_project_delete';
  const scope=deleting?projectAssetCleanupScope(message?.params?.arguments?.projectId):null;
  let result=await localOrchestratorMcp.handle(message);
  if(deleting&&result?.result?.structuredContent){
    const receipt=withDeletedProjectAssetCleanup(result.result.structuredContent,scope);
    result={...result,result:{...result.result,structuredContent:receipt,
      content:[{type:'text',text:JSON.stringify(receipt)}]}};
  }
  if(message?.method==='tools/call'&&ORCHESTRATOR_TOOLS.some(t=>t.name===message.params?.name&&!t.readOnly)&&win&&!win.isDestroyed())
    emitRendererEvent('ordax:orchestrator:changed');
  return result;
});

// A confirmed delayed GPT reply is not another send. The canonical
// reconciler has already attested the original Run; only a hash-verified
// file on that SAME reply can produce a natural completion message.
async function finalizeReconciledSiteDelivery(taskId,{captureMissing=false}={}){
  const run=store.db.prepare('SELECT id,status FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 1')
    .get(taskId);
  if(run?.status!=='succeeded'||!store.db.prepare(`SELECT 1 FROM events
      WHERE task_id=? AND kind='provider.response.reconciled'
        AND json_extract(payload,'$.run_id')=? LIMIT 1`).get(taskId,run.id))
    return false;
  let current=store.db.prepare(`SELECT a.local_path,a.sha256
      FROM message_assets a JOIN messages m ON m.id=a.message_id
      WHERE m.task_id=? AND m.role='assistant'
        AND m.sequence=(SELECT MAX(sequence) FROM messages WHERE task_id=? AND role='assistant')
        AND a.kind='file' AND a.mime_type='text/html'
      ORDER BY a.rowid DESC LIMIT 1`).get(taskId,taskId);
  if(!current&&captureMissing){
    try{await captureConfirmedHtmlArtifact(taskId);}
    catch{} // No official card, no invented site and no second GPT request.
    current=store.db.prepare(`SELECT a.local_path,a.sha256
      FROM message_assets a JOIN messages m ON m.id=a.message_id
      WHERE m.task_id=? AND m.role='assistant'
        AND m.sequence=(SELECT MAX(sequence) FROM messages WHERE task_id=? AND role='assistant')
        AND a.kind='file' AND a.mime_type='text/html'
      ORDER BY a.rowid DESC LIMIT 1`).get(taskId,taskId);
  }
  let verified=false;
  if(current){
    try{
      const root=fs.realpathSync.native(assetsRoot);
      const real=fs.realpathSync.native(assertLocalArtifactPath(assetsRoot,current.local_path));
      assertLocalArtifactPath(root,real);
      verified=verifyLocalHtmlArtifact(real).sha256===current.sha256;
    }catch{verified=false;}
  }
  // This is a user-visible fact, not a model-generated proposal.
  orchestratorService.recordSiteDelivery({
    taskId,runId:run.id,verified,sha256:verified?current.sha256:null
  });
  const resumed=orchestratorService.autonomous.resumeReconciledTechnical(localOrchestratorContext);
  notifyOrchestratorChanged();
  if(resumed)queueMicrotask(()=>{
    void orchestratorService.autonomous.tick(localOrchestratorContext).catch(()=>{});
  });
  return verified;
}

function notifyOrchestratorChanged(){
  if(win&&!win.isDestroyed())emitRendererEvent('ordax:orchestrator:changed');
}
// Preserve evidence after an app restart. Reconcile ONLY finished Runs with
// a previously attested same-thread reply; no provider request, navigation or
// raw HTML injection occurs during startup.
void app.whenReady().then(async()=>{
  const completed=store.db.prepare(`SELECT r.task_id AS taskId
    FROM runs r JOIN lab_task_bindings b ON b.task_id=r.task_id AND b.kind='work'
    WHERE r.status='succeeded' AND
      r.rowid=(SELECT MAX(x.rowid) FROM runs x WHERE x.task_id=r.task_id)
      AND EXISTS(SELECT 1 FROM events e WHERE e.task_id=r.task_id
        AND e.kind='provider.response.reconciled'
        AND json_extract(e.payload,'$.run_id')=r.id)
    ORDER BY r.rowid DESC LIMIT 8`).all();
  for(const row of completed)
    await finalizeReconciledSiteDelivery(row.taskId,{captureMissing:false})
      .catch(()=>{});
}).catch(()=>{});
registerUiHandler('ordax:orchestrator:chat-status',event=>{
  requireTrustedSupervisorRenderer(event);
  return coordinatorChatStatus();
});
registerUiHandler('ordax:background:status',event=>{
  requireTrustedSupervisorRenderer(event);
  return backgroundState();
});
registerUiHandler('ordax:app:quit',event=>{
  requireTrustedSupervisorRenderer(event);
  // Exit the actual owner process even when background residence is enabled.
  // A live GPT Run is interrupted by the existing close transaction.
  quittingIntentionally=true;
  setImmediate(()=>app.quit());
  return {accepted:true};
});
registerUiHandler('ordax:background:set',async(event,value)=>{
  requireTrustedSupervisorRenderer(event);
  const enabled=backgroundModeRequested(value);
  if(!backgroundSupported)throw Error('background_mode_unavailable');
  if(enabled&&!(await ensureBackgroundTray()))
    throw Error('background_tray_unavailable');
  backgroundOptedIn=enabled;
  store.updateWorkspaceMetadata({keep_running_in_background:enabled});
  updateLoginStartup(enabled);
  if(!enabled&&backgroundTray){backgroundTray.destroy();backgroundTray=null;}
  return backgroundState();
});
registerUiHandler('ordax:supervisor:status', (event) => {
  requireTrustedSupervisorRenderer(event);
  return ({
  enabled:process.env.ORDAX_LAB_SUPERVISOR_ENABLE === '1' && Boolean(currentGroqKey()),
  configured:Boolean(currentGroqKey()),
  keySaved:groqCredential.hasSaved(),
  secureStorageAvailable:groqCredential.isAvailable(),
  environment:"internal", requires_owner_approval:true, version:app.getVersion()
  });
});
// Credential operations are local-only: no validation network request and no
// automatic activation. A key never appears in any status response or event.
registerUiHandler('ordax:supervisor:key:save',(event,key)=>{
  requireTrustedSupervisorRenderer(event);
  const result=groqCredential.save(key);
  labSupervisor=null;
  notifyOrchestratorChanged();
  return result;
});
registerUiHandler('ordax:supervisor:key:test',async(event)=>{
  requireTrustedSupervisorRenderer(event);
  return testGroqApiKey({apiKey:currentGroqKey()});
});
registerUiHandler('ordax:supervisor:key:remove',(event)=>{
  requireTrustedSupervisorRenderer(event);
  const result=groqCredential.remove();
  labSupervisor=null;
  notifyOrchestratorChanged();
  return result;
});
registerUiHandler('ordax:tasks:supervisor-role:set',(event,payload)=>{
  requireTrustedSupervisorRenderer(event);
  return store.setTaskSupervisorRole(String(payload?.taskId||''),payload?.role);
});
registerUiHandler('ordax:supervisor:plan', (event,payload) => {
  requireTrustedSupervisorRenderer(event);
  return requireLabSupervisor().plan({
  taskId:payload?.taskId,requestId:payload?.requestId,objective:payload?.objective
  });
});
registerUiHandler('ordax:supervisor:recoverable', (event,payload) => {
  requireTrustedSupervisorRenderer(event);
  // Recovery must work after restart without Groq keys or enabled supervisor.
  return listLocalSupervisorRecoverable({store,taskId:payload?.taskId});
});
registerUiHandler('ordax:supervisor:inspect', async (event,payload) => {
  requireTrustedSupervisorRenderer(event);
  if (liveRun) return {kind:'unavailable',reason:'another_run_active',requiresReconciliation:true};
  // Local, manual, read-only examination; no Groq key or auto-execution required.
  return inspectSupervisorChatReadOnly({
    store,worker,taskId:payload?.taskId,actionId:payload?.actionId
  });
});
registerUiHandler('ordax:supervisor:approve', async (event,payload) => {
  requireTrustedSupervisorRenderer(event);
  const controller = requireLabSupervisor();
  // The proposed text belongs to a potentially different workspace.
  // Authorize before reading it or showing it in an owner-approval dialog.
  controller.authorize(payload?.taskId, 'approve');
  const row = store.db.prepare(
    'SELECT result,status FROM action_ledger WHERE id=? AND task_id=? AND action_type=?'
  ).get(payload?.actionId,payload?.taskId,'supervisor.plan');
  if (row?.status !== 'pending_approval') throw new Error('approval_not_pending');
  const decision = JSON.parse(row.result).decision;
  if (decision?.type !== 'send_message') throw new Error('not_a_message_plan');
  const approved=await confirmInActiveUi({
    title:'OrdaX Lab — aprovação humana',message:'Autoriza enviar esta mensagem ao ChatGPT?',
    detail:decision.content,approveLabel:'Aprovar mensagem'
  });
  if (!approved) return {approved:false};
  return { approved:true, ...(controller.approve({
    taskId:payload?.taskId,actionId:payload?.actionId,
    approvalId:payload?.approvalId,explicitOwnerApproval:true
  })) };
});
registerUiHandler('ordax:supervisor:dispatch', (event,payload) => {
  requireTrustedSupervisorRenderer(event);
  return requireLabSupervisor().dispatch({taskId:payload?.taskId,actionId:payload?.actionId});
});
let continuationTimer=null;
let providerRecoveryInFlight=false;
app.whenReady().then(async () => {
  hostStartupLog('electron_ready');
  protocol.handle('ordax-asset', request => {
    try {
      const url = new URL(request.url);
      const id = decodeURIComponent(url.pathname.replace(/^\//, ''));
      const asset = store.getAsset(id);
      // Untrusted HTML or other generated files must NEVER be served through
      // the in-app asset origin. Only the dedicated reveal action may expose
      // their location; no HTML execution is implicit.
      if (!asset || asset.kind!=='image'||!MIME_EXT.has(asset.mime_type))
        return new Response('Not found', { status: 404 });

      const resolved = path.resolve(asset.local_path);
      const safeRoot = path.resolve(assetsRoot) + path.sep;
      if (!resolved.startsWith(safeRoot) || !fs.existsSync(resolved)) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(resolved).href);
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  await createWindow();
  if(backgroundOptedIn){
    const trayReady=await ensureBackgroundTray();
    if(!trayReady&&win&&!win.isDestroyed())win.show();
  }
  hostStartupLog('window_ready');
  // Observe completed Runs even when the coordinator chat is not selected.
  // Bound to this App lifetime; does not promise a headless 24h supervisor.
  continuationTimer=setInterval(()=>{
    void (async()=>{
      try {
        const autonomous=await orchestratorService.autonomous.tick(localOrchestratorContext);
        if(autonomous.state==='advanced'||autonomous.state==='blocked'||autonomous.state==='reconciliation_required')notifyOrchestratorChanged();
        // Never compete with an active autonomous mission for the same GPT executor.
        if(['advanced','busy','executor_busy'].includes(autonomous.state))return;
        const result=await orchestratorService.continuation.tick(localOrchestratorContext);
        if(result.state==='analyzed'||result.state==='reconciliation_required')notifyOrchestratorChanged();
      } catch {}
      // Use the existing app-lifetime supervisor tick. Recovery is restricted
      // to an uncertain Run whose exact linked GPT thread is already visible;
      // it performs bounded, read-only observations and never re-sends.
      if(providerRecoveryInFlight||liveRun||
          store.db.prepare("SELECT 1 FROM runs WHERE status='running' LIMIT 1").get()||
          store.db.prepare("SELECT 1 FROM lab_command_receipts WHERE status='running' LIMIT 1").get()||
          orchestratorService.provider?.busy?.()===true)return;
      providerRecoveryInFlight=true;
      try {
        const recovery=await recoverVisibleLinkedProviderSubmission({store,worker});
        if(recovery.state==='recovered') {
          emitRendererEvent('ordax:task:reconciled',{
            taskId:recovery.taskId,runId:recovery.runId
          });
          notifyOrchestratorChanged();
        }
      } catch {} finally {providerRecoveryInFlight=false;}
    })().catch(()=>{});
  },10000);
}).catch(()=>{
  hostStartupLog('startup_failed');
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit',()=>{quittingIntentionally=true;});
app.on('will-quit', () => {
  if(backgroundTray){backgroundTray.destroy();backgroundTray=null;}
  if(continuationTimer)clearInterval(continuationTimer);
  void hostBrowserServer?.close();
  void forgeLocalMcp.stop();
  closeRuntimeOrchestratorPipe?.();
  store.close();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
