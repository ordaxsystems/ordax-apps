import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const bootstrap = JSON.parse(fs.readFileSync(path.join(root,'..','package.json'),'utf8'));
const main = fs.readFileSync(path.join(root,'desktop','main.mjs'),'utf8');
const taskHandlers = fs.readFileSync(path.join(root,'src','task-ui-handlers.mjs'),'utf8');
const worker = fs.readFileSync(path.join(root,'desktop','embedded-worker.mjs'),'utf8');
const workerPreload = fs.readFileSync(path.join(root,'desktop','worker-preload.cjs'),'utf8');
const preload = fs.readFileSync(path.join(root,'desktop','preload.cjs'),'utf8');
const hostBridge = fs.readFileSync(path.join(root,'desktop','host-browser-bridge.js'),'utf8');
const hostServer = fs.readFileSync(path.join(root,'host','host-browser-server.mjs'),'utf8');
const ui = fs.readFileSync(path.join(root,'desktop','ui.js'),'utf8');
const e2eLock = fs.readFileSync(path.join(root,'scripts','e2e-lock.cjs'),'utf8');
const liveText = fs.readFileSync(path.join(root,'scripts','live-ui-text-smoke.cjs'),'utf8');

test('desktop package ships only canonical desktop runtime', () => {
  assert.equal(pkg.main, 'desktop/bootstrap.mjs');
  // The only extra packaged file is the bounded content-integrity manifest.
  // No test, userData, cookies or arbitrary source directory may be shipped.
  assert.deepEqual(pkg.build.files, ['desktop/**/*','src/*.mjs','supervisor/**/*','package.json']);
  assert.match(main,/const hostBrowserMode=!app\.isPackaged&&/);
  assert.match(main,/await import\('\.\.\/host\/host-browser-server\.mjs'\)/);
  assert.match(main,/createTaskUiHandlers/);
  assert.match(ui,/Orchestrator • Host Node de desenvolvimento/);
  assert.match(ui,/const observerRow=\$\('\.observer-row'\);/);
  assert.match(ui,/observerRow\.classList\.add\('hidden'\)/);
  assert.equal(pkg.scripts.start,'node scripts/start-host.mjs');
  assert.equal(pkg.scripts['start:electron'],'electron .');
  assert.equal(bootstrap.scripts.start,'node product/scripts/start-host.mjs');
  assert.equal(bootstrap.scripts['start:electron'],'node scripts/start-lab.mjs');
  assert.equal(pkg.engines.node, '>=22.13.0');
  assert.equal(pkg.dependencies, undefined);
  assert.ok(!JSON.stringify(pkg).includes('playwright-core'));
  assert.ok(!JSON.stringify(pkg.build.files).includes('chrome-extension'));
});

test('desktop is single-instance with canonical durable AppData state', () => {
  assert.match(main, /requestSingleInstanceLock/);
  const binding=fs.readFileSync(path.join(root,'src','lab-profile-binding.mjs'),'utf8');
  assert.match(main,/resolveLabUserRoot/);
  assert.match(main,/app\.setPath\('userData', userRoot\)/);
  assert.match(binding,/path\.join\(localAppData,'OrdaX','OrchestratorLab'\)/);
  assert.match(binding,/lab_staged_profile_explicit_binding_required/);
  assert.match(main, /recoverInterruptedRuns/);
  assert.match(main, /heartbeatRun/);
  assert.match(main, /will-quit/);
  assert.match(main, /store\.close\(\)/);
  assert.match(main, /executionTail/);
  assert.match(main, /enqueueExecution/);
  assert.match(main, /providerHealthInFlight/);
  assert.match(main, /providerHealthCache/);
  assert.match(main, /if \(base\.active\)/);
  assert.match(main, /health_pending/);
});

test('embedded ChatGPT surface is sandboxed and navigation-scoped', () => {
  assert.match(worker, /contextIsolation:\s*true/);
  assert.match(worker, /sandbox:\s*true/);
  assert.match(worker, /nodeIntegration:\s*false/);
  assert.match(worker, /setPermissionRequestHandler/);
  assert.match(worker, /will-navigate/);
  assert.match(worker, /chatgpt\\\.com\|auth\\\.openai\\\.com\|accounts\\\.google\\\.com/);
  assert.match(worker, /formReady/);
  assert.match(worker, /pending-home-input/);
  assert.match(worker, /const scope = form \|\| document/);
  assert.match(worker, /requestSubmit/);
});


