const $=id=>document.getElementById(id);
const IDS=['forjador'];
let state=null,active='forjador',connected=false,ready=[],busy=[],operation=false,sessions=new Map();
let coreStatus={connected:false},coreProjection=null,receiptPanelProject=null;
let reconnectChoiceInitialized=false;
const standardDispatchExplanation=$('core-dispatch-explain').textContent;
const nameOf=id=>id==='forjador'?'Forjador':id;
function message(text){$('status').textContent=String(text||'');}
function renderCore(){
  const activeCore=coreStatus?.connected===true;
  const dev=coreStatus?.devAutoPair===true;
  $('core-manual-auth').hidden=dev;
  $('core-connect').hidden=dev;
  $('core-dev-state').hidden=!dev;
  $('core-dev-state').textContent=dev
    ?activeCore
      ?'Modo Dev ativo · Forge Core conectado automaticamente, sem códigos, tokens ou aprovações repetidas.'
      :'Modo Dev ativo · procurando o Forge Core local para conectar automaticamente.'
    :'';
  $('core-dispatch').textContent=dev
    ?'Executar Task via Forge Core'
    :'Executar Task via Forge Core (confirmação nativa)';
  $('core-dispatch-explain').textContent=dev
    ?'Visualização GPT Web. Prepare a Task no Core para executar sem popup no modo Dev. O Core continua criando Runs e recibos e bloqueia o reenvio de efeitos incertos. Mensagens digitadas diretamente no navegador não são Runs canônicos.'
    :standardDispatchExplanation;
  $('core-connect').disabled=operation||activeCore;
  $('core-pair').disabled=operation||activeCore||coreStatus?.reconnectProtected!==true;
  const code=coreStatus?.pairingCode;
  const pairedCode=typeof code==='string'&&/^[A-F0-9]{10}$/.test(code)?code:null;
  $('core-pair-code').hidden=pairedCode===null;
  $('core-pair-code').textContent=pairedCode
    ?'Código de vínculo: '+pairedCode+'\nCompare exatamente este código com a confirmação nativa do Forge.'
    :'';
  $('core-disconnect').disabled=operation||!activeCore;
  $('core-refresh').disabled=operation||!activeCore;
  $('core-connection').textContent=(activeCore
    ?coreStatus?.providerDispatchAllowed===true
      ?dev
        ?'Forge MCP conectado · modo Dev sem confirmação nativa de envio inicial.'
        :'Forge MCP conectado · envio inicial sujeito somente à confirmação nativa.'
      :'Forge MCP conectado · leitura e rascunho disponíveis; atualize o Forge nativo para habilitar o envio autorizado.'
    :dev
      ?'Forge MCP Dev: aguardando o Core local; reconexão automática habilitada.'
      :'Forge MCP desconectado: conecte uma vez e habilite a proteção Windows se desejar.')+
    (coreStatus?.reconnectRemembered===true
      ?'\nReconexão protegida salva neste Windows (o Core pode revogá-la).'
      :'\nNenhuma reconexão local salva.');
  const selector=$('core-project');
  selector.replaceChildren();
  const projects=activeCore?(coreProjection?.projects||[]):[];
  if(!projects.length){
    const option=document.createElement('option');
    option.value='';option.textContent=activeCore?'Nenhum projeto autorizado':'Conecte o Forge MCP';
    selector.append(option);
  }else for(const project of projects){
    const option=document.createElement('option');
    option.value=project.id;
    option.textContent=project.name||project.id;
    selector.append(option);
  }
  selector.value=coreProjection?.selectedProjectId||'';
  selector.disabled=operation||!activeCore||!projects.length;
  const tasks=activeCore?(coreProjection?.works||[]):[];
  const selected=coreProjection?.selectedTaskId||'';
  const taskSelector=$('core-task');
  taskSelector.replaceChildren();
  const none=document.createElement('option');
  none.value='';none.textContent='Selecione uma Task canônica';
  taskSelector.append(none);
  for(const task of tasks){
    const option=document.createElement('option');
    option.value=task.id;option.textContent=task.title||task.id;
    taskSelector.append(option);
  }
  taskSelector.value=selected;
  taskSelector.disabled=operation||!activeCore||!tasks.length;
  $('save-draft').disabled=operation||!activeCore||!selected||
    coreProjection?.selectedHandoff?.selectedTask?.taskId!==selected;
  $('core-dispatch').disabled=operation||!activeCore||
    coreStatus?.providerDispatchAllowed!==true||!selected||
    coreStatus?.preparedTaskId!==selected||
    coreStatus?.preparedDraftRevision!==
      coreProjection?.selectedHandoff?.selectedTask?.draftRevision;
  const handoff=coreProjection?.handoff;
  const unresolved=activeCore&&Array.isArray(handoff?.unresolvedCommands)
    ?handoff.unresolvedCommands:[];
  const receiptSelector=$('core-command');
  const previouslySelected=receiptSelector.value;
  receiptSelector.replaceChildren();
  const availableReceipts=unresolved.filter(item=>
    typeof item?.commandId==='string'&&
    /^command_[0-9a-f-]{36}$/.test(item.commandId)).slice(0,40);
  if(!availableReceipts.length){
    const option=document.createElement('option');
    option.value='';option.textContent='Nenhum recibo pendente deste projeto';
    receiptSelector.append(option);
  }else for(const item of availableReceipts){
    const option=document.createElement('option');
    option.value=item.commandId;
    option.textContent=item.commandId+' · '+String(item.status||'incerto');
    receiptSelector.append(option);
  }
  receiptSelector.value=availableReceipts.some(item=>item.commandId===previouslySelected)
    ?previouslySelected:(availableReceipts[0]?.commandId||'');
  receiptSelector.disabled=operation||!activeCore||
    coreStatus?.receiptLookupAllowed!==true||!availableReceipts.length;
  $('core-command-check').disabled=receiptSelector.disabled||!receiptSelector.value;
  const projectKey=activeCore?coreProjection?.selectedProjectId??null:null;
  if(projectKey!==receiptPanelProject){
    receiptPanelProject=projectKey;
    $('core-receipt-status').textContent=
      'Recibos são consultados somente no Forge Core. Nenhuma operação será reenviada.';
  }
  if(!activeCore||!handoff){
    $('core-summary').textContent='Nenhuma leitura canônica confirmada.';
    $('core-tasks').textContent='Tarefas e bloqueios disponíveis após conexão.';
    return;
  }
  const project=projects.find(p=>p.id===coreProjection.selectedProjectId);
  const agents=coreProjection.orchestrators||[];
  const work=coreProjection.works||[];
  const plan=handoff.workPlan||{};
  const admission=handoff.continuation||{};
  $('core-summary').textContent=
    'Projeto: '+(project?.name||handoff.project?.name||'?')+
    '\nAutoridade: Forge Core / SQLite'+
    '\nLeitura: '+(coreProjection.observedAt||'não verificada')+
    '\nAgentes coordenadores: '+agents.length+
    '\nTarefas registradas: '+work.length+
    '\nRepositório cadastrado: '+(handoff.project?.repositoryUrl||'não informado')+
    '\nGitHub ao vivo: NÃO verificado nesta projeção.';
  const rows=work.slice(0,20).map(w=>{
    const worker=Array.isArray(plan.workers)?plan.workers.find(x=>x.taskId===w.id):null;
    const branch=Array.isArray(handoff.tasks)?handoff.tasks.find(x=>x.taskId===w.id)?.branchEvidence:null;
    return '• '+(w.title||w.id)+' ['+(worker?.state||w.status||'desconhecido')+']'+
      (w.latestRunStatus?' · Run: '+w.latestRunStatus:'')+
      (w.runningRuns?' · '+w.runningRuns+' execução(ões) ativa(s)':'')+
      (branch?' · branch registrada: '+branch.branchName+' ('+branch.worktreeStatus+', HEAD ao vivo não verificado)':'');
  });
  const scoped=coreProjection?.selectedHandoff;
  const selectedInfo=scoped?.selectedTask;
  const selectedBlockers=scoped?.continuation?.blockedReasons||[];
  const detail=scoped?.taskDetail;
  const recentRuns=Array.isArray(detail?.runs)?detail.runs:[];
  const currentRun=recentRuns[0];
  const lastMessages=Array.isArray(detail?.messages)?detail.messages:[];
  const readback=lastMessages.slice(-5).map(m=>
    String(m.role||'?')+': '+String(m.content||'').slice(0,180));
  const selectedReport=selectedInfo
    ?'\nTask escolhida: '+selectedInfo.taskId+
      '\nRascunho revisionado: '+selectedInfo.draftRevision+
      '\nBloqueios desta Task: '+(selectedBlockers.length?selectedBlockers.join(', '):'nenhum encontrado (não concede lease)')+
      '\nRun mais recente: '+(currentRun?currentRun.id+' ['+currentRun.status+']':'não registrado')+
      '\nRuns recentes consultados: '+recentRuns.length+
      '\nConversas recentes consultadas: '+(detail?.recentConversationsRead??'?')+
      '\nAprovações pendentes: '+(detail?.pendingApprovals??'?')+
      '\nRevisão do Run registrada: '+(detail?.latestRunReviewRecorded===true?'sim, avaliar no Core':'não verificada')+
      '\nHistórico recente (Core): '+(readback.length?readback.join(' | '):'sem mensagens registradas')+
      '\nContinuação: usar a mesma Task e o envio nativo do Forge Core; não reenviar Run incerto.'
    :'\nSelecione uma Task para consultar histórico, Run e bloqueios canônicos.';
  const blockers=Array.isArray(admission.blockedReasons)?admission.blockedReasons:[];
  const receiptReport=unresolved.map(command=>
    String(command.commandId||'?')+' ['+String(command.operation||'?')+
    ', '+String(command.status||'uncertain')+']').join(' | ');
  const receiptTruncated=handoff.limits?.unresolvedCommandsTruncated===true;
  $('core-tasks').textContent=
    'Estado do plano: '+(plan.basis||plan.reason||'não disponível')+
    '\nComandos incertos/ativos: '+(handoff.counts?.unresolvedCommands??'?')+
    '\nRecibos pendentes (leitura, nunca reenviar): '+
      (receiptReport||'nenhum apresentado')+
      (receiptTruncated?' | lista truncada, consulte o Core':'')+
    '\nBloqueios: '+(blockers.length?blockers.join(', '):'nenhum bloqueio global identificado')+
    '\nTarefas aguardando aceite: '+(admission.needsAcceptanceTaskIds?.length||0)+
    '\nReserva/lease para envio: NÃO concedida nesta leitura.'+
    '\nBranch/PR por tarefa: verificar no Forge Core (não atestada nesta projeção).'+
    '\n'+(rows.length?rows.join('\n'):'Nenhuma tarefa registrada.')+
    (work.length>rows.length?'\n... outras '+(work.length-rows.length)+' tarefas':'')+selectedReport;
}
function render(){
  if(!state)return;
  const agent=state.agents.find(x=>x.id===active);
  $('role').textContent=nameOf(active);
  $('send').textContent='Envio direto bloqueado — use Forge Core';
  for(const id of IDS){
    const button=$('tab-'+id);
    button.classList.toggle('active',id===active);
    button.setAttribute('aria-selected',String(id===active));
  }
  $('autonomy-controls').hidden=true;
  $('autonomy-help').hidden=true;
  const doing=busy.includes(active)||agent.status==='running';
  const awaiting=['awaiting-github','awaiting-provider','verifying'].includes(agent.status);
  $('send').disabled=true; // No unregistered GPT effect outside Core Run/receipt.
  $('auto-start').disabled=true;
  $('auto-pause').disabled=true;
  $('new-chat').disabled=true; // Core owns rotation of the same Task.
  $('check-agent').disabled=true;
  $('refresh').disabled=true;
  $('connect').disabled=operation;
  $('notify-forjador').disabled=true;
  const branch=agent.branch||'(sem branch)';
  const chatStatus={
    'ready':'pronto',
    'login-required':'login necessário',
    'authenticating':'autenticando',
    'unavailable':'aguardando verificação'
  }[sessions.get(active)]||(active==='forjador'?'carregando':'histórico (sem worker separado)');
  $('agent-status').textContent=
    'Estado: '+agent.status+'\nGPT Web: '+chatStatus+'\nBranch: '+branch+
    '\nConversa: '+(agent.chatUrl?'vinculada':'nova')+
    (agent.lastError?'\nBloqueio: '+agent.lastError:'')+
    (active!=='forjador'?'\nAgente histórico (somente leitura): novas tarefas são gerenciadas no Forge Core.':'\nAutoridade: Forge MCP; resposta do GPT não comprova operações.')+
    (agent.autoContinue?'\nCheckpoint antigo preservado; envios automáticos do app desativados.':'');
  const observed=state.observed||{};
  $('revision').textContent='Histórico local (não é GitHub ao vivo): '+(observed.base||'?')+'@'+(observed.sha||'?').slice(0,12)+
    (observed.at?'\nVerificado: '+observed.at:'');
  const archived=(state.inbox||[]).filter(x=>!x.delivered);
  $('inbox').textContent=archived.length
    ?'Arquivo histórico (sem autorização de envio ou Task): '+archived.length+' aviso(s) antigos:\n'+
      archived.slice(-5).map(x=>'• '+x.detail).join('\n')
    :'Arquivo histórico: sem avisos antigos.';
  const list=$('history');
  list.replaceChildren();
  for(const event of state.events.slice(-12).reverse()){
    const row=document.createElement('div');
    row.className='event';
    row.textContent=event.at+' · '+event.kind+
      (event.agent?' · '+nameOf(event.agent):'')+'\n'+event.detail;
    list.append(row);
  }
  if(!state.events.length)list.textContent='Sem alterações confirmadas.';
  renderCore();
}
async function action(fn){
  if(operation)return;
  operation=true;render();
  try{await fn();}
  catch(error){message('Erro: '+String(error?.message||error));}
  finally{operation=false;render();}
}
function apply(data){
  if(data.snapshot)state=data.snapshot;
  if(data.active)active=data.active;
  if(data.ready)ready=data.ready;
  if(data.busy)busy=data.busy;
  if(data.sessions)sessions=new Map(data.sessions);
  if(Object.hasOwn(data,'coreStatus')){
    coreStatus=data.coreStatus||{connected:false};
    if(!reconnectChoiceInitialized&&Object.hasOwn(coreStatus,'reconnectRemembered')){
      $('core-remember').checked=coreStatus.reconnectRemembered===true;
      reconnectChoiceInitialized=true;
    }
  }
  if(Object.hasOwn(data,'coreProjection'))coreProjection=data.coreProjection;
  if(data.message)message(data.message);
  render();
}
$('core-pair').addEventListener('click',()=>action(async()=>{
  const endpoint=$('core-endpoint').value.trim();
  await window.forgeGit.corePair(endpoint);
  apply(await window.forgeGit.state());
  message('Forge Git vinculado ao MCP do Forge com autorização nativa. A reconexão protegida foi habilitada.');
}));
$('core-connect').addEventListener('click',()=>action(async()=>{
  const endpoint=$('core-endpoint').value.trim();
  const token=$('core-token').value.trim();
  try{
    await window.forgeGit.coreConnect({
      endpoint,token,remember:$('core-remember').checked===true
    });
    apply(await window.forgeGit.state());
    message('Forge MCP conectado. Estado do projeto obtido do Core autorizado.');
  }finally{
    // No credential may remain in the renderer after attempting to connect.
    $('core-token').value='';
  }
}));
$('core-refresh').addEventListener('click',()=>action(async()=>{
  await window.forgeGit.coreRefresh();
  apply(await window.forgeGit.state());
}));
$('core-command-check').addEventListener('click',()=>action(async()=>{
  const commandId=$('core-command').value;
  const projectId=coreProjection?.selectedProjectId;
  if(!commandId||!projectId)throw Error('Selecione um recibo do projeto canônico.');
  const receipt=await window.forgeGit.coreReceiptRead(commandId);
  if(receipt?.readOnly!==true||receipt.commandId!==commandId)
    throw Error('forge_mcp_receipt_readback_invalid');
  apply(await window.forgeGit.state());
  if(coreProjection?.selectedProjectId!==projectId)
    throw Error('forge_mcp_project_changed_during_receipt_read');
  $('core-receipt-status').textContent=
    'Consultado no Forge Core: '+receipt.commandId+
    '\nOperação: '+receipt.operation+
    '\nEstado registrado: '+receipt.status+
    '\nVerificado em: '+receipt.checkedAt+
    '\n'+(receipt.requiresReconciliation
      ?'PENDENTE: resultado incerto ou em execução. NÃO reenvie; reconcilie no Core.'
      :'Recibo registrado. Isso NÃO comprova alterações externas, aceite ou conclusão da Task.');
}));
$('core-disconnect').addEventListener('click',()=>action(async()=>{
  await window.forgeGit.coreDisconnect();
  apply(await window.forgeGit.state());
}));
$('core-project').addEventListener('change',()=>action(async()=>{
  const selected=$('core-project').value;
  if(!selected)return;
  await window.forgeGit.coreSelect(selected);
  $('draft-confirmation').textContent='Projeto selecionado; escolha a Task antes de salvar.';
  apply(await window.forgeGit.state());
}));
$('core-task').addEventListener('change',()=>action(async()=>{
  const selected=$('core-task').value;
  if(!selected)return;
  await window.forgeGit.coreSelectTask(selected);
  $('draft-confirmation').textContent='Task selecionada; rascunho ainda não foi salvo.';
  apply(await window.forgeGit.state());
}));
$('save-draft').addEventListener('click',()=>action(async()=>{
  const taskId=coreProjection?.selectedTaskId;
  const expectedRevision=coreProjection?.selectedHandoff?.selectedTask?.draftRevision;
  const content=$('instruction').value;
  if(!taskId||!Number.isSafeInteger(expectedRevision))
    throw Error('Selecione uma Task canônica antes de preparar trabalho.');
  if(typeof content!=='string'||content.trim().length<4)
    throw Error('Descreva a tarefa antes de salvar o rascunho.');
  const result=await window.forgeGit.coreSaveDraft({taskId,content,expectedRevision});
  if(result?.providerMessagesSent!==0||result?.readbackVerified!==true)
    throw Error('Recibo canônico de rascunho não confirmado.');
  $('draft-confirmation').textContent='Rascunho registrado no Core: Task '+taskId+
    ', revisão '+result.draftRevision+
    '. Nenhum GPT foi acionado. Confira o texto e escolha Executar Task; a janela do Forge solicitará confirmação.';
  apply(await window.forgeGit.state());
}));
for(const id of IDS){
  $('tab-'+id).addEventListener('click',()=>action(async()=>{
    const data=await window.forgeGit.select(id);
    active=data.active;render();
  }));
}
$('connect').addEventListener('click',()=>action(async()=>{
  const connectedUser=await window.forgeGit.connect();
  connected=true;
  $('login-state').textContent='Identidade GitHub verificada: '+connectedUser.login+'. Acesso aos repositórios: não verificado no Forge Git.';
  apply(await window.forgeGit.state());
}));
$('refresh').addEventListener('click',()=>action(async()=>{
  const result=await window.forgeGit.refresh();
  apply(result);message(result.note);
}));
$('check-agent').addEventListener('click',()=>action(async()=>{
  const result=await window.forgeGit.agentRefresh(active);
  apply(result);message(result.note);
}));
$('core-dispatch').addEventListener('click',()=>action(async()=>{
  const taskId=coreProjection?.selectedTaskId;
  const draftRevision=coreStatus?.preparedDraftRevision;
  const content=$('instruction').value;
  if(!taskId||!Number.isSafeInteger(draftRevision))
    throw Error('Salve primeiro o rascunho da Task selecionada.');
  // The owner already clicked this explicit action. The native Forge Core
  // presents the sole authoritative confirmation, with exact Task/draft.
  // Do not show a second, redundant renderer confirmation.
  message('Forge Core: confirmação nativa necessária; verificando Run e recibo.');
  let receipt;
  try{
    receipt=await window.forgeGit.coreDispatch({taskId,content,draftRevision});
  }catch(error){
    const code=String(error?.message||error);
    // Once an owner-dispatch POST might have left the app, no local retry is safe.
    // Show the canonical reconciliation action, not an invitation to resubmit.
    if(/^forge_owner_dispatch_(?:result_uncertain|unconfirmed_http_|invalid_receipt|incomplete_run|connection_changed)/.test(code)){
      $('draft-confirmation').textContent=
        'Resultado do envio não confirmado. A operação pode ter ocorrido. NÃO reenvie: consulte o comando e o Run no Forge Core para reconciliar o recibo.';
      apply(await window.forgeGit.state());
    }
    throw error;
  }
  if(receipt?.mcpReceiptVerified!==true)
    throw Error('forge_owner_dispatch_receipt_unverified');
  if(receipt.status==='succeeded'){
    $('instruction').value='';
    $('draft-confirmation').textContent='Run '+receipt.runId+
      ' e comando '+receipt.commandId+
      ' confirmados no Core. Efeitos GitHub/arquivo NÃO verificados.';
  }else{
    $('draft-confirmation').textContent='Comando '+receipt.commandId+
      ': '+receipt.status+'. Consulte o Core. NÃO reenviar.';
  }
  apply(await window.forgeGit.state());
}));
$('send').addEventListener('click',()=>message(
  'Envio direto desativado. Faça o envio no Forge Core para registrar Run e recibos.'
));$('auto-start').addEventListener('click',()=>action(async()=>{
  if(active==='forjador')throw Error('Missão contínua pertence aos agentes.');
  const text=$('instruction').value.trim();
  if(!text)throw Error('Escreva a missão.');
  if(!confirm('Autorizar até 6 ciclos GPT Web consecutivos após commits GitHub confirmados, apenas na branch de testes? Sem merge automático.'))return;
  $('instruction').value='';
  message('Missão contínua iniciada. O aplicativo só continuará após comprovar commits remotos.');
  await window.forgeGit.send({agentId:active,text,autoContinue:true});
  apply(await window.forgeGit.state());
}));
$('auto-pause').addEventListener('click',async()=>{
  try{
    apply({snapshot:await window.forgeGit.pauseAuto(active)});
    message('Continuidade pausada; a operação já em curso terminará normalmente.');
  }catch(error){message('Erro: '+String(error?.message||error));}
});
$('new-chat').addEventListener('click',()=>action(async()=>{
  if(!confirm('Iniciar nova conversa para '+nameOf(active)+' preservando a memória do projeto?'))return;
  apply({snapshot:await window.forgeGit.newChat(active)});
  message('Nova conversa preparada. A próxima missão receberá o contexto verificado.');
}));
$('notify-forjador').addEventListener('click',()=>action(async()=>{
  const result=await window.forgeGit.notifyForjador();
  apply(await window.forgeGit.state());
  message(result.message||result.note||'Forjador atualizado.');
}));
window.forgeGit.onEvent(data=>apply(data));
apply(await window.forgeGit.state());
action(async()=>{
  try{
    const who=await window.forgeGit.connect();
    connected=true;
    $('login-state').textContent='Identidade GitHub verificada: '+who.login+'. Acesso aos repositórios: não verificado no Forge Git.';
  }catch(error){
    $('login-state').textContent='GitHub não conectado nesta interface (opcional para conversar com o Forge MCP).';
    message('GitHub: '+String(error.message||error)+'; o Forge Core é responsável por evidências e permissões.');
  }
  apply(await window.forgeGit.state());
});