const $=id=>document.getElementById(id);
const IDS=['forjador','agent-1','agent-2'];
let state=null,active='forjador',connected=false,ready=[],busy=[],operation=false,sessions=new Map();
const nameOf=id=>({forjador:'Forjador','agent-1':'Agente 1','agent-2':'Agente 2'})[id]||id;
function message(text){$('status').textContent=String(text||'');}
function render(){
  if(!state)return;
  const agent=state.agents.find(x=>x.id===active);
  $('role').textContent=nameOf(active);
  $('send').textContent=active==='forjador'?'Enviar ao GPT Web com Forge MCP':'Delegação pertence ao Forge Core';
  for(const id of IDS){
    const button=$('tab-'+id);
    button.classList.toggle('active',id===active);
    button.setAttribute('aria-selected',String(id===active));
  }
  $('autonomy-controls').hidden=true;
  $('autonomy-help').hidden=true;
  const doing=busy.includes(active)||agent.status==='running';
  const awaiting=['awaiting-github','awaiting-provider','verifying'].includes(agent.status);
  $('send').disabled=operation||active!=='forjador'||doing||awaiting||!ready.includes(active);
  $('auto-start').disabled=true;
  $('auto-pause').disabled=true;
  $('new-chat').disabled=operation||active!=='forjador'||doing||awaiting||agent.autoContinue;
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
    $('login-state').textContent='GitHub não conectado nesta interface (opcional para conversar com o Forge MCP).';
    message('GitHub: '+String(error.message||error)+'; o Forge Core é responsável por evidências e permissões.');
  }
  apply(await window.forgeGit.state());
});