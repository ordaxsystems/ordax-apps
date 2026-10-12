(function(){
'use strict';

var shell={
  project:null,
  conversations:[],
  activeConversationId:null,
  messages:[],
  catalog:{accounts:[],providers:[],send_supported:false,send_summary:''},
  draftSelection:{account_id:'',provider_id:'',model_id:''},
  loading:false
};
var lastProject=null;
var loadEpoch=0;

function byId(id){return document.getElementById(id)}
function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function status(text){var node=byId('assistantStatus');if(node)node.textContent=text||'Assistente pronto'}
function hostMethod(name){var host=window.ordaxStudioHost;return host&&typeof host[name]==='function'?host[name].bind(host):null}
function active(){return shell.conversations.find(function(item){return String(item.id)===String(shell.activeConversationId)})||null}
function connectedAccounts(){return (Array.isArray(shell.catalog.accounts)?shell.catalog.accounts:[]).filter(function(item){return item.connected!==false})}
function availableModels(){var out=[];(Array.isArray(shell.catalog.providers)?shell.catalog.providers:[]).forEach(function(provider){(Array.isArray(provider.models)?provider.models:[]).forEach(function(model){out.push({provider:provider,model:model})})});return out}
function syncDraftSelection(){
  var current=active(),accounts=connectedAccounts(),models=availableModels();
  if(current){
    shell.draftSelection={account_id:String(current.account_id||''),provider_id:String(current.provider_id||''),model_id:String(current.model_id||'')};
    return;
  }
  if(!accounts.some(function(item){return String(item.id)===String(shell.draftSelection.account_id)}))shell.draftSelection.account_id=accounts.length?String(accounts[0].id||''):'';
  if(!models.some(function(item){return String(item.provider.id)===String(shell.draftSelection.provider_id)&&String(item.model.id)===String(shell.draftSelection.model_id)})){
    shell.draftSelection.provider_id=models.length?String(models[0].provider.id||''):'';
    shell.draftSelection.model_id=models.length?String(models[0].model.id||''):'';
  }
}
function providerValue(providerId,modelId){return String(providerId||'')+'::'+String(modelId||'')}
function parseProviderValue(value){var parts=String(value||'').split('::');return{providerId:parts[0]||'',modelId:parts.slice(1).join('::')||''}}

function applyState(data){
  data=data||{};
  shell.project=String(data.project||shell.project||'');
  shell.conversations=Array.isArray(data.conversations)?data.conversations:[];
  shell.messages=Array.isArray(data.messages)?data.messages:[];
  shell.catalog=data.catalog&&typeof data.catalog==='object'?data.catalog:{accounts:[],providers:[],send_supported:false,send_summary:''};
  var selection=data.selection||{};
  shell.activeConversationId=selection.active_conversation_id||null;
  if(!active()&&shell.conversations.length)shell.activeConversationId=shell.conversations[0].id;
  syncDraftSelection();
}

async function reload(){
  if(!shell.project||shell.loading)return;
  var method=hostMethod('assistantState');
  if(!method){status('Runtime incompatível com o assistente persistente');return}
  var epoch=++loadEpoch;shell.loading=true;
  try{
    var result=await method();
    if(epoch!==loadEpoch)return;
    if(!result||!result.ok)throw new Error((result&&result.summary)||'Falha ao carregar assistente');
    applyState(result.data);render();status('Assistente pronto');
  }catch(error){status(String(error))}
  finally{if(epoch===loadEpoch)shell.loading=false}
}

function renderAccounts(){
  var select=byId('assistantAccount');if(!select)return;
  var accounts=Array.isArray(shell.catalog.accounts)?shell.catalog.accounts:[];
  select.innerHTML=accounts.map(function(item){
    var connected=item.connected!==false;
    return '<option value="'+esc(item.id)+'" '+(connected?'':'disabled')+'>'+esc(item.label||item.id)+(connected?'':' · desconectada')+'</option>';
  }).join('');
  var connected=connectedAccounts();
  var desired=shell.draftSelection.account_id;
  if(connected.some(function(item){return String(item.id)===String(desired)}))select.value=desired;
  else if(connected.length)select.value=String(connected[0].id||'');
  select.disabled=!connected.length;
}

function renderProviders(){
  var select=byId('assistantProvider');if(!select)return;
  var providers=Array.isArray(shell.catalog.providers)?shell.catalog.providers:[];
  var options=[];
  providers.forEach(function(provider){
    var models=Array.isArray(provider.models)?provider.models:[];
    models.forEach(function(model){
      var suffix=model.can_send?'':(model.session_available?' · sessão ativa':' · sem adapter');
      options.push('<option value="'+esc(providerValue(provider.id,model.id))+'">'+esc((model.label||model.id)+' · '+(provider.label||provider.id)+suffix)+'</option>');
    });
  });
  select.innerHTML=options.join('');
  var current=active();
  var desired=providerValue(shell.draftSelection.provider_id,shell.draftSelection.model_id);
  if(options.length)select.value=desired;
  select.disabled=!options.length;
  var badge=byId('assistantProviderBadge');
  if(badge){
    var selected=providers.flatMap(function(provider){return (provider.models||[]).map(function(model){return{provider:provider,model:model}})}).find(function(item){
      return String(item.provider.id)===String(shell.draftSelection.provider_id)&&String(item.model.id)===String(shell.draftSelection.model_id);
    });
    badge.textContent=selected?(selected.model.label+' · '+selected.provider.label):'Provider não configurado';
  }
}

function renderTabs(){
  var root=byId('assistantChatTabs');if(!root)return;root.innerHTML='';
  shell.conversations.forEach(function(item){
    var wrap=document.createElement('div');
    wrap.className='assistantChatTab'+(String(item.id)===String(shell.activeConversationId)?' active':'');
    var label=document.createElement('button');
    label.type='button';label.className='assistantChatLabel';label.textContent=item.title||'Chat';
    label.onclick=function(){void selectChat(item.id)};
    wrap.appendChild(label);
    if(shell.conversations.length>1){
      var close=document.createElement('button');
      close.type='button';close.className='closeChat';close.title='Fechar chat';close.textContent='×';
      close.onclick=function(event){event.stopPropagation();void closeChat(item.id)};
      wrap.appendChild(close);
    }
    root.appendChild(wrap);
  });
}

function renderThread(){
  var root=byId('assistantThread');if(!root)return;
  var current=active();
  if(!current){
    root.innerHTML='<div class="assistantEmpty"><div class="assistantEmptyInner"><h3>Nenhum chat aberto</h3></div></div>';
    return;
  }
  if(!shell.messages.length){
    var summary=shell.catalog.send_summary||'O chat está pronto para receber um provider configurado.';
    root.innerHTML='<div class="assistantEmpty"><div class="assistantEmptyInner"><h3>'+esc(current.title||'Chat')+'</h3><p>'+esc(current.model_id||'')+' · '+esc(current.provider_id||'')+'</p><p style="margin-top:8px">'+esc(summary)+'</p></div></div>';
    return;
  }
  root.innerHTML=shell.messages.map(function(message){
    var mine=String(message.role)==='user';
    var at=message.created_at?new Date(message.created_at):null;
    var time=at&&!Number.isNaN(at.getTime())?at.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'';
    return '<div class="assistantMessage '+(mine?'me':'')+'"><div class="assistantMessageBubble"><div class="assistantMessageMeta">'+esc(mine?'Você':String(message.role||'ORDAX'))+(time?' · '+esc(time):'')+'</div>'+esc(message.content||'')+'</div></div>';
  }).join('');
  root.scrollTop=root.scrollHeight;
}

function updateSend(){
  var send=byId('assistantSend'),prompt=byId('assistantPrompt');if(!send)return;
  var enabled=Boolean(shell.catalog.send_supported)&&Boolean(active());
  send.disabled=!enabled;
  var title=enabled?'Enviar mensagem':'Envio indisponível: '+String(shell.catalog.send_summary||'nenhum adapter de provider configurado');
  send.title=title;if(prompt)prompt.title=title;
}

function render(){renderAccounts();renderProviders();renderTabs();renderThread();updateSend()}

async function createChat(){
  var method=hostMethod('assistantCreateChat'),current=active();
  if(!method){status('Runtime sem suporte a criação de chats');return}
  var accountSelect=byId('assistantAccount');
  var providerSelect=byId('assistantProvider');
  var selectedProvider=parseProviderValue(providerSelect?providerSelect.value:'');
  var accountId=accountSelect&&accountSelect.value?String(accountSelect.value):String(shell.draftSelection.account_id||'');
  var providerId=selectedProvider.providerId||String(shell.draftSelection.provider_id||'');
  var modelId=selectedProvider.modelId||String(shell.draftSelection.model_id||'');
  status('Criando chat...');
  try{
    var result=await method(
      '',
      accountId,
      providerId,
      modelId
    );
    if(!result||!result.ok)throw new Error((result&&result.summary)||'Falha ao criar chat');
    await reload();
    var prompt=byId('assistantPrompt');if(prompt)prompt.focus();
  }catch(error){status(String(error))}
}

async function selectChat(id){
  var method=hostMethod('assistantSelectChat');if(!method)return;
  status('Abrindo chat...');
  try{
    var result=await method(String(id));
    if(!result||!result.ok)throw new Error((result&&result.summary)||'Falha ao abrir chat');
    await reload();
  }catch(error){status(String(error))}
}

async function closeChat(id){
  var method=hostMethod('assistantCloseChat');if(!method)return;
  status('Fechando chat...');
  try{
    var result=await method(String(id));
    if(!result||!result.ok)throw new Error((result&&result.summary)||'Falha ao fechar chat');
    await reload();
  }catch(error){status(String(error))}
}

async function updateChat(changes){
  var current=active(),method=hostMethod('assistantUpdateChat');if(!current||!method)return;
  status('Atualizando chat...');
  try{
    var result=await method(
      String(current.id),
      changes.title===undefined?null:changes.title,
      changes.account_id===undefined?null:changes.account_id,
      changes.provider_id===undefined?null:changes.provider_id,
      changes.model_id===undefined?null:changes.model_id
    );
    if(!result||!result.ok)throw new Error((result&&result.summary)||'Falha ao atualizar chat');
    await reload();
  }catch(error){status(String(error))}
}

function bind(){
  var add=byId('assistantNewChat');if(add)add.onclick=function(){void createChat()};
  var account=byId('assistantAccount');if(account)account.onchange=function(event){
    shell.draftSelection.account_id=String(event.target.value||'');
    if(active())void updateChat({account_id:shell.draftSelection.account_id});else render();
  };
  var providers=byId('assistantProvider');if(providers)providers.onchange=function(event){
    var value=parseProviderValue(event.target.value);
    shell.draftSelection.provider_id=value.providerId;shell.draftSelection.model_id=value.modelId;
    if(active())void updateChat({provider_id:value.providerId,model_id:value.modelId});else render();
  };
  var send=byId('assistantSend');if(send)send.onclick=function(){status(shell.catalog.send_summary||'Envio ainda não disponível')};
  var prompt=byId('assistantPrompt');if(prompt)prompt.onkeydown=function(event){
    if(event.key==='Enter'&&!event.shiftKey&&!byId('assistantSend').disabled){event.preventDefault();byId('assistantSend').click()}
  };
  var context=byId('assistantContextButton');if(context)context.onclick=function(){if(window.switchView)window.switchView('overview')};
  var execute=byId('assistantExecuteButton');if(execute)execute.onclick=function(){if(window.switchView)window.switchView('sessions')};
  document.querySelectorAll('[data-system-action]').forEach(function(button){button.onclick=function(){
    var action=button.dataset.systemAction;
    if(action==='account'){var accountButton=document.getElementById('accountButton');if(accountButton)accountButton.click()}
    else if(action==='device'){if(window.switchView)window.switchView('computer')}
    else status('Configurações gerais permanecem no shell do produto.');
  }});
  document.addEventListener('keydown',function(event){
    var modifier=event.ctrlKey||event.metaKey;
    if(modifier&&event.shiftKey&&String(event.key).toLowerCase()==='n'){
      event.preventDefault();void createChat();return;
    }
    if(modifier&&!event.shiftKey&&/^[1-9]$/.test(event.key)){
      var index=Number(event.key)-1;
      if(shell.conversations[index]){event.preventDefault();void selectChat(shell.conversations[index].id)}
    }
    if(modifier&&event.altKey&&String(event.key).toLowerCase()==='c'&&window.switchView){
      event.preventDefault();window.switchView('computer');
    }
  });
}

async function syncProject(){
  var project=(typeof state!=='undefined'&&state.project)||null;
  if(project&&project!==lastProject){
    lastProject=project;shell.project=project;shell.conversations=[];shell.messages=[];shell.activeConversationId=null;shell.draftSelection={account_id:'',provider_id:'',model_id:''};
    await reload();
  }else if(!project&&lastProject){
    lastProject=null;shell.project=null;shell.conversations=[];shell.messages=[];shell.activeConversationId=null;render();
  }
}

window.ordaxIdeShell=Object.freeze({
  getState:function(){return JSON.parse(JSON.stringify(shell))},
  refresh:function(){return reload()}
});
bind();
void syncProject();
setInterval(function(){void syncProject()},350);
setInterval(function(){if(shell.project)void reload()},15000);
})();
