/** Shared Store-backed task handlers for the native shell and browser host. */
export function createProviderAwareTaskOpener({
  isChatVisible=()=>false,
  showConversation,
  safeTaskNavigationReason,
  onNavigationResult=()=>{}
}={}) {
  if(typeof isChatVisible!=='function'||typeof showConversation!=='function'||
    typeof safeTaskNavigationReason!=='function'||typeof onNavigationResult!=='function')
    throw Error('task_navigation_dependencies_required');
  let latestNavigationRequest=0;
  let navigationTail=Promise.resolve();
  return task=>{
    if(!task)return null;
    if(!isChatVisible()||!task.chat_url)return task;

    // The local Store is the source of truth for task history. Return it to the
    // renderer before asking the provider pane to navigate: GPT may be slow,
    // offline, or waiting for the user to complete verification.
    const request=++latestNavigationRequest;
    const publish=(provider_navigation,reason)=>{
      if(request!==latestNavigationRequest)return;
      try {
        onNavigationResult({
          taskId:String(task.id),
          provider_navigation,
          ...(reason?{provider_navigation_reason:reason}:{})
        });
      } catch {}
    };
    const navigate=async()=>{
      if(request!==latestNavigationRequest)return;
      try {
        const navigation=await showConversation(task.chat_url);
        if(request!==latestNavigationRequest)return;
        if(navigation?.navigated===false) {
          publish('not_navigated',safeTaskNavigationReason(navigation.reason));
          return;
        }
        publish('navigated');
      } catch(error) {
        publish('failed',safeTaskNavigationReason(error?.message));
      }
    };
    // Serialize provider navigation so a slow previous task cannot finish
    // after, and visually replace, the conversation selected most recently.
    navigationTail=navigationTail.then(navigate,navigate);
    navigationTail.catch(()=>{});
    return {...task,provider_navigation:'pending'};
  };
}

export function createTaskUiHandlers({
  store,
  decorateTask=task=>task,
  decorateMessages=messages=>messages,
  getTaskView=id=>decorateTask(store.getTask(String(id))),
  isRunActive=()=>false,
  onOpenTask=null
}={}) {
  if(!store?.getTask||!store?.listTasks)throw Error('task_ui_store_required');
  const handlers=new Map();
  handlers.set('ordax:workspace:get',()=>store.getWorkspaceSession());
  handlers.set('ordax:workspace:navigation:set',(_event,payload={})=>{
    if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('workspace_navigation_invalid');
    const {view}=payload;
    if(!['home','task','coordinator'].includes(view))throw Error('workspace_navigation_view_invalid');
    const normalizeId=value=>{
      if(value==null||value==='')return null;
      if(typeof value!=='string'||value.length>256||!/^[A-Za-z0-9_-]+$/.test(value))
        throw Error('workspace_navigation_id_invalid');
      return value;
    };
    const taskId=normalizeId(payload.taskId);
    let projectId=normalizeId(payload.projectId);
    let orchestratorId=normalizeId(payload.orchestratorId);
    const session=store.getWorkspaceSession();
    if(!session?.id)throw Error('workspace_session_unavailable');
    if(view==='task') {
      if(!taskId)throw Error('workspace_navigation_task_required');
      const task=store.db.prepare('SELECT id FROM tasks WHERE id=? AND workspace_session_id=?').get(taskId,session.id);
      if(!task)throw Error('task_not_found');
      const binding=store.db.prepare(`SELECT project_id,orchestrator_id FROM lab_task_bindings
        WHERE task_id=?`).get(taskId);
      if(binding) {
        if(projectId!==binding.project_id||orchestratorId!==binding.orchestrator_id)
          throw Error('workspace_navigation_scope_mismatch');
      }
    } else if(taskId) {
      throw Error('workspace_navigation_task_unexpected');
    }
    if(orchestratorId&&!projectId)throw Error('workspace_navigation_project_required');
    if(projectId&&!store.db.prepare('SELECT id FROM lab_projects WHERE id=? AND workspace_session_id=?')
      .get(projectId,session.id))throw Error('workspace_navigation_project_not_found');
    if(orchestratorId&&!store.db.prepare('SELECT id FROM lab_orchestrators WHERE id=? AND project_id=?')
      .get(orchestratorId,projectId))throw Error('workspace_navigation_orchestrator_not_found');
    if(view==='coordinator'&&(!projectId||!orchestratorId))
      throw Error('workspace_navigation_coordinator_scope_required');
    const navigation={schema:'ordax.workspace-navigation.v1',view,taskId,projectId,orchestratorId};
    store.updateWorkspaceMetadata({navigation});
    return navigation;
  });
  handlers.set('ordax:tasks:list',()=>{
    const bindings=new Map(store.db.prepare('SELECT * FROM lab_task_bindings').all().map(row=>[row.task_id,row]));
    return store.listTasks().map(task=>({...task,lab_binding:bindings.get(task.id)||null}));
  });
  handlers.set('ordax:tasks:create',(_event,title)=>decorateTask(store.createTask(String(title||'Nova tarefa'))));
  handlers.set('ordax:tasks:get',(_event,id)=>getTaskView(id));
  handlers.set('ordax:tasks:draft:get',(_event,id)=>store.getTaskDraft(String(id)));
  handlers.set('ordax:tasks:messages:page',(_event,{taskId,before})=>{
    if(!store.getTaskExecutionSnapshot(String(taskId)))throw Error('task_not_found');
    const page=store.messagesPage(String(taskId),{before});
    return {...page,messages:decorateMessages(page.messages)};
  });
  handlers.set('ordax:tasks:rename',(_event,{taskId,title})=>{
    store.renameTask(String(taskId),title);
    return getTaskView(taskId);
  });
  handlers.set('ordax:tasks:draft:set',(_event,{taskId,content,revision})=>
    store.setDraft(String(taskId),content,revision));
  handlers.set('ordax:tasks:open',async(_event,id)=>{
    const task=getTaskView(id);
    return typeof onOpenTask==='function'?onOpenTask(task):task;
  });
  handlers.set('ordax:tasks:resume-capsule',(_event,id)=>store.buildResumeCapsule(String(id)));
  handlers.set('ordax:tasks:rotate-conversation',(_event,id)=>{
    if(isRunActive())throw Error('conversation_rotation_during_run');
    store.rotateConversation(String(id),'manual_ui');
    return getTaskView(id);
  });
  handlers.set('ordax:tasks:memory:upsert',(_event,{taskId,item})=>{
    store.upsertProjectMemory(String(taskId),{...(item||{}),source_type:'manual'});
    return getTaskView(taskId);
  });
  handlers.set('ordax:tasks:memory:archive',(_event,{taskId,memoryId})=>{
    store.archiveProjectMemory(String(taskId),String(memoryId));
    return getTaskView(taskId);
  });
  handlers.set('ordax:tasks:memory:candidates:scan',(_event,taskId)=>{
    store.memoryCandidates.scan(String(taskId));
    return getTaskView(taskId);
  });
  handlers.set('ordax:tasks:memory:candidates:review',(_event,{taskId,candidateId,action,changes})=>{
    store.memoryCandidates.review(String(taskId),String(candidateId),String(action),changes||{});
    return getTaskView(taskId);
  });
  return handlers;
}
