// Native App UI is a client of the same command service as MCP. No DOM of
// ChatGPT, coordinates or direct SQLite access is used to operate the Lab.
import {providerComposeAvailability,COMPOSE_STATUS_MESSAGES} from '../src/provider-compose-availability.mjs';
export function mountOrchestratorUi({api,onScopeChange,onOpenWork,onShowCoordinator,onStartMission,canStartMission}) {
  const $=id=>document.getElementById(id);
  let projectId=null,orchestratorId=null,projectsCache=[],orchestrators=[],epoch=0,chatTaskId=null,workCount=0;
  let coordinatorOpen=false,coordinatorAvailable=false,analysisBusy=false;
  const requestKeys=new Map();
  const status=text=>{$('orchestrationNotice').textContent=text;};
  const call=(operation,input={})=>api.orchestratorInvoke(operation,input);
  function syncCoordinatorActions() {
    const selected=orchestrators.find(item=>item.id===orchestratorId);
    const enabled=coordinatorAvailable&&Boolean(selected)&&selected.status!=='paused';
    $('coordinatorSend').disabled=!enabled||analysisBusy;
    $('analyzeWorks').disabled=!enabled||workCount===0||analysisBusy;
    $('prepareWork').disabled=!enabled||analysisBusy;
  }
  function renderProjectNavigation(projects) {
    const list=$('projectNavList');list.replaceChildren();
    if(!projects.length){const empty=document.createElement('p');empty.className='nav-empty';empty.textContent='Crie seu primeiro projeto.';list.append(empty);return;}
    for(const project of projects){
      const button=document.createElement('button');button.type='button';button.className='nav-item project-nav-item';
      button.textContent=project.name;button.dataset.projectId=project.id;
      button.setAttribute('aria-pressed',String(project.id===projectId));
      if(project.id===projectId)button.classList.add('active');
      button.addEventListener('click',()=>{ $('projectSelect').value=project.id;$('projectSelect').dispatchEvent(new Event('change')); });
      list.append(button);
    }
  }
  function renderOrchestratorNavigation() {
    const list=$('orchestratorNavList');list.replaceChildren();
    if(!projectId){const empty=document.createElement('p');empty.className='nav-empty';empty.textContent='Selecione um projeto.';list.append(empty);return;}
    if(!orchestrators.length){const empty=document.createElement('p');empty.className='nav-empty';empty.textContent='Adicione um orquestrador para começar.';list.append(empty);return;}
    for(const item of orchestrators){
      const button=document.createElement('button');button.type='button';button.className='nav-item orchestrator-nav-item';
      button.textContent=item.name;button.dataset.orchestratorId=item.id;
      button.setAttribute('aria-pressed',String(item.id===orchestratorId));
      if(item.id===orchestratorId)button.classList.add('active');
      button.addEventListener('click',()=>{ $('orchestratorSelect').value=item.id;$('orchestratorSelect').dispatchEvent(new Event('change')); });
      list.append(button);
    }
  }
  function renderWorks(works) {
    const labels={running:['Em andamento','running'],completed:['Concluída','completed'],failed:['Revisar','attention'],error:['Revisar','attention'],interrupted:['Revisar','attention'],paused:['Pausada','paused'],ready:['Pronta','ready']};
    $('workRailCount').textContent=String(works.length);
    $('workRailProject').textContent=$('projectSelect').selectedOptions[0]?.textContent||'';
    const list=$('orchestratorWorks');list.replaceChildren();
    if(!works.length){const empty=document.createElement('div');empty.className='work-rail-empty';empty.textContent='As conversas criadas para este orquestrador aparecerão aqui.';list.append(empty);return;}
    for(const work of works){
      const [label,state]=labels[work.status]||labels.ready;const button=document.createElement('button');
      button.type='button';button.className='work-card';button.dataset.taskId=work.id;
      const copy=document.createElement('span');copy.className='work-card-copy';
      const title=document.createElement('strong');title.textContent=work.title;
      const detail=document.createElement('small');detail.textContent=work.provider_segments?`${work.provider_segments} conversa${work.provider_segments===1?'':'s'} no histórico`:'Conversa pronta para iniciar';
      copy.append(title,detail);const badge=document.createElement('span');badge.className=`work-state ${state}`;badge.textContent=label;
      button.append(copy,badge);button.addEventListener('click',async()=>{
        try{coordinatorOpen=false;await onOpenWork(work.id);}catch{status('Não foi possível abrir esta conversa.');}
      });list.append(button);
    }
  }
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
  function syncProjectRepository() {
    const project=projectsCache.find(item=>item.id===projectId);
    const input=$('projectRepositoryInput');
    input.value=project?.repository_url||'';
    input.disabled=!project;
    $('saveProjectRepository').disabled=!project;
    $('renameProjectButton').disabled=!project;
    $('renameProjectInput').value=project?.name||'';
    $('remoteRepositoryStatus').textContent=!project
      ?'Selecione um projeto.'
      :project.repository_url
        ?`Destino remoto: ${project.repository_url}. A API não leu o conteúdo do repositório.`
        :'Nenhum repositório remoto vinculado. Vincule o GitHub antes de iniciar trabalho sobre código.';
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
    document.body.classList.add('orchestrator-api-settings');
    $('contextRail').classList.add('open');
    $('labSupervisorPanel').open=true;$('labSupervisorKeySettings').open=true;
    $('labSupervisorKeyInput').scrollIntoView({block:'center'});$('labSupervisorKeyInput').focus();
  });
  $('closeCoordinatorApiSettings').addEventListener('click',()=>{
    document.body.classList.remove('orchestrator-api-settings');$('contextRail').classList.remove('open');
  });
  $('addProject').addEventListener('click',()=>{ $('projectSetup').open=true;$('projectObjective').focus(); });
  $('renameProjectButton').addEventListener('click',()=>{
    if(!projectId)return;
    $('renameProjectInput').value=projectsCache.find(item=>item.id===projectId)?.name||'';
    $('projectRenameSetup').open=true;$('renameProjectInput').focus();
  });
  $('addOrchestrator').addEventListener('click',()=>{
    if(!projectId){status('Selecione ou crie um projeto antes de adicionar um orquestrador.');return;}
    $('orchestratorSetup').open=true;$('orchestratorName').focus();
  });
  $('newScopedWorkButton').addEventListener('click',()=>{
    $('newScopedWorkDetails').open=true;$('scopedWorkTitle').focus();
  });
  $('coordinatorRailToggle').addEventListener('click',()=>{
    const open=document.body.classList.toggle('orchestrator-rail-open');
    $('contextRail').classList.toggle('open',open);
    $('coordinatorRailToggle').setAttribute('aria-expanded',String(open));
  });
  $('coordinatorApiEnable').addEventListener('click',async()=>{
    $('coordinatorApiEnable').disabled=true;
    try {await api.coordinatorChatEnable($('coordinatorApiEnable').dataset.enabled!=='true');
      await refreshApiStatus();await refreshOrchestrators();}
    catch {status('Não foi possível ativar o chat. Confira a configuração da API.');}
  });
  async function refreshWorks() {
    const generation=++epoch,p=projectId,o=orchestratorId;
    if(!p) {workCount=0;renderWorks([]);onScopeChange(null);syncCoordinatorActions();return;}
    const {works}=await call('work_list',{projectId:p,...(o?{orchestratorId:o}:{})});
    if(generation!==epoch)return;
    workCount=works.length;
    renderWorks(works);
    onScopeChange(new Set(works.map(w=>w.id)));
    syncCoordinatorActions();
  }
  async function refreshProjects() {
    const result=await call('projects_list');
    projectsCache=result.projects;
    options($('projectSelect'),projectsCache,'Conversas sem projeto');
    if(projectsCache.some(p=>p.id===projectId))$('projectSelect').value=projectId;
    renderProjectNavigation(projectsCache);
    syncProjectRepository();
    return projectsCache;
  }
  async function refreshContinuityStatus() {
    const p=projectId,o=orchestratorId;
    if(!p||!o){$('continuityToggle').disabled=true;$('continuityProposalsToggle').disabled=true;$('continuityState').textContent='Selecione um orquestrador.';return;}
    const result=await call('continuity_status',{projectId:p,orchestratorId:o});
    if(p!==projectId||o!==orchestratorId)return;
    $('continuityToggle').disabled=false;
    $('continuityProposalsToggle').disabled=!result.enabled;
    $('continuityProposalsToggle').dataset.enabled=String(result.nextProposals.enabled);
    $('continuityProposalsToggle').textContent=result.nextProposals.enabled?'Desativar propostas automáticas':'Propor próximas frentes automaticamente';
    $('continuityToggle').dataset.enabled=String(result.enabled);
    $('continuityToggle').textContent=result.enabled?'Desativar análise automática':'Ativar análise automática';
    const messages={disabled:'Desativada',blocked_coordinator:'Bloqueada: configure e ative a API Groq',pending:'Analisando trabalhos concluídos',observing:'Observando novas respostas',reconciliation_required:'Revisão manual necessária'};
    const proposals=result.nextProposals.enabled?(' Próximas propostas: '+result.nextProposals.proposed+'/'+result.nextProposals.maximum+' geradas neste ciclo; exigem revisão.'):' Próximas propostas desativadas.';
    $('continuityState').textContent=(messages[result.state]||'Estado indisponível')+'.'+proposals+' Nenhum envio automático ao GPT.';
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
    syncCoordinatorActions();
    renderOrchestratorNavigation();
    await refreshWorks();
    await refreshContinuityStatus();
    return orchestrators;
  }
  async function renderCoordinator() {
    if(!projectId||!chatTaskId)return;
    const p=projectId,t=chatTaskId,o=orchestratorId;
    const page=await call('work_messages',{projectId:p,taskId:t,limit:50});
    const {proposals}=await call('proposals_list',{projectId:p,orchestratorId:o});
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
    const cards=$('coordinatorProposals');cards.replaceChildren();
    for(const proposal of proposals) {
      const prepared=proposal.status==='prepared';
      const card=document.createElement('article');card.className='coordinator-proposal';
      const title=document.createElement('strong');title.textContent=proposal.title;
      const reason=document.createElement('p');reason.textContent=proposal.reason;
      const draft=document.createElement('pre');draft.textContent=proposal.content;
      const note=document.createElement('p');note.textContent=prepared?'Frente criada. O envio exige nova confirmação da mensagem exata no App.':'Revisar primeira mensagem: criar salva um rascunho local. Nenhum envio ao ChatGPT.';
      const accept=document.createElement('button');accept.type='button';accept.textContent=prepared?'Revisar e enviar ao GPT':'Criar frente com este rascunho';
      accept.disabled=orchestrators.find(item=>item.id===o)?.status==='paused';
      const reject=document.createElement('button');reject.type='button';reject.textContent=prepared?'Abrir e editar':'Descartar proposta';
      for(const [button,approved] of [[accept,true],[reject,false]])button.addEventListener('click',async()=>{
        if(p!==projectId||o!==orchestratorId)return;
        accept.disabled=true;reject.disabled=true;
        try {
          if(prepared&&!approved){coordinatorOpen=false;$('orchestrationPanel').hidden=true;await onOpenWork(proposal.taskId);return;}
          if(prepared) {
            const availability=providerComposeAvailability(await api.providerStatus());
            if(p!==projectId||o!==orchestratorId)return;
            if(!availability.allowed){status(COMPOSE_STATUS_MESSAGES[availability.reason]);accept.disabled=false;reject.disabled=false;return;}
          }
          const receipt=await command(prepared?'proposal_send':'proposal_review',{projectId:p,orchestratorId:o,actionId:proposal.actionId,
            ...(prepared?{draftRevision:proposal.draftRevision}:{approved})});
          if(p!==projectId||o!==orchestratorId)return;
          await refreshWorks();await renderCoordinator();
          if(receipt.status!=='succeeded') {
            if(prepared&&receipt.result?.taskId){coordinatorOpen=false;$('orchestrationPanel').hidden=true;await onOpenWork(receipt.result.taskId);}
            return;
          }
          if(receipt.result.taskId){coordinatorOpen=false;$('orchestrationPanel').hidden=true;await onOpenWork(receipt.result.taskId);}
          status(prepared?'Resposta do GPT observada e registrada na conversa.':approved?'Frente criada com rascunho. Revise e envie pela conversa quando desejar.':'Proposta descartada.');
        }catch{error();await renderCoordinator();}
      });
      card.append(title,reason,draft,note,accept,reject);cards.append(card);
    }
  }
  async function showCoordinator() {
    if(!chatTaskId)return;
    coordinatorOpen=true;
    document.body.classList.remove('orchestrator-api-settings','orchestrator-rail-open');$('contextRail').classList.remove('open');
    $('orchestrationPanel').hidden=false;$('orchestratorWorkRail').hidden=false;
    await onShowCoordinator();
    await renderCoordinator();
  }
  function error() {status('Não foi possível confirmar a operação. Consulte o estado antes de repetir.');}
  async function formAction(form,action) {
    const buttons=[...form.querySelectorAll('button')];
    const previous=buttons.map(b=>b.disabled);buttons.forEach(b=>b.disabled=true);
    try {await action();}catch{error();}finally{buttons.forEach((b,i)=>b.disabled=previous[i]);}
  }
  $('projectSelect').addEventListener('change',async()=>{
    document.body.classList.remove('orchestrator-api-settings','orchestrator-rail-open');$('contextRail').classList.remove('open');
    projectId=$('projectSelect').value||null;orchestratorId=null;
    await refreshProjects();
    $('orchestrationPanel').hidden=true;coordinatorOpen=false;
    try{
      const items=await refreshOrchestrators();
      if(items.length)await showCoordinator();
      else{document.body.classList.remove('orchestrator-focus','orchestrator-rail-open','orchestrator-api-settings');$('empty').classList.remove('hidden');}
    }catch{error();}
  });
  $('orchestratorSelect').addEventListener('change',async()=>{
    orchestratorId=$('orchestratorSelect').value||null;
    try{await refreshOrchestrators();if(chatTaskId)await showCoordinator();}catch{error();}
  });
  $('newProjectForm').addEventListener('submit',event=>{
    event.preventDefault();void formAction(event.currentTarget,async()=>{
      if(typeof canStartMission==='function'&&canStartMission()!==true) {
        status('Conecte uma sessão válida do ChatGPT antes de iniciar a missão. Nenhum projeto foi criado.');
        return;
      }
      const mission=$('projectObjective').value.trim();
      const name=$('projectName').value.trim();
      const repositoryUrl=$('projectRepositoryUrl').value.trim();
      const input={mission,...(name?{name}:{}),...(repositoryUrl?{repositoryUrl}:{})};
      const receipt=await command('mission_create',input);
      if(receipt.status!=='succeeded')return;
      projectId=receipt.result.projectId;orchestratorId=receipt.result.orchestratorId;
      $('newProjectForm').reset();$('projectSetup').open=false;
      await refreshProjects();await refreshOrchestrators();
      if(typeof onStartMission==='function') {
        let sent=false;
        try {sent=await onStartMission({taskId:receipt.result.taskId,mission});} catch {}
        status(sent===true
          ?'Missão enviada à sessão ativa do ChatGPT. Acompanhe a execução e os resultados nesta conversa.'
          :'Projeto criado e missão preservada como rascunho. O envio não foi confirmado; verifique a conversa antes de repetir.');
      } else {
        status('Projeto criado com a missão salva. O executor GPT não está disponível.');
      }
    });
  });
  $('renameProjectForm').addEventListener('submit',event=>{
    event.preventDefault();void formAction(event.currentTarget,async()=>{
      if(!projectId)return;
      const p=projectId;
      const receipt=await command('project_rename',{projectId:p,name:$('renameProjectInput').value});
      if(receipt.status!=='succeeded'||p!==projectId)return;
      $('projectRenameSetup').open=false;
      await refreshProjects();
      status('Nome do projeto atualizado.');
    });
  });
  $('projectRepositoryForm').addEventListener('submit',event=>{
    event.preventDefault();
    const p=projectId,button=$('saveProjectRepository');if(!p)return;
    button.disabled=true;
    void (async()=>{
      try {
        const receipt=await command('project_repository_set',{projectId:p,repositoryUrl:$('projectRepositoryInput').value});
        if(receipt.status!=='succeeded'||p!==projectId)return;
        await refreshProjects();
        status(receipt.result.repositoryUrl
          ?'Repositório remoto vinculado. As tarefas de trabalho vão receber essa URL como destino GitHub.'
          :'Vínculo remoto removido.');
      } catch(error) {
        if(error?.message==='orchestrator_github_repository_invalid')
          status('URL inválida. Use https://github.com/owner/repository.');
        else if(error?.message==='orchestrator_repository_change_requires_new_project')
          status('Este projeto já iniciou trabalho com o remoto atual. Crie outro projeto para usar um repositório diferente.');
        else status('Não foi possível salvar o repositório. Consulte o estado antes de repetir.');
      } finally {button.disabled=false;}
    })();
  });
  $('newOrchestratorForm').addEventListener('submit',event=>{
    event.preventDefault();void formAction(event.currentTarget,async()=>{
      const p=projectId;
      const receipt=await command('orchestrator_create',{projectId:p,name:$('orchestratorName').value,mission:$('missionInput').value});
      if(receipt.status!=='succeeded'||p!==projectId)return;
      orchestratorId=receipt.result.orchestratorId;
      $('newOrchestratorForm').reset();$('orchestratorSetup').open=false;
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
  $('continuityProposalsToggle').addEventListener('click',async()=>{
    const p=projectId,o=orchestratorId;if(!p||!o)return;
    $('continuityProposalsToggle').disabled=true;
    try {await command('continuity_proposals_set',{projectId:p,orchestratorId:o,enabled:$('continuityProposalsToggle').dataset.enabled!=='true'});
      await refreshContinuityStatus();}
    catch {status('Não foi possível mudar as propostas automáticas.');await refreshContinuityStatus();}
  });
  $('continuityToggle').addEventListener('click',async()=>{
    const p=projectId,o=orchestratorId;if(!p||!o)return;
    $('continuityToggle').disabled=true;
    try {await command('continuity_set',{projectId:p,orchestratorId:o,enabled:$('continuityToggle').dataset.enabled!=='true'});
      await refreshContinuityStatus();}
    catch {status('Não foi possível mudar a análise automática.');await refreshContinuityStatus();}
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
  $('analyzeWorks').addEventListener('click',async()=>{
    if($('analyzeWorks').disabled||!projectId||!orchestratorId)return;
    const p=projectId,o=orchestratorId;
    analysisBusy=true;syncCoordinatorActions();
    status('Enviando ao Groq somente o histórico recente limitado deste orquestrador…');
    try {
      const receipt=await command('orchestrator_analyze',{projectId:p,orchestratorId:o});
      if(p!==projectId||o!==orchestratorId)return;
      if(receipt.status==='succeeded')status('Análise registrada no histórico. Nenhuma recomendação foi executada.');
      await renderCoordinator();
    }catch{error();}
    finally{analysisBusy=false;syncCoordinatorActions();}
  });
  $('prepareWork').addEventListener('click',async()=>{
    if($('prepareWork').disabled||!projectId||!orchestratorId)return;
    const p=projectId,o=orchestratorId,content=$('coordinatorPrompt').value.trim();
    if(!content){status('Descreva no campo de mensagem a frente que o orquestrador deve preparar.');$('coordinatorPrompt').focus();return;}
    analysisBusy=true;syncCoordinatorActions();
    status('A IA está preparando uma proposta de frente para sua revisão…');
    try {
      const receipt=await command('orchestrator_prepare',{projectId:p,orchestratorId:o,content});
      if(p!==projectId||o!==orchestratorId)return;
      if(receipt.status==='succeeded'){$('coordinatorPrompt').value='';status('Proposta pronta. Confira título e mensagem antes de criar a frente.');}
      await renderCoordinator();
    }catch{error();}finally{analysisBusy=false;syncCoordinatorActions();}
  });
  $('coordinatorPrompt').addEventListener('keydown',event=>{
    if(event.key==='Enter'&&!event.shiftKey&&!$('coordinatorSend').disabled){event.preventDefault();$('coordinatorComposer').requestSubmit();}
  });
  $('newScopedWorkForm').addEventListener('submit',event=>{
    event.preventDefault();void formAction(event.currentTarget,async()=>{
      await createWork($('scopedWorkTitle').value);
      $('newScopedWorkForm').reset();$('newScopedWorkDetails').open=false;
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
    async start(){const projects=await refreshProjects();
      await refreshApiStatus();
      if(!projectId&&projects.length){projectId=projects[0].id;$('projectSelect').value=projectId;renderProjectNavigation(projects);}
      syncProjectRepository();
      const items=await refreshOrchestrators();
      if(items.length)await showCoordinator();
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
