// Native App UI is a client of the same command service as MCP. No DOM of
// ChatGPT, coordinates or direct SQLite access is used to operate the Lab.
export function mountOrchestratorUi({api,onScopeChange,onOpenWork,onShowCoordinator}) {
  const $=id=>document.getElementById(id);
  let projectId=null,orchestratorId=null,orchestrators=[],epoch=0,chatTaskId=null;
  let coordinatorOpen=false,coordinatorAvailable=false;
  const requestKeys=new Map();
  const status=text=>{$('orchestrationNotice').textContent=text;};
  const call=(operation,input={})=>api.orchestratorInvoke(operation,input);
  async function command(operation,input) {
    const key=JSON.stringify({operation,input});
    const requestId=requestKeys.get(key)||crypto.randomUUID();
    requestKeys.set(key,requestId);
    const receipt=await call(operation,{requestId,...input});
    if(receipt.status==='succeeded')requestKeys.delete(key);
    else status('O comando precisa de verificação. Nenhuma ação será repetida automaticamente.');
    return receipt;
  }
  function options(select,rows,label) {
    select.replaceChildren(new Option(label,''),...rows.map(row=>new Option(row.name,row.id)));
  }
  async function refreshApiStatus() {
    const state=await api.coordinatorChatStatus();
    coordinatorAvailable=(await call('status')).coordinatorAvailable===true;
    $('coordinatorApiEnable').disabled=!state.configured;
    $('coordinatorApiEnable').textContent=state.enabled?'Desativar chat por API':'Ativar chat por API';
    $('coordinatorApiEnable').dataset.enabled=String(state.enabled);
    $('orchestrationConnection').textContent=!state.configured
      ? 'Configure sua chave Groq para conversar pela API. O MCP não é necessário.'
      : coordinatorAvailable?'Chat por API ativo nesta sessão. Cada envio usa sua conta Groq.'
      : 'Chave configurada. Ative o chat por API para enviar uma mensagem.';
  }
  $('coordinatorApiSettings').addEventListener('click',()=>{
    $('labSupervisorPanel').open=true;$('labSupervisorKeySettings').open=true;
    $('labSupervisorKeyInput').scrollIntoView({block:'center'});$('labSupervisorKeyInput').focus();
  });
  $('coordinatorApiEnable').addEventListener('click',async()=>{
    $('coordinatorApiEnable').disabled=true;
    try {await api.coordinatorChatEnable($('coordinatorApiEnable').dataset.enabled!=='true');
      await refreshApiStatus();await refreshOrchestrators();}
    catch {status('Não foi possível ativar o chat. Confira a configuração da API.');}
  });
  async function refreshWorks() {
    const generation=++epoch,p=projectId,o=orchestratorId;
    if(!p) {onScopeChange(null);return;}
    const {works}=await call('work_list',{projectId:p,...(o?{orchestratorId:o}:{})});
    if(generation!==epoch)return;
    onScopeChange(new Set(works.map(w=>w.id)));
  }
  async function refreshProjects() {
    const {projects}=await call('projects_list');
    options($('projectSelect'),projects,'Conversas sem projeto');
    if(projects.some(p=>p.id===projectId))$('projectSelect').value=projectId;
  }
  async function refreshOrchestrators() {
    const p=projectId;
    orchestrators=p?(await call('orchestrators_list',{projectId:p})).orchestrators:[];
    if(p!==projectId)return;
    if(!orchestrators.some(o=>o.id===orchestratorId))orchestratorId=orchestrators[0]?.id||null;
    options($('orchestratorSelect'),orchestrators,'Selecione um orquestrador');
    $('orchestratorSelect').value=orchestratorId||'';
    const selected=orchestrators.find(o=>o.id===orchestratorId);
    chatTaskId=selected?.chat_task_id||null;
    $('openOrchestrator').disabled=!selected;
    $('pauseOrchestrator').disabled=!selected;
    $('pauseOrchestrator').textContent=selected?.status==='paused'?'Retomar':'Pausar';
    $('newOrchestratorForm').hidden=!p;
    $('orchestratorMission').textContent=selected?.mission||'Configure um orquestrador para este projeto.';
    $('orchestratorTitle').textContent=selected?.name||'Orquestrador';
    $('coordinatorSend').disabled=!coordinatorAvailable||!selected||selected.status==='paused';
    await refreshWorks();
  }
  async function renderCoordinator() {
    if(!projectId||!chatTaskId)return;
    const p=projectId,t=chatTaskId;
    const page=await call('work_messages',{projectId:p,taskId:t,limit:50});
    if(p!==projectId||t!==chatTaskId)return;
    const box=$('coordinatorMessages');box.replaceChildren();
    if(page.has_more) {
      const note=document.createElement('p');
      note.textContent='Exibindo as 50 mensagens mais recentes. O histórico anterior permanece salvo.';
      box.append(note);
    }
    for(const message of page.messages) {
      const article=document.createElement('article');article.className='coordinator-message';
      const role=document.createElement('strong');role.textContent=message.role==='user'?'Você':'Orquestrador';
      const text=document.createElement('p');text.textContent=message.content;
      article.append(role,text);box.append(article);
    }
    box.scrollTop=box.scrollHeight;
  }
  async function showCoordinator() {
    if(!chatTaskId)return;
    coordinatorOpen=true;
    await onShowCoordinator();
    $('orchestrationPanel').hidden=false;
    await renderCoordinator();
  }
  function error() {status('Não foi possível confirmar a operação. Consulte o estado antes de repetir.');}
  async function formAction(form,action) {
    const buttons=[...form.querySelectorAll('button')];
    const previous=buttons.map(b=>b.disabled);buttons.forEach(b=>b.disabled=true);
    try {await action();}catch{error();}finally{buttons.forEach((b,i)=>b.disabled=previous[i]);}
  }
  $('projectSelect').addEventListener('change',async()=>{
    projectId=$('projectSelect').value||null;orchestratorId=null;
    $('orchestrationPanel').hidden=true;coordinatorOpen=false;
    try{await refreshOrchestrators();}catch{error();}
  });
  $('orchestratorSelect').addEventListener('change',async()=>{
    orchestratorId=$('orchestratorSelect').value||null;
    try{await refreshOrchestrators();if(coordinatorOpen)await showCoordinator();}catch{error();}
  });
  $('newProjectForm').addEventListener('submit',event=>{
    event.preventDefault();void formAction(event.currentTarget,async()=>{
      const receipt=await command('project_create',{name:$('projectName').value,objective:$('projectObjective').value});
      if(receipt.status!=='succeeded')return;
      projectId=receipt.result.projectId;orchestratorId=null;
      $('newProjectForm').reset();$('projectSetup').open=false;
      await refreshProjects();await refreshOrchestrators();
      status('Projeto criado. Configure a missão do orquestrador.');
    });
  });
  $('newOrchestratorForm').addEventListener('submit',event=>{
    event.preventDefault();void formAction(event.currentTarget,async()=>{
      const p=projectId;
      const receipt=await command('orchestrator_create',{projectId:p,name:$('orchestratorName').value,mission:$('missionInput').value});
      if(receipt.status!=='succeeded'||p!==projectId)return;
      orchestratorId=receipt.result.orchestratorId;
      $('newOrchestratorForm').reset();
      await refreshOrchestrators();await showCoordinator();status('Orquestrador configurado.');
    });
  });
  $('openOrchestrator').addEventListener('click',()=>{void showCoordinator().catch(error);});
  $('pauseOrchestrator').addEventListener('click',async()=>{
    const o=orchestrators.find(o=>o.id===orchestratorId);if(!o)return;
    try {
      await command('orchestrator_pause',{projectId,orchestratorId,paused:o.status!=='paused'});
      await refreshOrchestrators();
    } catch {error();}
  });
  $('coordinatorComposer').addEventListener('submit',event=>{
    event.preventDefault();void formAction(event.currentTarget,async()=>{
      const p=projectId,o=orchestratorId,content=$('coordinatorPrompt').value.trim();
      if(!content)return;
      status('Consultando o orquestrador…');
      const receipt=await command('orchestrator_chat',{projectId:p,orchestratorId:o,content});
      if(p!==projectId||o!==orchestratorId)return;
      if(receipt.status==='succeeded') {
        $('coordinatorPrompt').value='';status('Resposta registrada. Propostas aguardam execução autorizada.');
      }
      await renderCoordinator();
    });
  });
  $('newScopedWorkForm').addEventListener('submit',event=>{
    event.preventDefault();void formAction(event.currentTarget,async()=>{
      await createWork($('scopedWorkTitle').value);
      $('newScopedWorkForm').reset();
    });
  });
  async function createWork(title='Nova conversa de trabalho') {
    if(!projectId||!orchestratorId)throw Error('orchestrator_selection_required');
    const p=projectId,o=orchestratorId;
    const receipt=await command('work_create',{projectId:p,orchestratorId:o,title});
    if(receipt.status!=='succeeded'||p!==projectId||o!==orchestratorId)return;
    coordinatorOpen=false;$('orchestrationPanel').hidden=true;
    await refreshWorks();await onOpenWork(receipt.result.taskId);
    return receipt.result.taskId;
  }
  return Object.freeze({
    async start(){await refreshProjects();
      await refreshApiStatus();
      await refreshOrchestrators();
      let refreshPending=false;
      api.onOrchestratorChanged?.(()=>{
        if(refreshPending)return;
        refreshPending=true;
        queueMicrotask(()=>{void(async()=>{
          try {
            await refreshApiStatus();
            await refreshProjects();await refreshOrchestrators();if(coordinatorOpen)await renderCoordinator();}
          catch{error();}finally{refreshPending=false;}
        })();});
      });},
    createWork,hasProject:()=>Boolean(projectId),
    getProjectId:()=>projectId,
    hide(){coordinatorOpen=false;$('orchestrationPanel').hidden=true;},
    refresh:refreshWorks
  });
}
