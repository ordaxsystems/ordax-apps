// Native App UI is a client of the same command service as MCP. No DOM of
// ChatGPT, coordinates or direct SQLite access is used to operate the Lab.
import {providerComposeAvailability,COMPOSE_STATUS_MESSAGES} from '../src/provider-compose-availability.mjs';
export function mountOrchestratorUi({api,onScopeChange,onOpenWork,onShowCoordinator,onSelectRightPane,onNavigationChange}) {
  const $=id=>document.getElementById(id);
  let projectId=null,orchestratorId=null,projectsCache=[],orchestrators=[],epoch=0,chatTaskId=null,workCount=0;
  let coordinatorOpen=false,coordinatorAvailable=false,orchestratorChatAvailable=false,coordinatorDraftCommitAvailable=false;
  let gptWebTransportAvailable=false;
  let chatgptPlanStatus={connected:false,planUsageAuthorized:false,secureStorageAvailable:false};
  let groqConfigured=false,coordinatorProvider=null;
  let analysisBusy=false,coordinatorSubmitting=false,nodeHost=false;
  let coordinatorDraftTaskId=null,coordinatorDraftRevision=0,coordinatorDraftTimer=null;
  let coordinatorDraftGeneration=0,pendingCoordinatorDraft=null,coordinatorDraftWrite=Promise.resolve();
  const requestKeys=new Map();
  const status=text=>{$('orchestrationNotice').textContent=text;};
  const call=(operation,input={})=>api.orchestratorInvoke(operation,input);
  function syncCapabilitySummary() {
    const summary=$('orchestrationCapabilitySummary');
    if(!summary)return;
    summary.hidden=!nodeHost;
    if(!nodeHost)return;
    const project=projectsCache.find(item=>item.id===projectId);
    const set=(id,label,state)=>{
      const item=$(id);item.textContent=label;item.dataset.state=state;
    };
    set('capabilityGroq',!groqConfigured?'Groq · opcional, sem chave':coordinatorProvider==='groq'&&coordinatorAvailable
      ?'Groq · ativo':'Groq · alternativo inativo',
      coordinatorProvider==='groq'&&coordinatorAvailable?'ready':groqConfigured?'partial':'blocked');
    set('capabilityGpt',!chatgptPlanStatus.connected?'ChatGPT Plan · não conectado':
      chatgptPlanStatus.planUsageAuthorized?'ChatGPT Plan · autorizado':'ChatGPT · uso do plano não autorizado',
      chatgptPlanStatus.planUsageAuthorized?'ready':chatgptPlanStatus.connected?'partial':'blocked');
    set('capabilityGitHub',project?.repository_url?'GitHub · URL salva, leitura ausente':'GitHub · sem leitura autenticada',
      project?.repository_url?'partial':'blocked');
    set('capabilityRuntime','Runtime · workspace sem grant','blocked');
    set('capabilityContinuity','24 h · supervisor ausente','blocked');
  }
  function syncCoordinatorActions() {
    const selected=orchestrators.find(item=>item.id===orchestratorId);
    const selectedReady=Boolean(selected)&&selected.status!=='paused';
    $('coordinatorSend').disabled=!orchestratorChatAvailable||!selectedReady||analysisBusy||coordinatorSubmitting||!coordinatorDraftCommitAvailable;
    $('analyzeWorks').disabled=!coordinatorAvailable||!selectedReady||workCount===0||analysisBusy||coordinatorSubmitting;
    $('prepareWork').disabled=!coordinatorAvailable||!selectedReady||analysisBusy||coordinatorSubmitting||!coordinatorDraftCommitAvailable;
    $('startAutonomousDialogue').disabled=!coordinatorAvailable||!gptWebTransportAvailable||!selectedReady||analysisBusy||coordinatorSubmitting;
    $('startAutonomousStory').disabled=$('startAutonomousDialogue').disabled;
    $('coordinatorPrompt').disabled=coordinatorSubmitting||!chatTaskId;
  }
  function setCoordinatorDraftState(text='') {
    const compatibility=coordinatorDraftCommitAvailable?'':
      'Rascunhos seguem salvos. Este Host está com backend anterior; envio seguro bloqueado até reiniciá-lo. A chave Groq desta sessão está só em memória.';
    $('coordinatorDraftState').textContent=[text,compatibility].filter(Boolean).join(' ');
  }
  async function drainCoordinatorDrafts() {
    while(pendingCoordinatorDraft) {
      const draft=pendingCoordinatorDraft;
      pendingCoordinatorDraft=null;
      try {
        const saved=await api.setDraft(draft.taskId,draft.content,draft.revision);
        if(saved?.draft_revision!==draft.revision||saved?.draft!==draft.content)
          throw Error('task_draft_revision_conflict');
      } catch(error) {
        if(!pendingCoordinatorDraft||pendingCoordinatorDraft.revision<draft.revision)
          pendingCoordinatorDraft=draft;
        if(coordinatorDraftTaskId===draft.taskId&&coordinatorDraftRevision===draft.revision)
          setCoordinatorDraftState('Rascunho não salvo. Confira a conexão antes de trocar de conversa.');
        throw error;
      }
      if(coordinatorDraftTaskId===draft.taskId&&coordinatorDraftRevision===draft.revision)
        setCoordinatorDraftState(draft.content?'Rascunho local salvo':'');
    }
    return coordinatorDraftRevision;
  }
  function flushCoordinatorDraft() {
    clearTimeout(coordinatorDraftTimer);coordinatorDraftTimer=null;
    const write=coordinatorDraftWrite.catch(()=>{}).then(drainCoordinatorDrafts);
    coordinatorDraftWrite=write;
    return write;
  }
  function stageCoordinatorDraft() {
    if(!chatTaskId||coordinatorDraftTaskId!==chatTaskId)return;
    const revision=coordinatorDraftRevision+1;
    if(!Number.isSafeInteger(revision)) {
      setCoordinatorDraftState('O rascunho atingiu o limite de revisões; recarregue a conversa antes de editar.');
      return;
    }
    coordinatorDraftRevision=revision;
    const content=$('coordinatorPrompt').value;
    pendingCoordinatorDraft={taskId:chatTaskId,content,revision};
    setCoordinatorDraftState(content?'Salvando rascunho local…':'');
    clearTimeout(coordinatorDraftTimer);
    coordinatorDraftTimer=setTimeout(()=>{void flushCoordinatorDraft().catch(()=>{});},250);
  }
  async function readCoordinatorDraft(taskId) {
    if(typeof api.getTaskDraft==='function') {
      try{return await api.getTaskDraft(taskId);}
      catch(error) {
        // An already-running Host process may still expose the prior bridge map.
        // Fall back to its existing canonical task read; never use browser storage.
        if(error?.code!=='method_not_available')throw error;
      }
    }
    const task=await api.getTask(taskId);
    if(!task)throw Error('task_not_found');
    return {draft:task.draft||'',draft_revision:Number(task.draft_revision||0),draft_updated_at:task.draft_updated_at||null};
  }
  async function activateCoordinatorDraft(taskId) {
    if(chatTaskId===taskId&&coordinatorDraftTaskId===taskId)return;
    await flushCoordinatorDraft();
    const generation=++coordinatorDraftGeneration;
    chatTaskId=taskId;
    coordinatorDraftTaskId=taskId;
    coordinatorDraftRevision=0;
    pendingCoordinatorDraft=null;
    $('coordinatorPrompt').value='';
    setCoordinatorDraftState('');
    if(!taskId)return;
    const draft=await readCoordinatorDraft(taskId);
    if(generation!==coordinatorDraftGeneration||taskId!==chatTaskId)return;
    coordinatorDraftRevision=Number(draft.draft_revision||0);
    $('coordinatorPrompt').value=draft.draft||'';
    setCoordinatorDraftState(draft.draft?'Rascunho local preservado nesta conversa':'');
  }
  async function prepareCoordinatorDraft(taskId) {
    await flushCoordinatorDraft();
    if(taskId!==chatTaskId||taskId!==coordinatorDraftTaskId)return null;
    const raw=$('coordinatorPrompt').value;
    let draft=await readCoordinatorDraft(taskId);
    if(draft.draft!==raw) {
      stageCoordinatorDraft();
      await flushCoordinatorDraft();
      draft=await readCoordinatorDraft(taskId);
    }
    if(draft.draft!==raw)throw Error('task_draft_revision_conflict');
    coordinatorDraftRevision=Number(draft.draft_revision||0);
    return {raw,content:raw.trim(),draftRevision:coordinatorDraftRevision};
  }
  async function reconcileCoordinatorDraft(taskId,raw,draftRevision) {
    const draft=await readCoordinatorDraft(taskId);
    if(draft.draft_revision!==draftRevision+1||draft.draft!=='')return false;
    if(chatTaskId===taskId&&coordinatorDraftTaskId===taskId) {
      coordinatorDraftRevision=draft.draft_revision;
      pendingCoordinatorDraft=null;
      if($('coordinatorPrompt').value===raw)$('coordinatorPrompt').value='';
      setCoordinatorDraftState('Mensagem registrada no histórico; rascunho removido.');
    }
    return true;
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
      button.addEventListener('click',()=>{
        if(item.id===orchestratorId){void showCoordinator().catch(()=>error());return;}
        $('orchestratorSelect').value=item.id;$('orchestratorSelect').dispatchEvent(new Event('change'));
      });
      list.append(button);
    }
  }
  let visibleWorkItems=[];
  const workClass=work=>work.status==='running'?'running':
    work.status==='completed'?'completed':
    ['failed','error','interrupted'].includes(work.status)?'attention':'ready';
  function applyWorkFilters(){
    const query=($('workSearch')?.value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim();
    const state=$('workStatusFilter')?.value||'all';
    const nodes=$('orchestratorWorks').querySelectorAll('.work-card');
    let visible=0;
    for(const button of nodes){
      const work=visibleWorkItems.find(w=>w.id===button.dataset.taskId);
      const haystack=String(work?.title||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
      const show=Boolean(work)&&(!query||haystack.includes(query))&&(state==='all'||workClass(work)===state);
      button.hidden=!show;if(show)visible++;
    }
    $('workFilteredCount').textContent=visible+' de '+visibleWorkItems.length+' frentes exibidas';
  }
  $('workSearch').addEventListener('input',applyWorkFilters);
  $('workStatusFilter').addEventListener('change',applyWorkFilters);
  let dependencyWorks=[],dependencySelectionDirty=false,dependencyProject=null;
  function showDependencyChoices(){
    const targetId=$('dependencyTarget').value;
    const selected=dependencyWorks.find(work=>work.id===targetId);
    const area=$('dependencyCandidates');area.replaceChildren();
    if(!selected){
      area.textContent='Selecione uma frente que ainda não foi executada.';
      return;
    }
    for(const work of dependencyWorks){
      if(work.id===targetId)continue;
      const label=document.createElement('label');
      const checkbox=document.createElement('input');
      checkbox.type='checkbox';checkbox.value=work.id;
      checkbox.checked=selected.dependsOn?.includes(work.id)===true;
      const title=document.createElement('span');title.textContent=work.title;
      label.append(checkbox,title);area.append(label);
    }
    if(!area.children.length)area.textContent='Crie outra frente para configurar pré-requisitos.';
  }
  function renderDependencyEditor(works,plan){
    const editor=$('workDependencyEditor'),select=$('dependencyTarget'),save=$('saveWorkDependencies');
    const sameProject=dependencyProject===projectId;
    if(editor.open&&dependencySelectionDirty&&sameProject)return;
    dependencyProject=projectId;
    dependencyWorks=works||[];
    const complete=Boolean(plan&&Array.isArray(works)&&works.length===plan.workCount&&works.length<200);
    const eligible=complete?works.filter(work=>
      work.latest_run_status==null&&work.running_runs===0&&
      !['running','error','interrupted'].includes(work.status)&&
      work.execution?.observed!=='reconciliation_required'):[];
    const previous=sameProject?select.value:'';
    select.replaceChildren();
    const empty=document.createElement('option');empty.value='';empty.textContent='Selecione uma frente';
    select.append(empty);
    for(const work of eligible){
      const option=document.createElement('option');
      option.value=work.id;option.textContent=work.title;select.append(option);
    }
    select.value=eligible.some(work=>work.id===previous)?previous:'';
    save.disabled=!complete||eligible.length===0;
    select.disabled=save.disabled;
    $('dependencyEditNote').textContent=!complete
      ?'A lista completa do projeto não está disponível; edição bloqueada para não apagar dependências ocultas.'
      :eligible.length===0
        ?'Não há frentes sem execução para configurar. Crie uma nova frente para a próxima etapa.'
        :'Pré-requisitos só podem ser alterados antes da primeira execução. Salvar não envia mensagens.';
    dependencySelectionDirty=false;
    showDependencyChoices();
  }
  function renderWorks(works,plan=null) {
    visibleWorkItems=works;
    const planWorkers=new Map((plan?.workers||[]).map(w=>[w.taskId,w]));
    const candidates=new Set(plan?.candidates||[]);
    const waiting=new Set(plan?.waiting||[]);
    const blocked=new Set(plan?.blocked||[]);
    const labels={running:['Em andamento','running'],completed:['Concluída','completed'],failed:['Revisar','attention'],error:['Revisar','attention'],interrupted:['Revisar','attention'],paused:['Pausada','paused'],ready:['Pronta','ready']};
    $('workRailCount').textContent=String(works.length);
    $('workRailProject').textContent=$('projectSelect').selectedOptions[0]?.textContent||'';
    const planStatus=$('workPlanSummary');
    if(plan?.automaticDispatchAllowed===false){
      planStatus.dataset.state=plan.blocked.length?'blocked':'ready';
      const executor=plan.executor;
      const physical=executor?.maxConcurrentSends===1&&executor?.isolatedWorkerSessions===false
        ?'Executor real: 1 sessão de navegador'+
          (executor.availableSlots===0?' (ocupada).':' (vaga disponível).')
        :'Capacidade física do executor não atestada.';
      planStatus.textContent='Planejamento do projeto · '+plan.candidates.length+' candidatas · '+
        plan.waiting.length+' aguardando · '+plan.blocked.length+' bloqueadas · '+
        plan.inFlight+' em execução no projeto. '+physical+
        ' A seleção consultiva de até '+(plan.availableSlots+plan.inFlight)+
        ' frentes não significa envios simultâneos. Nenhum envio automático autorizado.';
    }else{
      planStatus.dataset.state='unavailable';
      planStatus.textContent=projectId?
        'Planejamento indisponível; consulte as tarefas e os recibos antes de agir.':
        'Selecione um projeto para consultar dependências.';
    }
    const list=$('orchestratorWorks');list.replaceChildren();
    const counts={running:0,completed:0,attention:0,ready:0};
    for(const w of works){
      if(w.status==='running')counts.running++;
      else if(w.status==='completed')counts.completed++;
      else if(['failed','error','interrupted'].includes(w.status))counts.attention++;
      else counts.ready++;
    }
    const overview=document.createElement('section');overview.className='work-overview';
    overview.setAttribute('aria-label','Resumo das frentes observadas');
    for(const [key,label] of [['running','Em andamento'],['completed','Concluídas'],['attention','Revisar'],['ready','Aguardando']]){
      const stat=document.createElement('div');stat.className='work-overview-stat';
      const value=document.createElement('strong');value.textContent=String(counts[key]);
      const name=document.createElement('span');name.textContent=label;
      stat.append(value,name);overview.append(stat);
    }
    const attention=works.filter(w=>['failed','error','interrupted'].includes(w.status));
    if(attention.length){
      const summary=document.createElement('div');
      summary.className='work-attention-summary';
      summary.setAttribute('role','status');
      const label=document.createElement('strong');
      label.textContent=attention.length+' frente(s) precisam de revisão';
      const description=document.createElement('span');
      description.textContent='Abra a conversa para conferir a última execução e seus recibos antes de continuar.';
      summary.append(label,description);list.append(summary);
    }
    const note=document.createElement('p');note.className='work-overview-note';
    note.textContent='Estado das conversas; execução paralela automática ainda não habilitada.';
    overview.append(note);list.append(overview);
    if(!works.length){applyWorkFilters();const empty=document.createElement('div');empty.className='work-rail-empty';empty.textContent='As conversas criadas para este orquestrador aparecerão aqui.';list.append(empty);return;}
    const ordered=[...works].sort((a,b)=>{const priority={failed:0,error:0,interrupted:0,running:1,ready:2,paused:3,completed:4};return (priority[a.status]??5)-(priority[b.status]??5);});
    for(const work of ordered){
      const [label,state]=work.status==='ready'&&nodeHost?['GPT indisponível','attention']:(labels[work.status]||labels.ready);const button=document.createElement('button');
      button.type='button';button.className='work-card';button.dataset.taskId=work.id;
      const copy=document.createElement('span');copy.className='work-card-copy';
      const title=document.createElement('strong');title.textContent=work.title;
      const detail=document.createElement('small');detail.textContent=work.provider_segments
        ?`${work.provider_segments} conversa${work.provider_segments===1?'':'s'} no histórico`
        :nodeHost?'Rascunho local • envio ao GPT indisponível neste host':'Conversa pronta para iniciar';
const runState=document.createElement('small');
      const states={running:'Run ativo',succeeded:'Último Run confirmado',failed:'Último Run falhou',cancelled:'Último Run cancelado',interrupted:'Run interrompido'};
      runState.textContent=work.execution?.observed==='reconciliation_required'?'Execução incerta · verificar recibos':work.execution?.observed==='review_required'?'Execução requer revisão':work.execution?.observed==='running'?'Run em andamento':work.execution?.observed==='last_run_succeeded'?'Último Run confirmado':work.running_runs>0?'Run em andamento':states[work.latest_run_status]||'Sem Run confirmado';
      runState.className='work-run-evidence';
      if(Array.isArray(work.dependsOn)&&work.dependsOn.length){
        const dependencies=document.createElement('small');
        dependencies.className='work-run-evidence';
        dependencies.textContent=work.dependsOn.length+' dependência(s) registrada(s)';
        copy.append(title,detail,runState,dependencies);
      }else copy.append(title,detail,runState);
      const planned=planWorkers.get(work.id);
      if(planned){
        const label=document.createElement('small');
        label.className='work-plan-item';
        label.textContent=blocked.has(work.id)?'Dependência bloqueada · revisar':
          waiting.has(work.id)?'Aguardando pré-requisitos':
          candidates.has(work.id)?'Candidata à próxima ação · requer autorização':
          planned.state==='uncertain'?'Entrega incerta · reconciliar':
          planned.state==='failed'?'Falha confirmada · revisar':
          planned.state==='running'?'Ação em andamento':
          planned.state==='succeeded'?'Último Run concluído; qualidade não certificada':
          planned.state==='pending'?'Aguardando capacidade ou autorização':
          'Estado não liberado';
        copy.append(label);
      }
      const badge=document.createElement('span');badge.className=`work-state ${state}`;badge.textContent=label;
      button.append(copy,badge);button.addEventListener('click',async()=>{
        try{coordinatorOpen=false;await onOpenWork(work.id);}catch{status('Não foi possível abrir esta conversa.');}
      });list.append(button);
    }
    applyWorkFilters();
  }
  async function command(operation,input) {
    const key=JSON.stringify({operation,input});
    const requestId=requestKeys.get(key)||crypto.randomUUID();
    requestKeys.set(key,requestId);
    const receipt=await call(operation,{requestId,...input});
    if(receipt.status==='succeeded')requestKeys.delete(key);
    else if(receipt.status==='failed') {
      requestKeys.delete(key);
      const failures={
        groq_auth_rejected:'Groq rejeitou a autenticação. Confira a chave nas configurações; nenhuma resposta foi registrada.',
        groq_rate_limited:'Groq aplicou limite de requisições. Aguarde o limite resetar antes de tentar novamente.',
        groq_service_unavailable:'Groq está indisponível no momento. A solicitação terminou sem resposta registrada.',
        groq_request_rejected:'Groq recusou a solicitação. Confira o modelo e a configuração da API.',
        groq_invalid_response:'Groq retornou uma resposta inválida; o app não a aceitou.',
        groq_incomplete_response:'Groq encerrou a resposta antes de concluí-la; o app não a aceitou.',
        groq_invalid_work_proposal:'Groq não retornou uma proposta de frente válida; nenhuma frente foi criada.',
        chatgpt_auth_rejected:'A autorização do ChatGPT Plan foi rejeitada. Reconecte a conta e tente novamente.',
        chatgpt_access_denied:'A política de acesso ao plano ChatGPT impediu a solicitação. Nenhuma resposta foi registrada.',
        chatgpt_rate_limited:'O limite de uso do plano ChatGPT foi atingido. Aguarde antes de iniciar outra solicitação.',
        chatgpt_service_unavailable:'O serviço ChatGPT Plan está indisponível. A solicitação terminou sem resposta registrada.',
        chatgpt_request_rejected:'O serviço ChatGPT Plan recusou a solicitação. Revise o modelo e as permissões concedidas.',
        chatgpt_plan_scope_missing:'O login não concedeu permissão de uso do plano ChatGPT. Reconecte e aprove essa permissão.',
        chatgpt_no_supported_models:'Não há modelos disponíveis para esta conta ChatGPT.',
        chatgpt_models_unavailable:'Não foi possível consultar os modelos da conta ChatGPT; nenhuma inferência foi enviada.',
        chatgpt_invalid_response:'O ChatGPT retornou uma resposta inválida; o app não a aceitou.',
        chatgpt_invalid_work_proposal:'O ChatGPT não retornou uma proposta válida; nenhuma frente foi criada.'
      };
      status(failures[receipt.result?.failureCode]||'A solicitação falhou e não foi repetida. Confira a configuração e tente novamente quando estiver pronta.');
    } else {
      const failureCode=receipt.result?.failureCode||'';
      const provider=failureCode.startsWith('chatgpt_')?'ChatGPT Plan':'Groq';
      status(failureCode.endsWith('_request_timeout')
        ?`O tempo de resposta do ${provider} expirou sem confirmação. Confira o histórico antes de enviar outra solicitação; nada será repetido automaticamente.`
        :failureCode.endsWith('_network_unavailable')
          ?`Não foi possível confirmar o resultado enviado ao ${provider}. Confira o histórico antes de enviar outra solicitação; nada será repetido automaticamente.`
          :'O resultado do comando não foi confirmado. Confira a conversa antes de iniciar outro envio; nada será repetido automaticamente.');
    }
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
    $('remoteRepositoryStatus').textContent=nodeHost
      ?!project?'Selecione um projeto.'
        :project.repository_url
          ?`URL salva no projeto: ${project.repository_url}. Este Host não lê o GitHub nem envia mensagens às frentes de trabalho.`
          :'Nenhum repositório vinculado. Salvar uma URL registra só metadado; a leitura autenticada do GitHub não está conectada neste Host.'
      :!project?'Selecione um projeto.'
        :project.repository_url
          ?`Destino remoto: ${project.repository_url}. A API não leu o conteúdo do repositório.`
          :'Nenhum repositório remoto vinculado. Vincular salva a URL do GitHub como destino do projeto.';
    $('remoteRepositoryCapabilityNote').textContent=nodeHost
      ?project?.repository_url
        ?'O chat coordenador recebe somente esta URL como contexto; não consulta arquivos, commits ou branches. Nenhuma integração GitHub está conectada ao Host.'
        :'Nenhuma URL de repositório está vinculada. O Host não tem leitura autenticada do GitHub; nenhuma integração GitHub está conectada.'
      :'A API recebe somente a URL. No desktop, tarefas podem pedir ao ChatGPT para usar a integração GitHub da sessão; isso não comprova que a integração está disponível. Nenhum arquivo local é lido nesta etapa.';
    $('workspaceConnection').textContent=nodeHost
      ?'Runtime/workspace local não conectado a esta página; nenhuma pasta ou arquivo local é lido.'
      :'Acesso ao workspace local ainda indisponível. Nenhum arquivo local é lido nesta fase.';
    syncCapabilitySummary();
  }
  async function refreshApiStatus() {
    const state=await api.coordinatorChatStatus();
    chatgptPlanStatus=state.chatgpt||chatgptPlanStatus;
    groqConfigured=state.groqConfigured===true;
    coordinatorProvider=state.provider||null;
    nodeHost=state.executionSurface==='node_host';
    $('orchestratorWorkRail').setAttribute('aria-label',nodeHost?'Frentes de trabalho do projeto':'Conversas do projeto no GPT');
    $('workRailTitle').textContent=nodeHost?'Frentes de trabalho':'Conversas no GPT';
    $('coordinatorRailToggle').textContent=nodeHost?'Frentes':'Frentes GPT';
    $('newScopedWorkButton').textContent=nodeHost?'＋ Nova frente':'＋ Nova conversa no GPT';
    $('newScopedWorkDetails').querySelector('summary').textContent=nodeHost?'Configurar título da frente':'Configurar nome da conversa';
    $('newScopedWorkForm').querySelector('button[type="submit"]').textContent=nodeHost?'Criar frente e abrir rascunho':'Criar e abrir conversa';
    $('workRailNote').textContent=nodeHost
      ?'As frentes ficam salvas no projeto. O ChatGPT conectado responde no chat coordenador; envio às conversas de trabalho ainda não está ligado neste Host.'
      :'Cada conversa mantém o próprio histórico dentro do projeto.';
    const engineStatus=await call('status');
    coordinatorAvailable=engineStatus.coordinatorAvailable===true;
    gptWebTransportAvailable=engineStatus.providerExecutionAvailable===true&&!nodeHost;
    // The coordinator is a distinct conversation, not another GPT Web front.
    orchestratorChatAvailable=coordinatorAvailable;
    coordinatorDraftCommitAvailable=engineStatus.coordinatorDraftCommitAvailable===true;
    if(!coordinatorDraftCommitAvailable)setCoordinatorDraftState($('coordinatorPrompt').value?'Rascunho local preservado nesta conversa.':'');
    else if($('coordinatorDraftState').textContent.includes('backend anterior'))
      setCoordinatorDraftState($('coordinatorPrompt').value?'Rascunho local preservado nesta conversa.':'');
    const routingName=nodeHost
      ?coordinatorProvider==='chatgpt_plan'?'ChatGPT Plan':'Groq'
      :'Groq';
    $('coordinatorNavProvider').textContent='Conversa com '+routingName;
    $('coordinatorRouteLabel').textContent='CONVERSA DIRETA · '+routingName.toLocaleUpperCase('pt-BR');
    $('coordinatorApiSettings').textContent='Configurar '+routingName;
    $('coordinatorPrompt').placeholder='Mensagem para o Orquestrador · '+routingName;
    $('coordinatorSend').textContent='Enviar à '+(routingName==='Groq'?'Groq':routingName);
    $('coordinatorSend').setAttribute('aria-label','Enviar mensagem ao Orquestrador via '+routingName);
    $('orchestrationConnection').textContent=coordinatorAvailable
      ?'Destino: Orquestrador via '+routingName+'. Nenhuma mensagem deste campo vai às conversas do ChatGPT Web.'
      :'Orquestrador indisponível: configure '+routingName+' para conversar. Nenhuma mensagem será redirecionada ao ChatGPT Web.';
    syncCapabilitySummary();
    syncCoordinatorActions();
  }
  $('coordinatorApiSettings').addEventListener('click',async()=>{
    await onSelectRightPane?.('context').catch(()=>{});
    document.body.classList.add('orchestrator-api-settings');
    $('contextRail').classList.add('open');
    $('labSupervisorPanel').open=true;
    if(nodeHost) {
      $('chatgptPlanSettings').scrollIntoView({block:'center'});
      $('chatgptPlanConnect').focus();
    } else {
      $('labSupervisorKeySettings').open=true;
      $('labSupervisorKeyInput').scrollIntoView({block:'center'});$('labSupervisorKeyInput').focus();
    }
  });
  $('closeCoordinatorApiSettings').addEventListener('click',()=>{
    document.body.classList.remove('orchestrator-api-settings');$('contextRail').classList.remove('open');
    void onSelectRightPane?.('context').catch(()=>{});
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
  const setWorkRailOpen=open=>{
    if(open)void onSelectRightPane?.('context').catch(()=>{});
    document.body.classList.toggle('orchestrator-rail-open',open);
    $('contextRail').classList.toggle('open',open);
    $('coordinatorRailToggle').setAttribute('aria-expanded',String(open));
  };
  $('coordinatorRailToggle').addEventListener('click',()=>{
    setWorkRailOpen(!$('contextRail').classList.contains('open'));
  });
  $('closeWorkRail').addEventListener('click',()=>{
    setWorkRailOpen(false);
    $('coordinatorRailToggle').focus();
  });
  $('dependencyTarget').addEventListener('change',()=>{
    dependencySelectionDirty=false;
    showDependencyChoices();
  });
  $('dependencyCandidates').addEventListener('change',()=>{dependencySelectionDirty=true;});
  $('workDependencyForm').addEventListener('submit',event=>{
    event.preventDefault();
    void (async()=>{
      const selectedProject=projectId,taskId=$('dependencyTarget').value;
      if(!selectedProject||!taskId)return;
      const dependsOn=[...$('dependencyCandidates').querySelectorAll('input[type="checkbox"]:checked')].map(node=>node.value);
      if(dependsOn.length>64){
        $('dependencyEditNote').textContent='Selecione no máximo 64 pré-requisitos.';
        return;
      }
      const save=$('saveWorkDependencies');
      save.disabled=true;
      $('dependencyEditNote').textContent='Verificando e salvando no projeto...';
      try{
        const receipt=await command('work_dependency_set',{projectId:selectedProject,taskId,dependsOn});
        if(receipt.status!=='succeeded')throw Error('dependency_change_unconfirmed');
        if(projectId!==selectedProject)return;
        dependencySelectionDirty=false;
        await refreshWorks();
        $('dependencyEditNote').textContent='Dependências registradas no projeto. Nenhuma mensagem foi enviada.';
        status('Dependências atualizadas. O planejamento considera os pré-requisitos persistidos.');
      }catch(error){
        if(projectId===selectedProject){
          $('dependencyEditNote').textContent=String(error?.message||'')==='orchestrator_dependency_cycle'
            ?'Dependências circulares não são permitidas. Revise as seleções.'
            :String(error?.message||'')==='orchestrator_dependencies_locked_after_execution'
              ?'Essa frente já foi executada. Crie uma nova frente para dependências futuras.'
              :'Não foi possível confirmar a gravação. Confira o estado antes de tentar novamente.';
        }
      }finally{
        if(projectId===selectedProject)save.disabled=false;
      }
    })();
  });
  async function refreshWorks() {
    const generation=++epoch,p=projectId,o=orchestratorId;
    if(!p) {workCount=0;renderWorks([]);renderDependencyEditor([],null);await onScopeChange(null);syncCoordinatorActions();return;}
    const [result,planning,allResult]=await Promise.all([
      call('work_list',{projectId:p,...(o?{orchestratorId:o}:{})}),
      call('work_plan',{projectId:p,maxParallel:4}).catch(()=>null),
      o?call('work_list',{projectId:p}).catch(()=>null):Promise.resolve(null)
    ]);
    if(generation!==epoch)return;
    const works=result.works;
    workCount=works.length;
    $('openWorks').disabled=!projectId||!orchestratorId||workCount===0;
    renderWorks(works,planning?.plan||null);
    renderDependencyEditor(allResult?.works||result.works,planning?.plan||null);
    await onScopeChange(new Set(works.map(w=>w.id)));
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
    const [result,engineStatus]=await Promise.all([
      call('continuity_status',{projectId:p,orchestratorId:o}),
      call('status').catch(()=>null)
    ]);
    if(p!==projectId||o!==orchestratorId)return;
    const canDisable=result.enabled===true;
    const canEnable=engineStatus?.coordinatorAvailable===true;
    $('continuityToggle').disabled=!canDisable&&!canEnable;
    $('continuityToggle').title=!canDisable&&!canEnable
      ?'Conecte e ative um modelo de coordenação para habilitar a análise automática.'
      :'';
    $('continuityProposalsToggle').disabled=!result.enabled;
    $('continuityProposalsToggle').dataset.enabled=String(result.nextProposals.enabled);
    $('continuityProposalsToggle').textContent=result.nextProposals.enabled?'Desativar propostas automáticas':'Propor próximas frentes automaticamente';
    $('continuityToggle').dataset.enabled=String(result.enabled);
    $('continuityToggle').textContent=result.enabled?'Desativar análise automática':'Ativar análise automática';
    const messages={disabled:'Desativada',blocked_coordinator:'Bloqueada: conecte e ative um modelo de coordenação',pending:'Analisando trabalhos concluídos',observing:'Observando novas respostas',reconciliation_required:'Revisão manual necessária'};
    const proposals=result.nextProposals.enabled?(' Próximas propostas: '+result.nextProposals.proposed+'/'+result.nextProposals.maximum+' geradas neste ciclo; exigem revisão.'):' Próximas propostas desativadas.';
    const executionNotice=engineStatus?.autonomousExecution===true
      ?' O supervisor de execução em segundo plano está ativo.'
      :engineStatus?.autonomousExecution===false
        ?' A análise só roda enquanto o processo OrdaX está aberto; o supervisor de 24 h do Runtime ainda não está conectado.'
        :' O estado de execução em segundo plano não foi confirmado; não considerar como trabalho 24 h.';
    $('continuityState').textContent=(messages[result.state]||'Estado indisponível')+'.'+proposals+' Nenhum envio automático ao GPT.'+executionNotice;
  }
  async function refreshOrchestrators() {
    const p=projectId;
    orchestrators=p?(await call('orchestrators_list',{projectId:p})).orchestrators:[];
    if(p!==projectId)return;
    if(!orchestrators.some(o=>o.id===orchestratorId))orchestratorId=orchestrators[0]?.id||null;
    options($('orchestratorSelect'),orchestrators,'Selecione um orquestrador');
    $('orchestratorSelect').value=orchestratorId||'';
    const selected=orchestrators.find(o=>o.id===orchestratorId);
    await activateCoordinatorDraft(selected?.chat_task_id||null);
    $('openOrchestrator').disabled=!selected;
    $('pauseOrchestrator').disabled=!selected;
    $('pauseOrchestrator').textContent=selected?.status==='paused'?'Retomar':'Pausar';
    $('newOrchestratorForm').hidden=!p;
    $('openWorks').disabled=!p||!selected||workCount===0;
    $('orchestratorMission').textContent=selected?.mission||'Configure um orquestrador para este projeto.';
    $('orchestratorTitle').textContent=selected?.name||'Orquestrador';
    syncCoordinatorActions();
    renderOrchestratorNavigation();
    await refreshWorks();
    await refreshContinuityStatus();
    await refreshAutonomousDialogue();
    return orchestrators;
  }
  async function refreshAutonomousDialogue(){
    if(!projectId||!orchestratorId)return;
    const p=projectId,o=orchestratorId;
    const result=await call('autonomous_dialogue_status',{projectId:p,orchestratorId:o}).catch(()=>null);
    if(p!==projectId||o!==orchestratorId)return;
    const job=result?.mission;
    const labels={queued:'Missão aceita; planejamento automático pendente',planning_a:'Groq preparando GPT A',ready_a:'Preparado para enviar GPT A',sending_a:'GPT A em execução',ready_b:'GPT A confirmado; preparando GPT B',planning_b:'Groq analisando resposta A',ready_final:'Pergunta B pronta',sending_b:'GPT B em execução',planning_final:'Groq interpretando resposta B',succeeded:'Concluído: duas respostas GPT e proposta final confirmadas',blocked:'Falha comprovada; sem reenvio automático',reconciliation_required:'Resultado incerto: exige reconciliação, sem reenvio'};
    const storyLabel=job?.mode==='story'?(job.quality?.passed===false
      ?'História produzida, mas reprovada na qualidade: '+job.quality.violations.join(', ')
      :job.state==='succeeded'
      ?'História final montada pelo Groq, após duas rodadas GPT A/B'
      :job.state.startsWith('story_')?'História colaborativa: '+job.state.replaceAll('_',' '):null):null;
    $('autonomousDialogueState').textContent=job?`${storyLabel||labels[job.state]||job.state}. ${job.lastError||''}${job.questionFinal?(job.mode==='story'?' História final: ':' Próxima pergunta proposta (não enviada): ')+job.questionFinal:''}`:
      'Uma missão autoriza duas perguntas ou quatro cenas em duas rodadas. Groq conduz tudo sem comandos adicionais.';
    $('startAutonomousDialogue').disabled=Boolean(job && !['succeeded','blocked','reconciliation_required'].includes(job.state))||!coordinatorAvailable||!gptWebTransportAvailable;
    $('startAutonomousStory').disabled=$('startAutonomousDialogue').disabled;
  }
  async function renderCoordinator() {
    if(!projectId||!chatTaskId)return;
    const p=projectId,t=chatTaskId,o=orchestratorId;
    const [page,{proposals},engineStatus]=await Promise.all([
      call('work_messages',{projectId:p,taskId:t,limit:50}),
      call('proposals_list',{projectId:p,orchestratorId:o}),
      call('status').catch(()=>null)
    ]);
    if(p!==projectId||t!==chatTaskId)return;
    const box=$('coordinatorMessages'),recoveryNotice=$('coordinatorRecoveryNotice');
    box.replaceChildren(recoveryNotice);
    const uncertainCommands=Number.isSafeInteger(engineStatus?.uncertainCommands)
      ?engineStatus.uncertainCommands:0;
    recoveryNotice.classList.toggle('hidden',uncertainCommands===0);
    recoveryNotice.textContent=uncertainCommands
      ?`Há ${uncertainCommands} comando${uncertainCommands===1?'':'s'} com resultado incerto nesta sessão. A solicitação está registrada, mas não há resposta confirmada; nada foi reenviado automaticamente. Revise o histórico antes de decidir outro envio.`
      :'';
    if(page.has_more) {
      const note=document.createElement('p');
      note.textContent='Exibindo as 50 mensagens mais recentes. O histórico anterior permanece salvo.';
      box.append(note);
    }
    if(page.messages.length===0) {
      const empty=document.createElement('div');empty.className='coordinator-empty';
      const title=document.createElement('strong');title.textContent='Conversa de coordenação ainda vazia';
      const copy=document.createElement('p');
      const model=nodeHost&&coordinatorProvider==='chatgpt_plan'?'ChatGPT Plan':'Groq';
      copy.textContent='Este é o chat do Orquestrador via '+model+'. As conversas GPT de execução ficam no outro ambiente. Configure o modelo para começar; esta área não envia mensagens ao GPT Web.';
      const settings=document.createElement('button');settings.type='button';settings.className='mini-secondary';settings.textContent='Configurar '+model;
      settings.addEventListener('click',()=>$('coordinatorApiSettings').click());
      empty.append(title,copy,settings);box.append(empty);
    }
    for(const message of page.messages) {
      const article=document.createElement('article');article.className='coordinator-message';
      const role=document.createElement('strong');role.textContent=message.role==='user'?'Você':'Resposta registrada (origem no recibo)';
      const text=document.createElement('p');text.textContent=message.content;
      article.append(role,text);box.append(article);
    }
    box.scrollTop=box.scrollHeight;
    await refreshAutonomousDialogue();
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
    await onNavigationChange?.({view:'coordinator',projectId,orchestratorId,taskId:null});
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
    const previous=projectId,next=$('projectSelect').value||null;
    if(previous===next)return;
    try{await flushCoordinatorDraft();}catch{$('projectSelect').value=previous||'';status('O rascunho do chat central não foi salvo; o projeto atual foi mantido.');return;}
    projectId=next;orchestratorId=null;
    await refreshProjects();
    $('orchestrationPanel').hidden=true;coordinatorOpen=false;
    try{
      const items=await refreshOrchestrators();
      if(items.length)await showCoordinator();
      else{document.body.classList.remove('orchestrator-focus','orchestrator-rail-open','orchestrator-api-settings');$('empty').classList.remove('hidden');
        await onNavigationChange?.({view:'home',projectId,orchestratorId:null,taskId:null});}
    }catch{error();}
  });
  $('orchestratorSelect').addEventListener('change',async()=>{
    const previous=orchestratorId,next=$('orchestratorSelect').value||null;
    if(previous===next)return;
    try{await flushCoordinatorDraft();}catch{$('orchestratorSelect').value=previous||'';status('O rascunho do chat central não foi salvo; o orquestrador atual foi mantido.');return;}
    orchestratorId=next;
    try{await refreshOrchestrators();if(chatTaskId)await showCoordinator();
      else await onNavigationChange?.({view:'home',projectId,orchestratorId,taskId:null});}catch{error();}
  });
  $('newProjectForm').addEventListener('submit',event=>{
    event.preventDefault();void formAction(event.currentTarget,async()=>{
      await flushCoordinatorDraft();
      const mission=$('projectObjective').value.trim();
      const name=$('projectName').value.trim();
      const repositoryUrl=$('projectRepositoryUrl').value.trim();
      const input={mission,...(name?{name}:{}),...(repositoryUrl?{repositoryUrl}:{})};
      const receipt=await command('mission_create',input);
      if(receipt.status!=='succeeded')return;
      projectId=receipt.result.projectId;orchestratorId=receipt.result.orchestratorId;
      $('newProjectForm').reset();$('projectSetup').open=false;
      await refreshProjects();await refreshOrchestrators();
      await onNavigationChange?.({view:'coordinator',projectId,orchestratorId,taskId:null});
      await showCoordinator();
      status('Projeto e missão criados localmente. Converse com o Orquestrador antes de abrir uma conversa GPT; nenhum envio foi realizado.');
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
          ?nodeHost
            ?'URL do GitHub salva como metadado do projeto. Este Host não leu o repositório nem enviou uma tarefa ao GPT.'
            :'Repositório remoto vinculado. As tarefas de trabalho vão receber essa URL como destino GitHub.'
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
  $('openWorks').addEventListener('click',()=>{
    const selected=visibleWorkItems[0];
    if(!selected){status('Crie primeiro uma conversa GPT neste projeto.');return;}
    coordinatorOpen=false;
    void onOpenWork(selected.id).catch(()=>status('Não foi possível abrir a conversa GPT.'));
  });
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
  $('coordinatorPrompt').addEventListener('keydown',event=>{
    if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.isComposing){
      event.preventDefault();
      if(!$('coordinatorSend').disabled)$('coordinatorComposer').requestSubmit();
    }
  });
  $('coordinatorComposer').addEventListener('submit',event=>{
    event.preventDefault();
    // Acquire the single-flight lock BEFORE the first async draft read.
    // The form's button restoration must not allow a second Groq dispatch.
    if(coordinatorSubmitting||analysisBusy||$('coordinatorSend').disabled)return;
    coordinatorSubmitting=true;syncCoordinatorActions();
    void formAction(event.currentTarget,async()=>{
      const p=projectId,o=orchestratorId,t=chatTaskId;
      const draft=await prepareCoordinatorDraft(t),content=draft?.content;
      // Selection can change while awaiting the durable draft. Never send a
      // stale coordinator message to the old project after navigation.
      if(p!==projectId||o!==orchestratorId||t!==chatTaskId||!content)return;
      status('Consultando o orquestrador…');
      const receipt=await command('orchestrator_chat',{projectId:p,orchestratorId:o,content,draftRevision:draft.draftRevision});
      if(p!==projectId||o!==orchestratorId||t!==chatTaskId)return;
      await reconcileCoordinatorDraft(t,draft.raw,draft.draftRevision);
      if(receipt.status==='succeeded')
        status('Resposta do Orquestrador registrada via '+(receipt.result?.provider||'modelo configurado')+'. Nenhuma mensagem foi enviada às conversas GPT.');
      else status('Resposta do Orquestrador não confirmada ('+receipt.status+'). O envio não será repetido automaticamente.');
      await renderCoordinator();
    }).finally(()=>{coordinatorSubmitting=false;syncCoordinatorActions();});
  });
  $('analyzeWorks').addEventListener('click',async()=>{
    if($('analyzeWorks').disabled||!projectId||!orchestratorId)return;
    const p=projectId,o=orchestratorId;
    analysisBusy=true;syncCoordinatorActions();
    status(nodeHost
      ?'Enviando ao coordenador disponível nesta superfície, com histórico local limitado…'
      :'Analisando as frentes pelo Groq configurado, com histórico recente limitado…');
    try {
      const receipt=await command('orchestrator_analyze',{projectId:p,orchestratorId:o});
      if(p!==projectId||o!==orchestratorId)return;
      if(receipt.status==='succeeded')status('Análise registrada no histórico. Nenhuma recomendação foi executada.');
      await renderCoordinator();
    }catch{error();}
    finally{analysisBusy=false;syncCoordinatorActions();}
  });
  async function launchAutonomousMission(mode){
    const button=$(mode==='story'?'startAutonomousStory':'startAutonomousDialogue');
    if(button.disabled||!projectId||!orchestratorId)return;
    const p=projectId,o=orchestratorId;
    const mission=$('coordinatorPrompt').value.trim();
    if(!mission){status('Descreva a missão única no campo do orquestrador.');$('coordinatorPrompt').focus();return;}
    $('startAutonomousStory').disabled=true;$('startAutonomousDialogue').disabled=true;
    try {
      const receipt=await command('autonomous_dialogue_start',{projectId:p,orchestratorId:o,mission,mode});
      if(p!==projectId||o!==orchestratorId)return;
      if(receipt.status==='succeeded')status('Missão aceita. Groq coordena as etapas e GPT responde sem novas orientações.');
      await refreshAutonomousDialogue();
    }catch{error();}finally{await refreshAutonomousDialogue();}
  }
  $('startAutonomousDialogue').addEventListener('click',()=>void launchAutonomousMission('dialogue'));
  $('startAutonomousStory').addEventListener('click',()=>void launchAutonomousMission('story'));
  $('prepareWork').addEventListener('click',async()=>{
    if($('prepareWork').disabled||analysisBusy||coordinatorSubmitting||!projectId||!orchestratorId)return;
    const p=projectId,o=orchestratorId,t=chatTaskId;
    // Preparing a proposal consumes the same coordinator lane as chat.
    // Admission is synchronous, before any draft flush or model request.
    analysisBusy=true;coordinatorSubmitting=true;syncCoordinatorActions();
    try {
      let draft;
      try{draft=await prepareCoordinatorDraft(t);}
      catch{setCoordinatorDraftState('Não foi possível confirmar o rascunho salvo. Ele foi preservado e nenhuma proposta foi enviada.');return;}
      if(p!==projectId||o!==orchestratorId||t!==chatTaskId)return;
      const content=draft?.content;
      if(!content){status('Descreva no campo de mensagem a frente que o orquestrador deve preparar.');$('coordinatorPrompt').focus();return;}
      status('A IA está preparando uma proposta de frente para sua revisão…');
      try {
        const receipt=await command('orchestrator_prepare',{projectId:p,orchestratorId:o,content,draftRevision:draft.draftRevision});
        if(p!==projectId||o!==orchestratorId||t!==chatTaskId)return;
        await reconcileCoordinatorDraft(t,draft.raw,draft.draftRevision);
        if(receipt.status==='succeeded')status('Proposta pronta. Confira título e mensagem antes de criar a frente.');
        await renderCoordinator();
      }catch{error();}
    }finally{analysisBusy=false;coordinatorSubmitting=false;syncCoordinatorActions();}
  });
  $('coordinatorPrompt').addEventListener('input',stageCoordinatorDraft);
  $('coordinatorPrompt').addEventListener('blur',()=>{void flushCoordinatorDraft().catch(()=>{});});
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
    async start({restoreNavigation=null}={}){const projects=await refreshProjects();
      await refreshApiStatus();
      const saved=restoreNavigation?.schema==='ordax.workspace-navigation.v1'?restoreNavigation:null;
      projectId=projects.some(project=>project.id===saved?.projectId)
        ?saved.projectId:projects[0]?.id||null;
      $('projectSelect').value=projectId||'';
      if(saved?.projectId===projectId)orchestratorId=saved.orchestratorId||null;
      renderProjectNavigation(projects);
      syncProjectRepository();
      const items=await refreshOrchestrators();
      const shouldRestoreTask=saved?.view==='task'&&typeof saved.taskId==='string'&&saved.taskId.length>0;
      if(items.length&&!shouldRestoreTask&&saved?.view!=='home')await showCoordinator();
      else if(!items.length)await onNavigationChange?.({view:'home',projectId,orchestratorId:null,taskId:null});
      let refreshPending=false,refreshRequested=false;
      const refreshAfterChange=async()=>{
        if(refreshPending)return;
        refreshPending=true;
        try {
          do {
            refreshRequested=false;
            await refreshApiStatus();
            await refreshProjects();await refreshOrchestrators();
            if(coordinatorOpen)await renderCoordinator();
          } while(refreshRequested);
        } catch {error();}
        finally {refreshPending=false;}
      };
      api.onOrchestratorChanged?.(()=>{
        refreshRequested=true;
        if(!refreshPending)void refreshAfterChange();
      });},
    createWork,hasProject:()=>Boolean(projectId),hasOrchestrator:()=>Boolean(chatTaskId),
    getProjectId:()=>projectId,
    getOrchestratorId:()=>orchestratorId,
    showCoordinator,
    refreshStatus:()=>refreshApiStatus(),
    hide(){coordinatorOpen=false;$('orchestrationPanel').hidden=true;},
    refresh:refreshWorks
  });
}
