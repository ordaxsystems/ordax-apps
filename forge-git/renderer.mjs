const $=id=>document.getElementById(id);
const IDS=['forjador','agent-1','agent-2'];
let state=null,active='forjador',connected=false,ready=[],busy=[],operation=false;
const nameOf=id=>({forjador:'Forjador','agent-1':'Agente 1','agent-2':'Agente 2'})[id]||id;
function message(text){$('status').textContent=String(text||'');}
function render(){
  if(!state)return;
  const agent=state.agents.find(x=>x.id===active);
  $('role').textContent=nameOf(active);
  $('send').textContent=active==='forjador'?'Enviar ao GPT Web com Forge MCP':'Executar no GPT Web';
  for(const id of IDS){
    const button=$('tab-'+id);
    button.classList.toggle('active',id===active);
    button.setAttribute('aria-selected',String(id===active));
  }
  $('autonomy-controls').hidden=active==='forjador';
  $('autonomy-help').hidden=active==='forjador';
  const doing=busy.includes(active)||agent.status==='running';
  const awaiting=agent.status==='awaiting-github';
  $('send').disabled=operation||!connected||doing||awaiting||!ready.includes(active);
  $('auto-start').disabled=operation||!connected||doing||awaiting||!ready.includes(active);
  $('auto-pause').disabled=!connected||!agent.autoContinue;
  $('new-chat').disabled=operation||doing;
  $('check-agent').disabled=operation||!connected;
  $('refresh').disabled=operation||!connected;
  $('connect').disabled=operation;
  $('notify-forjador').disabled=operation||!connected||busy.includes('forjador')||
    !state.inbox.some(x=>!x.delivered);
  const branch=agent.branch||'(sem branch)';
  $('agent-status').textContent=
    'Estado: '+agent.status+'\nBranch: '+branch+
    '\nConversa: '+(agent.chatUrl?'vinculada':'nova')+
    (agent.lastError?'\nBloqueio: '+agent.lastError:'')+
    (agent.autoContinue?'\nContinuidade automática: ativa ('+(agent.autoRounds||0)+'/6)':'');
  const observed=state.observed||{};
  $('revision').textContent='Main: '+(observed.base||'?')+'@'+(observed.sha||'?').slice(0,12)+
    (observed.at?'\nVerificado: '+observed.at:'');
  const unread=state.inbox.filter(x=>!x.delivered);
  $('inbox').textContent=unread.length?unread.length+' aviso(s) pendente(s):\n'+
    unread.slice(-5).map(x=>'• '+x.detail).join('\n'):'Sem avisos pendentes.';
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
  if(data.message)message(data.message);
  render();
}
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
$('send').addEventListener('click',()=>action(async()=>{
  const text=$('instruction').value.trim();
  if(!text)throw Error('Escreva a missão.');
  if(!confirm('Enviar esta missão ao '+nameOf(active)+'? O GPT só terá acesso às ferramentas MCP que estiverem autorizadas.'))return;
  $('instruction').value='';
  message('Mensagem em execução no GPT Web. O aplicativo verificará o GitHub após a resposta.');
  await window.forgeGit.send({agentId:active,text});
  apply(await window.forgeGit.state());
}));
$('auto-start').addEventListener('click',()=>action(async()=>{
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
    $('login-state').textContent='Conecte a conta GitHub pelo botão.';
    message('GitHub: '+String(error.message||error));
  }
  apply(await window.forgeGit.state());
});