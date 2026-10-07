
(function(){
'use strict';

var VERSION=1;
var PROVIDERS=[
  {id:'openai:gpt-4o',provider:'OpenAI',model:'GPT-4o'},
  {id:'xai:grok',provider:'xAI',model:'Grok'},
  {id:'anthropic:claude',provider:'Anthropic',model:'Claude'}
];
var ACCOUNTS=[
  {id:'ordax',label:'Conta ORDAX'},
  {id:'local',label:'Sessao local'}
];
var shell={project:null,chats:[],activeChatId:null,accountId:'ordax',lastProviderId:'openai:gpt-4o'};
var lastProject=null;

function byId(id){return document.getElementById(id)}
function now(){return new Date().toISOString()}
function uid(){return 'chat-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8)}
function key(project){return 'ordax-studio:'+project+':assistant-shell-v'+VERSION}
function provider(id){return PROVIDERS.find(function(item){return item.id===id})||PROVIDERS[0]}
function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function validAccount(id){return ACCOUNTS.some(function(item){return item.id===id})}
function validProvider(id){return PROVIDERS.some(function(item){return item.id===id})}
function chat(index){
  return {id:uid(),title:'Chat '+index,providerId:shell.lastProviderId,accountId:shell.accountId,createdAt:now(),updatedAt:now(),messages:[]};
}
function active(){return shell.chats.find(function(item){return item.id===shell.activeChatId})||null}
function save(){
  if(!shell.project)return;
  localStorage.setItem(key(shell.project),JSON.stringify({
    version:VERSION,accountId:shell.accountId,lastProviderId:shell.lastProviderId,
    activeChatId:shell.activeChatId,chats:shell.chats
  }));
}
function load(project){
  shell={project:project,chats:[],activeChatId:null,accountId:'ordax',lastProviderId:'openai:gpt-4o'};
  try{
    var raw=JSON.parse(localStorage.getItem(key(project))||'null');
    if(raw&&raw.version===VERSION){
      shell.accountId=validAccount(raw.accountId)?raw.accountId:'ordax';
      shell.lastProviderId=validProvider(raw.lastProviderId)?raw.lastProviderId:'openai:gpt-4o';
      shell.chats=Array.isArray(raw.chats)?raw.chats.filter(function(item){return item&&item.id}).map(function(item,i){
        return {
          id:String(item.id),title:String(item.title||('Chat '+(i+1))).slice(0,80),
          providerId:validProvider(item.providerId)?item.providerId:'openai:gpt-4o',
          accountId:validAccount(item.accountId)?item.accountId:'ordax',
          createdAt:String(item.createdAt||now()),updatedAt:String(item.updatedAt||now()),
          messages:Array.isArray(item.messages)?item.messages.slice(-80):[]
        };
      }):[];
      shell.activeChatId=String(raw.activeChatId||'');
    }
  }catch(error){}
  if(!shell.chats.length)shell.chats=[chat(1)];
  if(!shell.chats.some(function(item){return item.id===shell.activeChatId}))shell.activeChatId=shell.chats[0].id;
  save();render();
}
function status(text){var node=byId('assistantStatus');if(node)node.textContent=text||'Assistente pronto'}
function renderAccounts(){
  var select=byId('assistantAccount');if(!select)return;
  select.innerHTML=ACCOUNTS.map(function(item){return '<option value="'+esc(item.id)+'">'+esc(item.label)+'</option>'}).join('');
  select.value=(active()&&active().accountId)||shell.accountId;
}
function renderProviders(){
  var select=byId('assistantProvider');if(!select)return;
  select.innerHTML=PROVIDERS.map(function(item){return '<option value="'+esc(item.id)+'">'+esc(item.model)+' · '+esc(item.provider)+'</option>'}).join('');
  var selected=(active()&&active().providerId)||shell.lastProviderId;
  select.value=selected;
  var badge=byId('assistantProviderBadge'),p=provider(selected);
  if(badge)badge.textContent=p.model+' · '+p.provider;
}
function renderTabs(){
  var root=byId('assistantChatTabs');if(!root)return;root.innerHTML='';
  shell.chats.forEach(function(item){
    var wrap=document.createElement('div');
    wrap.className='assistantChatTab'+(item.id===shell.activeChatId?' active':'');
    var label=document.createElement('button');
    label.type='button';label.className='assistantChatLabel';label.textContent=item.title;
    label.onclick=function(){shell.activeChatId=item.id;shell.accountId=item.accountId;shell.lastProviderId=item.providerId;save();render()};
    wrap.appendChild(label);
    if(shell.chats.length>1){
      var close=document.createElement('button');
      close.type='button';close.className='closeChat';close.title='Fechar chat';close.textContent='×';
      close.onclick=function(){closeChat(item.id)};
      wrap.appendChild(close);
    }
    root.appendChild(wrap);
  });
}
function runtimeSessionFor(providerId){
  var data=(typeof state!=='undefined'&&state.aiSessions)||null;
  var items=(data&&data.continuations)||[];
  var p=provider(providerId);
  return items.find(function(item){
    var session=(item&&item.session)||{};
    if(session.state==='completed'||session.state==='failed')return false;
    var text=((session.provider||'')+' '+(session.model||'')).toLowerCase();
    return text.indexOf(p.provider.toLowerCase())>=0||text.indexOf(p.model.toLowerCase())>=0;
  })||null;
}
function renderThread(){
  var root=byId('assistantThread');if(!root)return;
  var current=active();
  if(!current){root.innerHTML='<div class="assistantEmpty"><div class="assistantEmptyInner"><h3>Nenhum chat aberto</h3></div></div>';return}
  var p=provider(current.providerId),session=runtimeSessionFor(current.providerId);
  if(!current.messages.length&&!session){
    root.innerHTML='<div class="assistantEmpty"><div class="assistantEmptyInner"><h3>'+esc(current.title)+'</h3><p>'+esc(p.model)+' · '+esc(p.provider)+'</p><p style="margin-top:8px">Chats, conta e provedor sao persistidos por projeto. O host atual ainda nao expoe envio direto de mensagens nesta superficie; o Studio nao simula respostas.</p></div></div>';
    return;
  }
  var html=current.messages.map(function(message){
    var mine=message.role==='user',time=new Date(message.at||now()).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    return '<div class="assistantMessage '+(mine?'me':'')+'"><div class="assistantMessageBubble"><div class="assistantMessageMeta">'+(mine?'Voce':'ORDAX')+' · '+esc(time)+'</div>'+esc(message.text||'')+'</div></div>';
  }).join('');
  if(session)html+='<div class="assistantMessage"><div class="assistantMessageBubble"><div class="assistantMessageMeta">Sessao autorizada</div>'+esc(p.model)+' possui uma sessao ativa. Use <strong>Execucoes</strong> para acompanhar o estado.</div></div>';
  root.innerHTML=html;root.scrollTop=root.scrollHeight;
}
function updateSend(){
  var send=byId('assistantSend'),prompt=byId('assistantPrompt');if(!send)return;
  var enabled=typeof (window.ordaxStudioHost&&window.ordaxStudioHost.sendAssistantMessage)==='function';
  send.disabled=!enabled;
  send.title=enabled?'Enviar mensagem para a sessao autorizada':'O host atual ainda nao expoe envio direto para providers';
  if(prompt)prompt.title=send.title;
}
function render(){renderAccounts();renderProviders();renderTabs();renderThread();updateSend()}
function addChat(){
  var item=chat(shell.chats.length+1);shell.chats.push(item);shell.activeChatId=item.id;save();render();
  var prompt=byId('assistantPrompt');if(prompt)prompt.focus();
}
function closeChat(id){
  var index=shell.chats.findIndex(function(item){return item.id===id});if(index<0)return;
  shell.chats.splice(index,1);if(!shell.chats.length)shell.chats.push(chat(1));
  if(shell.activeChatId===id)shell.activeChatId=(shell.chats[Math.max(0,index-1)]||shell.chats[0]).id;
  save();render();
}
async function sendMessage(){
  var prompt=byId('assistantPrompt'),current=active();
  var method=window.ordaxStudioHost&&window.ordaxStudioHost.sendAssistantMessage;
  if(!prompt||!current||typeof method!=='function')return;
  var text=prompt.value.trim();if(!text)return;status('Enviando...');
  try{
    var result=await method({project:shell.project,chat_id:current.id,account_id:current.accountId,provider_id:current.providerId,text:text});
    if(!result||!result.ok)throw new Error((result&&result.summary)||'Falha ao enviar mensagem');
    current.messages.push({role:'user',text:text,at:now()});
    if(result.data&&result.data.reply)current.messages.push({role:'system',text:String(result.data.reply),at:now()});
    current.updatedAt=now();prompt.value='';save();renderThread();status('Assistente pronto');
  }catch(error){status(String(error))}
}
function bind(){
  var add=byId('assistantNewChat');if(add)add.onclick=addChat;
  var account=byId('assistantAccount');if(account)account.onchange=function(event){var current=active();if(!current)return;var value=String(event.target.value);if(!validAccount(value))return;current.accountId=value;shell.accountId=value;current.updatedAt=now();save();render()};
  var providers=byId('assistantProvider');if(providers)providers.onchange=function(event){var current=active();if(!current)return;var value=String(event.target.value);if(!validProvider(value))return;current.providerId=value;shell.lastProviderId=value;current.updatedAt=now();save();render()};
  var send=byId('assistantSend');if(send)send.onclick=sendMessage;
  var prompt=byId('assistantPrompt');if(prompt)prompt.onkeydown=function(event){if(event.key==='Enter'&&!event.shiftKey&&!byId('assistantSend').disabled){event.preventDefault();sendMessage()}};
  var context=byId('assistantContextButton');if(context)context.onclick=function(){if(window.switchView)window.switchView('overview')};
  var execute=byId('assistantExecuteButton');if(execute)execute.onclick=function(){if(window.switchView)window.switchView('sessions')};
  document.querySelectorAll('[data-system-action]').forEach(function(button){button.onclick=function(){
    var action=button.dataset.systemAction;
    if(action==='account'){var accountButton=document.getElementById('accountButton');if(accountButton)accountButton.click()}
    else if(action==='device'){if(window.switchView)window.switchView('computer')}
    else status('Configuracoes gerais permanecem no shell do produto.');
  }});
}
async function refreshSessions(){
  if(!shell.project||typeof loadAiSessions!=='function')return;
  try{await loadAiSessions();renderThread()}catch(error){}
}
function syncProject(){
  var project=(typeof state!=='undefined'&&state.project)||null;
  if(project&&project!==lastProject){lastProject=project;load(project);refreshSessions()}
  else if(!project&&lastProject){lastProject=null;shell.project=null}
}
window.ordaxIdeShell=Object.freeze({getState:function(){return JSON.parse(JSON.stringify(shell))},addChat:addChat,refresh:render});
bind();syncProject();
setInterval(syncProject,350);
setInterval(function(){if(shell.project)refreshSessions()},10000);
})();