test('ChatGPT worker is hidden by default and direct mode is explicit', () => {
  assert.match(main, /let chatVisible = false/);
  assert.match(ui, /directMode/);
  assert.match(ui, /await setDirectModeVisible\(false\)/);
  assert.match(ui, /await window\.ordax\.setChatVisible\(visible\)/);
  assert.match(ui, /await setDirectModeVisible\(true\)/);
  assert.match(ui, /const nextVisible = !directMode/);
});

test('assistant output streams into OrdaX UI through isolated worker preload', () => {
  assert.match(worker, /worker-preload\.cjs/);
  assert.match(workerPreload, /MutationObserver/);
  assert.match(workerPreload, /conversationRoot/);
  assert.match(workerPreload, /main,\[role=\"main\"\]/);
  assert.match(workerPreload, /ordax:worker:stream/);
  assert.match(main, /ordax:task:stream/);
  assert.match(preload, /onTaskStream/);
  assert.match(ui, /updateLiveRun/);
});

test('current ChatGPT DOM identity binds each run to its own assistant message', () => {
  assert.match(workerPreload, /data-chatgpt-selection-message-id/);
  assert.match(workerPreload, /data-user-message-bubble/);
  assert.match(workerPreload, /messageId/);
  assert.match(worker, /seenAssistantMessageIds/);
  assert.match(worker, /currentAssistantMessageId/);
  assert.match(worker, /latestUserText/);
  assert.match(worker, /data-user-message-bubble/);
});

test('live E2E gates are exclusive and detect cross-run leaks', () => {
  const target=fs.readFileSync(path.join(root,'scripts','e2e-lab-target.cjs'),'utf8');
  assert.match(e2eLock, /labLockPath\(\)/);
  assert.match(target, /e2e\.lock/);
  assert.doesNotMatch(e2eLock, /['"]Gratis['"]/);
  assert.match(e2eLock, /e2e_lock_busy/);
  assert.match(liveText, /crossRunLeak/);
  assert.match(liveText, /providerStatus/);
});

test('send readiness is state-driven without legacy 1800ms fixed delay', () => {
  assert.doesNotMatch(worker, /sleep\(1800\)/);
  assert.match(worker, /formReady/);
  assert.match(worker, /requestSubmit/);
});


test('observer mode is persisted and fast path never replaces durable Task state', () => {
  assert.match(main, /observer_mode/);
  assert.match(main, /provider:observer-mode:set/);
  assert.match(worker, /setObserverMode/);
  assert.match(worker, /Network\.enable/);
  assert.match(worker, /networkFirstByteAt/);
  assert.match(worker, /firstObserver/);
  assert.match(worker, /lastDeliveredText/);
  assert.match(worker, /fastSuppressed/);
  assert.match(worker, /internal_tool_payload/);
  assert.match(ui, /observerMode/);
});

test('OrdaX UI exposes responsive conversation, chat and context columns', () => {
  const html = fs.readFileSync(path.join(root,'desktop','ui.html'),'utf8');
  const css = fs.readFileSync(path.join(root,'desktop','ui.css'),'utf8');
  assert.match(html, /left-rail/);
  assert.match(html, /chat-column/);
  assert.match(html, /context-rail/);
  assert.match(html, /contentAssets/);
  assert.match(html, /memorySummary/);
  assert.match(html, /structuredMemory/);
  assert.match(html, /memoryEditor/);
  assert.match(html, /conversationTimeline/);
  assert.match(html, /toggleContext/);
  assert.match(html, /closeContext/);
  assert.match(ui, /setContextOpen/);
  assert.match(css, /grid-template-columns:292px minmax\(460px,1fr\) 330px/);
  assert.match(css, /\.context-rail\.open/);
  assert.match(css, /@media \(max-width:1180px\)/);
  assert.match(css, /@media \(max-width:620px\)/);
  assert.match(css, /body\.orchestrator-focus \.left-rail \.footer-actions #login/);
  assert.match(css, /body\.orchestrator-focus #orchestrationNotice/);
  assert.match(html, /aria-label="Entrar no ChatGPT"/);
  assert.match(ui, /O transporte suportado do ChatGPT Web não está disponível nesta página/);
  assert.match(ui, /function applyHostProviderLimit\(\)/);
  assert.match(ui, /#directMode'\)\.hidden = true/);
  assert.match(ui, /#login'\)\.hidden = true/);
  assert.match(ui, /O ChatGPT Web ainda não está conectado ao Host/);
  assert.match(html, /id="sessionPersistenceNote"/);
});

test('Orchestrator workspace links project navigation, coordinator and scoped GPT work conversations', () => {
  const html=fs.readFileSync(path.join(root,'desktop','ui.html'),'utf8');
  const css=fs.readFileSync(path.join(root,'desktop','ui.css'),'utf8');
  const orchestration=fs.readFileSync(path.join(root,'desktop','orchestrator-ui.mjs'),'utf8');
  for(const id of ['projectNavList','orchestratorNavList','orchestrationPanel','orchestratorWorkRail','orchestratorWorks','newScopedWorkForm'])
    assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/Conversas no GPT/);
  assert.match(html,/Nova conversa no GPT/);
  assert.match(html,/id="analyzeWorks"/);
  assert.match(html,/id="remoteRepositoryCapabilityNote"/);
  assert.match(html,/até quatro conversas recentes e oito mensagens do chat central/);
  assert.match(orchestration,/command\('orchestrator_analyze'/);
  assert.match(orchestration,/call\('status'\)\.catch\(\(\)=>null\)/);
  assert.match(orchestration,/const canDisable=result\.enabled===true/);
  assert.match(orchestration,/const canEnable=engineStatus\?\.coordinatorAvailable===true/);
  assert.match(orchestration,/Configure e ative o chat opcional por API para habilitar a análise automática/);
  assert.match(orchestration,/engineStatus\?\.autonomousExecution===false/);
  assert.match(orchestration,/A análise só roda enquanto o processo OrdaX está aberto; o supervisor de 24 h do Runtime ainda não está conectado/);
  assert.match(orchestration,/call\('work_list'/);
  assert.match(orchestration,/let refreshPending=false,refreshRequested=false/);
  assert.match(orchestration,/while\(refreshRequested\)/);
  assert.match(orchestration,/await onScopeChange\(new Set\(works\.map\(w=>w\.id\)\)\)/);
  assert.match(ui,/onScopeChange:async ids=>/);
  assert.match(ui,/try \{await loadTasks\(\);\}\s*catch/);
  assert.match(orchestration,/onOpenWork\(work\.id\)/);
  assert.match(orchestration,/executionSurface==='node_host'/);
  assert.match(orchestration,/coordinatorDraftCommitAvailable/);
  assert.match(orchestration,/envio seguro bloqueado até reiniciá-lo/);
  assert.match(orchestration,/GPT indisponível/);
  assert.match(orchestration,/Este host não abre nem envia conversas ao GPT/);
  assert.match(orchestration,/URL salva no projeto: \$\{project\.repository_url\}\. Este Host não lê o GitHub nem envia trabalho ao GPT\./);
  assert.match(orchestration,/Nenhuma integração GitHub está conectada ao Host/);
  assert.match(orchestration,/Runtime\/workspace local não conectado a esta página/);
  assert.match(orchestration,/URL do GitHub salva como metadado do projeto/);
  assert.match(orchestration,/orchestrator-focus/);
  assert.match(css,/body\.orchestrator-focus #contextRail/);
  assert.match(css,/\.work-card:hover/);
});

test('coordinator shows an actionable empty state and keeps mobile controls inside the panel',()=>{
  const html=fs.readFileSync(path.join(root,'desktop','ui.html'),'utf8');
  const css=fs.readFileSync(path.join(root,'desktop','ui.css'),'utf8');
  const orchestration=fs.readFileSync(path.join(root,'desktop','orchestrator-ui.mjs'),'utf8');
  assert.match(html,/id="coordinatorMessages"/);
  assert.match(html,/id="coordinatorRecoveryNotice"/);
  assert.match(orchestration,/page\.messages\.length===0/);
  assert.match(orchestration,/uncertainCommands/);
  assert.match(orchestration,/nada foi reenviado automaticamente/);
  assert.match(orchestration,/Conversa de coordenação ainda vazia/);
  assert.match(orchestration,/O chat central depende do Groq opcional/);
  assert.match(orchestration,/O GPT Web é o caminho principal das frentes/);
  assert.match(orchestration,/Configurar Groq opcional/);
  assert.match(orchestration,/groq_auth_rejected:/);
  assert.match(orchestration,/O tempo de resposta do Groq expirou sem confirmação/);
  assert.match(orchestration,/settings\.addEventListener\('click',\(\)=>\$\('coordinatorApiSettings'\)\.click\(\)\)/);
  assert.match(css,/\.coordinator-empty\{[^}]*text-align:center/);
  assert.match(css,/body\.orchestrator-focus \.coordinator-analysis-actions\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/body\.orchestrator-focus \.coordinator-analysis-actions>small\{min-width:0;overflow-wrap:anywhere\}/);
  assert.match(css,/body\.orchestrator-focus \.left-rail \.provider-main div\{display:none\}/);
  assert.match(css,/body\.orchestrator-focus \.left-rail \.host-browser-controls>summary::after\{content:"Host"/);
  assert.match(css,/body:not\(\.orchestrator-focus\) \.left-rail \.orchestration-navigation \.nav-item\.active\{box-sizing:border-box;width:46px/);
  assert.match(css,/body:not\(\.orchestrator-focus\) \.left-rail \.orchestration-navigation \.nav-item:not\(\.active\),\s*body:not\(\.orchestrator-focus\) \.left-rail \.orchestration-navigation \.nav-empty\{display:none\}/);
});

test('a new mission is persisted once, starts through the existing GPT executor, and labels project and conversation actions separately',()=>{
  const html=fs.readFileSync(path.join(root,'desktop','ui.html'),'utf8');
  const orchestration=fs.readFileSync(path.join(root,'desktop','orchestrator-ui.mjs'),'utf8');
  const contract=fs.readFileSync(path.join(root,'src','orchestrator-contract.mjs'),'utf8');
  const packagedSmoke=fs.readFileSync(path.join(root,'scripts','live-ui-orchestration-smoke.cjs'),'utf8');
  const hostFixture=fs.readFileSync(path.join(root,'scripts','orchestrator-host-e2e-client.cjs'),'utf8');
  assert.match(html,/id="newProjectForm"/);
  assert.match(html,/id="renameProjectForm"/);
  assert.match(html,/aria-label="Nome da conversa"/);
  assert.match(orchestration,/command\('mission_create',input\)/);
  assert.match(orchestration,/canStartMission\(\)===true/);
  assert.match(orchestration,/onStartMission\(\{taskId:receipt\.result\.taskId,mission\}\)/);
  assert.match(ui,/return submitTaskMessage\(mission\)/);
  assert.match(ui,/window\.ordax\.send\(\{ taskId, content, draftRevision \}\)/);
  assert.match(contract,/\['mission_create'/);
  assert.match(contract,/\['project_rename'/);
  assert.match(packagedSmoke,/missionDraftPreserved/);
  assert.match(packagedSmoke,/mission_draft_not_persisted/);
  assert.match(packagedSmoke,/conversationCards!==2/);
  assert.match(packagedSmoke,/phase,reason:'app_orchestration_scenario_failed'/);
  assert.match(hostFixture,/workRows\.length!==3/);
  assert.match(hostFixture,/work\.title==='Primeira frente'/);
});

test('drafts are scoped to a Task, revision-guarded and saved without entering provider memory', () => {
  const store = fs.readFileSync(path.join(root, 'src', 'store.mjs'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'desktop', 'ui.html'), 'utf8');
  const orchestration = fs.readFileSync(path.join(root, 'desktop', 'orchestrator-ui.mjs'), 'utf8');
  assert.match(store, /draft_revision<\?/);
  assert.match(preload, /setDraft/);
  assert.match(preload, /getTaskDraft/);
  assert.match(hostBridge,/getTaskDraft:\['id'\]/);
  assert.match(hostServer,/getTaskDraft:\['ordax:tasks:draft:get',a=>\[a\[0\]\]\]/);
  assert.match(hostBridge,/setDraft:\['taskId','content','revision'\]/);
  assert.match(main, /createTaskUiHandlers/);
  assert.match(taskHandlers, /ordax:tasks:draft:set/);
  assert.match(taskHandlers, /ordax:tasks:draft:get/);
  assert.match(main, /store\.beginProviderRun\(taskId, prompt/);
  assert.match(store, /this\.setDraft\(taskId, '', draftRevision\)/);
  assert.match(ui, /draftCache/);
  assert.match(ui, /flushDraft/);
  assert.match(ui, /navigationEpoch/);
  assert.match(ui, /draftRevision/);
  assert.match(html, /draftState/);
  assert.match(html, /coordinatorDraftState/);
  assert.match(orchestration,/api\.getTaskDraft\(taskId\)/);
  assert.match(orchestration,/api\.setDraft\(draft\.taskId,draft\.content,draft\.revision\)/);
  assert.match(orchestration,/draftRevision:draft\.draftRevision/);
  assert.match(orchestration,/reconcileCoordinatorDraft/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage/);
});

test('project titles can be renamed from the chat header and are persisted in Tasks', () => {
  const store = fs.readFileSync(path.join(root, 'src', 'store.mjs'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'desktop', 'ui.html'), 'utf8');
  assert.match(store, /renameTask\(taskId, title\)/);
  assert.match(taskHandlers, /ordax:tasks:rename/);
  assert.match(preload, /renameTask/);
  assert.match(ui, /saveTaskRename/);
  assert.match(html, /id="renameTask"/);
  assert.match(html, /id="renameTaskForm"/);
});

test('SSOT projections avoid duplicate full-history reads during send and support bounded context', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'store.mjs'), 'utf8');
  assert.match(source, /idx_messages_task_time/);
  assert.match(source, /SELECT t\.id,t\.title,t\.status,t\.created_at,t\.updated_at/);
  assert.doesNotMatch(source, /SELECT t\.\*, \(SELECT COUNT\(\*\) FROM task_conversations/);
  assert.match(source, /getTaskExecutionSnapshot\(taskId\)/);
  assert.match(main, /store\.getTaskExecutionSnapshot\(taskId\)/);
  assert.match(main, /conversationPlan\.newSession && task\.has_messages/);
  assert.match(source, /recentMessages: this\.messages\(taskId, \{ limit: 8 \}\)/);
  assert.match(source, /snapshot\.totalMessages/);
  assert.match(source, /SELECT message_id,id,kind,mime_type,alt,width,height,sha256,created_at FROM message_assets/);
  assert.doesNotMatch(source, /this\.messages\(taskId\)\.slice\(-10\)/);
  assert.doesNotMatch(source, /recentMessages: task\.messages/);
});

test('history paging uses one SQLite SSOT with bounded renderer pages and stale-response guards', () => {
  const store = fs.readFileSync(path.join(root, 'src', 'store.mjs'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'desktop', 'ui.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'desktop', 'ui.css'), 'utf8');
  assert.match(store, /messagesPage\(taskId,/);
  assert.match(store, /decodeMessageCursor/);
  assert.match(store, /created_at < \? OR \(created_at = \? AND id < \?\)/);
  assert.match(main, /messageLimit:MESSAGE_PAGE_SIZE/);
  assert.match(taskHandlers, /ordax:tasks:messages:page/);
  assert.match(preload, /loadMessagePage/);
  assert.match(html, /id="messageHistoryNav"/);
  assert.match(html, /id="olderMessages"/);
  assert.match(html, /id="newerMessages"/);
  assert.match(html, /id="messageList"/);
  assert.match(ui, /changeHistoryPage/);
  assert.match(ui, /historyCursors/);
  assert.match(ui, /historyEpoch/);
  // Live placeholder is inside the paginated message list and disappears when final history renders.
  assert.match(ui, /function appendLiveRun[\s\S]*?\$\('#messageList'\)\.insertAdjacentHTML\('beforeend'/);
  assert.doesNotMatch(ui, /\$\('#messages'\)\.insertAdjacentHTML\('beforeend', messageHtml/);
  assert.match(ui, /navigationEpoch !== requestNavigation/);
  assert.match(ui, /acceptTaskRefresh/);
  assert.doesNotMatch(ui, /\$\('#messages'\)\.innerHTML\s*=/);
  assert.match(css, /\.message-history-nav\{/);
  assert.match(html, /Conteúdo desta página/);
  const historySmoke = fs.readFileSync(path.join(root, 'scripts', 'live-ui-history-smoke.cjs'), 'utf8');
  assert.match(historySmoke, /acquireE2ELock\('history-smoke'\)/);
  assert.match(historySmoke, /expectPage\(3, '000', '024', 25\)/);
  assert.match(historySmoke, /DELETE FROM tasks WHERE id=\?/);
});

test('live E2E scripts wait for a fresh Task ID before sending test prompts', () => {
  for (const file of ['live-ui-text-smoke.cjs','live-ui-image-smoke.cjs','live-ui-continuity-smoke.cjs']) {
    const source = fs.readFileSync(path.join(root,'scripts',file),'utf8');
    assert.match(source, /previousTaskId/);
    assert.match(source, /new_task_not_ready/);
    assert.doesNotMatch(source, /if\(await (?:evalJs|ev)\(`!document\.querySelector\('#taskPanel'\)/);
  }
});

test('persistent Task memory can rotate provider conversations without losing the project', () => {
  const store = fs.readFileSync(path.join(root,'src','store.mjs'),'utf8');
  assert.match(store, /task_conversations/);
  assert.match(store, /rotateConversation/);
  assert.match(store, /buildContinuationPrompt/);
  assert.match(store, /continuationSummary/);
  assert.match(main, /needsContinuation/);
  assert.match(main, /providerPrompt/);
  assert.match(preload, /rotateConversation/);
  assert.match(ui, /Nova conversa interna/);
});

test('a persistent project hides internal provider sessions and rotates only after completed turns', () => {
  const policy = fs.readFileSync(path.join(root,'src','conversation-policy.mjs'),'utf8');
  const html = fs.readFileSync(path.join(root,'desktop','ui.html'),'utf8');
  assert.match(policy, /SUCCESSFUL_TURNS_PER_SEGMENT = 24/);
  assert.match(main, /planProviderConversation/);
  assert.match(main, /conversationPlan\.newSession/);
  assert.match(main, /provider\.conversation\.auto_rotated/);
  assert.match(taskHandlers, /conversation_rotation_during_run/);
  assert.match(html, /internal-diagnostics/);
  assert.match(html, /<details/);
  assert.match(ui, /Projeto contínuo/);
  assert.doesNotMatch(html, /id="rotateConversation"[^>]*Nova conversa interna/);
  assert.match(fs.readFileSync(path.join(root,'src','store.mjs'),'utf8'), /conversation_completed_runs/);
});

test('provider chat identity is canonical and unconfirmed navigation never triggers resend', () => {
  const source = fs.readFileSync(path.join(root,'src','conversation-policy.mjs'),'utf8');
  assert.match(source, /canonicalProviderChatUrl/);
  assert.match(main, /canonicalProviderChatUrl\(result\.chatUrl\)/);
  assert.match(main, /provider\.conversation\.url_unconfirmed/);
  assert.match(main, /provider_url_unconfirmed/);
  assert.doesNotMatch(main, /provider_url:\s*String\(result\.chatUrl/);
});

test('project memory suggestions are review-only and isolated from canon', () => {
  const schema = fs.readFileSync(path.join(root,'src','memory-candidates.mjs'),'utf8');
  const detector = fs.readFileSync(path.join(root,'src','memory-suggestions.mjs'),'utf8');
  const html = fs.readFileSync(path.join(root,'desktop','ui.html'),'utf8');
  assert.match(schema, /project_memory_candidates/);
  assert.match(schema, /source_message_id/);
  assert.match(schema, /BEGIN IMMEDIATE/);
  assert.match(schema, /candidate_reviewed/);
  assert.match(detector, /explicit-project-v2/);
  assert.match(taskHandlers, /memory:candidates:review/);
  assert.match(preload, /reviewMemoryCandidate/);
  assert.match(ui, /renderMemoryCandidates/);
  assert.match(html, /memoryCandidates/);
  assert.match(html, /scanMemoryCandidates/);
});

test('generic project context is assembled from approved memory without truncating requests', () => {
  const store = fs.readFileSync(path.join(root,'src','store.mjs'),'utf8');
  const context = fs.readFileSync(path.join(root,'src','continuation-context.mjs'),'utf8');
  assert.match(store, /buildProjectContinuation/);
  assert.match(context, /MEMORIA PARCIAL/);
  assert.match(context, /HISTORICO PARCIAL/);
  assert.match(context, /continuation_budget_invariant_failed/);
  assert.ok(!store.includes('slice(0, 12)'));
});

test('structured project memory is editable, durable and part of continuation', () => {
  const store = fs.readFileSync(path.join(root,'src','store.mjs'),'utf8');
  assert.match(store, /project_memory_items/);
  assert.match(store, /upsertProjectMemory/);
  assert.match(store, /archiveProjectMemory/);
  assert.match(fs.readFileSync(path.join(root,'src','continuation-context.mjs'),'utf8'), /Memória estruturada canônica/);
  assert.match(taskHandlers, /ordax:tasks:memory:upsert/);
  assert.match(taskHandlers, /ordax:tasks:memory:archive/);
  assert.match(preload, /upsertProjectMemory/);
  assert.match(preload, /archiveProjectMemory/);
  assert.match(ui, /saveMemoryItem/);
  assert.match(ui, /memoryCategoryLabels/);
});
