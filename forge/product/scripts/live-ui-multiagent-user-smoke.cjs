// Packaged Windows Electron: real user clicks across THREE administrators and
// THREE independent GPT work conversations. No provider login, paid request,
// forged model reply, installed profile or synthetic UI DOM.
const {waitForLabUiTarget,waitForLabAppMode}=require('./e2e-lab-target.cjs');
const {acquireE2ELock}=require('./e2e-lock.cjs');
const {closeCdpWebSocket}=require('./cdp-websocket-close.cjs');
acquireE2ELock('packaged-multiagent-user');
if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true'||
   process.env.ORDAX_LAB_E2E_ORCHESTRATION_APPROVED!=='1')
  throw Error('multiagent_packaged_ci_required');
const reasons=new Set(['multiagent_app_identity_invalid','multiagent_baseline_unavailable',
  'multiagent_project_unavailable','multiagent_admin_creation_failed',
  'multiagent_admin_switch_failed','multiagent_work_creation_failed',
  'multiagent_draft_unconfirmed','multiagent_draft_leaked',
  'multiagent_session_scope_wrong','multiagent_provider_send_unexpected',
  'multiagent_dom_timeout','multiagent_socket_unavailable',
  'multiagent_app_evaluation_failed']);
let phase='startup',failurePhase=null;
(async()=>{
  const tab=await waitForLabUiTarget();
  const ws=new WebSocket(tab.webSocketDebuggerUrl);
  let seq=0;const pending=new Map();
  const evaluate=source=>new Promise((resolve,reject)=>{
    const id=++seq;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('multiagent_dom_timeout'));},20000);
    pending.set(id,{resolve,reject,timer});
    ws.send(JSON.stringify({id,method:'Runtime.evaluate',
      params:{expression:source,awaitPromise:true,returnByValue:true}}));
  });
  let report=null;
  try{
    await new Promise((resolve,reject)=>{
      ws.onopen=resolve;ws.onerror=()=>reject(Error('multiagent_socket_unavailable'));
    });
    ws.onmessage=event=>{
      let message;try{message=JSON.parse(event.data);}catch{return;}
      const q=pending.get(message.id);if(!q)return;
      pending.delete(message.id);clearTimeout(q.timer);
      if(message.error||message.result?.exceptionDetails)
        q.reject(Error('multiagent_app_evaluation_failed'));
      else q.resolve(message.result?.result?.value);
    };
    phase='app_ready';
    await waitForLabAppMode(evaluate);
    const proof=await evaluate('window.ordax.labBuildProof()');
    if(proof?.verified!==true||proof.sourceCommit!==process.env.ORDAX_LAB_E2E_EXPECTED_COMMIT)
      throw Error('multiagent_app_identity_invalid');
    const wait=expression=>evaluate(`(async()=>{for(let i=0;i<90;i++){
      if(await (${expression}))return true;
      await new Promise(resolve=>setTimeout(resolve,100));
    }return false;})()`);
    phase='baseline';
    const initial=await evaluate(`(async()=>{
      const projects=(await window.ordax.orchestratorInvoke('projects_list')).projects;
      const p=projects.find(x=>x.name==='Projeto E2E isolado');
      if(!p)return null;
      const admins=(await window.ordax.orchestratorInvoke('orchestrators_list',
        {projectId:p.id})).orchestrators;
      const works=(await window.ordax.orchestratorInvoke('work_list',{projectId:p.id})).works;
      return {id:p.id,projectCount:projects.length,adminIds:admins.map(a=>a.id),
        coordinatorId:admins.find(a=>a.name==='Coordenador E2E')?.id,
        baselineWorkIds:works.map(w=>w.id)};
    })()`);
    if(initial?.projectCount!==2||initial.adminIds?.length<2||
       initial.baselineWorkIds?.length!==3||!initial.coordinatorId)
      throw Error('multiagent_baseline_unavailable');
    const p=initial.id;
    phase='select_project';
    const selected=await wait(`(()=>{
      if(document.getElementById('projectSelect').value===${JSON.stringify(p)})return true;
      const btn=[...document.querySelectorAll('#projectNavList button')]
        .find(b=>b.dataset.projectId===${JSON.stringify(p)});
      if(!btn)return false;btn.click();return false;
    })()`);
    if(!selected||!(await wait(`document.getElementById('projectSelect').value===${JSON.stringify(p)}&&
      !document.getElementById('orchestrationPanel').hidden`)))
      throw Error('multiagent_project_unavailable');
    phase='create_admin';
    await evaluate(`(()=>{
      document.getElementById('addOrchestrator').click();
      document.getElementById('orchestratorName').value='Agente de Revisão E2E';
      document.getElementById('missionInput').value='Revisar o trabalho sem enviar mensagens ao GPT';
      document.getElementById('newOrchestratorForm').requestSubmit();
    })()`);
    const adminCreated=await wait(`(async()=>{
      const admins=(await window.ordax.orchestratorInvoke('orchestrators_list',
        {projectId:${JSON.stringify(p)}})).orchestrators;
      const newAdmin=admins.find(a=>a.name==='Agente de Revisão E2E');
      return admins.length===3&&!!newAdmin&&
        document.getElementById('orchestratorSelect').value===newAdmin.id;
    })()`);
    if(!adminCreated)throw Error('multiagent_admin_creation_failed');
    const review=await evaluate(`(async()=>(
      await window.ordax.orchestratorInvoke('orchestrators_list',
        {projectId:${JSON.stringify(p)}})
    ).orchestrators.find(a=>a.name==='Agente de Revisão E2E').id)()`);
    const coordinator=initial.coordinatorId;
    const tasks=[];
    const addConversation=async(title,adminId,draft)=>{
      phase='create_work_'+tasks.length;
      const ready=await wait(`document.getElementById('orchestratorSelect').value===
        ${JSON.stringify(adminId)}&&
        !document.getElementById('orchestrationPanel').hidden`);
      if(!ready)throw Error('multiagent_admin_switch_failed');
      await evaluate(`(()=>{
        document.getElementById('newScopedWorkButton').click();
        document.getElementById('scopedWorkTitle').value=${JSON.stringify(title)};
        document.getElementById('newScopedWorkForm').requestSubmit();
      })()`);
      if(!(await wait(`document.getElementById('taskTitle').textContent===
        ${JSON.stringify(title)}&&
        !document.getElementById('taskPanel').classList.contains('hidden')`))){
        // Diagnostic is limited to synthetic fixture booleans/counts, never
        // credentials, user content, or provider URLs. The gate still fails.
        try{
          const diagnostic=await evaluate(`(async()=>({
            taskTitleMatches:document.getElementById('taskTitle')?.textContent===
              ${JSON.stringify(title)},
            taskPanelVisible:!document.getElementById('taskPanel')?.classList.contains('hidden'),
            selectedAdmin:document.getElementById('orchestratorSelect')?.value===
              ${JSON.stringify(adminId)},
            workExists:(await window.ordax.orchestratorInvoke('work_list',
              {projectId:${JSON.stringify(p)}})).works.some(w=>w.title===${JSON.stringify(title)})
          }))()`);
          console.error(JSON.stringify({schema:'ordax.forge.packaged-work-create-diagnostic/1',
            phase,diagnostic}));
        }catch{}
        throw Error('multiagent_work_creation_failed');
      }
      const taskId=await evaluate("document.getElementById('taskId').textContent.trim()");
      if(!taskId||tasks.some(t=>t.taskId===taskId))
        throw Error('multiagent_work_creation_failed');
      phase='type_draft_'+tasks.length;
      await evaluate(`(()=>{
        const input=document.getElementById('prompt');
        input.value=${JSON.stringify(draft)};
        input.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      const persisted=await wait(`(async()=>{
        const state=await window.ordax.getTaskDraft(${JSON.stringify(taskId)});
        return state?.draft===${JSON.stringify(draft)};
      })()`);
      if(!persisted)throw Error('multiagent_draft_unconfirmed');
      const availability=await evaluate(`(()=>({
        disabled:document.getElementById('send').disabled,
        sendReady:document.getElementById('composer').dataset.sendReady,
        taskVisible:document.getElementById('taskTitle').textContent
      }))()`);
      if(availability.sendReady==='true'||availability.disabled!==true)
        throw Error('multiagent_provider_send_unexpected');
      tasks.push({taskId,title,adminId,draft});
      await evaluate("document.getElementById('taskBackToForjador').click()");
      if(!(await wait("!document.getElementById('orchestrationPanel').hidden")))
        throw Error('multiagent_admin_switch_failed');
    };
    const switchAdmin=async id=>{
      phase='switch_admin';
      const clicked=await evaluate(`(()=>{
        const row=[...document.querySelectorAll('#orchestratorNavList button')]
          .find(x=>x.dataset.orchestratorId===${JSON.stringify(id)});
        if(!row||row.disabled)return false;row.click();return true;
      })()`);
      if(!clicked||!(await wait(`document.getElementById('orchestratorSelect').value===
         ${JSON.stringify(id)}&&
         !document.getElementById('orchestrationPanel').hidden`)))
        throw Error('multiagent_admin_switch_failed');
    };
    await addConversation('Revisão visual E2E',review,
      'Revisar legibilidade do painel sem enviar ao GPT - agente revisão');
    await switchAdmin(coordinator);
    await addConversation('Implementar layout E2E',coordinator,
      'Construir componentes do layout - agente implementação');
    await addConversation('Testes e backend E2E',coordinator,
      'Validar SQLite, UI e MCP - agente backend');
    // User switches between agents and opens all three real Task views.
    // Drafts and persisted Task identities may NEVER follow the wrong agent.
    for(const item of [tasks[0],tasks[2],tasks[1],tasks[0]]){
      await switchAdmin(item.adminId);
      phase='open_conversation';
      const visible=await wait(`!!document.querySelector(
        '#tasks .task[data-id=${JSON.stringify(item.taskId)}]')`);
      if(!visible)throw Error('multiagent_session_scope_wrong');
      const opened=await evaluate(`(()=>{
        const button=[...document.querySelectorAll('#tasks .task')]
          .find(x=>x.dataset.id===${JSON.stringify(item.taskId)});
        if(!button)return false;button.click();return true;
      })()`);
      if(!opened||!(await wait(`document.getElementById('taskTitle').textContent===
        ${JSON.stringify(item.title)}&&
        document.getElementById('prompt').value===${JSON.stringify(item.draft)}`)))
        throw Error('multiagent_draft_leaked');
      const state=await evaluate(`(async()=>({
        id:document.getElementById('taskId').textContent.trim(),
        draft:(await window.ordax.getTaskDraft(${JSON.stringify(item.taskId)})).draft,
        sendReady:document.getElementById('composer').dataset.sendReady
      }))()`);
      if(state.id!==item.taskId||state.draft!==item.draft||state.sendReady==='true')
        throw Error('multiagent_draft_leaked');
      await evaluate("document.getElementById('taskBackToForjador').click()");
      if(!(await wait("!document.getElementById('orchestrationPanel').hidden")))
        throw Error('multiagent_admin_switch_failed');
    }
    phase='backend_integrity';
    const integrity=await evaluate(`(async()=>{
      const api=window.ordax,p=${JSON.stringify(p)};
      const tasks=${JSON.stringify(tasks.map(x=>({taskId:x.taskId,title:x.title,adminId:x.adminId})))};
      const works=(await api.orchestratorInvoke('work_list',{projectId:p})).works;
      const source=await Promise.all(tasks.map(async item=>({
        ...item,draft:(await api.getTaskDraft(item.taskId)).draft,
        messages:(await api.orchestratorInvoke('work_messages',
          {projectId:p,taskId:item.taskId,limit:10})).messages.length
      })));
      const all=await api.listTasks();
      return {works,source,activeRuns:all.filter(x=>x.status==='running').length,
        totalNew:source.length};
    })()`);
    if(integrity.totalNew!==3||integrity.activeRuns!==0||
       integrity.source.some((x,i)=>x.messages!==0||x.draft!==tasks[i].draft)||
       tasks.some(x=>!integrity.works.some(w=>w.id===x.taskId&&
         w.orchestrator_id===x.adminId&&w.provider_segments===0&&
         w.running_runs===0)))
      throw Error('multiagent_session_scope_wrong');
    const foreign=await evaluate(`(async()=>{
      const other=(await window.ordax.orchestratorInvoke('projects_list')).projects
        .find(project=>project.id!==${JSON.stringify(p)});
      if(!other)return null;
      const works=(await window.ordax.orchestratorInvoke('work_list',
        {projectId:other.id})).works;
      return {projectId:other.id,workIds:works.map(item=>item.id)};
    })()`);
    if(!foreign||foreign.workIds.some(id=>tasks.some(task=>task.taskId===id)))
      throw Error('multiagent_session_scope_wrong');
    report={schema:'ordax.forge.packaged-multiagent-user-e2e/1',ok:true,
      packagedElectron:true,nativeUiClicks:true,disposableProfile:true,
      administratorCount:3,independentConversations:3,
      switchSequenceVerified:4,draftPersistenceVerified:true,
      canonicalSQLiteVerified:true,unconfirmedGptReplies:0,
      realGptRepliesVerified:false,providerMessagesSent:0,
      crossAgentLeakDetected:false,parallelGptExecutionVerified:false};
  }catch(e){failurePhase=phase;throw e;}
  finally{
    for(const q of pending.values()){clearTimeout(q.timer);q.reject(Error('socket_closed'));}
    pending.clear();
    await closeCdpWebSocket(ws);
  }
  console.log(JSON.stringify(report));
})().catch(error=>{
  console.error(JSON.stringify({schema:'ordax.forge.packaged-multiagent-user-e2e/1',
    ok:false,phase:failurePhase||phase,
    reason:reasons.has(error?.message)?error.message:'multiagent_scenario_unconfirmed'}));
  process.exitCode=2;
});
