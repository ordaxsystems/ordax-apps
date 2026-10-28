import { app, BrowserWindow, ipcMain, protocol, net, dialog, safeStorage } from 'electron';
import path from 'node:path';import { SupervisorCoordinator, authorizeLocalSupervisorTask, listLocalSupervisorRecoverable } from '../supervisor/coordinator.mjs';
import { inspectSupervisorChatReadOnly } from '../supervisor/read-only-reconcile.mjs';
import { chatReceiptFromRunTask } from '../src/supervisor-chat-receipt.mjs';
import { bindObservedSubmittedConversation } from '../src/provider-submitted-conversation.mjs';
import { recordProviderSubmissionProvenance, findProviderSubmissionProvenance } from '../src/provider-submission-provenance.mjs';
import { assertTaskHasNoUncertainTransport } from '../src/provider-uncertain-run-policy.mjs';
import { assertProviderSendReadiness, normalizeProviderFailure } from '../src/provider-observation-policy.mjs';
import { assessProviderConversationEvidence } from '../src/provider-conversation-reconciliation.mjs';
import { safeHistoricalThreadFailure } from '../src/provider-observation-policy.mjs';
import { safeTaskNavigationReason } from '../src/task-navigation-status.mjs';
import { createGroqSupervisorPlanner } from '../supervisor/groq-planner.mjs';
import { createLocalGroqCredential } from '../src/local-supervisor-credential.mjs';
import { OrchestratorService } from '../src/orchestrator-service.mjs';
import { createOrchestratorMcp } from '../src/orchestrator-mcp.mjs';
import { ORCHESTRATOR_TOOLS } from '../src/orchestrator-contract.mjs';
import { createOrchestratorRuntimeBridge,attachOrchestratorRuntimePipes,resolveOrchestratorRuntimeTransport,openOrchestratorRuntimeStreams } from '../src/orchestrator-runtime-bridge.mjs';
import { createGroqCoordinatorConversation } from '../supervisor/groq-conversation.mjs';
import { projectCoordinatorContinuationEnabled } from '../src/project-coordinator-continuation.mjs';

import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { Store, MESSAGE_PAGE_SIZE } from '../src/store.mjs';
import { planProviderConversation, assessProviderRotation, canonicalProviderChatUrl } from '../src/conversation-policy.mjs';
import { EmbeddedChatWorker } from './embedded-worker.mjs';
import { createProviderProvisionalRecorder } from '../src/provider-provisional-recorder.mjs';
import { resolveLabUserRoot, labProfileFingerprint } from '../src/lab-profile-binding.mjs';
import { verifyRuntimeManifest } from '../src/runtime-build-identity.mjs';

if (process.env.ORDAX_DESKTOP_DEBUG === '1') {
  app.commandLine.appendSwitch('remote-debugging-port', '9445');
}

