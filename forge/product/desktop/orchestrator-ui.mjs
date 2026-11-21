// Native App UI is a client of the same command service as MCP. No DOM of
// ChatGPT, coordinates or direct SQLite access is used to operate the Lab.
import {providerComposeAvailability,COMPOSE_STATUS_MESSAGES} from '../src/provider-compose-availability.mjs';

// Only canonical Works count as active/reviewable. An idle session must never
// be presented as an active execution just because a historical mission exists.
export function describeExecutionMonitor({running,attention}) {
  if(!Number.isSafeInteger(running)||running<0||
     !Number.isSafeInteger(attention)||attention<0)
    throw Error('invalid_execution_monitor_counts');
  if(running>0)return {
    title:'Execução em andamento',
    description:`${running} tarefa(s) com Run GPT histórico ativo. Resultados externos continuam não verificados.`
  };
  if(attention>0)return {
    title:'Revisões pendentes',
    description:`Nenhum Run GPT ativo. ${attention} tarefa(s) aguardam revisão ou reconciliação.`
  };
  return {
    title:'Nenhuma execução ativa',
    description:'Nenhum Run GPT em andamento ou tarefa pendente de revisão neste projeto.'
  };
}
// Name-only onboarding uses the existing mission_create contract. This
// description is coordination guidance, never permission to inspect GitHub,
// execute work or send messages to GPT Web.
// Present only canonical receipt counts. Never infer an outcome, retry a
// command, or attribute another project's pending effect to this project.
export function describeUncertainReceiptNotice(engineStatus,projectId){
  const uncertainCommands=Number.isSafeInteger(engineStatus?.uncertainCommands)&&
    engineStatus.uncertainCommands>=0?engineStatus.uncertainCommands:null;
  const projectReceipts=engineStatus?.uncertainByProject;
  const projectCount=Array.isArray(projectReceipts)
    ?projectReceipts.find(item=>item?.projectId===projectId)?.count??0:null;
  const scopedCount=Number.isSafeInteger(projectCount)&&projectCount>=0&&
    (uncertainCommands===null||projectCount<=uncertainCommands)?projectCount:null;
  if(uncertainCommands===null)
    return 'Não foi possível verificar os recibos pendentes. Confira o estado antes de qualquer novo envio.';
  if(uncertainCommands===0)return '';
  if(scopedCount===null)
    return `Há ${uncertainCommands} comando${uncertainCommands===1?'':'s'} com resultado incerto neste perfil. O projeto de origem ainda não foi confirmado. Revise os recibos; nada foi reenviado automaticamente.`;
  if(scopedCount>0){
    const elsewhere=uncertainCommands-scopedCount;
    return `Há ${scopedCount} comando${scopedCount===1?'':'s'} com resultado incerto neste projeto`+
      (elsewhere?` e ${elsewhere} fora dele`:'')+
      '. Revise os recibos antes de qualquer nova ação; nada foi reenviado automaticamente.';
  }
  return `Este projeto não possui comandos incertos. Há ${uncertainCommands} pendência${uncertainCommands===1?'':'s'} fora dele, preservada${uncertainCommands===1?'':'s'} para revisão; nada foi reenviado automaticamente.`;
}
export function resolveProjectOnboardingMission(name,objective) {
  const explicit=String(objective||'').trim();
  if(explicit)return explicit;
  const title=String(name||'').trim();
  if(!title)return null;
  return `Coordenar o projeto ${title}. Identificar prioridades e dependências apenas a partir das conexões e evidências efetivamente disponíveis; propor próximos passos para revisão humana. Não presumir acesso ao GitHub ou Runtime e não enviar mensagens ao GPT Web sem autorização explícita.`;
}
// Pure presentation of the SAME read-only project_preflight projection.
 // It cannot confer GitHub/Runtime authority or issue a provider request.

// Presentation only. Neither a saved binding nor a connected computer-wide
// MCP session proves a current project resource grant.
export function describeWorkspaceSnapshot(snapshot) {
  const unavailable={offline:'dispositivo offline',denied:'acesso negado',
    revoked:'grant revogado',moved:'recurso movido',unavailable:'indisponível',
    capability_unavailable:'Runtime não conectado'};
  if(snapshot?.verified!==true||snapshot?.state!=='connected')
    return 'Nenhum workspace verificado. Estado: '+
      (unavailable[snapshot?.state]||'sem prova válida')+'. Nenhum arquivo foi lido pelo Forge.';
  if(!Number.isSafeInteger(snapshot.fileCount)||snapshot.fileCount<0||
    !Number.isSafeInteger(snapshot.changedCount)||snapshot.changedCount<0||
    typeof snapshot.observedAt!=='string'||!Number.isFinite(Date.parse(snapshot.observedAt)))
    return 'Resposta incompleta do Runtime. Nenhuma leitura foi considerada verificada.';
  const git=snapshot.git?.isRepository===true&&
    typeof snapshot.git.branch==='string'&&typeof snapshot.git.head==='string'
      ?' Git '+snapshot.git.branch+' @ '+snapshot.git.head.slice(0,12)+'.'
      :'';
  return 'Snapshot autenticado pelo Runtime em '+snapshot.observedAt+': '+
    snapshot.fileCount+' arquivo(s), '+snapshot.changedCount+' alteração(ões).'+git+
    ' Somente metadados verificados; nenhum conteúdo de arquivo foi lido ou alterado pelo Forge.';
}

export function describeWorkspaceConnection(state) {
  if(state?.available!==true)
    return 'Runtime/workspace local não conectado ao Forge. O acesso MCP do ChatGPT não concede permissão a este aplicativo.';
  if(state.state==='bound'&&Array.isArray(state.bindings)&&state.bindings.length)
    return state.bindings.length+' vínculo(s) registrado(s), ainda sem grant atual confirmado. Verifique o snapshot autorizado.';
  return 'Porta Runtime disponível, mas nenhum workspace com grant vinculado a este projeto.';
}

