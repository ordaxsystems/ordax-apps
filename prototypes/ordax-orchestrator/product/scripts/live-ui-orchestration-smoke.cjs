// Real Electron App-only scenario. Operates native forms and MCP IPC, never
// ChatGPT DOM, screenshots, a paid API, or an installed user profile.
const {waitForLabUiTarget,waitForLabAppMode}=require('./e2e-lab-target.cjs');
const {acquireE2ELock}=require('./e2e-lock.cjs');
const {closeCdpWebSocket}=require('./cdp-websocket-close.cjs');
acquireE2ELock('orchestration-native-mcp');
if(process.env.ORDAX_LAB_E2E_ORCHESTRATION_APPROVED!=='1')
  throw Error('lab_orchestration_e2e_approval_required');
let phase='startup';
(async()=>{
  const {ORCHESTRATOR_TOOLS}=await import('../src/orchestrator-contract.mjs');
  phase='app_start';
  const tab=await waitForLabUiTarget();
  const ws=new WebSocket(tab.webSocketDebuggerUrl);
  let sequence=0;
  const pending=new Map();
  try {
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=()=>reject(Error('socket_unavailable'));});
    ws.onmessage=event=>{
      let message;try{message=JSON.parse(event.data);}catch{return;}
      const waiter=pending.get(message.id);if(!waiter)return;
      pending.delete(message.id);clearTimeout(waiter.timer);
      if(message.error||message.result?.exceptionDetails)waiter.reject(Error('app_evaluation_failed'));
      else waiter.resolve(message.result?.result?.value);
    };
    const evaluate=expression=>new Promise((resolve,reject)=>{
      const id=++sequence;
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('app_evaluation_timeout'));},20000);
      pending.set(id,{resolve,reject,timer});
      ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
    });
    let disposableApiKeyCleanupRequired=false;
    let successReport=null;
    phase='app_ready';
    await waitForLabAppMode(evaluate);
    const proof=await evaluate('window.ordax.labBuildProof()');
    if(proof?.verified!==true||proof.sourceCommit!==process.env.ORDAX_LAB_E2E_EXPECTED_COMMIT)
      throw Error('runtime_identity_mismatch');
    phase='fresh_profile';
    const before=await evaluate(`(async()=>({status:await window.ordax.orchestratorInvoke('status'),
      projects:(await window.ordax.orchestratorInvoke('projects_list')).projects.length,
      taskCount:(await window.ordax.listTasks()).length,
      analysisButton:!!document.getElementById('analyzeWorks'),
      analysisDisabled:document.getElementById('analyzeWorks')?.disabled,
      prepareDisabled:document.getElementById('prepareWork')?.disabled,
      proposalsPresent:!!document.getElementById('coordinatorProposals'),
      analysisHint:document.getElementById('analysisScopeHint')?.textContent||''}))()`);
    if(before.projects!==0||before.taskCount!==0||before.status.coordinatorAvailable!==false||
      before.status.autonomousExecution!==false||!before.analysisButton||before.analysisDisabled!==true||
      !before.analysisHint.includes('não executam ações')||before.prepareDisabled!==true||!before.proposalsPresent)throw Error('fresh_disabled_profile_required');
    phase='mission_create';
    await evaluate(`(()=>{
      document.getElementById('projectSetup').open=true;
      document.getElementById('projectName').value='Projeto E2E isolado';
      document.getElementById('projectObjective').value='Criar missão isolada sem enviar ao provedor';
      document.getElementById('newProjectForm').requestSubmit();
    })()`);
    const wait=expression=>evaluate(`(async()=>{for(let n=0;n<80;n++){
      const value=await (${expression});if(value)return value;
      await new Promise(r=>setTimeout(r,100));}throw Error('ui_condition_timeout');})()`);
    phase='mission_project_selected';
    const projectId=await wait("document.getElementById('projectSelect').value");
    const projectNavigation=await evaluate(`(()=>{const row=[...document.querySelectorAll('#projectNavList button')].find(b=>b.dataset.projectId==='${projectId}');return row?.getAttribute('aria-pressed')==='true'&&row?.textContent==='Projeto E2E isolado'})()`);
    if(!projectNavigation)throw Error('project_navigation_not_selected');
    phase='mission_persisted';
    await wait("document.getElementById('orchestrationNotice')?.textContent?.includes('salva como rascunho')");
    const missionDraft=await evaluate(`(async()=>{
      const projectId=document.getElementById('projectSelect').value;
      const coordinators=(await window.ordax.orchestratorInvoke('orchestrators_list',{projectId})).orchestrators;
      const works=(await window.ordax.orchestratorInvoke('work_list',{projectId})).works;
      const first=works.find(work=>work.title==='Primeira frente');
      const task=first?await window.ordax.getTask(first.id):null;
      return {coordinatorCount:coordinators.length,workCount:works.length,
        mission:coordinators[0]?.mission,draft:task?.draft,draftRevision:task?.draft_revision};
    })()`);
    if(missionDraft.coordinatorCount!==1||missionDraft.workCount!==1||
      missionDraft.mission!=='Criar missão isolada sem enviar ao provedor'||
      missionDraft.draft!==missionDraft.mission||missionDraft.draftRevision!==1)
      throw Error('mission_draft_not_persisted');
    phase='workspace_access';
    await wait("document.getElementById('workspaceConnection')?.textContent?.includes('ainda indisponível')");
    const workspace=await evaluate(`(async()=>{const projectId=document.getElementById('projectSelect').value;
      const state=await window.ordax.orchestratorInvoke('workspace_status',{projectId});
      return {available:state.available,state:state.state,bindings:state.bindings.length,
        ui:document.getElementById('workspaceConnection')?.textContent||''};})()`);
    if(workspace.available!==false||workspace.state!=='capability_unavailable'||
      workspace.bindings!==0||!workspace.ui.includes('ainda indisponível'))
      throw Error('workspace_grant_absence_not_visible');
    phase='coordinator_create';
    await evaluate(`(()=>{
      document.getElementById('newOrchestratorForm').closest('details').open=true;
      document.getElementById('orchestratorName').value='Coordenador E2E';
      document.getElementById('missionInput').value='Analisar somente este projeto';
      document.getElementById('newOrchestratorForm').requestSubmit();
    })()`);
    await wait("document.getElementById('orchestratorSelect').value && !document.getElementById('orchestrationPanel').hidden");
    const coordinatorLayout=await evaluate(`(()=>({focus:document.body.classList.contains('orchestrator-focus'),rail:!document.getElementById('orchestratorWorkRail').hidden,selected:[...document.querySelectorAll('#orchestratorNavList button')].some(b=>b.getAttribute('aria-pressed')==='true')}))()`);
    if(!coordinatorLayout.focus||!coordinatorLayout.rail||!coordinatorLayout.selected)throw Error('coordinator_workspace_layout_missing');
    phase='api_key_save';
    // Disposable credential fixture only: activation must not call the API.
    disposableApiKeyCleanupRequired=true;
    await evaluate(`window.ordax.supervisorSaveKey('gsk_'+ 'A'.repeat(40))`);
    phase='api_key_save_status';
    const credential=await evaluate(`window.ordax.supervisorStatus()`);
    if(credential.configured!==true||credential.keySaved!==true||credential.secureStorageAvailable!==true)
      throw Error('api_key_not_persisted_securely');
    phase='api_enable_button_available';
    await wait("!document.getElementById('coordinatorApiEnable').disabled");
    phase='api_enable_request';
    await evaluate(`document.getElementById('coordinatorApiEnable').click()`);
    phase='api_enable_state';
    await wait("document.getElementById('coordinatorApiEnable').dataset.enabled==='true' && !document.getElementById('coordinatorSend').disabled");
    phase='api_prepare_action_available';
    if(await evaluate("document.getElementById('prepareWork').disabled"))throw Error('prepare_action_unavailable');
    phase='api_disable_request';
    await evaluate(`document.getElementById('coordinatorApiEnable').click()`);
    phase='api_disable_state';
    // Disabling Groq must turn off analysis/preparation while leaving the
    // central composer available through the primary GPT Web executor.
    await wait("document.getElementById('coordinatorApiEnable').dataset.enabled==='false' && !document.getElementById('coordinatorSend').disabled && document.getElementById('analyzeWorks').disabled && document.getElementById('prepareWork').disabled && document.getElementById('orchestrationConnection').textContent.includes('Groq está desligado.')");
    phase='api_key_remove';
    await evaluate(`window.ordax.supervisorRemoveKey()`);
    phase='api_key_remove_state';
    await wait("document.getElementById('coordinatorApiEnable').disabled && (async()=>!(await window.ordax.supervisorStatus()).keySaved)()");
    disposableApiKeyCleanupRequired=false;
    phase='mcp_work_create';
    const summary=await evaluate(`(async()=>{
      const p=document.getElementById('projectSelect').value;
      const o=document.getElementById('orchestratorSelect').value;
      const api=window.ordax;
      const initialize=await api.orchestratorMcp({jsonrpc:'2.0',id:1,method:'initialize',params:{
        protocolVersion:'2025-11-25',clientInfo:{name:'App-only-E2E',version:'1'},capabilities:{}}});
      if(initialize.error)throw Error('mcp_initialization_failed');
      await api.orchestratorMcp({jsonrpc:'2.0',method:'notifications/initialized'});
      const catalog=await api.orchestratorMcp({jsonrpc:'2.0',id:2,method:'tools/list'});
      const command={jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'orchestrator_work_create',arguments:{
        requestId:'app-only-work-once',projectId:p,orchestratorId:o,title:'Frente criada pelo MCP'}}};
      const first=await api.orchestratorMcp(command);
      const repeated=await api.orchestratorMcp({...command,id:4});
      const works=await api.orchestratorInvoke('work_list',{projectId:p});
      const orchs=await api.orchestratorInvoke('orchestrators_list',{projectId:p});
      const messages=await api.orchestratorInvoke('work_messages',{projectId:p,taskId:orchs.orchestrators[0].chat_task_id});
      const missionWork=works.works.find(work=>work.title==='Primeira frente');
      const missionTask=missionWork?await api.getTask(missionWork.id):null;
      return {projectId:p,toolCount:catalog.result.tools.length,
        continuationAvailable:catalog.result.tools.some(t=>t.name==='orchestrator_continuity_status'&&t.annotations?.readOnlyHint===true)&&
          catalog.result.tools.some(t=>t.name==='orchestrator_continuity_proposals_set'&&t.annotations?.readOnlyHint===false),
        commandSucceeded:first.result.structuredContent.status==='succeeded',
        idempotent:JSON.stringify(first.result)===JSON.stringify(repeated.result),
        workCount:works.works.length,workId:works.works[0]?.id,coordinatorMessages:messages.messages.length,
        missionDraftPreserved:missionTask?.draft==='Criar missão isolada sem enviar ao provedor'&&missionTask?.draft_revision===1};
    })()`);
    if(summary.projectId!==projectId||summary.toolCount!==ORCHESTRATOR_TOOLS.length||!summary.continuationAvailable||!summary.commandSucceeded||
      !summary.idempotent||summary.workCount!==2||!summary.missionDraftPreserved||summary.coordinatorMessages!==0)
      throw Error('native_mcp_state_mismatch');
    phase='work_list_refresh';
    await wait("[...document.querySelectorAll('#tasks .task strong')].some(n=>n.textContent==='Frente criada pelo MCP')");
    phase='work_open';
    await evaluate(`([...document.querySelectorAll('#tasks .task')].find(row=>row.querySelector('strong')?.textContent==='Frente criada pelo MCP')?.click())`);
    await wait("!document.getElementById('taskPanel').classList.contains('hidden') && document.getElementById('orchestrationPanel').hidden && document.getElementById('taskTitle').textContent==='Frente criada pelo MCP'");
    phase='coordinator_reopen';
    await evaluate(`document.querySelector('#orchestratorNavList button.active').click()`);
    await wait("!document.getElementById('orchestrationPanel').hidden && document.getElementById('taskPanel').classList.contains('hidden')");
    phase='scoped_work_create';
    await evaluate(`document.getElementById('newScopedWorkButton').click()`);
    await wait("document.getElementById('newScopedWorkDetails').open");
    await evaluate(`(()=>{document.getElementById('scopedWorkTitle').value='Frente criada pela interface';document.getElementById('newScopedWorkForm').requestSubmit()})()`);
    await wait("document.querySelectorAll('#orchestratorWorks .work-card').length===2 && !document.getElementById('taskPanel').classList.contains('hidden') && document.getElementById('taskTitle').textContent==='Frente criada pela interface'");
    const layoutResult=await evaluate(`(()=>({openedWork:document.getElementById('taskTitle').textContent,
      projectItems:document.querySelectorAll('#projectNavList button').length,
      orchestratorItems:document.querySelectorAll('#orchestratorNavList button').length,
      conversationCards:document.querySelectorAll('#orchestratorWorks .work-card').length,
      analysisDisabled:document.getElementById('analyzeWorks').disabled}))()`);
    phase='final_layout_verify';
    if(layoutResult.openedWork!=='Frente criada pela interface'||layoutResult.conversationCards!==2||
      layoutResult.analysisDisabled!==true)
      throw Error('work_conversation_layout_failed');
    successReport={schema:'ordax.lab.orchestration-app-e2e.v1',ok:true,
      appMode:true,runtimeVerified:true,toolCount:summary.toolCount,sharedStateVerified:true,
      projectFormVerified:true,missionDraftPersisted:true,missionStartBlockedWithoutSession:true,
      coordinatorFormVerified:true,workVisibleInApp:true,
      projectNavigationVerified:true,coordinatorWorkspaceVerified:true,workConversationUiVerified:true,
      projectWorkspaceFailClosedVerified:true,
      localApiOptInVerified:true,localApiDisableVerified:true,analysisNeedsExplicitApiOptIn:true,
      idempotencyVerified:true,providerMessagesSent:0,coordinatorApiCalls:0,
      externalMcpConnected:false,autonomousExecution:false};
  }finally{
    try {
      if(disposableApiKeyCleanupRequired) {
        phase='test_credential_cleanup';
        await evaluate(`window.ordax.supervisorRemoveKey()`);
        const status=await evaluate(`window.ordax.supervisorStatus()`);
        if(status?.keySaved!==false)throw Error('test_api_key_cleanup_failed');
      }
    } finally {
      phase='pending_request_cleanup';
      for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('socket_closed'));}
      phase='cdp_websocket_cleanup';
      await closeCdpWebSocket(ws);
    }
  }
  console.log(JSON.stringify(successReport));
})().catch(error=>{
  const cleanupReasons=new Set(['cdp_websocket_close_unavailable','cdp_websocket_close_timeout_invalid',
    'cdp_websocket_close_invalid_state','cdp_websocket_close_timeout','cdp_websocket_close_failed']);
  const reason=phase==='cdp_websocket_cleanup'&&cleanupReasons.has(error?.message)
    ?error.message:'app_orchestration_scenario_failed';
  console.error(JSON.stringify({schema:'ordax.lab.orchestration-app-e2e.v1',ok:false,phase,reason}));
  process.exitCode=2;
});