const runtimeTransportRequest=resolveOrchestratorRuntimeTransport();
app.setName('OrdaX Orchestrator Lab');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const hostBrowserMode=!app.isPackaged&&(process.env.ORDAX_HOST_BROWSER_UI==='1'||process.argv.includes('--host-browser'));
let createHostBrowserServer=null;
if(hostBrowserMode)({createHostBrowserServer} = await import('./host-browser-server.mjs'));
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
const {userRoot} = resolveLabUserRoot({
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
  app.on('second-instance', () => {
    if(hostBrowserMode)return;
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}


const dataRoot = path.join(userRoot, 'data');
const assetsRoot = path.join(dataRoot, 'assets');
fs.mkdirSync(assetsRoot, { recursive: true });

protocol.registerSchemesAsPrivileged([
  { scheme: 'ordax-asset', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

const store = new Store(path.join(dataRoot, 'ordax-orchestrator-lab.sqlite'));
const recoveredRunCount = store.recoverInterruptedRuns();
store.updateWorkspaceMetadata({
  last_started_at: new Date().toISOString(),
  recovered_runs_on_start: recoveredRunCount,
  sqlite_open_retries: store.openRetryCount
});

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
  'ordax:task:stream':'task-stream'
});
function emitRendererEvent(channel,payload) {
  if(win&&!win.isDestroyed())win.webContents.send(channel,payload);
  const hostEvent=HOST_EVENT_BY_CHANNEL[channel];
  if(hostEvent)hostBrowserServer?.publish(hostEvent,payload);
}
let chatVisible = false;
let liveRun = null;
const persistedObserverMode = store.getWorkspaceSession()?.metadata?.observer_mode;
let observerMode = ['auto','fast','beta'].includes(persistedObserverMode) ? persistedObserverMode : 'auto';
let workerPreload = { ready:false, url:null, at:null };
let providerHealthInFlight = null;
let providerHealthCache = null;
let executionTail = Promise.resolve();
const LEFT_WIDTH = 470;

function enqueueExecution(operation) {
  const next = executionTail.then(operation, operation);
  executionTail = next.catch(() => {});
  return next;
}

function assetUrl(id) {
  return `ordax-asset://local/${encodeURIComponent(id)}`;
}

function decorateMessages(messages) {
  return messages.map(message => ({
    ...message,
    assets: (message.assets || []).map(asset => ({ ...asset, url: assetUrl(asset.id) }))
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

async function runTask(taskId, prompt, { newSession = false, draftRevision = null } = {}) {
  orchestratorService.assertProviderTaskAvailable(taskId);
  // Before appending another user message or starting another Run, require
  // reconciliation of any earlier uncertain transport effect on this Task.
  // The single existing Store is authoritative; this performs no replay.
  assertTaskHasNoUncertainTransport(store,taskId);
  const task = store.getTaskExecutionSnapshot(taskId);
  if (!task) throw new Error('task_not_found');

  const conversationPlan = planProviderConversation(task, { forceNew:newSession });
  const needsContinuation = Boolean(conversationPlan.newSession && task.has_messages);
  const checkpointVersion = task.checkpoint_version;
  const providerPrompt = needsContinuation ? store.buildContinuationPrompt(taskId, prompt) : prompt;
  // Authoritative, fresh, read-only readiness gate BEFORE any Task/Run/message
  // mutation or draft clearing. A signed-out/unknown provider creates no Run.
  // Worker.sendPrompt independently checks again immediately before editing.
  try { assertProviderSendReadiness(await worker.health()); }
  catch(error) { throw normalizeProviderFailure(error,{stage:'health'}); }
  // No provider interaction happens until this atomic transaction commits.
  // The message, draft-clear and Run must never be persisted separately.
  const { userMessage, runId } = store.beginProviderRun(taskId, prompt, {
    draftRevision,workerId:'electron-embedded-chatgpt',observerMode
  });
  liveRun = { taskId, runId, startedAt:Date.now(), firstDeltaAt:null };
  const provisional=createProviderProvisionalRecorder({
    save:(text,source)=>store.saveRunProvisionalOutput(taskId,runId,text,source)
  });
  if (win && !win.isDestroyed()) emitRendererEvent('ordax:task:run-started', { taskId, runId, userMessage });
  const heartbeat = setInterval(() => store.heartbeatRun(taskId, runId), 5000);

  try {
    const result = await worker.sendPrompt({
      prompt:providerPrompt,chatUrl:task.chat_url,newSession:conversationPlan.newSession,
      onProvisionalProgress:({text,source})=>{
        if(liveRun?.runId===runId)provisional.capture(text,source);
      },
      onDeliveryObserved:({chatUrl,submittedAt}) => {
        if (liveRun?.runId !== runId) throw new Error('submission_run_context_changed');
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
            chatUrl,submittedAt
          });
        } catch {
          // The provider already accepted the send. Never fail or retry it
          // merely because optional local provenance could not be recorded.
          try { store.event(taskId,'provider.submission.provenance_unavailable',{run_id:runId}); }
          catch { /* Preserve transport result; reconcile conservatively. */ }
        }
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
    const runMetrics = store.recordRunMetrics(taskId, runId, observerMode, { ...(result.metrics || {}), runStartedAt: liveRun?.startedAt || null });
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
    if (confirmedChatUrl) await worker.showConversation(confirmedChatUrl).catch(() => {});
    return { result: { ...result, runId, assets }, task:getTaskView(taskId) };
  } catch (error) {
    // Persist the last pending observed text, never as a confirmed message.
    provisional.flush();
    if (worker.lastFailureMetrics) {
      try { store.recordRunMetrics(taskId, runId, observerMode, {
        ...worker.lastFailureMetrics,
        runStartedAt:liveRun?.startedAt || null
      }); } catch { /* preserve original failure */ }
    }
    store.finishRun(taskId, runId, String(error?.message || error));
    throw error;
  } finally {
    if (liveRun?.runId === runId) liveRun = null;
    clearInterval(heartbeat);
  }
}

function layoutViews() {
  if (!win || !worker) return;
  const [width, height] = win.getContentSize();
  const workerBounds = chatVisible
    ? { x: LEFT_WIDTH, y: 0, width: Math.max(640, width - LEFT_WIDTH), height }
    : { x: 0, y: 0, width: Math.max(960, width), height: Math.max(700, height) };
  worker.view.setBounds(workerBounds);
  worker.view.setVisible(chatVisible);
}

async function createWindow() {
  hostStartupLog('window_create_begin');
  win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1050,
    minHeight: 700,
    title: 'OrdaX Orchestrator Lab',
    backgroundColor: '#0b0e13',
    autoHideMenuBar: true,
    show:!hostBrowserMode,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });

  worker = new EmbeddedChatWorker();
  hostStartupLog('worker_constructed');
  worker.setObserverMode(observerMode);
  worker.setStageSink(({ stage, at }) => {
    if (!liveRun || !win || win.isDestroyed()) return;
    emitRendererEvent('ordax:task:stage', {
      taskId:liveRun.taskId, runId:liveRun.runId, stage, at, runStartedAt:liveRun.startedAt
    });
  });
  worker.setFastStreamSink(delta => {
    if (!liveRun || !win || win.isDestroyed()) return;
    emitRendererEvent('ordax:task:stream', { taskId:liveRun.taskId, runId:liveRun.runId, ...delta, mirrorAt:Date.now(), runStartedAt:liveRun.startedAt });
  });

  // Native WebContentsView defaults to visible. Hide the embedded provider
  // BEFORE awaiting the App renderer, or it can cover a still-loading UI.
  win.contentView.addChildView(worker.view);
  hostStartupLog('provider_view_attached');
  layoutViews();
  win.on('resize', layoutViews);
  win.on('maximize', layoutViews);
  win.on('unmaximize', layoutViews);

  // A dead App renderer must never look like a successfully started product.
  // Report only local, sanitized shell failure codes, never provider content.
  let shellFailureReported=false;
  const reportShellFailure=code=>{
    if(shellFailureReported || !win || win.isDestroyed())return;
    shellFailureReported=true;
    dialog.showMessageBox(win,{
      type:'error',
      title:'OrdaX Orchestrator — falha na interface',
      message:'A interface do aplicativo não pôde ser carregada.',
      detail:'Código local: '+code+'. Nenhuma tarefa foi enviada. Feche esta janela e reinicie o Orchestrator.',
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
  else await worker.load('https://chatgpt.com/');
  hostStartupLog('window_create_complete');
}

ipcMain.on('ordax:worker:preload-ready', (event, payload) => {
  if (!worker || event.sender.id !== worker.view.webContents.id) return;
  workerPreload = { ready:true, url:String(payload?.url || ''), at:Number(payload?.at || Date.now()) };
});

ipcMain.on('ordax:worker:stream', (event, snapshot) => {
  if (!worker || event.sender.id !== worker.view.webContents.id || !liveRun || !win || win.isDestroyed()) return;
  const delta = worker.acceptStreamSnapshot(snapshot);
  if (!delta) return;
  const mirrorAt = Date.now();
  if (!liveRun.firstDeltaAt) liveRun.firstDeltaAt = delta.firstDeltaAt || mirrorAt;
  emitRendererEvent('ordax:task:stream', { taskId:liveRun.taskId, runId:liveRun.runId, source:'beta', ...delta, mirrorAt, runStartedAt:liveRun.startedAt });
});

registerUiHandler('ordax:workspace:get', () => store.getWorkspaceSession());
registerUiHandler('ordax:tasks:list', () => {
  const bindings=new Map(store.db.prepare('SELECT * FROM lab_task_bindings').all().map(row=>[row.task_id,row]));
  return store.listTasks().map(task=>({...task,lab_binding:bindings.get(task.id)||null}));
});
registerUiHandler('ordax:tasks:create', (_event, title) => decorateTask(store.createTask(String(title || 'Nova tarefa'))));
registerUiHandler('ordax:tasks:get', (_event, id) => getTaskView(id));
registerUiHandler('ordax:tasks:messages:page', (_event, { taskId, before }) => {
  if (!store.getTaskExecutionSnapshot(String(taskId))) throw new Error('task_not_found');
  const page = store.messagesPage(String(taskId), { before });
  return { ...page, messages:decorateMessages(page.messages) };
});
registerUiHandler('ordax:tasks:rename', (_event, { taskId, title }) => {
  store.renameTask(String(taskId), title);
  return getTaskView(taskId);
});
registerUiHandler('ordax:tasks:draft:set', (_event, { taskId, content, revision }) =>
  store.setDraft(String(taskId), content, revision));
registerUiHandler('ordax:tasks:open', async (_event, id) => {
  const task = getTaskView(id);
  if (chatVisible && task?.chat_url) {
    try {
      const navigation = await worker.showConversation(task.chat_url);
      if (navigation.navigated === false) return {
        ...task, provider_navigation:'not_navigated',
        provider_navigation_reason:safeTaskNavigationReason(navigation.reason)
      };
    } catch (error) {
      return {
        ...task, provider_navigation:'failed',
        provider_navigation_reason:safeTaskNavigationReason(error?.message)
      };
    }
  }
  return task;
});
// A first-party OrdaX App action, not the ChatGPT direct-mode UI.
// Historical inspection never sends messages or changes the SQLite ledger.
registerUiHandler('ordax:tasks:inspect-linked-thread', async (event, requestedId) => {
  requireTrustedSupervisorRenderer(event);
  if (liveRun) return {kind:'unavailable',reason:'run_active',threadRendered:false,requiresReconciliation:true};
  const taskId=String(requestedId || '');
  const row=store.db.prepare('SELECT chat_url,workspace_session_id FROM tasks WHERE id=?').get(taskId);
  const currentSession=store.getWorkspaceSession();
  if (!row || row.workspace_session_id !== currentSession?.id)
    throw new Error('task_access_denied');
  const expectedUrl=canonicalProviderChatUrl(row.chat_url);
  if (!expectedUrl)
    return {kind:'unavailable',reason:'canonical_chat_url_missing',threadRendered:false,requiresReconciliation:true};
  // SQLite insertion order is authoritative here. created_at/id can tie or
  // sort randomly within a millisecond, selecting an older turn by mistake.
  const message=store.db.prepare(`SELECT id,content FROM messages WHERE task_id=? AND role='user'
    ORDER BY rowid DESC LIMIT 1`).get(taskId);
  // The receipt must belong to this exact latest local user turn, not just an
  // older message sharing its Task and provider conversation.
  const provenance=findProviderSubmissionProvenance({
    store,taskId,chatUrl:expectedUrl,messageId:message?.id
  });
  // Without a receipt for the latest submitted turn, W3 certification is
  // impossible regardless of what the remote DOM displays. Return from the
  // local ledger BEFORE triggering any provider navigation or extra traffic.
  // Manual task opening remains a separate, explicitly requested action.
  if (!provenance) return {
    kind:'unavailable',reason:'provider_submission_provenance_missing',
    inspectionReason:'provider_submission_provenance_missing',
    threadRendered:false,responseCandidate:false,requiresReconciliation:true
  };
  // No mutation or replay, including when the provider navigation times out.
  const observed=await worker.inspectConversationReadOnly(expectedUrl).catch(() => ({available:false,reason:'provider_inspection_unavailable'}));
  const assessment=assessProviderConversationEvidence({
    expectedUrl,observed,expectedMessage:message?.content,
    expectedPromptSha256:provenance?.promptSha256
  });
  // DOM presence is not evidence that the Task's conversation was restored.
  // The canonical submitted turn and its assistant reply must both match.
  // A candidate in a still-generating thread is never a completed W3 answer.
  // Older/untrusted observations lacking the explicit read-only stop probe also
  // fail closed. Absence of a stop control is necessary but not sufficient.
  const generationNotActive=observed?.generationStopVisible===false;
  const threadRendered=Boolean(provenance) && assessment.kind==='response_candidate' &&
    assessment.candidates===1 && assessment.responseCandidate===true &&
    observed?.truncated!==true && generationNotActive;
  const possibleAnswer=assessment.kind==='response_candidate' &&
    assessment.candidates===1 && assessment.responseCandidate===true;
  return {
    kind:assessment.kind,reason:assessment.reason,threadRendered,
    inspectionReason:threadRendered ? 'thread_rendered' :
      (!provenance && possibleAnswer
        ? 'provider_submission_provenance_missing'
        : possibleAnswer && observed?.generationStopVisible===true
          ? 'provider_response_generation_active'
          : possibleAnswer && observed?.generationStopVisible!==false
            ? 'provider_generation_state_unobserved'
            : safeHistoricalThreadFailure(observed?.reason)),
    responseCandidate:assessment.responseCandidate===true,
    requiresReconciliation:assessment.requiresReconciliation===true
  };
});
registerUiHandler('ordax:tasks:resume-capsule', (_event, id) => store.buildResumeCapsule(String(id)));
registerUiHandler('ordax:tasks:rotate-conversation', (_event, id) => {
  if (liveRun) throw new Error('conversation_rotation_during_run');
  store.rotateConversation(String(id), 'manual_ui');
  return getTaskView(id);
});
registerUiHandler('ordax:tasks:memory:upsert', (_event, { taskId, item }) => {
  store.upsertProjectMemory(String(taskId), { ...(item || {}), source_type:'manual' });
  return getTaskView(taskId);
});
registerUiHandler('ordax:tasks:memory:archive', (_event, { taskId, memoryId }) => {
  store.archiveProjectMemory(String(taskId), String(memoryId));
  return getTaskView(taskId);
});
registerUiHandler('ordax:tasks:memory:candidates:scan', (_event, taskId) => {
  store.memoryCandidates.scan(String(taskId));
  return getTaskView(taskId);
});
registerUiHandler('ordax:tasks:memory:candidates:review', (_event, { taskId, candidateId, action, changes }) => {
  store.memoryCandidates.review(String(taskId), String(candidateId), String(action), changes || {});
  return getTaskView(taskId);
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
registerUiHandler('ordax:provider:login', () => {
  if(hostBrowserMode)throw new Error('provider_login_requires_app_view');
  return worker.login();
});
registerUiHandler('ordax:provider:home', () => worker.newChat());
registerUiHandler('ordax:provider:reload', () => {
  // Manual reload must never interrupt a pending/uncertain provider send.
  if (liveRun || worker.active) throw new Error('provider_reload_during_run_blocked');
  return worker.view.webContents.reload();
});
registerUiHandler('ordax:chat:visible', (_event, visible) => {
  if(hostBrowserMode&&visible)throw new Error('provider_login_requires_app_view');
  chatVisible = Boolean(visible);
  layoutViews();
  return chatVisible;
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
  return enqueueExecution(() => runTask(String(taskId), prompt, { newSession: Boolean(newSession), draftRevision }));
});


// LAB ONLY. No automatic model or chat execution while disabled.
let labSupervisor = null;
// The UI may prepare a key, but only an explicit dev enable flag permits a
// model call. Stored secrets never travel back through IPC.
const currentGroqKey=()=>groqCredential.read()||process.env.GROQ_API_KEY||null;
// Local chat opt-in lasts only for this App process; it does not enable the
// supervisor, provider automation, remote grants or an external MCP endpoint.
let localCoordinatorChatEnabled=null;
const coordinatorChatEnabled=(projectId=null,orchestratorId=null)=>
  (localCoordinatorChatEnabled??(process.env.ORDAX_LAB_SUPERVISOR_ENABLE==='1'))===true ||
  projectCoordinatorContinuationEnabled(store.db,projectId,orchestratorId);
const coordinatorChatStatus=()=>({enabled:coordinatorChatEnabled(),configured:Boolean(currentGroqKey())});
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
        const reply = await enqueueExecution(() => runTask(taskId,content,{newSession:false}));
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
const localOrchestratorContext=Object.freeze({actorId:'lab-owner',clientId:'lab-ui',
  workspaceSessionId:store.getWorkspaceSession().id});
let runtimeOrchestratorBridge=null;
let closeRuntimeOrchestratorPipe=null;
const orchestratorService=new OrchestratorService({
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
  store,authorize:({context,operation})=>context===localOrchestratorContext||
    runtimeOrchestratorBridge?.allows(context,operation)===true,
  provider:{busy:()=>Boolean(liveRun||worker?.active),
    ready:async()=>{assertProviderSendReadiness(await worker.health());return true;},
    send:async({taskId,content,draftRevision})=>
    chatReceiptFromRunTask(await enqueueExecution(()=>runTask(taskId,content,{newSession:false,draftRevision})))},
  coordinator:createGroqCoordinatorConversation({store,getApiKey:currentGroqKey,
    isEnabled:coordinatorChatEnabled})
});
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
const localOrchestratorMcp=createOrchestratorMcp({service:orchestratorService,
  getContext:()=>localOrchestratorContext,version:app.getVersion()});
registerUiHandler('ordax:orchestrator:invoke',async(event,payload)=>{
  requireTrustedSupervisorRenderer(event);
  const result=await orchestratorService.invoke(localOrchestratorContext,payload?.operation,payload?.input??{});
  if(ORCHESTRATOR_TOOLS.some(t=>t.operation===payload?.operation&&!t.readOnly)&&win&&!win.isDestroyed())
    emitRendererEvent('ordax:orchestrator:changed');
  return result;
});
// Local protocol conformance/host integration entrypoint, never arbitrary eval.
registerUiHandler('ordax:orchestrator:mcp',async(event,message)=>{
  requireTrustedSupervisorRenderer(event);
  const result=await localOrchestratorMcp.handle(message);
  if(message?.method==='tools/call'&&ORCHESTRATOR_TOOLS.some(t=>t.name===message.params?.name&&!t.readOnly)&&win&&!win.isDestroyed())
    emitRendererEvent('ordax:orchestrator:changed');
  return result;
});

function notifyOrchestratorChanged(){
  if(win&&!win.isDestroyed())emitRendererEvent('ordax:orchestrator:changed');
}
registerUiHandler('ordax:orchestrator:chat-status',event=>{
  requireTrustedSupervisorRenderer(event);
  return coordinatorChatStatus();
});
registerUiHandler('ordax:orchestrator:chat-enable',(event,enabled)=>{
  requireTrustedSupervisorRenderer(event);
  if(typeof enabled!=='boolean')throw Error('orchestrator_chat_setting_invalid');
  if(enabled&&!currentGroqKey())throw Error('supervisor_api_key_missing');
  localCoordinatorChatEnabled=enabled;
  notifyOrchestratorChanged();
  return coordinatorChatStatus();
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
app.whenReady().then(async () => {
  hostStartupLog('electron_ready');
  protocol.handle('ordax-asset', request => {
    try {
      const url = new URL(request.url);
      const id = decodeURIComponent(url.pathname.replace(/^\//, ''));
      const asset = store.getAsset(id);
      if (!asset) return new Response('Not found', { status: 404 });

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
  hostStartupLog('window_ready');
  // Observe completed Runs even when the coordinator chat is not selected.
  // Bound to this App lifetime; does not promise a headless 24h supervisor.
  continuationTimer=setInterval(()=>{
    void orchestratorService.continuation.tick(localOrchestratorContext)
      .then(result=>{if(result.state==='analyzed'||result.state==='reconciliation_required')notifyOrchestratorChanged();})
      .catch(()=>{}); // No auto-retry of an uncertain provider/API effect.
  },10000);
}).catch(()=>{
  hostStartupLog('startup_failed');
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if(continuationTimer)clearInterval(continuationTimer);
  void hostBrowserServer?.close();
  closeRuntimeOrchestratorPipe?.();
  store.close();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

