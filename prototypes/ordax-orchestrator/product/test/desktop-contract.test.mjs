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
const providerDomSelectors = fs.readFileSync(path.join(root,'src','provider-dom-selectors.cjs'),'utf8');
const preload = fs.readFileSync(path.join(root,'desktop','preload.cjs'),'utf8');
const hostBridge = fs.readFileSync(path.join(root,'desktop','host-browser-bridge.js'),'utf8');
const hostServer = fs.readFileSync(path.join(root,'host','host-browser-server.mjs'),'utf8');
const ui = fs.readFileSync(path.join(root,'desktop','ui.js'),'utf8');
const uiHtml = fs.readFileSync(path.join(root,'desktop','ui.html'),'utf8');
const e2eLock = fs.readFileSync(path.join(root,'scripts','e2e-lock.cjs'),'utf8');
const liveText = fs.readFileSync(path.join(root,'scripts','live-ui-text-smoke.cjs'),'utf8');

test('desktop package ships only canonical desktop runtime', () => {
  assert.equal(pkg.main, 'desktop/bootstrap.mjs');
  // Runtime CJS helpers are shipped beside the ESM source; tests, userData
  // and cookies remain outside the packaged file set.
  assert.deepEqual(pkg.build.files, ['desktop/**/*','src/*.mjs','src/*.cjs','supervisor/**/*','package.json']);
  assert.match(main,/const hostBrowserMode=!app\.isPackaged&&/);
  assert.match(main,/await import\('\.\.\/host\/host-browser-server\.mjs'\)/);
  assert.match(main,/createTaskUiHandlers/);
  assert.match(ui,/Orchestrator • Host Node de desenvolvimento/);
  assert.match(ui,/const observerRow=\$\('\.observer-row'\);/);
  assert.match(ui,/observerRow\.classList\.add\('hidden'\)/);
  assert.equal(pkg.scripts.start,'node scripts/start-host.mjs');
  assert.equal(pkg.scripts['build:worker-preload'],'node scripts/build-worker-preload.mjs');
  assert.equal(pkg.scripts['start:electron'],'npm run build:worker-preload && electron .');
  assert.equal(bootstrap.scripts.start,'node product/scripts/start-host.mjs');
  assert.equal(bootstrap.scripts['start:electron'],'node scripts/start-lab.mjs');
  assert.equal(pkg.engines.node, '>=22.13.0');
  assert.equal(pkg.dependencies, undefined);
  assert.ok(!JSON.stringify(pkg).includes('playwright-core'));
  assert.ok(!JSON.stringify(pkg.build.files).includes('chrome-extension'));
});

test('empty project state promises persistence without claiming autonomous execution',()=>{
  assert.match(uiHtml,/Seu projeto começa no Orquestrador/);
  assert.match(uiHtml,/data-start-project>Começar pelo Orquestrador/);
  assert.doesNotMatch(uiHtml,/data-create-task/);
  assert.match(ui,/document\.querySelector\('\[data-start-project\]'\)/);
  assert.doesNotMatch(ui,/querySelector\('\[data-create-task\]'\)/);

  assert.match(uiHtml,/Cada campo identifica o seu destino/);
  assert.doesNotMatch(uiHtml,/continuar amanhã|gerencia automaticamente as conversas internas/);
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
  assert.doesNotMatch(main, /executionTail/);
  assert.match(main, /createProviderExecutionScheduler/);
  assert.match(main, /const registeredScheduler=providerScheduler/);
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
  assert.match(worker,/navigationHistory\.canGoBack\(\)/);
  assert.match(worker,/history\.goBack\(\)/);
});

test('ChatGPT text insertion focuses and verifies the embedded composer before dispatch',()=>{
  const start=worker.indexOf('  async #setComposerAndSend(prompt,{onSubmissionIntent=null}={}) {');
  const end=worker.indexOf('    // Wait until React renders a usable submit control',start);
  const preparation=worker.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.ok(preparation.indexOf('this.view.webContents.focus()')<preparation.indexOf('Input.insertText'));
  assert.match(preparation,/document\.activeElement === input \|\| input\.contains\(document\.activeElement\)/);
  assert.match(preparation,/composer_focus_not_observed/);
  const send=worker.slice(start,worker.indexOf('  async #submissionState()',start));
  assert.ok(send.indexOf('await onSubmissionIntent({')<send.indexOf('form.requestSubmit(button)'));
});


