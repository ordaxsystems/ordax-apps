// Native App UI is a client of the same command service as MCP. No DOM of
// ChatGPT, coordinates or direct SQLite access is used to operate the Lab.
import {providerComposeAvailability,COMPOSE_STATUS_MESSAGES} from '../src/provider-compose-availability.mjs';
// Name-only onboarding uses the existing mission_create contract. This
// description is coordination guidance, never permission to inspect GitHub,
// execute work or send messages to GPT Web.
export function resolveProjectOnboardingMission(name,objective) {
  const explicit=String(objective||'').trim();
  if(explicit)return explicit;
  const title=String(name||'').trim();
  if(!title)return null;
  return `Coordenar o projeto ${title}. Identificar prioridades e dependências apenas a partir das conexões e evidências efetivamente disponíveis; propor próximos passos para revisão humana. Não presumir acesso ao GitHub ou Runtime e não enviar mensagens ao GPT Web sem autorização explícita.`;
}
// Pure presentation of the SAME read-only project_preflight projection.
 // It cannot confer GitHub/Runtime authority or issue a provider request.
export function describeProjectPreflight(snapshot) {
  if(snapshot?.schema!=='ordax.orchestrator.project-preflight/2'||
    snapshot.provenance?.source!=='app_sqlite'||snapshot.provenance.externalObservation!==false||
    !snapshot.observation||typeof snapshot.observation.requested!=='boolean'||
    snapshot.observation.active!==false||!snapshot.repository||
    typeof snapshot.repository.urlRegistered!=='boolean'||
    snapshot.repository.authenticatedRead!=='unavailable'||
    snapshot.runtime?.grantVerified!==false||
    !snapshot.work||!Number.isSafeInteger(snapshot.work.registered)||snapshot.work.registered<0||
    !Number.isSafeInteger(snapshot.work.started)||snapshot.work.started<0||
    !Number.isSafeInteger(snapshot.work.unresolvedSends)||snapshot.work.unresolvedSends<0||
    !snapshot.analysis||!Number.isSafeInteger(snapshot.analysis.attempts)||snapshot.analysis.attempts<0||
    !Number.isSafeInteger(snapshot.analysis.completed)||snapshot.analysis.completed<0||
    !(snapshot.analysis.lastStatus===null||['running','succeeded','failed','uncertain'].includes(snapshot.analysis.lastStatus))||
    !(snapshot.analysis.lastAttemptAt===null||typeof snapshot.analysis.lastAttemptAt==='string')||
    !snapshot.coordinator||typeof snapshot.coordinator.modelConfigured!=='boolean'||
    !snapshot.gates||typeof snapshot.gates.recordedWorkAnalysisEligible!=='boolean'||
    snapshot.gates.githubObservationVerified!==false||
    snapshot.gates.automaticGptDispatchAllowed!==false||
    snapshot.gates.headlessExecutionVerified!==false||!Array.isArray(snapshot.blockers))
    throw Error('project_preflight_evidence_invalid');
  const actions=[];
  if(snapshot.work.unresolvedSends>0)
    actions.push('Reconcilie envios pendentes ou incertos antes de iniciar outra análise.');
  if(snapshot.coordinator.state!=='ready')
    actions.push('Retome o Administrador Geral deste projeto.');
  if(!snapshot.coordinator.modelConfigured)
    actions.push('Configure um modelo no Administrador Geral para análises locais.');
  if(snapshot.work.registered===0)
    actions.push('Registre uma frente de trabalho para a análise local.');
  if(!snapshot.repository.urlRegistered)
    actions.push('Cadastre a URL do repositório nas conexões do projeto.');
  const historical=snapshot.repository.lastHistoricalHead;
  if(historical?.provenance?.historical===true&&
    historical.provenance.currentAccessVerified===false&&
    historical.provenance.source==='github_rest_authenticated'&&
    /^[a-f0-9]{40}$/.test(historical.headSha)&&
    typeof historical.observedAt==='string'&&Number.isFinite(Date.parse(historical.observedAt)))
    actions.push(`Histórico GitHub: HEAD ${historical.headSha.slice(0,12)} observado em ${historical.observedAt}; não confirma acesso atual, integridade ou checks.`);
  actions.push('GitHub: integração autorizada pela Platform ainda indisponível neste Host.');
  actions.push('Runtime: grant de leitura e supervisão headless ainda não verificados.');
  const latestAnalysis=snapshot.analysis.lastStatus==='succeeded'
    ?`Última análise registrada em ${snapshot.analysis.lastAttemptAt}.`
    :snapshot.analysis.lastStatus==='running'?'Há uma análise em andamento; consulte o histórico antes de repetir.'
      :snapshot.analysis.lastStatus==='uncertain'?'O recibo da última análise está incerto; consulte o histórico antes de repetir.'
        :snapshot.analysis.lastStatus==='failed'?'A última análise falhou; consulte o histórico antes de repetir.'
          :'Análise ainda não iniciada.';
  const analysisLabel=snapshot.analysis.attempts>0?'Reanalisar frentes':'Analisar frentes';
  return {
    state:snapshot.observation.requested?'blocked':
      snapshot.gates.recordedWorkAnalysisEligible?'ready':'blocked',
    summary:`Inventário local: ${snapshot.work.registered} frente(s), ${snapshot.work.started} com histórico de Run, ${snapshot.work.unresolvedSends} envio(s) incerto(s) ou pendente(s). `+
      `${latestAnalysis} `+(snapshot.gates.recordedWorkAnalysisEligible?
        'Análise das frentes registradas elegível. ':
        'Análise das frentes registradas bloqueada. ')+
      'Fonte: Store local. Este preflight não fez nova leitura GitHub, chamada Groq, mensagem GPT ou ação Runtime.',
    actions,analysisLabel
  };
}

