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
    $('startAutonomousTechnical').disabled=$('startAutonomousDialogue').disabled;
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
    const otherProjects=projects.filter(project=>project.id!==projectId);
    const repository=current?.repository_url?'GitHub vinculado por URL · leitura não verificada':'Repositório GitHub ainda não vinculado';
    $('activeProjectDetail').textContent=current?repository:'Crie seu primeiro projeto usando Novo projeto.';
    // One canonical Store supplies the active project and switchable others.
    // Previously created projects are first-class, never hidden as legacy.
    $('projectSwitcher').hidden=otherProjects.length===0;
    const list=$('projectNavList');list.replaceChildren();
    for(const project of otherProjects){
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
  let verificationRequiredWorkIds=new Set();
  const workClass=work=>
    ['reconciliation_required','review_required'].includes(work.execution?.observed)?'attention':
    work.status==='running'?'running':
    work.status==='completed'?'completed':
    ['failed','error','interrupted'].includes(work.status)?'attention':'ready';
  // One classification drives pulse counters, per-work labels and rail filters.
  const workClassForPlan=work=>verificationRequiredWorkIds.has(work.id)?'attention':workClass(work);
  // This monitor is a projection of the existing project Works and mission.
  // It never creates a virtual agent, an estimated progress percentage or a
  // second execution ledger. A succeeded GPT Run is not a verified code change.
  let executionMission=null,executionMissionScope='',executionWorkScope='';
  const executionScope=()=>[projectId,orchestratorId].join(':');
  function renderExecutionMonitor() {
    const scope=executionScope(),works=executionWorkScope===scope?visibleWorkItems:[];
    const mission=executionMissionScope===scope?executionMission:null;
    const active=mission?.mode==='technical'?mission:null;
    const stats={running:0,attention:0,ready:0,completed:0};
    for(const work of works)stats[workClassForPlan(work)]++;
    $('executionWorkCount').textContent=String(works.length);
    $('executionRunningCount').textContent=String(stats.running);
    $('executionReviewCount').textContent=String(stats.attention);
    const state=active?.state||'idle';
    const stateLabels={
      idle:'Sem missão',queued:'Preparando',ready_a:'Aguardando GPT',
      sending_a:'Enviando ao GPT',ready_b:'Revisando GPT',reviewing_a:'Revisão Groq',
      ready_final:'Aguardando GPT',sending_b:'Enviando ao GPT',
      ready_review_final:'Revisando GPT',reviewing_final:'Revisão Groq',
      budget_exhausted:'Aguardando autorização',
      verification_required:'Verificação necessária',
      reconciliation_required:'Reconciliação necessária',blocked:'Bloqueada'
    };
    const badge=$('executionMissionBadge');
    badge.textContent=stateLabels[state]||'Estado registrado';
    badge.dataset.state=['sending_a','sending_b','reviewing_a','reviewing_final'].includes(state)
      ?'running':['verification_required','reconciliation_required','budget_exhausted'].includes(state)
        ?'attention':state==='blocked'?'blocked':'idle';
    const title=active?.mission?.trim()||'Nenhuma missão técnica registrada';
    $('executionMissionTitle').textContent=title.length>140?title.slice(0,137)+'…':title;
    $('executionMissionDetail').textContent=active?.decision?.summary
      ?'Decisão Groq registrada: '+active.decision.summary
      :active?.lastError
        ?'Interrupção registrada: '+active.lastError+'. Consulte os recibos antes de agir.'
        :active?'Missão vinculada ao projeto; resultados externos ainda não certificados.'
          :'Inicie ou inspecione uma missão para acompanhar as decisões do administrador.';
    const workList=$('executionWorkList');workList.replaceChildren();
    const priority={running:0,attention:1,ready:2,completed:3};
    const ordered=[...works].sort((a,b)=>
      priority[workClassForPlan(a)]-priority[workClassForPlan(b)]).slice(0,5);
    if(!ordered.length){
      const empty=document.createElement('p');empty.className='execution-empty';
      empty.textContent='Ainda não há frentes GPT neste projeto. Nenhum agente ativo foi confirmado.';
      workList.append(empty);
    }
    for(const work of ordered){
      const state=workClassForPlan(work);
      const button=document.createElement('button');
      button.type='button';button.className='execution-work-item';
      button.dataset.state=state;button.setAttribute('role','listitem');
      const icon=document.createElement('span');icon.className='execution-work-symbol';
      icon.textContent=state==='running'?'◉':state==='attention'?'!':'◇';
      const copy=document.createElement('span');copy.className='execution-work-copy';
      const title=document.createElement('strong');title.textContent=work.title;
      const info=document.createElement('small');
      info.textContent=work.latest_run_status==='succeeded'?'Resposta GPT registrada · efeito não verificado':
        work.running_runs>0?'Run GPT em andamento':
        work.execution?.observed==='reconciliation_required'?'Envio incerto · reconciliar':
        work.provider_segments>0?'Conversa registrada no projeto':'Ainda sem resposta GPT';
      copy.append(title,info);
      const label=document.createElement('span');label.className='execution-work-state';
      label.textContent=state==='running'?'Em execução':
        state==='attention'?'Revisar':state==='completed'?'Run concluído':'Aguardando';
      button.append(icon,copy,label);
      button.addEventListener('click',async()=>{
        if(scope!==executionScope())return;
        try{coordinatorOpen=false;await onOpenWork(work.id);}
        catch{status('Não foi possível abrir a frente. Nenhuma mensagem foi enviada.');}
      });
      workList.append(button);
    }
    const timeline=$('executionActivity');timeline.replaceChildren();
    const entries=[];
    if(active)entries.push(['Missão registrada',stateLabels[state]||state]);
    if(active?.decision)entries.push(['Análise Groq',active.decision.summary||
      'Uma decisão foi registrada; consulte a revisão completa.']);
    for(const work of ordered.filter(w=>w.latest_run_status||w.running_runs>0).slice(0,3)){
      entries.push([work.title,work.running_runs>0?'Run GPT em andamento':
        work.latest_run_status==='succeeded'?'Resposta observada; verificação externa pendente':
        'Último Run: '+work.latest_run_status]);
    }
    if(!entries.length)entries.push(['Sem execução comprovada',
      'O painel acompanha apenas missões, Runs e recibos presentes no projeto.']);
    for(const [name,detail] of entries){
      const item=document.createElement('li'),strong=document.createElement('strong');
      const description=document.createElement('span');
      strong.textContent=name;description.textContent=detail;
      item.append(strong,description);timeline.append(item);
    }
  }
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
      const show=Boolean(work)&&(!query||normalize(work.title).includes(query))&&(state==='all'||workClassForPlan(work)===state);
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
    verificationRequiredWorkIds=new Set(plan?.verificationRequired||[]);
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
        plan.inFlight+' em execução no projeto · '+
        verificationRequiredWorkIds.size+' respostas aguardando comprovação de resultado. '+physical+
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
    for(const work of works)counts[workClassForPlan(work)]++;
    renderProjectPulse(counts,works.length);
    const attention=works.filter(work=>workClassForPlan(work)==='attention');
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
    const ordered=[...works].sort((a,b)=>{const priority={attention:0,running:1,ready:2,completed:4};return (priority[workClassForPlan(a)]??5)-(priority[workClassForPlan(b)]??5);});
    for(const work of ordered){
      const state=workClassForPlan(work);
      const label=verificationRequiredWorkIds.has(work.id)?'Verificar resultado':
        work.execution?.observed==='reconciliation_required'?'Resultado incerto':
        work.execution?.observed==='review_required'?'Revisar recibo':
        (labels[work.status]||labels.ready)[0];
      // A Host capability gap is not a failure of this work item.
      const button=document.createElement('button');
      button.type='button';button.className='work-card';button.dataset.taskId=work.id;
      const copy=document.createElement('span');copy.className='work-card-copy';
      const title=document.createElement('strong');title.textContent=work.title;
      const detail=document.createElement('small');detail.textContent=work.provider_segments
        ?`${work.provider_segments} conversa${work.provider_segments===1?'':'s'} no histórico`
        :nodeHost?'Rascunho local • envio ao GPT indisponível neste host':'Conversa pronta para iniciar';
      const evidence=document.createElement('span');evidence.className='work-evidence-stack';
      const runState=document.createElement('small');
      const states={running:'Run ativo',succeeded:'Último Run confirmado',failed:'Último Run falhou',cancelled:'Último Run cancelado',interrupted:'Run interrompido'};
      const observed=work.execution?.observed==='reconciliation_required'?'Execução incerta · verificar recibos':
        work.execution?.observed==='review_required'?'Execução requer revisão':
        work.execution?.observed==='running'?'Run em andamento':
        work.execution?.observed==='last_run_succeeded'?'Último Run confirmado':
        work.running_runs>0?'Run em andamento':states[work.latest_run_status]||'Sem Run confirmado';
      runState.textContent='Execução · '+observed;
      runState.className='work-run-evidence';
      evidence.append(runState);
      if(Array.isArray(work.dependsOn)&&work.dependsOn.length){
        const dependencies=document.createElement('small');
        dependencies.className='work-run-evidence';
        dependencies.textContent='Dependências · '+work.dependsOn.length+' registrada(s)';
        evidence.append(dependencies);
      }
      copy.append(title,detail,evidence);
      const planned=planWorkers.get(work.id);
      if(planned){
        const label=document.createElement('small');
        label.className='work-plan-item';
        label.textContent='Plano · '+(verificationRequiredWorkIds.has(work.id)?'Resposta GPT recebida; resultado externo não verificado':
          blocked.has(work.id)?'Dependência bloqueada · revisar':
          waiting.has(work.id)?'Aguardando pré-requisitos':
          candidates.has(work.id)?'Candidata à próxima ação · requer autorização':
          planned.state==='uncertain'?'Entrega incerta · reconciliar':
          planned.state==='failed'?'Falha confirmada · revisar':
          planned.state==='running'?'Ação em andamento':
          planned.state==='succeeded'?'Último Run concluído; qualidade não certificada':
          planned.state==='pending'?'Aguardando capacidade ou autorização':
          'Estado não liberado');
        copy.append(label);
      }
      const badge=document.createElement('span');badge.className=`work-state ${state}`;badge.textContent=label;
      button.append(copy,badge);button.addEventListener('click',async()=>{
        try{coordinatorOpen=false;await onOpenWork(work.id);}catch{status('Não foi possível abrir esta conversa.');}
      });
      const entry=document.createElement('div');entry.className='work-entry';entry.append(button);
      if(dependencyEligibleIds.has(work.id)){
        const edit=document.createElement('button');edit.type='button';
        edit.className='work-dependency-action';
        edit.textContent='Organizar pré-requisitos';
        edit.setAttribute('aria-label','Organizar pré-requisitos de '+work.title);
        edit.addEventListener('click',()=>{
          $('workDependencyEditor').open=true;
          if(dependencySelectionDirty&&$('dependencyTarget').value!==work.id){
            $('dependencyEditNote').textContent='Salve ou revise as alterações pendentes antes de trocar de frente.';
            $('dependencyTarget').focus();
            return;
          }
          $('dependencyTarget').value=work.id;
          dependencySelectionDirty=false;
          showDependencyChoices();
          $('workDependencyEditor').scrollIntoView({block:'nearest'});
          $('dependencyTarget').focus();
        });
        entry.append(edit);
      }
      list.append(entry);
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
        groq_response_filtered:'A resposta do Groq foi interrompida pelo filtro do provedor. Não foi aceita nem repetida.',
        groq_unexpected_tool_call:'Groq tentou concluir com uma ação não solicitada. O app não executou ferramentas nem aceitou a resposta.',
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
      const diagnostics=receipt.result||{};
      const groqLength=diagnostics.failureCode==='groq_incomplete_response'&&
        diagnostics.finishReason==='length';
      status(groqLength
        ?'Groq atingiu o limite de geração antes de concluir a resposta. Nenhuma resposta parcial foi aceita ou enviada ao GPT.'
        :failures[diagnostics.failureCode]||
          'A solicitação falhou e não foi repetida. Confira a configuração e tente novamente quando estiver pronta.');
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
  function syncProjectObservation() {
    const project=projectsCache.find(item=>item.id===projectId);
    const requested=project?.observation_requested===1;
    const anotherRequested=projectsCache.some(item=>item.id!==projectId&&item.observation_requested===1);
    const button=$('projectObservationToggle');
    button.disabled=!project||observationBusy||(!requested&&anotherRequested);
    button.dataset.requested=String(requested);
    button.textContent=requested?'Pausar':'Iniciar';
    $('projectObservationState').dataset.state=requested?'blocked':'idle';
    $('projectObservationState').textContent=!project
      ?'Selecione um projeto.'
      :requested
        ?'Início solicitado. O preflight local é restaurado ao abrir o projeto; não há observação remota nem execução em segundo plano.'
        :anotherRequested
          ?'Outro projeto deste perfil tem início solicitado. Pause aquele projeto antes de iniciar este.'
        :'Pausado. Iniciar registra a intenção, consulta o inventário local e pode solicitar uma análise ao Administrador Geral se os gates permitirem.';
  }
  function syncProjectRepository() {
    const project=projectsCache.find(item=>item.id===projectId);
    const input=$('projectRepositoryInput');
    input.value=project?.repository_url||'';
    input.disabled=!project;
    $('saveProjectRepository').disabled=!project;
    $('observeProjectRepository').hidden=!repositoryPortAvailable;
    $('observeProjectRepository').disabled=!repositoryPortAvailable||!project?.repository_url||repositoryBusy;
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
    syncProjectObservation();
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
    repositoryPortAvailable=engineStatus.repositoryPortAvailable===true;
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
    $('coordinatorNavProvider').textContent='Canal administrativo · '+routingName;
    $('coordinatorRouteLabel').textContent='CANAL ADMINISTRATIVO · '+routingName.toLocaleUpperCase('pt-BR');
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
  $('coordinatorApiSettings').addEventListener('click',()=>onOpenAppSettings?.('providers'));
  function openNewProjectForm(){
    const form=$('projectSetup');
    form.open=true;
    // The same canonical form serves the desktop shortcut and compact header.
    // No separate project-creation implementation or duplicate draft.
    form.scrollIntoView({block:'nearest',behavior:'auto'});
    $('projectName').focus();
  }
  $('addProject').addEventListener('click',openNewProjectForm);
  $('quickNewProject').addEventListener('click',openNewProjectForm);
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
  let workRailReturnFocus=$('coordinatorRailToggle');
  const setWorkRailOpen=open=>{
    const ready=open?(onSelectRightPane?.('context').catch(()=>{})??Promise.resolve()):Promise.resolve();
    document.body.classList.toggle('orchestrator-rail-open',open);
    $('contextRail').classList.toggle('open',open);
    $('coordinatorRailToggle').setAttribute('aria-expanded',String(open));
    $('openWorks').setAttribute('aria-expanded',String(open));
    return ready;
  };
  const openFilteredWorks=(filter,trigger)=>{
    if(!projectId||!orchestratorId)return;
    workRailReturnFocus=trigger;
    // A summary counter refers to ALL matching work; clear any stale search.
    $('workSearch').value='';
    $('workStatusFilter').value=filter;
    applyWorkFilters();
    void setWorkRailOpen(true).then(()=>{
      if(document.body.classList.contains('orchestrator-rail-open'))$('workSearch').focus();
    });
  };
  $('executionOpenWorks').addEventListener('click',()=>openFilteredWorks('all',$('executionOpenWorks')));
  $('refreshExecutionOverview').addEventListener('click',async()=>{
    const button=$('refreshExecutionOverview'),p=projectId,o=orchestratorId;
    if(button.disabled||!p||!o)return;
    button.disabled=true;
    try{
      await refreshWorks();
      if(p===projectId&&o===orchestratorId)await refreshAutonomousDialogue();
    }catch{status('Não foi possível atualizar a execução. O último estado confirmado foi preservado.');}
    finally{button.disabled=false;}
  });
  $('coordinatorRailToggle').addEventListener('click',()=>{
    workRailReturnFocus=$('coordinatorRailToggle');
    setWorkRailOpen(!$('contextRail').classList.contains('open'));
  });
  $('openProjectWork').addEventListener('click',()=>{
    openFilteredWorks('all',$('openProjectWork'));
  });
  $('projectPulseStats').addEventListener('click',event=>{
    const button=event.target.closest('button[data-work-filter]');
    if(!button||!event.currentTarget.contains(button))return;
    openFilteredWorks(button.dataset.workFilter,button);
  });
  $('closeWorkRail').addEventListener('click',()=>{
    setWorkRailOpen(false);
    if(workRailReturnFocus?.isConnected)workRailReturnFocus.focus();
    else $('coordinatorRailToggle').focus();
  });
  $('dependencyTarget').addEventListener('change',()=>{
    if(dependencySelectionDirty&&dependencyCurrentTarget&&$('dependencyTarget').value!==dependencyCurrentTarget){
      $('dependencyTarget').value=dependencyCurrentTarget;
      $('dependencyEditNote').textContent='Salve ou desfaça alterações pendentes antes de mudar de frente.';
      return;
    }
    showDependencyChoices();
  });
  $('dependencyCandidates').addEventListener('change',updateDependencySelectionCount);
  $('clearDependencySelection').addEventListener('click',()=>{
    for(const box of $('dependencyCandidates').querySelectorAll('input[type="checkbox"]'))box.checked=false;
    updateDependencySelectionCount();
  });
  $('discardDependencyChanges').addEventListener('click',()=>{
    showDependencyChoices();
    $('dependencyEditNote').textContent='Alterações não salvas descartadas. Nenhuma gravação ou envio foi realizado.';
  });
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
    if(!p) {workCount=0;executionWorkScope='';renderDependencyEditor([],null);renderWorks([]);renderExecutionMonitor();await onScopeChange(null);syncCoordinatorActions();return;}
    const [result,planning,allResult]=await Promise.all([
      call('work_list',{projectId:p,...(o?{orchestratorId:o}:{})}),
      call('work_plan',{projectId:p,maxParallel:4}).catch(()=>null),
      o?call('work_list',{projectId:p}).catch(()=>null):Promise.resolve(null)
    ]);
    if(generation!==epoch||p!==projectId||o!==orchestratorId)return;
    const works=result.works;
    workCount=works.length;
    $('openWorks').disabled=!projectId||!orchestratorId;
    $('openHistory').disabled=!projectId||!orchestratorId;
    $('openEvidence').disabled=!projectId||!orchestratorId;
    const editableDependencies=renderDependencyEditor(allResult?.works||result.works,planning?.plan||null);
    renderWorks(works,planning?.plan||null,editableDependencies);
    executionWorkScope=executionScope();renderExecutionMonitor();
    await onScopeChange(new Set(works.map(w=>w.id)));
    if(generation!==epoch||p!==projectId||o!==orchestratorId)return;
    syncCoordinatorActions();
  }
  async function refreshProjects() {
    const generation=++projectRefreshGeneration;
    const result=await call('projects_list');
    // Only the newest discovery may repopulate the project selector.
    if(generation!==projectRefreshGeneration)return projectsCache;
    projectsCache=result.projects;
    options($('projectSelect'),projectsCache,'Conversas sem projeto');
    if(projectsCache.some(p=>p.id===projectId))$('projectSelect').value=projectId;
    renderProjectNavigation(projectsCache);
    syncProjectRepository();
    return projectsCache;
  }
  async function refreshContinuityStatus() {
    const p=projectId,o=orchestratorId;
    if(!p||!o){$('continuityToggle').disabled=true;$('continuityProposalsToggle').disabled=true;$('continuityFollowupPrepare').hidden=true;$('continuityFollowupPrepare').disabled=true;$('continuityState').textContent='Selecione um orquestrador.';return;}
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
    const latestDecision=result.latest?.reviewDecision;
    const nextLabels={continue_same_conversation:'Continuar na conversa atual',
      new_conversation:'Abrir outra conversa',new_work:'Propor outra frente',
      request_correction:'Solicitar correção',verify_external_effect:'Verificar efeitos externos',
      candidate_complete:'Possível conclusão — falta verificar',blocked:'Aguardar dependência'};
    const reviewNotice=latestDecision?.reviewOnly===true
      ?' Revisão da última resposta GPT: '+(nextLabels[latestDecision.decision]||'Sem decisão')+
        '. '+String(latestDecision.summary||'').slice(0,240)+
        '. Proposta consultiva; nenhum efeito externo ou envio autorizado.'
      :'';
    const followup=$('continuityFollowupPrepare');
    const supported=new Set(['continue_same_conversation','request_correction','new_conversation']);
    const canPrepare=result.enabled===true&&result.latest?.state==='analyzed'&&
      result.latest.followupPrepared!==true&&latestDecision?.reviewOnly===true&&
      supported.has(latestDecision.decision)&&
      orchestrators.find(item=>item.id===o)?.status==='ready';
    followup.hidden=!canPrepare;
    followup.disabled=!canPrepare;
    followup.dataset.reviewRunId=canPrepare?result.latest.run_id:'';
    followup.textContent=latestDecision?.decision==='new_conversation'
      ?'Preparar nova conversa para continuar'
      :latestDecision?.decision==='request_correction'
        ?'Preparar correção na conversa GPT'
        :'Preparar continuação na conversa GPT';
    $('continuityState').textContent=(messages[result.state]||'Estado indisponível')+'.'+proposals+
      ' Nenhum envio automático ao GPT.'+reviewNotice+executionNotice;
  }
  async function refreshOrchestrators() {
    const generation=++orchestratorRefreshGeneration,p=projectId;
    const result=p?await call('orchestrators_list',{projectId:p}):{orchestrators:[]};
    // A late response from project A must never overwrite project B's state.
    if(generation!==orchestratorRefreshGeneration||p!==projectId)return [];
    orchestrators=result.orchestrators;
    if(!orchestrators.some(o=>o.id===orchestratorId))orchestratorId=orchestrators[0]?.id||null;
    options($('orchestratorSelect'),orchestrators,'Selecione um orquestrador');
    $('orchestratorSelect').value=orchestratorId||'';
    const selected=orchestrators.find(o=>o.id===orchestratorId);
    const selectedId=selected?.id||null;
    const isCurrent=()=>generation===orchestratorRefreshGeneration&&p===projectId&&selectedId===orchestratorId;
    await activateCoordinatorDraft(selected?.chat_task_id||null,isCurrent);
    if(!isCurrent())return [];
    $('openOrchestrator').disabled=!selected;
    $('pauseOrchestrator').disabled=!selected;
    $('pauseOrchestrator').textContent=selected?.status==='paused'?'Retomar':'Pausar';
    $('newOrchestratorForm').hidden=!p;
    $('openWorks').disabled=!p||!selected;
    $('openHistory').disabled=!p||!selected;
    $('openEvidence').disabled=!p||!selected;
    $('orchestratorMission').textContent=selected
      ?selected.name+' · '+selected.mission
      :'Configure o Administrador Geral deste projeto.';
    $('orchestratorTitle').textContent='Conversar com Orchestrator';
    syncCoordinatorActions();
    renderOrchestratorNavigation();
    await refreshWorks();
    if(!isCurrent())return [];
    await refreshContinuityStatus();
    if(!isCurrent())return [];
    await refreshAutonomousDialogue();
    return isCurrent()?orchestrators:[];
  }
  async function refreshAutonomousDialogue(){
    if(!projectId||!orchestratorId)return;
    const p=projectId,o=orchestratorId;
    const result=await call('autonomous_dialogue_status',{projectId:p,orchestratorId:o}).catch(()=>null);
    if(p!==projectId||o!==orchestratorId)return;
    const job=result?.mission;
    executionMission=job||null;executionMissionScope=executionScope();renderExecutionMonitor();
    const labels={queued:'Missão aceita; planejamento automático pendente',planning_a:'Groq preparando GPT A',ready_a:'Preparado para enviar GPT A',sending_a:'GPT A em execução',ready_b:'GPT A confirmado; preparando GPT B',planning_b:'Groq analisando resposta A',ready_final:'Pergunta B pronta',sending_b:'GPT B em execução',planning_final:'Groq interpretando resposta B',succeeded:'Concluído: duas respostas GPT e proposta final confirmadas',blocked:'Falha comprovada; sem reenvio automático',reconciliation_required:'Resultado incerto: exige reconciliação, sem reenvio'};
    const technicalLabel=job?.mode==='technical'?(
      job.state==='verification_required'
        ?'GPT respondeu; verificação externa de alterações/testes é necessária'
        :job.state==='budget_exhausted'
          ?'Ciclo de dois envios concluído; decisão Groq registrada'+
            (job.canContinue?'; é possível autorizar outro ciclo':'')
          :job.state==='blocked'
            ?'Missão técnica bloqueada; nenhum envio será repetido'
            :job.state==='reconciliation_required'
              ?'Missão técnica incerta; exige reconciliação sem repetir'
              :'Missão técnica: '+(labels[job.state]||job.state)
    ):null;
    const storyLabel=job?.mode==='story'?(job.quality?.passed===false
      ?'História produzida, mas reprovada na qualidade: '+job.quality.violations.join(', ')
      :job.state==='succeeded'
      ?'História final montada pelo Groq, após duas rodadas GPT A/B'
      :job.state.startsWith('story_')?'História colaborativa: '+job.state.replaceAll('_',' '):null):null;
    $('autonomousDialogueState').textContent=job?`${technicalLabel||storyLabel||labels[job.state]||job.state}. ${job.lastError||''}${job.decision?.summary?' Decisão Groq: '+job.decision.summary:''}${job.questionFinal?(job.mode==='story'?' História final: ':' Próximo passo proposto (não enviado): ')+job.questionFinal:''}`:
      'Uma missão autoriza duas perguntas ou quatro cenas em duas rodadas. Groq conduz tudo sem comandos adicionais.';
    // A failed or uncertain mission remains read-only. Reuse the canonical
    // Task navigator to inspect confirmed records, never schedule a retry.
    const reviews=$('autonomousReviewActions');
    reviews.replaceChildren();
    if(job&&['succeeded','blocked','reconciliation_required','verification_required','budget_exhausted'].includes(job.state)) {
      for(const item of job.reviewTasks||[]) {
        if(typeof item?.taskId!=='string'||!item.taskId)continue;
        const button=document.createElement('button');
        button.type='button';button.className='mini-secondary';
        button.textContent='Revisar '+item.label;
        button.addEventListener('click',async()=>{
          if(p!==projectId||o!==orchestratorId)return;
          button.disabled=true;
          try {
            coordinatorOpen=false;$('orchestrationPanel').hidden=true;
            await onOpenWork(item.taskId);
          }catch{
            status('Não foi possível abrir a conversa para revisão. Nenhuma mensagem foi reenviada.');
            button.disabled=false;
          }
        });
        reviews.append(button);
      }
    }
    reviews.hidden=reviews.childElementCount===0;
    $('startAutonomousDialogue').disabled=Boolean(job && !['succeeded','blocked','reconciliation_required','verification_required','budget_exhausted'].includes(job.state))||!coordinatorAvailable||!gptWebTransportAvailable||analysisBusy||coordinatorSubmitting||preflightBusy;
    $('startAutonomousStory').disabled=$('startAutonomousDialogue').disabled;
    $('startAutonomousTechnical').disabled=$('startAutonomousDialogue').disabled;
    const continueButton=$('continueAutonomousTechnical');
    continueButton.hidden=job?.canContinue!==true;
    continueButton.disabled=continueButton.hidden||!coordinatorAvailable||
      !gptWebTransportAvailable||analysisBusy||coordinatorSubmitting||preflightBusy;
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
  function openMissionNavigation(filter,trigger){
    // Every destination opens the same scoped Work list. Never choose a GPT
    // Task automatically, even when arriving from a different app screen.
    if(openingWorkNavigation)return;
    if(!projectId||!orchestratorId||!chatTaskId){
      status('Selecione um projeto e configure o Administrador Geral para ver as frentes.');
      return;
    }
    const currentProject=projectId,currentOrchestrator=orchestratorId;
    openingWorkNavigation=true;
    void (async()=>{
      try{
        if(!coordinatorOpen)await showCoordinator();
        if(currentProject!==projectId||currentOrchestrator!==orchestratorId)return;
        openFilteredWorks(filter,trigger);
      }catch{
        status('Não foi possível abrir a lista de frentes. Confira o estado antes de tentar novamente.');
      }finally{openingWorkNavigation=false;}
    })();
  }
  $('openWorks').addEventListener('click',()=>openMissionNavigation('all',$('openWorks')));
  $('openHistory').addEventListener('click',()=>openMissionNavigation('all',$('openHistory')));
  $('openEvidence').addEventListener('click',()=>openMissionNavigation('attention',$('openEvidence')));
  $('pauseOrchestrator').addEventListener('click',async()=>{
    const o=orchestrators.find(o=>o.id===orchestratorId);if(!o)return;
    try {
      await command('orchestrator_pause',{projectId,orchestratorId,paused:o.status!=='paused'});
      await refreshOrchestrators();
    } catch {error();}
  });
  $('continuityFollowupPrepare').addEventListener('click',async()=>{
    const p=projectId,o=orchestratorId,button=$('continuityFollowupPrepare');
    const reviewRunId=button.dataset.reviewRunId;
    if(!p||!o||!reviewRunId||button.disabled)return;
    button.disabled=true;
    try {
      const receipt=await command('continuity_followup_prepare',{
        projectId:p,orchestratorId:o,reviewRunId
      });
      if(p!==projectId||o!==orchestratorId)return;
      await refreshContinuityStatus();
      if(receipt.status!=='succeeded'||!receipt.result?.taskId)return;
      await refreshWorks();
      coordinatorOpen=false;$('orchestrationPanel').hidden=true;
      await onOpenWork(receipt.result.taskId);
      status(receipt.result.conversationRotated
        ?'Nova conversa preparada na mesma frente. Revise o rascunho antes de enviar.'
        :'Próximo passo preparado na conversa original. Revise o rascunho antes de enviar.');
    }catch{
      if(p===projectId&&o===orchestratorId){
        status('Não foi possível preparar o próximo passo: verifique rascunho, recibos e estado da frente.');
        await refreshContinuityStatus().catch(()=>{});
      }
    }
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
    const button=$(mode==='story'?'startAutonomousStory':
      mode==='technical'?'startAutonomousTechnical':'startAutonomousDialogue');
    if(button.disabled||!projectId||!orchestratorId)return;
    const p=projectId,o=orchestratorId;
    const mission=$('coordinatorPrompt').value.trim();
    if(!mission){status('Descreva a missão única no campo do orquestrador.');$('coordinatorPrompt').focus();return;}
    $('startAutonomousStory').disabled=true;$('startAutonomousDialogue').disabled=true;
    $('startAutonomousTechnical').disabled=true;
    try {
      // A transport function existing does not prove ChatGPT is ready now.
      // The Electron worker still independently validates each submission.
      let availability;
      try{availability=providerComposeAvailability(await api.providerStatus(),{hostMode:nodeHost});}
      catch{status('Não foi possível verificar a sessão do GPT. Nenhuma missão foi iniciada.');return;}
      if(p!==projectId||o!==orchestratorId)return;
      if(!availability.allowed) {
        status(COMPOSE_STATUS_MESSAGES[availability.reason]||'Sessão do GPT não confirmada. Nenhuma missão foi iniciada.');
        return;
      }
      const receipt=await command('autonomous_dialogue_start',{projectId:p,orchestratorId:o,mission,mode});
      if(p!==projectId||o!==orchestratorId)return;
      if(receipt.status==='succeeded')status('Missão aceita. Groq coordena as etapas e GPT responde sem novas orientações.');
      await refreshAutonomousDialogue();
    }catch{error();}finally{await refreshAutonomousDialogue();}
  }
  $('continueAutonomousTechnical').addEventListener('click',async()=>{
    const button=$('continueAutonomousTechnical');
    if(button.disabled||!projectId||!orchestratorId)return;
    const p=projectId,o=orchestratorId;
    button.disabled=true;
    try{
      const snapshot=await call('autonomous_dialogue_status',{projectId:p,orchestratorId:o});
      if(p!==projectId||o!==orchestratorId)return;
      if(snapshot?.mission?.canContinue!==true){
        status('A decisão Groq anterior não está disponível para continuação. Nenhum envio realizado.');
        return;
      }
      let availability;
      try{availability=providerComposeAvailability(await api.providerStatus(),{hostMode:nodeHost});}
      catch{
        status('Não foi possível verificar a sessão GPT. Nenhuma autorização foi criada.');
        return;
      }
      if(p!==projectId||o!==orchestratorId)return;
      if(!availability.allowed){
        status(COMPOSE_STATUS_MESSAGES[availability.reason]||
          'Sessão GPT não confirmada. Nenhuma autorização foi criada.');
        return;
      }
      const receipt=await command('autonomous_dialogue_continue',{
        projectId:p,orchestratorId:o,sourceMissionId:snapshot.mission.missionId});
      if(p!==projectId||o!==orchestratorId)return;
      if(receipt.status==='succeeded')
        status('Continuação autorizada: até 2 novos envios GPT, com decisões e recibos canônicos.');
    }catch{error();}
    finally{if(p===projectId&&o===orchestratorId)await refreshAutonomousDialogue();}
  });
  $('startAutonomousTechnical').addEventListener('click',()=>void launchAutonomousMission('technical'));
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
  $('batchWorkForm').addEventListener('submit',event=>{
    event.preventDefault();void formAction(event.currentTarget,async()=>{
      if(!projectId||!orchestratorId)throw Error('orchestrator_selection_required');
      const p=projectId,o=orchestratorId;
      const titles=$('batchWorkTitles').value.split(/\r?\n/u).map(title=>title.trim()).filter(Boolean);
      if(titles.length<2||titles.length>16||titles.some(title=>title.length>140)) {
        $('batchWorkFeedback').textContent='Informe de 2 a 16 frentes, uma por linha, com até 140 caracteres cada.';
        status('Informe de 2 a 16 frentes, uma por linha, com até 140 caracteres cada.');
        return;
      }
      let receipt;
      try {
        receipt=await command('work_batch_create',{projectId:p,orchestratorId:o,titles});
      } catch (failure) {
        // The service remains the authority for duplicate and capacity checks.
        // Show only known, safe error codes instead of exposing raw IPC errors.
        const reason=String(failure?.message||'');
        const notice=reason.includes('orchestrator_batch_title_already_exists')
          ?'Uma dessas frentes já está cadastrada neste Administrador. Altere o título repetido e tente novamente.'
          :reason.includes('orchestrator_batch_titles_invalid')
            ?'Há títulos repetidos ou inválidos no lote. Revise as linhas antes de salvar.'
            :reason.includes('orchestrator_work_plan_too_large')
              ?'O projeto atingiu o limite de 256 frentes. Revise as frentes existentes.'
              :'Não foi possível confirmar o lote. Consulte as frentes antes de repetir a solicitação.';
        $('batchWorkFeedback').textContent=notice;
        status(notice);
        return;
      }
      if(receipt.status!=='succeeded'||p!==projectId||o!==orchestratorId)return;
      $('batchWorkForm').reset();$('batchWorkDetails').open=false;
      await refreshWorks();
      $('batchWorkFeedback').textContent=receipt.result.created+' frentes registradas. Nenhuma mensagem enviada ao GPT.';
      status(receipt.result.created+' frentes registradas no projeto, sem enviar ao GPT. Organize as dependências antes de executar.');
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
  // Read-only status of the selected Run from the existing work_get endpoint.
  // The service owns the SQLite receipt; the renderer cannot infer success
  // from an earlier generic project analysis or a stale local button state.
  async function getRunReviewStatus({taskId,runId}={}) {
    const p=projectId,o=orchestratorId;
    if(!p||!o||typeof taskId!=='string'||typeof runId!=='string')
      throw Error('orchestrator_run_review_scope_missing');
    const work=await call('work_get',{projectId:p,taskId});
    if(p!==projectId||o!==orchestratorId||work?.kind!=='work'||
       work?.orchestrator_id!==o||work?.runs?.[0]?.id!==runId||
       work?.runs?.[0]?.status!=='succeeded'||
       work?.latestRunReview?.runId!==runId)
      throw Error('orchestrator_run_review_scope_changed');
    return work.latestRunReview;
  }
  // Explicit, Run-scoped review using the existing administrative Groq path.
  // The service verifies the Run, owning project, delivery receipt and quoted
  // response before persisting a review decision. This never sends GPT work.
  async function reviewGptRun({taskId,runId}={}) {
    const p=projectId,o=orchestratorId;
    const owner=orchestrators.find(item=>item.id===o);
    if(!p||!o||owner?.status!=='ready'||!coordinatorAvailable||
       analysisBusy||preflightBusy||coordinatorSubmitting)
      throw Error('orchestrator_run_review_unavailable');
    if(typeof taskId!=='string'||!/^task_[a-f0-9-]{36}$/i.test(taskId)||
       typeof runId!=='string'||!/^run_[a-f0-9-]{36}$/i.test(runId))
      throw Error('orchestrator_run_review_identity_invalid');
    analysisBusy=true;syncCoordinatorActions();
    try {
      const receipt=await command('orchestrator_analyze',{
        projectId:p,orchestratorId:o,reviewRunId:runId
      });
      if(p!==projectId||o!==orchestratorId)
        throw Error('orchestrator_run_review_scope_changed');
      return receipt;
    } finally {
      analysisBusy=false;syncCoordinatorActions();
    }
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
      // The administrative Orchestrator is the canonical landing workspace.
      // Persisted GPT Task identity stays in SQLite and its scoped Work list,
      // but a cold start must never silently restore the executor as main chat.
      if(items.length&&chatTaskId)await showCoordinator();
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
    createWork,reviewGptRun,getRunReviewStatus,hasProject:()=>Boolean(projectId),hasOrchestrator:()=>Boolean(chatTaskId),
    getProjectId:()=>projectId,
    getOrchestratorId:()=>orchestratorId,
    showCoordinator,
    refreshStatus:()=>refreshApiStatus(),
    hide(){coordinatorOpen=false;$('orchestrationPanel').hidden=true;},
    refresh:refreshWorks
  });
}