test('ChatGPT is embedded in a bounded right pane with safe browser controls', () => {
  assert.match(main, /let chatVisible = false/);
  assert.match(main, /normalizeProviderViewBounds\(providerViewBounds/);
  assert.match(ui, /await window\.ordax\.setChatVisible\(visible\)/);
  assert.match(ui, /window\.ordax\.setProviderBounds\(bounds\)/);
  assert.match(ui, /providerNavigate\('back'\)/);
  assert.match(ui, /providerNavigate\('forward'\)/);
  assert.match(ui, /providerClose/);
  assert.match(ui, /await showProviderPane\(true\)/);
});

test('assistant output streams into OrdaX UI through isolated worker preload', () => {
  assert.match(worker, /worker-preload\.bundle\.cjs/);
  assert.match(workerPreload, /MutationObserver/);
  assert.match(workerPreload, /conversationRoot/);
  assert.match(workerPreload, /main,\[role=\"main\"\]/);
  assert.match(workerPreload, /ordax:worker:stream/);
  assert.match(main, /ordax:task:stream/);
  assert.match(preload, /onTaskStream/);
  assert.match(ui, /updateLiveRun/);
});

test('current ChatGPT DOM identity binds each run to its own assistant message', () => {
  assert.match(providerDomSelectors, /data-chatgpt-selection-message-id/);
  assert.match(providerDomSelectors, /data-user-message-bubble/);
  assert.match(providerDomSelectors, /bg-user-message/);
  assert.match(providerDomSelectors, /data-markdown-text-style/);
  assert.match(workerPreload, /queryProviderMessageNodes/);
  assert.match(workerPreload, /messageId/);
  assert.match(worker, /queryProviderMessageNodes/);
  assert.match(worker, /seenAssistantMessageIds/);
  assert.match(worker, /currentAssistantMessageId/);
  assert.match(worker, /latestUserText/);
});

test('provider health executes shared DOM discovery before constructing its status object',()=>{
  const start=worker.indexOf('const page = await evaluateProviderReadOnlyDom({');
  const end=worker.indexOf('const url = this.view.webContents.getURL()',start);
  const block=worker.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(block,/const composer=\$\{composerExpression\(\)\};\s*\$\{providerMessageQueryBootstrap\}\s*\$\{providerVerificationNoticeProbeBootstrap\}\s*const authControls=\$\{providerAuthControlProbeExpression\};\s*const messageNodes=queryProviderMessageNodes\(document,'user',providerMessageSelectors\)\.length \+\s*queryProviderMessageNodes\(document,'assistant',providerMessageSelectors\)\.length;/);
  assert.match(block,/messageNodes,\s*hasLogin:authControls\.hasLogin,\s*hasSignup:authControls\.hasSignup/);
  assert.doesNotMatch(block,/composer:Boolean\(composer\),\s*\$\{providerMessageQueryBootstrap\}/);
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
  assert.match(css,/grid-template-columns:270px minmax\(450px,1fr\) minmax\(360px,410px\)/);
  assert.match(css, /\.context-rail\.open/);
  assert.match(css, /@media\(max-width:1180px\) and \(min-width:1025px\)/);
  assert.match(css, /@media \(max-width:620px\)/);
  assert.match(css, /@media\(max-width:820px\)/);
  assert.match(css, /body\.orchestrator-focus \.app-shell\{display:grid;grid-template-columns:minmax\(0,1fr\);grid-template-rows:62px minmax\(0,1fr\)\}/);
  assert.match(css, /body\.orchestrator-focus #projectSelect/);
  assert.match(css, /body\.orchestrator-focus #orchestratorSelect/);
  assert.match(css, /body\.orchestrator-focus \.left-footer #login/);
  assert.match(css, /body\.orchestrator-focus #orchestrationNotice/);
  assert.match(html, /aria-label="Entrar no ChatGPT"/);
  assert.match(ui, /O transporte suportado do ChatGPT Web não está disponível nesta página/);
  assert.match(ui, /function applyHostProviderLimit\(\)/);
  assert.match(html, /id="providerClose"[^>]*Fechar navegador/);
  assert.match(html, /id="previewPaneTab"/);
  assert.match(html, /id="contextPaneTab"/);
  assert.match(ui, /#login'\)\.hidden = true/);
  assert.match(ui, /A conta ChatGPT Plan é conectada pelo fluxo oficial do navegador/);
  assert.match(ui, /isso não vincula conversas existentes do ChatGPT Web/);
  assert.match(html, /id="sessionPersistenceNote"/);
});

test('single-project direction leads the desktop navigation without implying autonomous GitHub access',()=>{
  const html=fs.readFileSync(path.join(root,'desktop','ui.html'),'utf8');
  const css=fs.readFileSync(path.join(root,'desktop','ui.css'),'utf8');
  const orchestration=fs.readFileSync(path.join(root,'desktop','orchestrator-ui.mjs'),'utf8');
  for(const id of ['activeProjectName','activeProjectDetail','projectNavList','openOrchestrator','openWorks'])
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id+' must have exactly one owner');
  assert.ok(html.indexOf('id="openOrchestrator"')<html.indexOf('id="projectNavList"'),
    'the administrator must appear before legacy project selectors');
  assert.match(html,/Administrador Geral/);
  assert.match(html,/Execuções GPT/);
  assert.match(html,/<details id="legacyProjectAccess"[^>]*hidden>/);
  assert.match(orchestration,/legacyProjectAccess'\)\.hidden=projects\.length<=1/);
  assert.match(orchestration,/activeProjectName'\)\.textContent=current\?\.name/);
  assert.match(orchestration,/GitHub vinculado por URL · leitura não verificada/);
  assert.match(orchestration,/ADMINISTRAÇÃO ·/);
  assert.match(css,/--font-ui:/);
  for(const token of ['--bg:','--panel:','--panel-2:','--border:','--text:','--muted:','--focus:'])
    assert.ok(css.includes(token),token+' should be defined in the canonical CSS root');
  assert.match(css,/\.project-identity\{/);
  assert.match(css,/\.nav-item\.active\{[^}]*var\(--focus\)/);
  assert.doesNotMatch(html,/id="startProjectAutonomous"/);
});

test('compact administrator navigation retains both accessible selectors and theme SSOT',()=>{
  const html=fs.readFileSync(path.join(root,'desktop','ui.html'),'utf8');
  const css=fs.readFileSync(path.join(root,'desktop','ui.css'),'utf8');
  const rule=name=>{
    const start=css.indexOf(name);
    assert.ok(start>=0,'missing CSS selector '+name);
    return css.slice(start,css.indexOf('}',start)+1);
  };
  assert.equal((css.match(/:root\{/g)||[]).length,1,'one visual token root');
  assert.match(html,/id="projectSelect"[^>]*aria-label="Selecionar projeto ativo"/);
  assert.match(html,/id="orchestratorSelect"[^>]*aria-label="Selecionar administrador do projeto"/);
  assert.match(html,/id="coordinatorApiSettings"[^>]*aria-label="Configurar modelo do Administrador Geral"/);
  assert.match(css,/body\.orchestrator-focus \.app-shell\{grid-template-rows:98px minmax\(0,1fr\)\}/);
  assert.match(css,/body\.orchestrator-focus \.orchestration-navigation\{grid-column:1\/-1;grid-row:2;/);
  assert.match(css,/body\.orchestrator-focus \.left-footer\{grid-column:2;grid-row:1\}/);
  assert.match(css,/body\.orchestrator-focus \.coordinator-head-actions button\{width:36px!important;height:36px!important\}/);
  assert.match(css,/body\.orchestrator-focus \.coordinator-title p\{max-width:42vw;font-size:var\(--type-caption\)/);
  assert.match(css,/body\.orchestrator-focus \.orchestration-connection\{white-space:normal;overflow:visible/);
  assert.match(rule('.work-state.running{'),/border-color:var\(--border-strong\)/);
  assert.match(rule('.work-state.completed{'),/color:var\(--green\)/);
  assert.match(rule('.work-state.attention{'),/color:var\(--amber\)/);
  assert.match(rule('.work-card-copy small{'),/font-size:var\(--type-caption\)/);
  assert.match(rule('.workspace-mode:hover:not(:disabled){'),/background:var\(--panel-3\)/);
  assert.match(rule('.nav-setup input,.nav-setup textarea{'),/background:var\(--panel-2\)/);
  assert.match(rule('.composer .send-button{'),/background:var\(--accent\)/);
});

test('operational overview reuses work state and never presents an experimental flow as autonomous execution',()=>{
  const html=fs.readFileSync(path.join(root,'desktop','ui.html'),'utf8');
  const css=fs.readFileSync(path.join(root,'desktop','ui.css'),'utf8');
  const orchestration=fs.readFileSync(path.join(root,'desktop','orchestrator-ui.mjs'),'utf8');
  for(const id of ['projectPulse','projectPulseTotal','projectPulseRunning','projectPulseAttention','projectPulseWaiting','projectPulseNote','openProjectWork','orchestratorExperiments'])
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,'unique ID: '+id);
  assert.match(html,/<section id="projectPulse"[^>]*hidden>/);
  assert.match(html,/Resumo das frentes registradas, não uma confirmação de execução autônoma/);
  assert.match(html,/<details id="orchestratorExperiments"/);
  assert.match(orchestration,/function renderProjectPulse\(counts,total\)/);
  assert.match(orchestration,/const hasScope=Boolean\(projectId&&orchestratorId\)/);
  assert.match(orchestration,/renderProjectPulse\(counts,works\.length\)/);
  assert.match(orchestration,/for\(const work of works\)counts\[workClass\(work\)\]\+\+/);
  assert.match(orchestration,/\['reconciliation_required','review_required'\]\.includes\(work\.execution\?\.observed\)/);
  assert.match(orchestration,/openProjectWork'\)\.addEventListener\('click',\(\)=>\{/);
  assert.match(orchestration,/Estados das conversas registradas; não comprovam execução autônoma/);
  assert.match(css,/\.project-pulse\[hidden\]\{display:none\}/);
  assert.match(css,/\.project-pulse-stats\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/\.orchestrator-experiments-content\{/);
});

test('project pulse opens a single filtered rail with preserved keyboard focus and no duplicate counters',()=>{
  const html=fs.readFileSync(path.join(root,'desktop','ui.html'),'utf8');
  const css=fs.readFileSync(path.join(root,'desktop','ui.css'),'utf8');
  const orchestration=fs.readFileSync(path.join(root,'desktop','orchestrator-ui.mjs'),'utf8');
  assert.match(html,/id="projectPulseStats"/);
  assert.deepEqual([...html.matchAll(/data-work-filter="([^"]+)"/g)].map(m=>m[1]),['all','running','attention','ready']);
  assert.match(html,/aria-label="Ver frentes que precisam de revisão"/);
  assert.match(orchestration,/projectPulseStats'\)\.addEventListener\('click'/);
  assert.match(orchestration,/const button=event\.target\.closest\('button\[data-work-filter\]'\)/);
  assert.match(orchestration,/openFilteredWorks\(button\.dataset\.workFilter,button\)/);
  assert.match(orchestration,/workStatusFilter'\)\.value=filter/);
  assert.match(orchestration,/workSearch'\)\.value=''/);
  assert.match(orchestration,/applyWorkFilters\(\)/);
  assert.match(orchestration,/setWorkRailOpen\(true\)\.then/);
  assert.match(orchestration,/workRailReturnFocus\?\.isConnected/);
  assert.match(orchestration,/const ordered=\[\.\.\.works\]\.sort\(\(a,b\)=>\{const priority=\{attention:0/);
  assert.doesNotMatch(orchestration,/className='work-overview'/);
  assert.doesNotMatch(css,/\.work-overview-stat\{/);
  assert.match(css,/\.project-pulse-stats>button\{/);
  assert.match(css,/\.project-pulse-stats button:focus-visible\{/);
  assert.match(css,/@media\(max-width:460px\)\{/);
});

test('Orchestrator workspace links project navigation, coordinator and scoped GPT work conversations', () => {
  const html=fs.readFileSync(path.join(root,'desktop','ui.html'),'utf8');
  const css=fs.readFileSync(path.join(root,'desktop','ui.css'),'utf8');
  const orchestration=fs.readFileSync(path.join(root,'desktop','orchestrator-ui.mjs'),'utf8');
  const coordinatorContext=fs.readFileSync(path.join(root,'supervisor','coordinator-request-context.mjs'),'utf8');
  for(const id of ['projectNavList','orchestratorNavList','projectSelect','orchestratorSelect','orchestrationPanel','orchestratorWorkRail','orchestratorWorks','newScopedWorkForm','closeWorkRail'])
    assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/Conversas no GPT/);
  assert.match(html,/Nova conversa no GPT/);
  assert.match(html,/id="analyzeWorks"/);
  assert.match(html,/id="remoteRepositoryCapabilityNote"/);
  assert.match(coordinatorContext,/historyLimit=analysisContext===null\?12:8/);
  assert.match(coordinatorContext,/historyMessageLimit=analysisContext===null\?4000:2000/);
  assert.match(orchestration,/command\('orchestrator_analyze'/);
  assert.match(orchestration,/call\('status'\)\.catch\(\(\)=>null\)/);
  assert.match(orchestration,/const canDisable=result\.enabled===true/);
  assert.match(orchestration,/const canEnable=engineStatus\?\.coordinatorAvailable===true/);
  assert.match(orchestration,/Conecte e ative um modelo de coordenação para habilitar a análise automática/);
  assert.match(orchestration,/engineStatus\?\.autonomousExecution===false/);
  assert.match(orchestration,/A análise só roda enquanto o processo OrdaX está aberto; o supervisor de 24 h do Runtime ainda não está conectado/);
  assert.match(orchestration,/call\('work_list'/);
  assert.match(orchestration,/let refreshPending=false,refreshRequested=false/);
  assert.match(orchestration,/while\(refreshRequested\)/);
  assert.match(orchestration,/await onScopeChange\(new Set\(works\.map\(w=>w\.id\)\)\)/);
  assert.match(orchestration,/if\(item\.id===orchestratorId\)\{void showCoordinator\(\)\.catch\(\(\)=>error\(\)\);return;\}/);
  assert.match(ui,/onScopeChange:async ids=>/);
  assert.match(ui,/try \{await loadTasks\(\);\}\s*catch/);
  assert.match(orchestration,/onOpenWork\(work\.id\)/);
  assert.match(orchestration,/executionSurface==='node_host'/);
  assert.match(orchestration,/const setWorkRailOpen=open=>/);
  assert.match(orchestration,/\$\('closeWorkRail'\)\.addEventListener\('click'/);
  assert.match(orchestration,/coordinatorDraftCommitAvailable/);
  assert.match(orchestration,/envio seguro bloqueado até reiniciá-lo/);
  assert.match(orchestration,/GPT indisponível/);
  assert.match(orchestration,/O ChatGPT conectado responde no chat coordenador; envio às conversas de trabalho ainda não está ligado neste Host/);
  assert.match(orchestration,/URL salva no projeto: \$\{project\.repository_url\}\. Este Host não lê o GitHub nem envia mensagens às frentes de trabalho\./);
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
  assert.match(orchestration,/Este é o chat do Orquestrador via/);
  assert.match(orchestration,/Configurar '\+model/);
  assert.match(orchestration,/ChatGPT Plan · autorizado/);
  assert.match(html,/id="coordinatorApiSettings"[^>]*>Configurar Groq</);
  assert.match(css,/coordinator-head-actions #coordinatorApiSettings\{font-size:9px;width:auto/);
  assert.match(orchestration,/groq_auth_rejected:/);
  assert.match(orchestration,/O tempo de resposta do \$\{provider\} expirou sem confirmação/);
  assert.match(orchestration,/settings\.addEventListener\('click',\(\)=>\$\('coordinatorApiSettings'\)\.click\(\)\)/);
  assert.match(css,/\.coordinator-empty\{[^}]*text-align:center/);
  assert.match(css,/body\.orchestrator-focus \.coordinator-analysis-actions\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/body\.orchestrator-focus \.coordinator-analysis-actions>small\{min-width:0;overflow-wrap:anywhere\}/);
  assert.match(css,/body\.orchestrator-focus \.orchestration-navigation\{grid-column:2;grid-row:1;display:grid/);
  assert.match(css,/body\.orchestrator-focus \.orchestration-capabilities\{display:grid;grid-template-columns:repeat\(auto-fit/);
  assert.match(css,/body:not\(\.orchestrator-focus\) \.left-rail \.orchestration-navigation \.nav-item\.active\{box-sizing:border-box;width:46px/);
  assert.match(css,/body:not\(\.orchestrator-focus\) \.left-rail \.orchestration-navigation \.nav-item:not\(\.active\),\s*body:not\(\.orchestrator-focus\) \.left-rail \.orchestration-navigation \.nav-empty\{display:none\}/);
});

test('startup Task restoration initializes its controls before the first await',()=>{
  const controls=ui.indexOf("const labRoleSelect=document.getElementById('labSupervisorRole')");
  const listener=ui.indexOf("labRoleSelect.addEventListener('change'");
  const startup=ui.indexOf('await orchestrationUi.start({restoreNavigation:savedNavigation})');
  assert.ok(controls>=0&&listener>=0&&startup>controls&&startup>listener);
  assert.match(ui,/if\(epoch!==navigationEpoch\|\|currentTaskId!==id\)return;\s*try \{await persistWorkspaceNavigation/);
});

test('Host keeps execution truth visible while collapsing project setup below the conversation',()=>{
  const html=fs.readFileSync(path.join(root,'desktop','ui.html'),'utf8');
  const css=fs.readFileSync(path.join(root,'desktop','ui.css'),'utf8');
  const orchestration=fs.readFileSync(path.join(root,'desktop','orchestrator-ui.mjs'),'utf8');
  assert.match(html,/<div id="orchestrationCapabilitySummary"[^>]*hidden>/);
  for(const id of ['capabilityGroq','capabilityGpt','capabilityGitHub','capabilityRuntime','capabilityContinuity'])
    assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/<details id="orchestrationIntegrations" class="orchestration-integrations">/);
  assert.match(html,/Projeto, conexões e automação/);
  assert.match(orchestration,/function syncCapabilitySummary\(\)/);
  assert.match(orchestration,/summary\.hidden=!nodeHost/);
  assert.match(orchestration,/GitHub · URL salva, leitura ausente/);
  assert.match(orchestration,/Runtime · workspace sem grant/);
  assert.match(orchestration,/24 h · supervisor ausente/);
  assert.match(css,/\.orchestration-capabilities span\[data-state="partial"\]/);
  assert.match(css,/\.orchestration-integrations-content\{max-height:min\(42vh,340px\);overflow:auto/);
});

test('saving or removing the Groq key refreshes Orchestrator readiness and send actions',()=>{
  const orchestration=fs.readFileSync(path.join(root,'desktop','orchestrator-ui.mjs'),'utf8');
  assert.match(ui,/async function refreshOrchestrationProviderStatus\(\)\{\s*try\{await orchestrationUi\?\.refreshStatus\?\.\(\);\}/);
  assert.equal((ui.match(/await refreshOrchestrationProviderStatus\(\);/g)||[]).length,2);
  assert.match(ui,/Chave salva, mas o estado local não atualizou/);
  assert.match(ui,/Remoção concluída, mas o estado local não atualizou/);
  assert.match(orchestration,/async function refreshApiStatus\(\)\s*\{[\s\S]*?syncCoordinatorActions\(\);/);
  assert.match(orchestration,/refreshStatus:\(\)=>refreshApiStatus\(\)/);
});

test('new missions are local drafts and never silently start a GPT work conversation',()=>{
  const html=fs.readFileSync(path.join(root,'desktop','ui.html'),'utf8');
  const orchestration=fs.readFileSync(path.join(root,'desktop','orchestrator-ui.mjs'),'utf8');
  const contract=fs.readFileSync(path.join(root,'src','orchestrator-contract.mjs'),'utf8');
  const packagedSmoke=fs.readFileSync(path.join(root,'scripts','live-ui-orchestration-smoke.cjs'),'utf8');
  const hostFixture=fs.readFileSync(path.join(root,'scripts','orchestrator-host-e2e-client.cjs'),'utf8');
  assert.match(html,/id="newProjectForm"/);
  assert.match(html,/id="renameProjectForm"/);
  assert.match(html,/aria-label="Nome da conversa"/);
  assert.match(orchestration,/command\('mission_create',input\)/);
  assert.doesNotMatch(orchestration,/onStartMission\(/);
  assert.doesNotMatch(orchestration,/canStartMission\(/);
  assert.match(orchestration,/Projeto e missão criados localmente/);
  assert.match(orchestration,/await showCoordinator\(\)/);
  assert.match(ui,/window\.ordax\.send\(\{ taskId, content, draftRevision \}\)/);
  assert.match(contract,/\['mission_create'/);
  assert.match(contract,/\['project_rename'/);
  assert.match(packagedSmoke,/missionDraftPreserved/);
  assert.match(packagedSmoke,/mission_draft_not_persisted/);
  assert.match(packagedSmoke,/conversationCards!==2/);
  assert.match(packagedSmoke,/phase='work_list_refresh'/);
  assert.match(packagedSmoke,/phase='coordinator_reopen'/);
  assert.match(packagedSmoke,/taskTitle'\)\.textContent==='Frente criada pelo MCP'/);
  assert.match(packagedSmoke,/cleanupReasons\.has\(error\?\.message\)/);
  assert.match(packagedSmoke,/app_orchestration_scenario_failed/);
  assert.match(packagedSmoke,/phase:reportedPhase,reason/);
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
  assert.match(source, /idx_messages_task_sequence/);
  assert.match(source, /SELECT t\.id,t\.title,t\.status,t\.created_at,t\.updated_at/);
  assert.doesNotMatch(source, /SELECT t\.\*, \(SELECT COUNT\(\*\) FROM task_conversations/);
  assert.match(source, /getTaskExecutionSnapshot\(taskId\)/);
  assert.match(main, /store\.getTaskExecutionSnapshot\(taskId\)/);
  assert.match(main, /conversationPlan\.newSession && task\.has_messages/);
  assert.match(source, /const recentMessages=this\.messages\(taskId,\{limit:8\}\)/);
  assert.match(source, /totalMessageCount,/);
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
  assert.match(store, /sequence < \? ORDER BY sequence DESC LIMIT \?/);
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
  assert.match(ui, /Conversa GPT nova aberta/);
  assert.match(ui, /await window\.ordax\.home\(\)/);
  assert.match(uiHtml, /id="recoverProviderConversation"/);
});

test('a persistent project hides internal provider sessions and rotates by observed transcript pressure or the hard turn ceiling', () => {
  const policy = fs.readFileSync(path.join(root,'src','conversation-policy.mjs'),'utf8');
  const store = fs.readFileSync(path.join(root,'src','store.mjs'),'utf8');
  const html = fs.readFileSync(path.join(root,'desktop','ui.html'),'utf8');
  assert.match(policy, /SUCCESSFUL_TURNS_PER_SEGMENT = 24/);
  assert.match(policy, /MAX_OBSERVED_TRANSCRIPT_BYTES_PER_SEGMENT = 64 \* 1024/);
  assert.match(policy, /observedTranscriptPressure/);
  assert.match(main, /planProviderConversation/);
  assert.match(main, /nextPromptBytes:Buffer\.byteLength/);
  assert.match(main, /conversationPlan\.newSession/);
  assert.match(main, /provider\.conversation\.auto_rotated/);
  assert.match(store, /observedConversationTranscriptBytes/);
  assert.match(store, /provider\.submission\.provenance/);
  assert.match(store, /message_assets/);
  assert.match(taskHandlers, /conversation_rotation_during_run/);
  assert.match(html, /internal-diagnostics/);
  assert.match(html, /<details/);
  assert.match(ui, /Projeto contínuo/);
  assert.doesNotMatch(html, /id="rotateConversation"[^>]*Nova conversa interna/);
  assert.match(store, /conversation_completed_runs/);
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
  assert.match(detector, /explicit-project-v3/);
  assert.match(taskHandlers, /memory:candidates:review/);
  assert.match(preload, /reviewMemoryCandidate/);
  assert.match(ui, /renderMemoryCandidates/);
  assert.match(html, /memoryCandidates/);
  assert.match(html, /scanMemoryCandidates/);
});

test('generic project context is assembled from approved memory without truncating requests', () => {
  const store = fs.readFileSync(path.join(root,'src','store.mjs'),'utf8');
  const context = fs.readFileSync(path.join(root,'src','continuation-context.mjs'),'utf8');
  const main = fs.readFileSync(path.join(root,'desktop','main.mjs'),'utf8');
  assert.match(store, /buildProjectContinuation/);
  assert.match(context, /MEMORIA PARCIAL/);
  assert.match(context, /JANELA DE HISTORICO/);
  assert.match(context, /HISTORICO FORA DO ORCAMENTO/);
  assert.match(context, /continuation_budget_invariant_failed/);
  assert.match(main,/assertContinuationContextReady\(continuationPacket\)/);
  assert.match(ui,/continuation_context_unavailable_request_exceeds_budget/);
  assert.match(ui,/continuation_context_critical_memory_omitted/);
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

test('Electron UI document is a single well-formed tree with unique control IDs',()=>{
  const source=fs.readFileSync(path.join(root,'desktop','ui.html'),'utf8');
  const ids=[...source.matchAll(/\bid=\"([^\"]+)\"/g)].map(match=>match[1]);
  assert.equal(source.split('</html>').length,2);
  assert.equal(new Set(ids).size,ids.length,'HTML IDs must be unique for reliable IPC-bound control lookup');
  assert.match(source,/<div id=\"contextPanel\"[^>]*>[\s\S]*<\/div>\s*<\/aside>/);
});

test('late provider recovery refreshes both Electron and Host task views',()=>{
  assert.match(main,/'ordax:task:reconciled':'task-reconciled'/);
  assert.match(preload,/onTaskReconciled: callback => ipcRenderer\.on\('ordax:task:reconciled'/);
  assert.match(hostBridge,/task-reconciled/);
  assert.match(hostBridge,/api\.onTaskReconciled=callback=>subscribe\('task-reconciled',callback\)/);
  assert.match(hostServer,/task-reconciled/);
  assert.match(ui,/window\.ordax\.onTaskReconciled\(async payload=>/);
  assert.match(ui,/recovery\.classList\.add\('recovered'\)/);
});


test('Groq analysis uses the configured credential automatically, never a volatile enable button',()=>{
  const host=fs.readFileSync(path.join(root,'host','host-application.mjs'),'utf8');
  const orchestratorUI=fs.readFileSync(path.join(root,'desktop','orchestrator-ui.mjs'),'utf8');
  assert.match(main,/const coordinatorChatEnabled=\(\)=>Boolean\(currentGroqKey\(\)\)/);
  assert.match(host,/const coordinatorEnabled=\(\)=>Boolean\(apiKey\(\)\|\|chatgptConnection\.isPlanAvailable\(\)\)/);
  assert.match(host,/const activeCoordinatorProvider=\(\)=>apiKey\(\)\?'groq'/);
  assert.doesNotMatch(main,/localCoordinatorChatEnabled|ordax:orchestrator:chat-enable/);
  assert.doesNotMatch(host,/chatEnabled|ordax:orchestrator:chat-enable/);
  assert.doesNotMatch(uiHtml,/coordinatorApiEnable|Ativar Groq para análises/);
  assert.doesNotMatch(orchestratorUI,/coordinatorApiEnable|coordinatorChatEnable/);
  assert.doesNotMatch(preload,/coordinatorChatEnable/);
  assert.doesNotMatch(hostBridge,/coordinatorChatEnable/);
  assert.doesNotMatch(hostServer,/coordinatorChatEnable/);
  assert.match(main,/createGroqCoordinatorConversation/);
});

test('Groq and ChatGPT workspaces have distinct visible destinations and fail-closed routes',()=>{
  const orchestratorUi=fs.readFileSync(path.join(root,'desktop','orchestrator-ui.mjs'),'utf8');
  const contract=fs.readFileSync(path.join(root,'src','orchestrator-contract.mjs'),'utf8');
  const service=fs.readFileSync(path.join(root,'src','orchestrator-service.mjs'),'utf8');
  const css=fs.readFileSync(path.join(root,'desktop','ui.css'),'utf8');
  assert.match(uiHtml,/id="openOrchestrator"/);
  assert.match(uiHtml,/id="openWorks"/);
  assert.match(uiHtml,/ADMINISTRAÇÃO · GROQ/);
  assert.match(uiHtml,/CONVERSA DE TRABALHO · CHATGPT WEB/);
  assert.match(uiHtml,/id="coordinatorComposer"/);
  assert.match(uiHtml,/id="composer"/);
  assert.match(uiHtml,/Enviar à Groq/);
  assert.match(uiHtml,/Enviar ao GPT/);
  assert.match(ui,/setWorkspaceRoute\('coordinator'\)/);
  assert.match(ui,/setWorkspaceRoute\('gpt'\)/);
  assert.match(ui,/flushDraft\(\);await selectRightPane\('context'\)/);
  assert.match(ui,/await selectRightPane\('provider'\)/);
  assert.match(orchestratorUi,/orchestratorChatAvailable=coordinatorAvailable/);
  assert.doesNotMatch(orchestratorUi,/orchestratorChatAvailable=gptWebTransportAvailable/);
  assert.match(orchestratorUi,/\$\('coordinatorComposer'\)\.addEventListener\('submit'/);
  assert.match(orchestratorUi,/command\('orchestrator_chat'/);
  assert.match(contract,/\['orchestrator_chat'.*configured coordinator/);
  assert.match(service,/const usesProvider=isWorkSend;/);
  assert.match(service,/const port=usesProvider\?this\.provider:this\.coordinator/);
  assert.doesNotMatch(service,/const gptWebChat=operation==='orchestrator_chat'/);
  assert.match(css,/#orchestratorWorkRail\{display:flex!important/);
  assert.match(css,/body\.orchestrator-focus \.left-rail \.tasks-wrap\{display:none!important\}/);

  assert.doesNotMatch(orchestratorUi,/GPT Web é o único transporte para enviar mensagens neste chat/);
});


test('coordinator UI admits a single Groq chat or proposal while an async draft is being committed',()=>{
  const source=fs.readFileSync(path.join(root,'desktop','orchestrator-ui.mjs'),'utf8');
  const admission=source.slice(source.indexOf('function syncCoordinatorActions()'),
    source.indexOf('function setCoordinatorDraftState('));
  assert.match(admission,/\$\('coordinatorSend'\)\.disabled=[^\n]*coordinatorSubmitting/);
  assert.match(admission,/\$\('analyzeWorks'\)\.disabled=[^\n]*coordinatorSubmitting/);
  assert.match(admission,/\$\('prepareWork'\)\.disabled=[^\n]*coordinatorSubmitting/);
  const chat=source.slice(source.indexOf("\$('coordinatorComposer')\.addEventListener('submit'"),
    source.indexOf("\$('analyzeWorks')\.addEventListener('click'"));
  assert.match(chat,/if\(coordinatorSubmitting\|\|analysisBusy\|\|\$\('coordinatorSend'\)\.disabled\)return/);
  const locked=chat.indexOf('coordinatorSubmitting=true;syncCoordinatorActions()');
  const draft=chat.indexOf('await prepareCoordinatorDraft(t)');
  const dispatch=chat.indexOf("command('orchestrator_chat'");
  assert.ok(locked>=0&&draft>locked&&dispatch>draft,'acquire before the first await and dispatch');
  assert.match(chat,/if\(p!==projectId\|\|o!==orchestratorId\|\|t!==chatTaskId\|\|!content\)return/);
  assert.match(chat,/\.finally\(\(\)=>\{coordinatorSubmitting=false;syncCoordinatorActions\(\);\}\)/);
  const proposal=source.slice(source.indexOf("\$('prepareWork')\.addEventListener('click'"),
    source.indexOf("\$('coordinatorPrompt')\.addEventListener('input'"));
  assert.match(proposal,/if\(\$\('prepareWork'\)\.disabled\|\|analysisBusy\|\|coordinatorSubmitting/);
  assert.ok(proposal.indexOf('analysisBusy=true;coordinatorSubmitting=true;syncCoordinatorActions()')>=0 &&
    proposal.indexOf('analysisBusy=true;coordinatorSubmitting=true;syncCoordinatorActions()')<
    proposal.indexOf('await prepareCoordinatorDraft(t)'),
    'proposal must lock the shared coordinator before awaiting SQLite draft');
  assert.match(proposal,/finally\{analysisBusy=false;coordinatorSubmitting=false;syncCoordinatorActions\(\);\}/);
  assert.doesNotMatch(chat,/window\.ordax\.send\(/,'Groq UI must never invoke the GPT Web sender');
  assert.doesNotMatch(proposal,/window\.ordax\.send\(/,'Groq planning must never invoke the GPT Web sender');
});

test('asynchronous project and orchestrator refreshes cannot overwrite newer scope or draft',()=>{
  const source=fs.readFileSync(path.join(root,'desktop','orchestrator-ui.mjs'),'utf8');
  const project=source.slice(source.indexOf('async function refreshProjects()'),
    source.indexOf('async function refreshContinuityStatus()'));
  assert.match(project,/const generation=\+\+projectRefreshGeneration/);
  assert.match(project,/if\(generation!==projectRefreshGeneration\)return projectsCache/);
  const orch=source.slice(source.indexOf('async function refreshOrchestrators()'),
    source.indexOf('async function refreshAutonomousDialogue()'));
  const fetch=orch.indexOf("await call('orchestrators_list'");
  const accept=orch.indexOf('orchestrators=result.orchestrators');
  const guard=orch.indexOf('if(generation!==orchestratorRefreshGeneration||p!==projectId)return []');
  assert.ok(fetch>=0&&guard>fetch&&accept>guard,
    'stale lookup must be discarded BEFORE mutating the canonical selection');
  assert.match(orch,/const isCurrent=\(\)=>generation===orchestratorRefreshGeneration&&p===projectId&&selectedId===orchestratorId/);
  assert.match(orch,/await activateCoordinatorDraft\(selected\?\.chat_task_id\|\|null,isCurrent\)/);
  assert.match(orch,/await refreshWorks\(\);\s*if\(!isCurrent\(\)\)return \[\]/);
  assert.match(orch,/await refreshContinuityStatus\(\);\s*if\(!isCurrent\(\)\)return \[\]/);
  const draft=source.slice(source.indexOf('async function activateCoordinatorDraft('),
    source.indexOf('async function prepareCoordinatorDraft('));
  assert.match(draft,/await flushCoordinatorDraft\(\);\s*[^\n]*\n\s*if\(!isCurrent\(\)\)return/);
  assert.match(draft,/if\(!isCurrent\(\)\|\|generation!==coordinatorDraftGeneration\|\|taskId!==chatTaskId\)return/);
  const works=source.slice(source.indexOf('async function refreshWorks()'),
    source.indexOf('async function refreshProjects()'));
  assert.equal((works.match(/generation!==epoch\|\|p!==projectId\|\|o!==orchestratorId/g)||[]).length,2,
    'scope must still be current before and after the async work-list subscription');
});

test('coordinator Enter uses exactly one IME-safe keyboard handler',()=>{
  const source=fs.readFileSync(path.join(root,'desktop','orchestrator-ui.mjs'),'utf8');
  assert.equal((source.match(/\$\('coordinatorPrompt'\)\.addEventListener\('keydown'/g)||[]).length,1);
  const keyboard=source.slice(source.indexOf("\$('coordinatorPrompt').addEventListener('keydown'"),
    source.indexOf("\$('coordinatorComposer').addEventListener('submit'"));
  assert.match(keyboard,/event\.key!=='Enter'\|\|event\.isComposing\|\|event\.shiftKey/);
  assert.match(keyboard,/event\.preventDefault\(\)/);
  assert.match(keyboard,/if\(!\$\('coordinatorSend'\)\.disabled\)\$\('coordinatorComposer'\)\.requestSubmit\(\)/);
  assert.equal((keyboard.match(/requestSubmit\(\)/g)||[]).length,1);
  assert.doesNotMatch(keyboard,/window\.ordax\.send\(/);
});
