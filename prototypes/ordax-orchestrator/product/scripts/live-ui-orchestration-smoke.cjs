// Real Electron App-only scenario. Operates native forms and MCP IPC, never
// ChatGPT DOM, screenshots, a paid API, or an installed user profile.
const {waitForLabUiTarget,waitForLabAppMode}=require('./e2e-lab-target.cjs');
const {acquireE2ELock}=require('./e2e-lock.cjs');
acquireE2ELock('orchestration-native-mcp');
if(process.env.ORDAX_LAB_E2E_ORCHESTRATION_APPROVED!=='1')
  throw Error('lab_orchestration_e2e_approval_required');
(async()=>{
  const {ORCHESTRATOR_TOOLS}=await import('../src/orchestrator-contract.mjs');
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
    await waitForLabAppMode(evaluate);
    const proof=await evaluate('window.ordax.labBuildProof()');
    if(proof?.verified!==true||proof.sourceCommit!==process.env.ORDAX_LAB_E2E_EXPECTED_COMMIT)
      throw Error('runtime_identity_mismatch');
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
    await evaluate(`(()=>{
      document.getElementById('projectSetup').open=true;
      document.getElementById('projectName').value='Projeto E2E isolado';
      document.getElementById('projectObjective').value='Validar integração sem envios';
      document.getElementById('newProjectForm').requestSubmit();
    })()`);
    const wait=expression=>evaluate(`(async()=>{for(let n=0;n<80;n++){
      const value=(${expression});if(value)return value;
      await new Promise(r=>setTimeout(r,100));}throw Error('ui_condition_timeout');})()`);
    const projectId=await wait("document.getElementById('projectSelect').value");
    const projectNavigation=await evaluate(`(()=>{const row=[...document.querySelectorAll('#projectNavList button')].find(b=>b.dataset.projectId==='${projectId}');return row?.getAttribute('aria-pressed')==='true'&&row?.textContent==='Projeto E2E isolado'})()`);
    if(!projectNavigation)throw Error('project_navigation_not_selected');
    await evaluate(`(()=>{
      document.getElementById('newOrchestratorForm').closest('details').open=true;
      document.getElementById('orchestratorName').value='Coordenador E2E';
      document.getElementById('missionInput').value='Analisar somente este projeto';
      document.getElementById('newOrchestratorForm').requestSubmit();
    })()`);
    await wait("document.getElementById('orchestratorSelect').value && !document.getElementById('orchestrationPanel').hidden");
    const coordinatorLayout=await evaluate(`(()=>({focus:document.body.classList.contains('orchestrator-focus'),rail:!document.getElementById('orchestratorWorkRail').hidden,selected:[...document.querySelectorAll('#orchestratorNavList button')].some(b=>b.getAttribute('aria-pressed')==='true')}))()`);
    if(!coordinatorLayout.focus||!coordinatorLayout.rail||!coordinatorLayout.selected)throw Error('coordinator_workspace_layout_missing');
    // Disposable credential fixture only: activation must not call the API.
    await evaluate(`window.ordax.supervisorSaveKey('gsk_'+ 'A'.repeat(40))`);
    await wait("!document.getElementById('coordinatorApiEnable').disabled");
    await evaluate(`document.getElementById('coordinatorApiEnable').click()`);
    await wait("document.getElementById('coordinatorApiEnable').dataset.enabled==='true' && !document.getElementById('coordinatorSend').disabled");
    if(await evaluate("document.getElementById('prepareWork').disabled"))throw Error('prepare_action_unavailable');
    await evaluate(`document.getElementById('coordinatorApiEnable').click()`);
    await wait("document.getElementById('coordinatorApiEnable').dataset.enabled==='false' && document.getElementById('coordinatorSend').disabled");
    await evaluate(`window.ordax.supervisorRemoveKey()`);
    await wait("document.getElementById('coordinatorApiEnable').disabled");
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
      return {projectId:p,toolCount:catalog.result.tools.length,
        continuationAvailable:catalog.result.tools.some(t=>t.name==='orchestrator_continuity_status'&&t.annotations?.readOnlyHint===true)&&
          catalog.result.tools.some(t=>t.name==='orchestrator_continuity_proposals_set'&&t.annotations?.readOnlyHint===false),
        commandSucceeded:first.result.structuredContent.status==='succeeded',
        idempotent:JSON.stringify(first.result)===JSON.stringify(repeated.result),
        workCount:works.works.length,workId:works.works[0]?.id,coordinatorMessages:messages.messages.length};
    })()`);
    if(summary.projectId!==projectId||summary.toolCount!==ORCHESTRATOR_TOOLS.length||!summary.continuationAvailable||!summary.commandSucceeded||
      !summary.idempotent||summary.workCount!==1||summary.coordinatorMessages!==0)
      throw Error('native_mcp_state_mismatch');
    await wait("[...document.querySelectorAll('#tasks .task strong')].some(n=>n.textContent==='Frente criada pelo MCP')");
    await evaluate(`document.querySelector('#tasks .task').click()`);
    await wait("!document.getElementById('taskPanel').classList.contains('hidden') && document.getElementById('orchestrationPanel').hidden");
    await evaluate(`document.querySelector('#orchestratorNavList button.active').click()`);
    await wait("!document.getElementById('orchestrationPanel').hidden && document.getElementById('taskPanel').classList.contains('hidden')");
    await evaluate(`document.getElementById('newScopedWorkButton').click()`);
    await wait("document.getElementById('newScopedWorkDetails').open");
    await evaluate(`(()=>{document.getElementById('scopedWorkTitle').value='Frente criada pela interface';document.getElementById('newScopedWorkForm').requestSubmit()})()`);
    await wait("document.querySelectorAll('#orchestratorWorks .work-card').length===2 && !document.getElementById('taskPanel').classList.contains('hidden')");
    const layoutResult=await evaluate(`(()=>({openedWork:document.getElementById('taskTitle').textContent,
      projectItems:document.querySelectorAll('#projectNavList button').length,
      orchestratorItems:document.querySelectorAll('#orchestratorNavList button').length,
      conversationCards:document.querySelectorAll('#orchestratorWorks .work-card').length,
      analysisDisabled:document.getElementById('analyzeWorks').disabled}))()`);
    if(layoutResult.openedWork!=='Frente criada pela interface'||layoutResult.conversationCards!==2||
      layoutResult.analysisDisabled!==true)
      throw Error('work_conversation_layout_failed');
    console.log(JSON.stringify({schema:'ordax.lab.orchestration-app-e2e.v1',ok:true,
      appMode:true,runtimeVerified:true,toolCount:summary.toolCount,sharedStateVerified:true,
      projectFormVerified:true,coordinatorFormVerified:true,workVisibleInApp:true,
      projectNavigationVerified:true,coordinatorWorkspaceVerified:true,workConversationUiVerified:true,
      localApiOptInVerified:true,localApiDisableVerified:true,analysisNeedsExplicitApiOptIn:true,
      idempotencyVerified:true,providerMessagesSent:0,coordinatorApiCalls:0,
      externalMcpConnected:false,autonomousExecution:false}));
  }finally{
    for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('socket_closed'));}
    ws.close();
  }
})().catch(()=>{console.error(JSON.stringify({schema:'ordax.lab.orchestration-app-e2e.v1',ok:false,
  reason:'app_orchestration_scenario_failed'}));process.exitCode=2;});
