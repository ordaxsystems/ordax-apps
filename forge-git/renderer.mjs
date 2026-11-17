const $=id=>document.getElementById(id);
const IDS=['forjador','agent-1','agent-2'];
let state=null,active='forjador',connected=false,ready=[],busy=[],operation=false,sessions=new Map();
let coreStatus={connected:false},coreProjection=null;
const nameOf=id=>({forjador:'Forjador','agent-1':'Agente 1','agent-2':'Agente 2'})[id]||id;
function message(text){$('status').textContent=String(text||'');}
function renderCore(){
  const activeCore=coreStatus?.connected===true;
  $('core-connect').disabled=operation;
  $('core-disconnect').disabled=operation||!activeCore;
  $('core-refresh').disabled=operation||!activeCore;
  $('core-connection').textContent=activeCore
    ?'Forge MCP conectado · leitura somente · token não persistido'
    :'Forge MCP desconectado: selecione e autorize a conexão local.';
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
  $('core-dispatch').disabled=operation||!activeCore||!selected||
    coreStatus?.preparedTaskId!==selected||
    coreStatus?.preparedDraftRevision!==
      coreProjection?.selectedHandoff?.selectedTask?.draftRevision;
  const handoff=coreProjection?.handoff;
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
  const unresolved=Array.isArray(handoff.unresolvedCommands)?handoff.unresolvedCommands:[];
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
  const unread=state.inbox.filter(x=>!x.delivered);
  $('inbox').textContent=unread.length?unread.length+' aviso(s) pendente(s):\n'+
    unread.slice(-5).map(x=>'• '+x.detail+(x.autoNotified?' (Forjador avisado; MCP não confirmado)':'')).join('\n'):'Sem avisos pendentes.';
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
  if(Object.hasOwn(data,'coreStatus'))coreStatus=data.coreStatus||{connected:false};
  if(Object.hasOwn(data,'coreProjection'))coreProjection=data.coreProjection;
  if(data.message)message(data.message);
  render();
}
$('core-connect').addEventListener('click',()=>action(async()=>{
  const endpoint=$('core-endpoint').value.trim();
  const token=$('core-token').value.trim();
  try{
    await window.forgeGit.coreConnect({endpoint,token});
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
  $('login-state').textContent='Conectado: '+connectedUser.login;
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
  if(!confirm('Solicitar ao Forge Core o envio único desta Task? A confirmação decisiva ocorrerá no aplicativo Forge. Um resultado incerto nunca será reenviado automaticamente.'))return;
  message('Forge Core: confirmação nativa necessária; verificando Run e recibo.');
  const receipt=await window.forgeGit.coreDispatch({taskId,content,draftRevision});
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
    $('login-state').textContent='Conectado: '+who.login;
  }catch(error){
    $('login-state').textContent='GitHub não conectado nesta interface (opcional para conversar com o Forge MCP).';
    message('GitHub: '+String(error.message||error)+'; o Forge Core é responsável por evidências e permissões.');
  }
  apply(await window.forgeGit.state());
});