export function mountOrchestratorUi({api,onScopeChange,onOpenWork,onShowCoordinator,onSelectRightPane,onOpenAppSettings,onNavigationChange}) {
  const $=id=>document.getElementById(id);
  let projectId=null,orchestratorId=null,projectsCache=[],orchestrators=[],epoch=0,chatTaskId=null,workCount=0;
  let projectRefreshGeneration=0,orchestratorRefreshGeneration=0;
  let coordinatorOpen=false,coordinatorAvailable=false,orchestratorChatAvailable=false,coordinatorDraftCommitAvailable=false;
  let gptWebTransportAvailable=false;
  let chatgptPlanStatus={connected:false,planUsageAuthorized:false,secureStorageAvailable:false};
  let groqConfigured=false,coordinatorProvider=null;
  let analysisBusy=false,preflightBusy=false,preflightGeneration=0,repositoryBusy=false,observationBusy=false,repositoryPortAvailable=false,coordinatorSubmitting=false,nodeHost=false;
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
    set('capabilityGitHub',repositoryPortAvailable&&project?.repository_url
      ?'GitHub · adaptador disponível, acesso não verificado'
      :project?.repository_url?'GitHub · URL salva, leitura ausente':'GitHub · sem leitura autenticada',
      project?.repository_url?'partial':'blocked');
    set('capabilityRuntime','Runtime · workspace sem grant','blocked');
    set('capabilityContinuity','24 h · supervisor ausente','blocked');
  }
  function syncCoordinatorActions() {
    const selected=orchestrators.find(item=>item.id===orchestratorId);
    const selectedReady=Boolean(selected)&&selected.status!=='paused';
    $('coordinatorSend').disabled=!orchestratorChatAvailable||!selectedReady||analysisBusy||coordinatorSubmitting||!coordinatorDraftCommitAvailable;
    $('analyzeWorks').disabled=!coordinatorAvailable||!selectedReady||workCount===0||analysisBusy||preflightBusy||coordinatorSubmitting;
    $('inspectProjectAccess').disabled=!projectId||!selected||analysisBusy||preflightBusy||coordinatorSubmitting;
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
  async function activateCoordinatorDraft(taskId,isCurrent=()=>true) {
    if(chatTaskId===taskId&&coordinatorDraftTaskId===taskId)return;
    await flushCoordinatorDraft();
    // A previous project selection may have been replaced while flushing.
    if(!isCurrent())return;
    const generation=++coordinatorDraftGeneration;
    chatTaskId=taskId;
    coordinatorDraftTaskId=taskId;
    coordinatorDraftRevision=0;
    pendingCoordinatorDraft=null;
    $('coordinatorPrompt').value='';
    setCoordinatorDraftState('');
    if(!taskId)return;
    const draft=await readCoordinatorDraft(taskId);
    if(!isCurrent()||generation!==coordinatorDraftGeneration||taskId!==chatTaskId)return;
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
    const current=projects.find(project=>project.id===projectId);
    // Read-only projection of the selected canonical project: not a second
    // project store and never proof that a GitHub URL was actually read.
    $('activeProjectName').textContent=current?.name||'Conecte seu projeto';
    const legacyCount=Math.max(0,projects.length-1);
    const repository=current?.repository_url?'GitHub vinculado por URL · leitura não verificada':'Repositório GitHub ainda não vinculado';
    $('activeProjectDetail').textContent=current
      ?repository+(legacyCount?' · '+legacyCount+' outro(s) projeto(s) existente(s)':'')
      :'Configure um projeto para começar';
    // Legacy projects remain selectable for safe migration, but they do not
    // compete with the active instance as primary navigation.
    $('legacyProjectAccess').hidden=projects.length<=1;
    const list=$('projectNavList');list.replaceChildren();
    if(!projects.length){const empty=document.createElement('p');empty.className='nav-empty';empty.textContent='Conecte seu primeiro projeto.';list.append(empty);return;}
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
  const workClass=work=>
    ['reconciliation_required','review_required'].includes(work.execution?.observed)?'attention':
    work.status==='running'?'running':
    work.status==='completed'?'completed':
    ['failed','error','interrupted'].includes(work.status)?'attention':'ready';
  function clearProjectPreflight() {
    // Invalidate read-only responses issued before a project change or Pause.
    preflightGeneration++;
    $('projectPreflightState').textContent='Diagnóstico ainda não solicitado. Uma URL GitHub não comprova acesso ao repositório.';
    $('projectPreflightState').dataset.state='idle';
    $('analyzeWorks').textContent='Analisar frentes';
    $('projectPreflightActions').replaceChildren();
    $('projectPreflightActions').hidden=true;
    clearRepositoryObservation();
  }
  function renderProjectPreflight(snapshot) {
    const guide=describeProjectPreflight(snapshot);
    const node=$('projectPreflightState');
    $('analyzeWorks').textContent=guide.analysisLabel;
    node.textContent=guide.summary;
    node.dataset.state=guide.state;
    const list=$('projectPreflightActions');
    list.replaceChildren(...guide.actions.map(action=>{
      const item=document.createElement('li');
      item.textContent=action;return item;
    }));
    list.hidden=guide.actions.length===0;
  }
  async function inspectProjectPreflight(p,o) {
    const generation=++preflightGeneration;
    const requested=projectsCache.find(item=>item.id===p)?.observation_requested===1;
    const snapshot=await call('project_preflight',{projectId:p,orchestratorId:o});
    // A pending project A read, old Start or an earlier retry cannot leak
    // into a different project/coordinator or supersede a later Pause.
    if(generation!==preflightGeneration||p!==projectId||o!==orchestratorId||
      requested!==(projectsCache.find(item=>item.id===p)?.observation_requested===1))
      return null;
    if(snapshot?.projectId!==p||snapshot.orchestratorId!==o||
      snapshot.observation?.requested!==requested||
      snapshot.schema!=='ordax.orchestrator.project-preflight/2')
      throw Error('project_preflight_scope_mismatch');
    renderProjectPreflight(snapshot);
    return snapshot;
  }
  async function inspectRequestedProject() {
    const p=projectId,o=orchestratorId;
    if(!projectsCache.some(project=>project.id===p&&project.observation_requested===1))return null;
    if(!o) {
      $('projectPreflightState').textContent='Início solicitado, mas este projeto não tem Administrador Geral. Configure um coordenador para diagnosticar as frentes locais.';
      $('projectPreflightState').dataset.state='blocked';
      return null;
    }
    try{return await inspectProjectPreflight(p,o);}
    catch {
      if(p===projectId&&o===orchestratorId&&
        projectsCache.some(project=>project.id===p&&project.observation_requested===1)) {
        $('projectPreflightState').textContent='Diagnóstico local indisponível. Nenhum acesso externo ou execução foi iniciado.';
        $('projectPreflightState').dataset.state='blocked';
        $('projectPreflightActions').replaceChildren();
        $('projectPreflightActions').hidden=true;
      }
      return null;
    }
  }
  function clearRepositoryObservation() {
    $('repositoryObservationState').textContent='Nenhum HEAD autenticado verificado nesta sessão.';
    $('repositoryObservationState').dataset.state='idle';
  }
  function renderProjectPulse(counts,total) {
    const panel=$('projectPulse');
    const hasScope=Boolean(projectId&&orchestratorId);
    panel.hidden=!hasScope;
    $('openProjectWork').disabled=!hasScope;
    if(!hasScope)return;
    $('projectPulseTotal').textContent=String(total);
    $('projectPulseRunning').textContent=String(counts.running);
    $('projectPulseAttention').textContent=String(counts.attention);
    $('projectPulseWaiting').textContent=String(counts.ready);
    panel.dataset.state=counts.attention?'review':counts.running?'running':'idle';
    $('projectPulseNote').textContent=counts.attention
      ?'Há frentes que exigem revisão do histórico e dos recibos. Nenhum reenvio é automático.'
      :total===0
        ?'Nenhuma frente de trabalho registrada. Crie uma frente para acompanhar o progresso.'
        :'Estados das conversas registradas; não comprovam execução autônoma nem conclusão do projeto.';
  }
  function applyWorkFilters(){
    const normalize=text=>String(text||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
    const query=normalize($('workSearch')?.value).trim();
    const state=$('workStatusFilter')?.value||'all';
    const nodes=$('orchestratorWorks').querySelectorAll('.work-card');
    const byId=new Map(visibleWorkItems.map(work=>[work.id,work]));
    let visible=0;
    for(const button of nodes){
      const work=byId.get(button.dataset.taskId);
      const show=Boolean(work)&&(!query||normalize(work.title).includes(query))&&(state==='all'||workClass(work)===state);
      (button.closest('.work-entry')||button).hidden=!show;if(show)visible++;
    }
    const summary=$('orchestratorWorks').querySelector('.work-attention-summary');
    // A global warning must not obscure a different filter or search result.
    if(summary)summary.hidden=Boolean(query)||(state!=='all'&&state!=='attention');
    $('workFilterEmpty').hidden=visibleWorkItems.length===0||visible>0;
    $('workFilteredCount').textContent=visible+' de '+visibleWorkItems.length+' frentes exibidas';
  }
  $('workSearch').addEventListener('input',applyWorkFilters);
  $('workStatusFilter').addEventListener('change',applyWorkFilters);
  $('clearWorkFilters').addEventListener('click',()=>{
    $('workSearch').value='';
    $('workStatusFilter').value='all';
    applyWorkFilters();
    $('workSearch').focus();
  });
  let dependencyWorks=[],dependencySelectionDirty=false,dependencyProject=null,dependencyCurrentTarget='';
  function updateDependencySelectionCount(){
    const boxes=[...$('dependencyCandidates').querySelectorAll('input[type="checkbox"]')];
    const marked=boxes.filter(box=>box.checked).length;
    const selected=dependencyWorks.find(work=>work.id===$('dependencyTarget').value);
    const persisted=new Set(Array.isArray(selected?.dependsOn)?selected.dependsOn:[]);
    dependencySelectionDirty=Boolean(selected)&&boxes.some(box=>box.checked!==persisted.has(box.value));
    $('dependencySelectionCount').textContent=$('dependencyTarget').value
      ?marked+' de '+boxes.length+' pré-requisitos selecionados'
      :'Selecione uma frente para organizar.';
    $('clearDependencySelection').disabled=marked===0;
    $('discardDependencyChanges').disabled=!dependencySelectionDirty;
  }
  function showDependencyChoices(){
    const targetId=$('dependencyTarget').value;
    dependencyCurrentTarget=targetId;
    const selected=dependencyWorks.find(work=>work.id===targetId);
    const area=$('dependencyCandidates');area.replaceChildren();
    if(!selected){
      area.textContent='Selecione uma frente que ainda não foi executada.';
      updateDependencySelectionCount();
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
    updateDependencySelectionCount();
  }
  function renderDependencyEditor(works,plan){
    const editor=$('workDependencyEditor'),select=$('dependencyTarget'),save=$('saveWorkDependencies');
    const sameProject=dependencyProject===projectId;
    if(editor.open&&dependencySelectionDirty&&sameProject)return new Set();
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
    return new Set(eligible.map(work=>work.id));
  }
  function renderWorks(works,plan=null,dependencyEligibleIds=new Set()) {
    visibleWorkItems=works;
    const planWorkers=new Map((plan?.workers||[]).map(w=>[w.taskId,w]));
    const candidates=new Set(plan?.candidates||[]);
    const waiting=new Set(plan?.waiting||[]);
    const blocked=new Set(plan?.blocked||[]);
    const labels={running:['Em andamento','running'],completed:['Concluída','completed'],failed:['Revisar','attention'],error:['Revisar','attention'],interrupted:['Revisar','attention'],paused:['Pausada','paused'],ready:['Pronta','ready']};
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
    for(const work of works)counts[workClass(work)]++;
    renderProjectPulse(counts,works.length);
    const attention=works.filter(work=>workClass(work)==='attention');
    if(attention.length){
      const summary=document.createElement('div');
      summary.className='work-attention-summary';
      summary.setAttribute('role','status');
      const label=document.createElement('strong');
      label.textContent='Há frentes que precisam de revisão';
      const description=document.createElement('span');
      description.textContent='Abra a conversa para conferir a última execução e seus recibos antes de continuar.';
      summary.append(label,description);list.append(summary);
    }
    if(!works.length){applyWorkFilters();const empty=document.createElement('div');empty.className='work-rail-empty';empty.textContent='Nenhuma frente registrada neste projeto. Use a ação de nova frente acima para criar um rascunho, sem envio automático ao GPT.';list.append(empty);return;}
    const ordered=[...works].sort((a,b)=>{const priority={attention:0,running:1,ready:2,completed:4};return (priority[workClass(a)]??5)-(priority[workClass(b)]??5);});
    for(const work of ordered){
    …6375 tokens truncated…  await refreshAutonomousDialogue();
    return isCurrent()?orchestrators:[];
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
    document.body.classList.remove('orchestrator-rail-open');$('contextRail').classList.remove('open');
    $('openWorks').setAttribute('aria-expanded','false');
    $('coordinatorRailToggle').setAttribute('aria-expanded','false');
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
    document.body.classList.remove('orchestrator-rail-open');$('contextRail').classList.remove('open');
    const previous=projectId,next=$('projectSelect').value||null;
    if(previous===next)return;
    try{await flushCoordinatorDraft();}catch{$('projectSelect').value=previous||'';status('O rascunho do chat central não foi salvo; o projeto atual foi mantido.');return;}
    projectId=next;orchestratorId=null;clearProjectPreflight();
    await refreshProjects();
    $('orchestrationPanel').hidden=true;coordinatorOpen=false;
    try{
      const items=await refreshOrchestrators();
      if(items.length)await showCoordinator();
      else{document.body.classList.remove('orchestrator-focus','orchestrator-rail-open');$('empty').classList.remove('hidden');
        await onNavigationChange?.({view:'home',projectId,orchestratorId:null,taskId:null});}
      await inspectRequestedProject();
    }catch{error();}
  });
  $('orchestratorSelect').addEventListener('change',async()=>{
    const previous=orchestratorId,next=$('orchestratorSelect').value||null;
    if(previous===next)return;
    try{await flushCoordinatorDraft();}catch{$('orchestratorSelect').value=previous||'';status('O rascunho do chat central não foi salvo; o orquestrador atual foi mantido.');return;}
    orchestratorId=next;clearProjectPreflight();
    try{await refreshOrchestrators();if(chatTaskId)await showCoordinator();
      else await onNavigationChange?.({view:'home',projectId,orchestratorId,taskId:null});
      await inspectRequestedProject();}catch{error();}
  });
  $('newProjectForm').addEventListener('submit',event=>{
    event.preventDefault();void formAction(event.currentTarget,async()=>{
      await flushCoordinatorDraft();
      const name=$('projectName').value.trim();
      const mission=resolveProjectOnboardingMission(name,$('projectObjective').value);
      if(!mission) {
        status('Informe o nome do projeto ou descreva o objetivo antes de conectar.');
        $('projectName').focus();
        return;
      }
      const repositoryUrl=$('projectRepositoryUrl').value.trim();
      const input={mission,...(name?{name}:{}),...(repositoryUrl?{repositoryUrl}:{})};
      const receipt=await command('mission_create',input);
      if(receipt.status!=='succeeded')return;
      projectId=receipt.result.projectId;orchestratorId=receipt.result.orchestratorId;clearProjectPreflight();
      $('newProjectForm').reset();$('projectSetup').open=false;
      await refreshProjects();await refreshOrchestrators();
      await onNavigationChange?.({view:'coordinator',projectId,orchestratorId,taskId:null});
      await showCoordinator();
      status('Projeto e missão criados localmente. Use Iniciar para solicitar a análise sem prompt; nenhum envio ao GPT ocorreu.');
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
        clearProjectPreflight();
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
        else if(error?.message==='orchestrator_repository_change_requires_observation_pause')
          status('Pause a observação solicitada antes de mudar o repositório vinculado.');
        else status('Não foi possível salvar o repositório. Consulte o estado antes de repetir.');
      } finally {button.disabled=false;}
    })();
  });
  $('observeProjectRepository').addEventListener('click',async()=>{
    const button=$('observeProjectRepository');
    const p=projectId,repositoryUrl=projectsCache.find(item=>item.id===p)?.repository_url;
    if(button.disabled||!repositoryPortAvailable||!p||!repositoryUrl||repositoryBusy)return;
    repositoryBusy=true;button.disabled=true;
    try{
      const snapshot=await call('repository_observe',{projectId:p});
      if(p!==projectId||projectsCache.find(item=>item.id===p)?.repository_url!==repositoryUrl)return;
      if(snapshot?.schema!=='ordax.orchestrator.repository-observation/1'||
        snapshot.repositoryUrl!==repositoryUrl||snapshot.provenance?.grantRechecked!==true)
        throw Error('orchestrator_repository_observation_unverified');
      const label=$('repositoryObservationState');
      label.dataset.state='ready';
      label.textContent=`GitHub autenticado: ${snapshot.defaultBranch} @ ${snapshot.headSha.slice(0,12)} · observado em ${snapshot.observedAt}. Apenas metadados do HEAD; PRs e checks não foram lidos.`;
    }catch{
      if(p===projectId&&projectsCache.find(item=>item.id===p)?.repository_url===repositoryUrl){
        $('repositoryObservationState').dataset.state='blocked';
        $('repositoryObservationState').textContent='Leitura GitHub não comprovada ou permissão revogada. Nenhum HEAD será assumido.';
      }
    }finally{
      repositoryBusy=false;
      button.disabled=!repositoryPortAvailable||!projectsCache.find(item=>item.id===projectId)?.repository_url;
    }
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
  let openingWorkNavigation=false;
  $('openWorks').addEventListener('click',()=>{
    // Work navigation opens the *list*, never an arbitrary first GPT task.
    // The user chooses the actual destination before any work is opened.
    if(openingWorkNavigation)return;
    if(!projectId||!orchestratorId||!chatTaskId){
      status('Selecione um projeto e configure o Administrador Geral para ver as frentes.');
      return;
    }
    const currentProject=projectId,currentOrchestrator=orchestratorId;
    openingWorkNavigation=true;
    void (async()=>{
      try{
        if(!coordinatorOpen)
          await showCoordinator();
        if(currentProject!==projectId||currentOrchestrator!==orchestratorId)return;
        openFilteredWorks('all',$('openWorks'));
      }catch{
        status('Não foi possível abrir a lista de frentes. Confira o estado antes de tentar novamente.');
      }finally{openingWorkNavigation=false;}
    })();
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
  // One keyboard submission path: Enter or Ctrl/Cmd+Enter submits; Shift+Enter
  // inserts a newline and IME composition must never trigger an early send.
  $('coordinatorPrompt').addEventListener('keydown',event=>{
    if(event.key!=='Enter'||event.isComposing||event.shiftKey)return;
    event.preventDefault();
    if(!$('coordinatorSend').disabled)$('coordinatorComposer').requestSubmit();
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
  async function analyzeRegisteredWorks(p,o,{automatic=false}={}) {
    const snapshot=await inspectProjectPreflight(p,o);
    if(p!==projectId||o!==orchestratorId)return null;
    if(automatic&&!projectsCache.some(item=>item.id===p&&item.observation_requested===1))return null;
    if(!snapshot||!snapshot.gates.recordedWorkAnalysisEligible) {
      if(snapshot)status('Início registrado, mas a análise do Administrador está bloqueada pelas pré-condições locais. Nenhum envio foi realizado.');
      return null;
    }
    const receipt=await command('orchestrator_analyze',{projectId:p,orchestratorId:o});
    if(p!==projectId||o!==orchestratorId)return null;
    if(receipt.status==='succeeded')status(automatic
      ?'Diagnóstico inicial registrado pelo Administrador Geral, sem prompt. Analisou somente frentes locais; GitHub, GPT Web e Runtime não foram acionados.'
      :'Análise das frentes locais registrada. Nenhuma recomendação foi executada.');
    else status('Análise não confirmada. Confira o histórico antes de tentar novamente; o app não repetiu a solicitação.');
    await renderCoordinator();
    return receipt;
  }
  $('projectObservationToggle').addEventListener('click',async()=>{
    const p=projectId,project=projectsCache.find(item=>item.id===projectId);
    if(!project||observationBusy)return;
    // Snapshot the selected scope before any await. A late response may not
    // change the state or message of a different project.
    const enabled=project.observation_requested!==1;
    if(enabled&&(analysisBusy||coordinatorSubmitting))return;
    observationBusy=true;syncProjectObservation();
    if(enabled){analysisBusy=true;syncCoordinatorActions();}
    try {
      const receipt=await command('project_observation_set',{projectId:p,enabled});
      if(receipt.status!=='succeeded'||receipt.result?.requested!==enabled)
        throw Error('orchestrator_observation_unconfirmed');
      if(p!==projectId)return;
      clearProjectPreflight();
      await refreshProjects();
      if(p!==projectId)return;
      if(enabled)await analyzeRegisteredWorks(p,orchestratorId,{automatic:true});
      if(p!==projectId)return;
      if(enabled&&!projectsCache.some(item=>item.id===p&&item.observation_requested===1))return;
      if(!enabled)status(
        'Observação pausada no projeto. Nenhum grant da Platform foi alterado.');
    }catch(error){
      if(p===projectId)status(error?.message==='orchestrator_project_observation_exclusive'
        ?'Outro projeto já tem início solicitado neste perfil. Pause aquele projeto antes de iniciar este.'
        :'Não foi possível confirmar a mudança da observação. Consulte o estado antes de repetir.');
    }finally{
      observationBusy=false;
      if(enabled)analysisBusy=false;
      // The user may have selected another project while the old command
      // was awaited. Restore controls for the CURRENT scope, not the old one.
      syncProjectObservation();
    }
  });
  $('inspectProjectAccess').addEventListener('click',async()=>{
    if($('inspectProjectAccess').disabled||!projectId||!orchestratorId)return;
    const p=projectId,o=orchestratorId;
    preflightBusy=true;syncCoordinatorActions();
    try{await inspectProjectPreflight(p,o);}
    catch{
      if(p===projectId&&o===orchestratorId) {
        $('projectPreflightState').textContent='Não foi possível confirmar o diagnóstico local. Nenhuma análise ou execução foi iniciada.';
        $('projectPreflightState').dataset.state='blocked';
      }
    }finally{preflightBusy=false;syncCoordinatorActions();}
  });
  $('analyzeWorks').addEventListener('click',async()=>{
    if($('analyzeWorks').disabled||!projectId||!orchestratorId)return;
    const p=projectId,o=orchestratorId;
    analysisBusy=true;syncCoordinatorActions();
    status(nodeHost
      ?'Analisando frentes locais pelo coordenador disponível; o GitHub não será lido e nenhuma frente GPT será acionada…'
      :'Analisando frentes locais pelo Groq; o GitHub não será lido e nenhuma frente GPT será acionada…');
    try {
      await analyzeRegisteredWorks(p,o);
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
      // One bounded read-only reconciliation after reopening the same project.
      // Never silently activate a scheduler, provider or foreign repository.
      await inspectRequestedProject();
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