export function mountOrchestratorUi({api,onScopeChange,onOpenWork,onShowCoordinator,onSelectRightPane,onOpenAppSettings,onNavigationChange,onArtifactPreviewTask}) {
  const $=id=>document.getElementById(id);
  // One real tools menu, not three permanent engineering panels above chat.
  // Relocate the existing nodes so their IDs, listeners and real capabilities
  // remain canonical and available on demand.
  const advancedContent=$('forgeCoordinatorAdvancedContent');
  for(const id of ['projectPulseDisclosure','orchestrationCapabilitySummary',
      'orchestrationIntegrations']){
    const node=$(id);
    if(advancedContent&&node)advancedContent.append(node);
  }
  let projectId=null,orchestratorId=null,projectsCache=[],orchestrators=[],epoch=0,chatTaskId=null,workCount=0;
  let dedicatedProject=false;
  let projectRefreshGeneration=0,orchestratorRefreshGeneration=0,autonomousRefreshGeneration=0;
  let coordinatorRecoveryRevision=0;
  let workspaceInspectionGeneration=0,workspacePortAvailable=false;
  let lastPresentedMissionStatusKey=null;
  let coordinatorOpen=false,analysisAvailable=false,orchestratorChatAvailable=false,coordinatorDraftCommitAvailable=false;
  let gptWebTransportAvailable=false;
  let observedGptHealth=null;
  let preflightBusy=false,preflightGeneration=0,repositoryBusy=false,repositoryPortAvailable=false,coordinatorSubmitting=false,quickProjectCreating=false,nodeHost=false;
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
    set('capabilityGpt','GPT Web · disponível no aplicativo desktop','blocked');
    set('capabilityGitHub',repositoryPortAvailable&&project?.repository_url
      ?'GitHub · adaptador disponível, acesso não verificado'
      :project?.repository_url?'GitHub · URL salva, leitura ausente':'GitHub · sem leitura autenticada',
      project?.repository_url?'partial':'blocked');
    set('capabilityRuntime',workspacePortAvailable
      ?'Runtime · porta detectada, grant não verificado':'Runtime · sem porta autenticada no Forge',
      workspacePortAvailable?'partial':'blocked');
    set('capabilityContinuity','24 h · supervisor ausente','blocked');
  }
  function syncForjadorSessionAvailability(){
    // Reuse the SAME fail-closed GPT readiness policy as the work composer.
    // A visible textbox or worker process does not prove a login session.
    const available=providerComposeAvailability(observedGptHealth,{hostMode:nodeHost});
    orchestratorChatAvailable=gptWebTransportAvailable&&available.allowed===true;
    const loginHint=['login_required','authenticating','unverified'].includes(available.reason)
      ?' Abra a aba GPT Web e conclua o login.':'';
    $('orchestrationConnection').textContent=!gptWebTransportAvailable
      ?'GPT Web indisponível. Confira o navegador na aba GPT Web.'
      :orchestratorChatAvailable
        ?'Sessão GPT observada. O envio ainda será verificado pelo executor.'
        :(COMPOSE_STATUS_MESSAGES[available.reason]||COMPOSE_STATUS_MESSAGES.unverified)+loginHint;
    if($('coordinatorTransport'))$('coordinatorTransport').hidden=orchestratorChatAvailable;
    syncCoordinatorActions();
  }
  function syncCoordinatorActions() {
    const selected=orchestrators.find(item=>item.id===orchestratorId);
    $('coordinatorSend').disabled=true; // MCP-only GPT sends
    $('inspectProjectAccess').disabled=!projectId||!selected||preflightBusy||coordinatorSubmitting;
    $('coordinatorPrompt').disabled=true; // App displays conversation history
  }
  function setCoordinatorDraftState(text='') {
    const compatibility=coordinatorDraftCommitAvailable?'':
      'Rascunhos seguem salvos. O Host não possui um executor GPT Web; abra o aplicativo desktop.';
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
    fitCoordinatorComposer();
    setCoordinatorDraftState('');
    if(!taskId)return;
    const draft=await readCoordinatorDraft(taskId);
    if(!isCurrent()||generation!==coordinatorDraftGeneration||taskId!==chatTaskId)return;
    coordinatorDraftRevision=Number(draft.draft_revision||0);
    $('coordinatorPrompt').value=draft.draft||'';
    fitCoordinatorComposer();
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
      if($('coordinatorPrompt').value===raw){$('coordinatorPrompt').value='';fitCoordinatorComposer();}
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
    $('activeProjectDetail').textContent=dedicatedProject&&current
      ?'Instância dedicada · um projeto, múltiplos repositórios OrdaX'
      :current?.name==='Novo projeto'
        ?'Projeto vazio · crie uma tarefa quando houver trabalho real.'
        :current?repository:'Crie seu primeiro projeto usando Novo projeto.';
    // The Store retains archival acceptance records; the dedicated Owner
    // deployment projects only its active OrdaX OS identity.
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
    if(!orchestrators.length){const empty=document.createElement('p');empty.className='nav-empty';empty.textContent='Adicione um administrador para começar.';list.append(empty);return;}
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
  let executionMemory=null,executionMemoryScope='';
  let executionActivity=null,executionActivityScope='';
  const executionScope=()=>[projectId,orchestratorId].join(':');
  const executionMemoryCategoryLabels={entity:'Entidade',structure:'Estrutura',fact:'Fato',decision:'Decisão',constraint:'Restrição',goal:'Objetivo',open_loop:'Pendência',reference:'Referência'};
  function renderExecutionSessions(works,scope){
    const list=$('executionSessionList'),summary=$('executionSessionSummary');
    if(!list||!summary)return;
    list.replaceChildren();
    const priority={occupied:0,expired:1,released:2};
    const sessions=[...works].filter(work=>work.claim||work.provider_segments>0)
      .sort((a,b)=>(priority[a.claim?.state]??3)-(priority[b.claim?.state]??3)||
        (b.provider_segments||0)-(a.provider_segments||0));
    const occupied=sessions.filter(work=>work.claim?.state==='occupied').length;
    const expired=sessions.filter(work=>work.claim?.state==='expired').length;
    // Claims reserve Tasks; they do not prove a GPT chat is online or executing.
    summary.textContent=sessions.length
      ?occupied+' reserva'+(occupied===1?'':'s')+' vigente'+(occupied===1?'':'s')+
        (expired?' · '+expired+' expirada'+(expired===1?'':'s'):'')+
        ' · '+sessions.length+' frente'+(sessions.length===1?'':'s')+' registrada'+(sessions.length===1?'':'s')
      :'0 frentes registradas';
    summary.dataset.state=occupied?'active':'idle';
    if(!sessions.length){
      const empty=document.createElement('p');empty.className='execution-empty';
      empty.textContent='Nenhuma conversa ou reserva registrada neste projeto.';list.append(empty);return;
    }
    for(const work of sessions.slice(0,6)){
      const button=document.createElement('button');button.type='button';button.className='execution-observation-item';
      button.setAttribute('role','listitem');
      button.dataset.state=work.claim?.state==='occupied'?'active':
        work.claim?.state==='expired'?'attention':'history';
      const copy=document.createElement('span');copy.className='execution-observation-copy';
      const title=document.createElement('strong');title.textContent=work.title;
      const detail=document.createElement('small');
      if(work.claim){
        const transport=work.claim.mcpToolCallObserved===true
          ?work.claim.mcpIngress==='remote_gateway'?'MCP remoto observado':'MCP local observado'
          :'Claim registrado no SQLite';
        const identity=work.claim.chatIdentityVerified===true
          ?'identidade do chat atestada':'identidade do chat não atestada';
        const heartbeat=Date.parse(work.claim.heartbeatAt||'');
        const recorded=Number.isFinite(heartbeat)
          ?' · última atividade registrada: '+new Date(heartbeat).toLocaleString('pt-BR')
          :' · sem horário de atividade verificável';
        const freshness=work.claim.state==='occupied'&&Number.isFinite(heartbeat)
          ?Date.now()-heartbeat<=5*60_000?' · atividade recente':' · sem atualização recente'
          :'';
        const generation=Number.isInteger(work.claim.generation)
          ?' · geração '+work.claim.generation:'';
        const checkpoint=work.claim.lastProgress
          ?' · último checkpoint declarado: '+String(work.claim.lastProgress).slice(0,110):'';
        detail.textContent=transport+' · '+identity+' · rótulo declarado: '+work.claim.chatLabel+
          generation+recorded+freshness+checkpoint;
      }else{
        detail.textContent=(work.provider_segments||0)+' conversa'+(work.provider_segments===1?'':'s')+
          ' persistida'+(work.provider_segments===1?'':'s');
      }
      const state=document.createElement('span');state.className='execution-observation-state';
      state.textContent=work.claim?.state==='occupied'?'Reserva vigente':
        work.claim?.state==='expired'?'Reserva expirada':
        work.claim?.state==='released'?'Reserva liberada':
        work.provider_segments>0?'Conversa registrada':'Histórico';
      copy.append(title,detail);button.append(copy,state);
      button.addEventListener('click',async()=>{
        if(scope!==executionScope())return;
        try{coordinatorOpen=false;await onOpenWork(work.id);}
        catch{status('Não foi possível abrir o histórico desta frente.');}
      });
      list.append(button);
    }
  }
  function renderExecutionMemory(){
    const list=$('executionMemoryList'),summary=$('executionMemorySummary');
    if(!list||!summary)return;
    list.replaceChildren();
    const memory=executionMemoryScope===executionScope()?executionMemory:null;
    if(!memory){
      summary.textContent=projectId?'Leitura indisponível':'Sem projeto';summary.dataset.state='idle';
      const empty=document.createElement('p');empty.className='execution-empty';
      empty.textContent=projectId?'A memória canônica não pôde ser lida agora.':'Selecione um projeto para consultar a memória compartilhada.';
      list.append(empty);return;
    }
    const canonical=Array.isArray(memory.canonical)?memory.canonical:[];
    const suggested=Array.isArray(memory.suggested)?memory.suggested:[];
    const canonicalTotal=Number(memory.counts?.canonicalMemories??canonical.length)||0;
    const pending=Number(memory.counts?.pendingSuggestions??suggested.length)||0;
    summary.textContent=canonicalTotal+' canônica'+(canonicalTotal===1?'':'s')+(pending?' · '+pending+' pendente'+(pending===1?'':'s'):'');
    summary.dataset.state=pending?'attention':canonical.length?'active':'idle';
    if(!canonical.length){
      const empty=document.createElement('p');empty.className='execution-empty';
      empty.textContent=pending?'Há sugestões aguardando revisão; nenhuma foi promovida automaticamente.':'Nenhuma memória canônica registrada neste projeto.';
      list.append(empty);return;
    }
    for(const item of canonical.slice(0,5)){
      const article=document.createElement('article');article.className='execution-memory-item';article.setAttribute('role','listitem');
      const head=document.createElement('div');head.className='execution-memory-head';
      const kind=document.createElement('span');kind.className='execution-memory-kind';kind.textContent=executionMemoryCategoryLabels[item.category]||item.category||'Memória';
      const key=document.createElement('strong');key.textContent=item.key||'Item sem chave';head.append(kind,key);
      const content=document.createElement('p');content.textContent=String(item.content||'');
      const meta=document.createElement('small');meta.textContent='Editorial · efeito externo '+(item.verifiedExternalEffect===true?'verificado':'não verificado');
      article.append(head,content,meta);list.append(article);
    }
    if(canonicalTotal>5){
      const more=document.createElement('p');more.className='execution-observation-note';more.textContent='+'+(canonicalTotal-5)+' item(ns) canônicos no mesmo armazenamento.';list.append(more);
    }
  }
  function renderExecutionMonitor() {
    const scope=executionScope(),works=executionWorkScope===scope?visibleWorkItems:[];
    const mission=executionMissionScope===scope?executionMission:null;
    const active=mission?.mode==='technical'?mission:null;
    const stats={running:0,attention:0,ready:0,completed:0,claimed:0};
    for(const work of works){
      stats[workClassForPlan(work)]++;
      if(work.claim?.state==='occupied')stats.claimed++;
    }
    $('executionWorkCount').textContent=String(works.length);
    $('executionClaimedCount').textContent=String(stats.claimed);
    $('executionRunningCount').textContent=String(stats.running);
    $('executionReviewCount').textContent=String(stats.attention);
    const authority=$('executionAuthorityState');
    authority.textContent=stats.claimed
      ?stats.claimed+' tarefa'+(stats.claimed===1?'':'s')+' com reserva vigente'
      :stats.running?'Run observado no projeto'
        :stats.attention?'Aguardando revisão':'Sem chat reservado';
    authority.dataset.state=stats.claimed||stats.running?'active':stats.attention?'attention':'idle';
    const overview=describeExecutionMonitor(stats);
    $('executionOverviewTitle').textContent=overview.title;
    $('executionOverviewDescription').textContent=overview.description;
    const state=active?.state||'idle';
    const stateLabels={
      idle:'Passivo',queued:'Preparando',ready_a:'Aguardando GPT',
      sending_a:'Enviando ao GPT',ready_b:'Revisando GPT',reviewing_a:'Revisão legada indisponível',
      ready_final:'Aguardando GPT',sending_b:'Enviando ao GPT',
      ready_review_final:'Revisando GPT',reviewing_final:'Revisão legada indisponível',
      budget_exhausted:'Aguardando autorização',
      verification_required:'Verificação necessária',
      reconciliation_required:'Reconciliação necessária',blocked:'Bloqueada'
    };
    const badge=$('executionMissionBadge');
    badge.textContent=stateLabels[state]||'Estado registrado';
    badge.dataset.state=['sending_a','sending_b','reviewing_a','reviewing_final'].includes(state)
      ?'running':['verification_required','reconciliation_required','budget_exhausted'].includes(state)
        ?'attention':state==='blocked'?'blocked':'idle';
    const title=active?.mission?.trim()||'Forge MCP em modo passivo';
    $('executionMissionTitle').textContent=title.length>140?title.slice(0,137)+'…':title;
    $('executionMissionDetail').textContent=active?.state==='reconciliation_required'
      ?'A revisão de acompanhamento precisa de reconciliação. Confira os recibos existentes; nenhum envio será repetido automaticamente.'
      :active?.state==='verification_required'
        ?'Resposta recebida. Confira os arquivos disponíveis na prévia; testes e publicação exigem validação separada.'
        :active?'Missão vinculada ao projeto. Nenhuma ação adicional é autorizada por sugestões internas.'
          :'O aplicativo apenas apresenta estado. Decisões, claims e progresso vêm dos chats GPT pelo Forge MCP.';
    const workList=$('executionWorkList');workList.replaceChildren();
    const priority={running:0,attention:1,ready:2,completed:3};
    const ordered=[...works].sort((a,b)=>
      priority[workClassForPlan(a)]-priority[workClassForPlan(b)]).slice(0,5);
    if(!ordered.length){
      const empty=document.createElement('p');empty.className='execution-empty';
      empty.textContent='Ainda não há tarefas neste projeto. Nenhum claim ativo foi confirmado.';
      workList.append(empty);
    }
    for(const work of ordered){
      const state=workClassForPlan(work);
      const button=document.createElement('button');
      button.type='button';button.className='execution-work-item';
      button.dataset.state=state;button.setAttribute('role','listitem');
      const icon=document.createElement('span');icon.className='execution-work-symbol';
      icon.textContent=work.acceptanceEvidence?'✓':state==='running'?'◉':state==='attention'?'!':'◇';
      const copy=document.createElement('span');copy.className='execution-work-copy';
      const title=document.createElement('strong');title.textContent=work.title;
      const info=document.createElement('small');
      info.textContent=work.acceptanceEvidence
        ?'Aceite verificado no Git local · '+String(work.acceptanceEvidence.testedMainHeadSha||'').slice(0,8)
        :work.claim?.state==='occupied'
          ?'Chat '+work.claim.chatLabel+' · '+(work.claim.lastProgress
            ?String(work.claim.lastProgress).slice(0,120)
            :'reserva ativa no Forge MCP')
          :work.claim?.state==='expired'
            ?'Reserva expirou · conferir recibos antes de retomar'
          :work.claim?.state==='released'
            ?'Reserva liberada · último progresso permanece registrado'
          :work.latest_run_status==='succeeded'?'Run GPT concluído · aceite ainda não registrado':
            work.running_runs>0?'Run GPT em andamento':
            work.execution?.observed==='reconciliation_required'?'Envio incerto · reconciliar':
            work.provider_segments>0?'Conversa registrada no projeto':'Ainda sem resposta GPT';
      copy.append(title,info);
      const label=document.createElement('span');label.className='execution-work-state';
      label.textContent=work.acceptanceEvidence?'Aceita':
        work.claim?.state==='occupied'?'Reservada':
          work.claim?.state==='expired'?'Expirada':
          work.claim?.state==='released'?'Liberada':
          state==='running'?'Em execução':
            state==='attention'?'Revisar':state==='completed'?'Concluída':'Aguardando';
      button.append(icon,copy,label);
      button.addEventListener('click',async()=>{
        if(scope!==executionScope())return;
        try{coordinatorOpen=false;await onOpenWork(work.id);}
        catch{status('Não foi possível abrir a frente. Nenhuma mensagem foi enviada.');}
      });
      workList.append(button);
    }
    renderExecutionSessions(works,scope);
    renderExecutionMemory();
    const timeline=$('executionActivity');timeline.replaceChildren();
    const entries=[];
    if(active)entries.push(['Missão registrada',stateLabels[state]||state]);
    if(active?.decision)entries.push(['Revisão registrada',
      'As sugestões internas não autorizam novas tarefas. Consulte a execução existente.']);
    // Read the canonical event projection; a denied MCP claim is a
    // coordination outcome, never proof of a live ChatGPT identity.
    const activity=executionActivityScope===scope?executionActivity:null;
    const claimConflicts=(activity?.recentActivity||[]).filter(event=>
      event.kind==='forge.mcp.work_tool_observed'&&event.operation==='work_claim'&&
      ['occupied','blocked_unreconciled_effects'].includes(event.outcome)).slice(-3).reverse();
    const taskNames=new Map(works.map(work=>[work.id,work.title]));
    for(const event of claimConflicts){
      const when=Date.parse(event.createdAt||'');
      const timestamp=Number.isFinite(when)
        ?' · registro '+new Date(when).toLocaleString('pt-BR'):'';
      const description=event.outcome==='occupied'
        ?'Tentativa MCP de reservar tarefa ocupada foi recusada; titular preservado'
        :'Retomada bloqueada por efeitos incertos; reconcilie recibos';
      entries.push([taskNames.get(event.taskId)||'Tarefa deste projeto',
        description+timestamp+' · identidade do chat não atestada']);
    }
    for(const work of ordered.filter(w=>w.claim).slice(0,4)){
      const label=work.claim.state==='occupied'?'Reserva vigente':
        work.claim.state==='expired'?'Reserva expirada':
        work.claim.state==='released'?'Reserva liberada':'Histórico de reserva';
      entries.push([work.title,label+' · rótulo declarado: '+work.claim.chatLabel+
        (work.claim.lastProgress?' · checkpoint não verificado: '+
          String(work.claim.lastProgress).slice(0,140):'')]);
    }
    for(const work of ordered.filter(w=>(w.latest_run_status||w.running_runs>0)&&w.claim?.state!=='occupied').slice(0,3)){
      entries.push([work.title,work.running_runs>0?'Run GPT em andamento':
        work.latest_run_status==='succeeded'?'Run concluído; confirme entregas e revisões separadamente':
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
    preflightGeneration++;
    $('projectPreflightState').textContent='Diagnóstico ainda não solicitado. Uma URL GitHub não comprova acesso ao repositório.';
    $('projectPreflightState').dataset.state='idle';
    $('projectPreflightActions').replaceChildren();
    $('projectPreflightActions').hidden=true;
    clearRepositoryObservation();
  }
  function renderProjectPreflight(snapshot) {
    const node=$('projectPreflightState');
    const work=snapshot?.work||{};
    const blockers=Array.isArray(snapshot?.blockers)?snapshot.blockers:[];
    const repo=snapshot?.repository?.urlRegistered?'URL GitHub cadastrada; leitura autenticada não verificada':'sem URL GitHub cadastrada';
    node.textContent='SQLite: '+(Number(work.registered)||0)+' tarefa(s), '+(Number(work.started)||0)+' com histórico de Run, '+(Number(work.unresolvedSends)||0)+' recibo(s) de envio antigo pendente(s); '+repo+'. O App não iniciou análise, GPT ou execução.';
    node.dataset.state=blockers.length?'blocked':'ready';
    const labels={
      orchestrator_paused:'Administrador histórico pausado.',
      no_registered_work:'Nenhuma tarefa registrada neste projeto.',
      work_receipts_unresolved:'Existem recibos históricos de envio ainda não reconciliados.'
    };
    const list=$('projectPreflightActions');
    list.replaceChildren(...blockers.map(code=>{
      const item=document.createElement('li');
      item.textContent=labels[code]||String(code);return item;
    }));
    list.hidden=blockers.length===0;
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
        ?'Nenhuma tarefa registrada. Crie uma tarefa para acompanhar o progresso.'
        :'Estados das tarefas persistidas; não comprovam execução externa nem conclusão do projeto.';
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
      planStatus.textContent='Planejamento do projeto · '+plan.candidates.length+' candidatas · '+
        plan.waiting.length+' aguardando · '+plan.blocked.length+' bloqueadas · '+
        plan.inFlight+' em execução no projeto · '+
        verificationRequiredWorkIds.size+' respostas aguardando comprovação de resultado. '+
        'Coordenação MCP-first: cada chat GPT adquire sua Task com claim, registra progresso/memória e libera a lease ao concluir. O App não inicia agentes nem envia mensagens.';
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
      // Passive projection of the canonical MCP Task claim. Never dispatches a
      // provider, acquires a claim or infers a verified ChatGPT identity.
      if(work.claim){
        const claimed=document.createElement('small');
        claimed.className='work-run-evidence';
        const state=work.claim.state==='occupied'?'ocupada':
          work.claim.state==='expired'?'expirada':'liberada';
        claimed.textContent='Chat · '+work.claim.chatLabel+' · reserva '+state+
          (work.claim.lastProgress?' · '+String(work.claim.lastProgress).slice(0,160):'');
        evidence.append(claimed);
      }
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
      // Historical provider failures remain readable, but neither local analysis nor
      // the old ChatGPT API endpoint can be invoked by this application.
      const legacyFailure=String(receipt.result?.failureCode||'');
      status(legacyFailure
        ?'Execução de modelo legado bloqueada ou falhou ('+legacyFailure+'). Consulte o recibo antes de continuar; nada foi reenviado.'
        :'O comando falhou. Consulte o histórico antes de tentar outra ação.');
    } else {
      const failureCode=receipt.result?.failureCode||'';
      status(failureCode.endsWith('_request_timeout')
        ?`O tempo de resposta de um mecanismo legado expirou sem confirmação. Confira o histórico antes de enviar outra solicitação; nada será repetido automaticamente.`
        :failureCode.endsWith('_network_unavailable')
          ?`Não foi possível confirmar o resultado legado. Confira o histórico antes de enviar outra solicitação; nada será repetido automaticamente.`
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
    $('observeProjectRepository').hidden=!repositoryPortAvailable;
    $('observeProjectRepository').disabled=!repositoryPortAvailable||!project?.repository_url||repositoryBusy;
    $('renameProjectButton').disabled=!project;
    $('deleteProjectButton').disabled=!project;
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
    // Every project/scope change revokes any pending UI snapshot result.
    workspaceInspectionGeneration++;
    $('inspectWorkspace').disabled=!project;
    $('workspaceConnection').textContent=!project?'Selecione um projeto para verificar o Runtime.':
      workspacePortAvailable?'Porta Runtime detectada; nenhum grant atual foi verificado para este projeto.':
        'Runtime/workspace local não conectado a esta página; nenhuma pasta ou arquivo local é lido.';
    $('workspaceEvidence').textContent='Nenhum snapshot autorizado verificado nesta sessão.';
    syncCapabilitySummary();
  }
  async function refreshApiStatus() {
    const state=await api.coordinatorChatStatus();
    nodeHost=state.executionSurface==='node_host';
    $('orchestratorWorkRail').setAttribute('aria-label','Tarefas do projeto');
    $('workRailTitle').textContent='Tarefas do projeto';
    $('coordinatorRailToggle').textContent='Sessões';
    $('newScopedWorkButton').textContent='＋ Nova tarefa';
    $('newScopedWorkDetails').querySelector('summary').textContent='Configurar tarefa';
    $('newScopedWorkForm').querySelector('button[type="submit"]').textContent='Criar tarefa';
    $('workRailNote').textContent='As tarefas ficam no SQLite canônico e são assumidas por chats GPT via Forge MCP.';
    const engineStatus=await call('status');
    analysisAvailable=engineStatus.analysisAvailable===true;
    repositoryPortAvailable=engineStatus.repositoryPortAvailable===true;
    workspacePortAvailable=engineStatus.workspacePortAvailable===true;
    gptWebTransportAvailable=engineStatus.providerExecutionAvailable===true&&!nodeHost;
    // Passive App: the coordinator Task is displayed as project activity.
    // GPT intelligence lives in external chats connected through Forge MCP.
    coordinatorDraftCommitAvailable=engineStatus.coordinatorDraftCommitAvailable===true;
    if(!coordinatorDraftCommitAvailable)setCoordinatorDraftState($('coordinatorPrompt').value?'Rascunho local preservado nesta conversa.':'');
    else if($('coordinatorDraftState').textContent.includes('backend anterior'))
      setCoordinatorDraftState($('coordinatorPrompt').value?'Rascunho local preservado nesta conversa.':'');
    $('coordinatorNavProvider').textContent='Estado · Forge MCP';
    $('coordinatorRouteLabel').textContent='ATIVIDADE DO PROJETO';
    $('coordinatorApiSettings').textContent='Ajustes';
    $('coordinatorPrompt').placeholder='Descreva o que você quer criar ou mudar…';
    $('coordinatorSend').textContent='Enviar';
    $('coordinatorSend').setAttribute('aria-label','Enviar mensagem');
    syncCapabilitySummary();
    syncForjadorSessionAvailability();
  }
  $('coordinatorApiSettings').addEventListener('click',()=>onOpenAppSettings?.('providers'));
  function openNewProjectForm(){
    const form=$('projectSetup');
    form.open=true;
    // The same canonical form serves the desktop shortcut and compact header.
    // No separate project-creation implementation or duplicate draft.
    $('projectName').focus();
  }
  $('addProject').addEventListener('click',openNewProjectForm);
  async function createBlankProject(){
    if(quickProjectCreating)return;
    quickProjectCreating=true;
    const button=$('quickNewProject');button.disabled=true;
    try{
      await flushCoordinatorDraft();
      const previous=projectId;
      // A unique creationNonce distinguishes two real clicks without weakening
      // the canonical idempotent command receipt.
      const receipt=await command('project_quick_create',{creationNonce:crypto.randomUUID()});
      if(receipt.status!=='succeeded'||!receipt.result?.projectId)
        throw Error('forge_quick_project_unconfirmed');
      if(projectId!==previous){await refreshProjects();return;}
      projectId=receipt.result.projectId;
      orchestratorId=receipt.result.orchestratorId;
      clearProjectPreflight();
      $('projectSetup').open=false;$('forgeProjectAdvanced').open=false;
      await refreshProjects();await refreshOrchestrators();
      await showCoordinator();
      status('Novo projeto criado. Tarefas e coordenações são gerenciadas pelo Forge MCP.');
    }catch{
      status('Não foi possível confirmar o novo projeto. Verifique a lista antes de tentar de novo.');
      await refreshProjects().catch(()=>{});
    }finally{
      quickProjectCreating=false;button.disabled=false;
    }
  }
  $('quickNewProject').addEventListener('click',()=>void createBlankProject());
  $('renameProjectButton').addEventListener('click',()=>{
    if(!projectId)return;
    $('renameProjectInput').value=projectsCache.find(item=>item.id===projectId)?.name||'';
    $('forgeProjectAdvanced').open=true;
    $('projectRenameSetup').open=true;$('renameProjectInput').focus();
  });
  $('deleteProjectButton').addEventListener('click',()=>{
    if(!projectId)return;
    $('projectDeleteName').value='';
    $('forgeProjectAdvanced').open=true;
    $('projectDeleteSetup').open=true;
    $('projectDeleteName').focus();
  });
  $('newScopedWorkButton').addEventListener('click',()=>{
    $('newScopedWorkDetails').open=true;$('scopedWorkTitle').focus();
  });
  let workRailReturnFocus=$('coordinatorRailToggle');
  const setWorkRailOpen=open=>{
    const ready=onSelectRightPane?.(open?'context':'execution').catch(()=>{})??Promise.resolve();
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
  $('coordinatorOutcomeOpen').addEventListener('click',async event=>{
    const button=event.currentTarget,p=projectId,o=orchestratorId;
    const taskId=button.dataset.taskId;
    if(button.disabled||!taskId||!p||!o)return;
    button.disabled=true;
    try{
      if(p!==projectId||o!==orchestratorId)return;
      coordinatorOpen=false;$('orchestrationPanel').hidden=true;
      await onOpenWork(taskId);
    }catch{
      status('Não foi possível abrir o resultado. Nenhuma mensagem foi reenviada.');
    }finally{button.disabled=false;}
  });
  $('executionOpenWorks').addEventListener('click',()=>openFilteredWorks('all',$('executionOpenWorks')));
  $('refreshExecutionOverview').addEventListener('click',async()=>{
    const button=$('refreshExecutionOverview'),p=projectId,o=orchestratorId;
    if(button.disabled||!p||!o)return;
    button.disabled=true;
    try{
      await refreshWorks();
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
    if(!p) {workCount=0;executionWorkScope='';executionMemoryScope='';executionMemory=null;executionActivityScope='';executionActivity=null;renderDependencyEditor([],null);renderWorks([]);renderExecutionMonitor();await onScopeChange(null);syncCoordinatorActions();return;}
    const [result,planning,allResult,memory,activity]=await Promise.all([
      call('work_list',{projectId:p,...(o?{orchestratorId:o}:{})}),
      call('work_plan',{projectId:p,maxParallel:4}).catch(()=>null),
      o?call('work_list',{projectId:p}).catch(()=>null):Promise.resolve(null),
      call('project_memory',{projectId:p}).catch(()=>null),
      call('project_activity',{projectId:p}).catch(()=>null)
    ]);
    if(generation!==epoch||p!==projectId||o!==orchestratorId)return;
    const works=result.works;
    workCount=works.length;
    $('openWorks').disabled=!projectId||!orchestratorId;
    $('openHistory').disabled=!projectId||!orchestratorId;
    $('openEvidence').disabled=!projectId||!orchestratorId;
    const editableDependencies=renderDependencyEditor(allResult?.works||result.works,planning?.plan||null);
    renderWorks(works,planning?.plan||null,editableDependencies);
    executionWorkScope=executionScope();
    executionMemory=memory?.schema==='ordax.forge.project-memory/1'&&memory.projectId===p?memory:null;
    executionMemoryScope=executionScope();
    executionActivity=activity?.schema==='ordax.forge.project-activity/1'&&activity.project?.id===p?activity:null;
    executionActivityScope=executionScope();renderExecutionMonitor();
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
    dedicatedProject=result.projectScope?.mode==='dedicated';
    for(const id of ['addProject','quickNewProject','renameProjectButton',
       'deleteProjectButton','projectSetup','projectRenameSetup',
       'projectDeleteSetup','projectRepositoryForm',
       'newScopedWorkButton','newScopedWorkDetails','batchWorkDetails',
       'forgeDevelopmentAccess','forgeWorkspacePanel']){
      const node=$(id);
      if(!node)continue;
      if(id==='projectSetup'||id==='projectRenameSetup'||id==='projectDeleteSetup')
        node.open=false;
      if(dedicatedProject&&'open' in node&&
         ['newScopedWorkDetails','batchWorkDetails'].includes(id))node.open=false;
      node.hidden=dedicatedProject;
    }
    $('projectSelect').disabled=dedicatedProject;
    options($('projectSelect'),projectsCache,'Conversas sem projeto');
    if(projectsCache.some(p=>p.id===projectId))$('projectSelect').value=projectId;
    renderProjectNavigation(projectsCache);
    syncProjectRepository();
    return projectsCache;
  }
  async function refreshDedicatedRepositories(){
    const host=$('orchestrationIntegrations');
    let section=$('dedicatedRepositoryCatalog');
    if(!dedicatedProject||!host||!projectId){
      section?.remove();
      return;
    }
    if(!section){
      section=document.createElement('section');
      section.id='dedicatedRepositoryCatalog';
      section.className='forge-dedicated-repositories';
      host.prepend(section);
    }
    const currentProjectId=projectId;
    let response;
    try{response=await call('project_repositories',{projectId:currentProjectId});}
    catch{response={available:false,repositories:[]};}
    if(currentProjectId!==projectId||!dedicatedProject)return;
    section.replaceChildren();
    const heading=document.createElement('h3');
    heading.textContent='Repositórios do OrdaX OS';
    section.append(heading);
    const note=document.createElement('p');
    note.textContent=response?.available
      ?'Catálogo do contrato canônico OrdaX OS. A lista não concede acesso ao GitHub, arquivos ou terminal.'
      :'Catálogo canônico indisponível neste Host. Verifique o checkout OrdaX OS; nenhuma autorização foi presumida.';
    section.append(note);
    if(response?.available&&Array.isArray(response.repositories)){
      const list=document.createElement('ul');
      for(const entry of response.repositories){
        const item=document.createElement('li');
        item.textContent=entry.displayName+' · '+entry.role.replaceAll('_',' ')+
          ' · acesso não concedido pelo catálogo';
        list.append(item);
      }
      section.append(list);
    }
    const mcpHeading=document.createElement('h3');
    mcpHeading.textContent='OrdaX MCP · autorização do Forge';
    section.append(mcpHeading);
    const mcpState=document.createElement('p');
    mcpState.textContent='Verificando a sessão OAuth e os grants da Platform…';
    section.append(mcpState);
    // The App only renders a bounded read from the Owner Core. The native
    // OAuth token and raw grant groups never enter the renderer.
    void call('ordax_devices',{projectId:currentProjectId}).then(result=>{
      if(currentProjectId!==projectId||!dedicatedProject||!section.isConnected)return;
      if(result?.available!==true){
        mcpState.textContent='OrdaX MCP não autorizado para consulta nesta sessão do Forge ('+
          String(result?.reason||'indisponível').slice(0,110)+
          '). A autorização é feita em Permissões MCP do OrdaX.';
        return;
      }
      const devices=Array.isArray(result.devices)?result.devices:[];
      const ready=devices.filter(item=>item.repositoryCatalogReadGranted===true).length;
      mcpState.textContent='Dispositivos visíveis ao OAuth nativo do Forge: '+
        devices.length+' · Catálogo autorizado: '+ready+
        '. Nenhum dispositivo foi selecionado e nenhuma execução foi habilitada.';
      if(ready!==devices.length){
        const notice=document.createElement('p');
        notice.textContent='Permissão necessária para o catálogo: repository-catalog-read. '+
          'Autorize o cliente Forge em Permissões MCP do OrdaX, se desejar habilitar essa leitura.';
        section.append(notice);
      }
    }).catch(()=>{
      if(currentProjectId===projectId&&section.isConnected)
        mcpState.textContent='A consulta ao OrdaX MCP falhou. Nenhuma permissão foi presumida.';
    });
  }

  async function refreshOrchestrators() {
    const generation=++orchestratorRefreshGeneration,p=projectId;
    const result=p?await call('orchestrators_list',{projectId:p}):{orchestrators:[]};
    // A late response from project A must never overwrite project B's state.
    if(generation!==orchestratorRefreshGeneration||p!==projectId)return [];
    orchestrators=result.orchestrators;
    if(!orchestrators.some(o=>o.id===orchestratorId))orchestratorId=orchestrators[0]?.id||null;
    options($('orchestratorSelect'),orchestrators,'Selecione uma coordenação');
    $('orchestratorSelect').value=orchestratorId||'';
    const selected=orchestrators.find(o=>o.id===orchestratorId);
    const selectedId=selected?.id||null;
    const isCurrent=()=>generation===orchestratorRefreshGeneration&&p===projectId&&selectedId===orchestratorId;
    await activateCoordinatorDraft(selected?.chat_task_id||null,isCurrent);
    if(!isCurrent())return [];
    $('openOrchestrator').disabled=!selected;
    $('openWorks').disabled=!p||!selected;
    $('openHistory').disabled=!p||!selected;
    $('openEvidence').disabled=!p||!selected;
    $('orchestratorMission').textContent=selected
      ?'Acompanhe tarefas, sessões, memória, progresso e resultados persistidos pelo Forge MCP.'
      :p?'Projeto sem coordenação registrada. Use o Forge MCP para criar ou associar uma coordenação.'
        :'Selecione um projeto para começar.';
    $('orchestratorMission').title=selected?.mission||'';
    $('orchestratorTitle').textContent='Atividade do projeto';
    syncCoordinatorActions();
    renderOrchestratorNavigation();
    await refreshWorks();
    if(!isCurrent())return [];
    return isCurrent()?orchestrators:[];
  }
  async function renderCoordinator() {
    if(!projectId||!chatTaskId)return;
    const p=projectId,t=chatTaskId,o=orchestratorId;
    const recoveryRevision=++coordinatorRecoveryRevision;
    const [page,engineStatus]=await Promise.all([
      call('work_messages',{projectId:p,taskId:t,limit:50}),
      call('status').catch(()=>null)
    ]);
    if(p!==projectId||t!==chatTaskId||o!==orchestratorId)return;
    const box=$('coordinatorMessages'),recoveryNotice=$('coordinatorRecoveryNotice');
    // Preserve the one result node while rebuilding the persisted project activity.
    box.replaceChildren(recoveryNotice,$('coordinatorOutcome'));
    const recoveryMessage=describeUncertainReceiptNotice(engineStatus,p);
    recoveryNotice.classList.toggle('hidden',!recoveryMessage);
    recoveryNotice.textContent=recoveryMessage;
    // The historical project Task remains reachable only for inspection and explicit
    // read-only reply recovery; never create a second delivery/retry route.
    // Optional read-only Task lookup must not hold the project-switch/chat
    // rendering lane. Revalidate the selection and render revision before
    // exposing the existing recovery route; old IPC replies are discarded.
    void api.getTask(t).then(chatTask=>{
      if(recoveryRevision!==coordinatorRecoveryRevision||
        p!==projectId||t!==chatTaskId||o!==orchestratorId)return;
      const needsReplyRecovery=Boolean(chatTask?.chat_url &&
        ['failed','interrupted'].includes(chatTask?.latest_run?.status));
      if(!needsReplyRecovery)return;
      recoveryNotice.classList.remove('hidden');
      const recoveryLink=document.createElement('button');
      recoveryLink.type='button';
      recoveryLink.className='mini-secondary';
      recoveryLink.textContent='Verificar resposta no GPT (sem reenviar)';
      recoveryLink.addEventListener('click',async()=>{
        if(p!==projectId||t!==chatTaskId||o!==orchestratorId)return;
        recoveryLink.disabled=true;
        try {
          coordinatorOpen=false;
          await onOpenWork(t);
        } catch {
          status('Não foi possível abrir a verificação. Nenhuma mensagem foi reenviada.');
          recoveryLink.disabled=false;
        }
      });
      recoveryNotice.append(recoveryLink);
    }).catch(()=>{ /* A missing inspection affordance never blocks project navigation. */ });
    if(page.has_more) {
      const note=document.createElement('p');
      note.textContent='Exibindo as 50 mensagens mais recentes. O histórico anterior permanece salvo.';
      box.append(note);
    }
    if(page.messages.length===0) {
      // Show the existing canonical Task projection instead of a false
      // empty-state whenever MCP work exists without historical GPT messages.
      const scope=executionScope(),works=executionWorkScope===scope?visibleWorkItems:[];
      const memory=executionMemoryScope===scope?executionMemory:null;
      const notes=memory?.canonical?.length||0;
      if(works.length||notes){
        const panel=document.createElement('section');panel.className='coordinator-project-overview';
        panel.setAttribute('aria-label','Frentes e continuidade do projeto');
        const title=document.createElement('h3');title.textContent='Frentes e continuidade';
        const description=document.createElement('p');
        description.textContent='Estado persistido pelo Forge MCP. Nenhuma mensagem GPT foi registrada nesta coordenação; claims, checkpoints e memórias não comprovam efeitos externos.';
        const counts=document.createElement('small');
        const occupied=works.filter(w=>w.claim?.state==='occupied').length;
        counts.textContent=works.length+' tarefas · '+occupied+' reservas vigentes · '+notes+' notas compartilhadas';
        panel.append(title,description,counts);
        const list=document.createElement('div');list.className='coordinator-project-list';list.setAttribute('role','list');
        for(const work of works.slice(0,12)){
          const card=document.createElement('button');card.type='button';card.className='execution-work-item coordinator-project-task';
          card.setAttribute('role','listitem');
          const copy=document.createElement('span');copy.className='execution-work-copy';
          const name=document.createElement('strong');name.textContent=work.title;
          const detail=document.createElement('small');
          detail.textContent=work.claim?.state==='occupied'?'Reserva vigente; GPT ativo não atestado':
            work.claim?.state==='expired'?'Reserva expirada; confira recibos antes de retomar':
            work.claim?.state==='released'?'Reserva liberada; continuidade preservada':
            work.latest_run_status==='succeeded'?'Run GPT registrado; aceite não presumido':
            'Aguardando trabalho pelo Forge MCP';
          if(work.claim?.lastProgress)detail.textContent+=' · checkpoint: '+String(work.claim.lastProgress).slice(0,140);
          const state=document.createElement('span');state.className='execution-work-state';
          state.textContent=work.acceptanceEvidence?'Aceita no Git':work.claim?.state==='occupied'?'Reservada':
            work.claim?.state==='expired'?'Expirada':work.claim?.state==='released'?'Liberada':'Pendente';
          copy.append(name,detail);card.append(copy,state);
          card.addEventListener('click',async()=>{
            if(scope!==executionScope()||!coordinatorOpen)return;
            try{coordinatorOpen=false;await onOpenWork(work.id);}
            catch{status('Não foi possível abrir a tarefa. Nenhuma ação foi executada.');}
          });
          list.append(card);
        }
        panel.append(list);box.append(panel);
      }else{
        const empty=document.createElement('div');empty.className='coordinator-empty forge-welcome';
        const mark=document.createElement('span');mark.className='forge-welcome-mark';
        mark.textContent='◇';mark.setAttribute('aria-hidden','true');
        const title=document.createElement('strong');title.textContent='Nenhum registro neste projeto';
        const copy=document.createElement('p');
        copy.textContent='As tarefas e eventos aparecerão aqui quando forem registrados pelo Forge MCP.';
        empty.append(mark,title,copy);box.append(empty);
      }
    }
    for(const message of page.messages) {
      const article=document.createElement('article');article.className='coordinator-message';
      article.dataset.role=message.role==='user'?'user':'assistant';
      const role=document.createElement('strong');role.textContent=message.role==='user'?'Você':'Forge';
      const text=document.createElement('p');text.textContent=message.content;
      article.append(role,text);box.append(article);
    }
    box.scrollTop=box.scrollHeight;
    const cards=$('coordinatorProposals');cards.replaceChildren();
  }
  let coordinatorRouteGeneration=0;
  async function showCoordinator() {
    if(!chatTaskId)return;
    const route=++coordinatorRouteGeneration;
    coordinatorOpen=true;
    document.body.classList.remove('orchestrator-rail-open');$('contextRail').classList.remove('open');
    $('openWorks').setAttribute('aria-expanded','false');
    $('coordinatorRailToggle').setAttribute('aria-expanded','false');
    $('orchestrationPanel').hidden=false;$('orchestratorWorkRail').hidden=false;
    // Never let an older coordinator transition overwrite a newer Task view.
    const applied=await onShowCoordinator();
    if(applied===false||!coordinatorOpen||route!==coordinatorRouteGeneration)return;
    await onNavigationChange?.({view:'coordinator',projectId,orchestratorId,taskId:null});
    if(!coordinatorOpen||route!==coordinatorRouteGeneration)return;
    await renderCoordinator();
  }
  function error() {status('Não foi possível confirmar a operação. Consulte o estado antes de repetir.');}
  async function formAction(form,action) {
    const buttons=[...form.querySelectorAll('button')];
    const previous=buttons.map(b=>b.disabled);buttons.forEach(b=>b.disabled=true);
    try {await action();}catch(cause){
      if(String(cause?.message||cause).includes('provider_mcp_selection_required'))
        status('Conecte e selecione Forge MCP na conversa GPT para trabalhar no projeto. O pedido não foi enviado e o rascunho foi preservado.');
      else error();
    }finally{buttons.forEach((b,i)=>b.disabled=previous[i]);}
  }
  $('inspectWorkspace').addEventListener('click',()=>{
    const p=projectId;if(!p)return;
    const generation=++workspaceInspectionGeneration;
    const button=$('inspectWorkspace');
    button.disabled=true;
    $('workspaceEvidence').textContent='Consultando somente o estado do grant do Runtime...';
    void (async()=>{
      try {
        const current=await call('workspace_status',{projectId:p});
        if(generation!==workspaceInspectionGeneration||p!==projectId)return;
        $('workspaceConnection').textContent=describeWorkspaceConnection(current);
        if(current?.available!==true||current.state!=='bound'||!Array.isArray(current.bindings)||
          typeof current.bindings[0]?.bindingId!=='string') {
          $('workspaceEvidence').textContent='Nenhum snapshot verificado. Sem leitura de arquivos ou execução local.';
          return;
        }
        // One explicit, read-only snapshot. Runtime must reverify the grant
        // before AND after the remote observation; no path or content reaches UI.
        const snapshot=await call('workspace_snapshot',{
          projectId:p,bindingId:current.bindings[0].bindingId
        });
        if(generation!==workspaceInspectionGeneration||p!==projectId)return;
        $('workspaceEvidence').textContent=describeWorkspaceSnapshot(snapshot);
      }catch {
        if(generation===workspaceInspectionGeneration&&p===projectId)
          $('workspaceEvidence').textContent=
            'Não foi possível verificar o grant atual. Nenhum arquivo foi lido ou modificado pelo Forge.';
      }finally {
        if(generation===workspaceInspectionGeneration&&p===projectId)
          button.disabled=false;
      }
    })();
  });
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
    try{await flushCoordinatorDraft();}catch{$('orchestratorSelect').value=previous||'';status('O rascunho do chat central não foi salvo; o administrador atual foi mantido.');return;}
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
  $('projectDeleteForm').addEventListener('submit',event=>{
    event.preventDefault();void formAction(event.currentTarget,async()=>{
      const p=projectId,project=projectsCache.find(item=>item.id===p);
      const name=$('projectDeleteName').value;
      if(!project||name!==project.name){
        status('Digite exatamente o nome do projeto para confirmar a exclusão.');return;
      }
      if(analysisBusy||coordinatorSubmitting){
        status('Existe trabalho em andamento; finalize antes de excluir este projeto.');return;
      }
      await flushCoordinatorDraft();
      const receipt=await command('project_delete',{projectId:p,confirmName:name});
      if(receipt.status!=='succeeded'||receipt.result?.deleted!==true)
        throw Error('orchestrator_project_delete_unconfirmed');
      if(projectId!==p)return;
      projectId=null;orchestratorId=null;chatTaskId=null;coordinatorOpen=false;
      clearProjectPreflight();
      $('orchestrationPanel').hidden=true;
      $('projectDeleteSetup').open=false;$('projectDeleteName').value='';
      document.body.classList.remove('orchestrator-focus','orchestrator-rail-open');
      $('contextRail').classList.remove('open');
      await refreshProjects();await refreshOrchestrators();
      await onNavigationChange?.({view:'home',projectId:null,orchestratorId:null,taskId:null});
      const cleanup=receipt.result?.localAssetCleanup;
      status(cleanup&&cleanup.filesPending===0&&cleanup.entriesRemaining===0
        ?'Projeto e anexos locais excluídos. Pastas externas preservadas.'
        :'Projeto excluído. Alguns anexos locais podem exigir limpeza; pastas externas preservadas.');
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
  $('openOrchestrator').addEventListener('click',()=>{void showCoordinator().catch(error);});
  let openingWorkNavigation=false;
  function openMissionNavigation(filter,trigger){
    // Every destination opens the same scoped Work list. Never choose a GPT
    // Task automatically, even when arriving from a different app screen.
    if(openingWorkNavigation)return;
    if(!projectId||!orchestratorId||!chatTaskId){
      status('Este projeto ainda não tem coordenação registrada. Use o Forge MCP para configurar a coordenação.');
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
  function fitCoordinatorComposer(){
    const input=$('coordinatorPrompt');
    input.style.height='auto';
    input.style.height=Math.min(input.scrollHeight,164)+'px';
  }
  $('coordinatorPrompt').addEventListener('input',()=>{
    fitCoordinatorComposer();
    stageCoordinatorDraft();
  });
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
      $('batchWorkFeedback').textContent=receipt.result.created+' tarefas registradas. Nenhuma mensagem enviada ao GPT.';
      status(receipt.result.created+' tarefas registradas no projeto. Chats GPT assumem trabalho somente por claim via Forge MCP.');
    });
  });
  async function createWork(title='Nova tarefa') {
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
      const saved=!dedicatedProject&&restoreNavigation?.schema==='ordax.workspace-navigation.v1'?restoreNavigation:null;
      projectId=projects.some(project=>project.id===saved?.projectId)
        ?saved.projectId:projects[0]?.id||null;
      $('projectSelect').value=projectId||'';
      await refreshDedicatedRepositories();
      if(saved?.projectId===projectId)orchestratorId=saved.orchestratorId||null;
      renderProjectNavigation(projects);
      syncProjectRepository();
      // Project restoration must not depend on a secondary status projection.
      // If status is temporarily unavailable, keep the canonical project visible
      // and continue with project/orchestrator reads instead of falling back to
      // the empty onboarding screen.
      await refreshApiStatus().catch(()=>null);
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
            await refreshProjects();await refreshDedicatedRepositories();await refreshOrchestrators();
            if(coordinatorOpen)await renderCoordinator();
          } while(refreshRequested);
        } catch {error();}
        finally {refreshPending=false;}
      };
      api.onOrchestratorChanged?.(()=>{
        refreshRequested=true;
        if(!refreshPending)void refreshAfterChange();
      });},
    setProviderHealth:health=>{
      observedGptHealth=health&&typeof health==='object'?health:null;
      syncForjadorSessionAvailability();
    },
    createWork,hasProject:()=>Boolean(projectId),hasOrchestrator:()=>Boolean(chatTaskId),
    getProjectId:()=>projectId,
    getOrchestratorId:()=>orchestratorId,
    showCoordinator,
    refreshStatus:()=>refreshApiStatus(),
    hide(){coordinatorOpen=false;coordinatorRouteGeneration++;$('orchestrationPanel').hidden=true;},
    refresh:refreshWorks
  });
}
