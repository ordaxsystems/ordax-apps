/** Shared Store-backed task handlers for the native shell and browser host. */
export function createProviderAwareTaskOpener({
  isChatVisible=()=>false,
  showConversation,
  safeTaskNavigationReason
}={}) {
  if(typeof isChatVisible!=='function'||typeof showConversation!=='function'||
    typeof safeTaskNavigationReason!=='function')throw Error('task_navigation_dependencies_required');
  return async task=>{
    if(!task)return null;
    if(isChatVisible()&&task.chat_url){
      try {
        const navigation=await showConversation(task.chat_url);
        if(navigation?.navigated===false)return {
          ...task,provider_navigation:'not_navigated',
          provider_navigation_reason:safeTaskNavigationReason(navigation.reason)
        };
      } catch(error) {
        return {
          ...task,provider_navigation:'failed',
          provider_navigation_reason:safeTaskNavigationReason(error?.message)
        };
      }
    }
    return task;
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
