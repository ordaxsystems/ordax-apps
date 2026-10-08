(function(){
'use strict';

var mode='web';
var lastPayload='';

function transportStatus(message,state){
  var target=byId('assistantWebStatus');
  if(target)target.textContent=message;
  var fallback=byId('assistantWebFallback');
  if(fallback)fallback.dataset.transport=state;
}

function byId(id){return document.getElementById(id)}
function surfaceHost(){
  var host=window.ordaxStudioHost;
  return host&&typeof host.presentAssistantSurface==='function'?host.presentAssistantSurface.bind(host):null;
}
function post(payload){
  var serialized=JSON.stringify(payload);
  if(serialized===lastPayload)return true;
  var present=surfaceHost();
  if(!present){
    lastPayload='';
    if(payload.active)transportStatus('Este host não oferece o navegador Web integrado. Use IA local / API ou atualize o Runtime.','unavailable');
    return false;
  }
  try{
    // The host acknowledges transport only; it does not certify remote login or browser readiness.
    if(present(payload)!==true){
      lastPayload='';
      if(payload.active)transportStatus('O host recusou a superfície Web. Confira a compatibilidade do Runtime.','unavailable');
      return false;
    }
    lastPayload=serialized;
    if(payload.active)transportStatus('Solicitação entregue ao host. A sessão depende do navegador nativo.','pending');
    return true;
  }catch(_error){
    // Do not expose native exception details, which may contain host/environment information.
    lastPayload='';
    if(payload.active)transportStatus('Falha ao comunicar com o navegador Web nativo.','unavailable');
    return false;
  }
}
function usableRect(node){
  if(!node||mode!=='web'||document.hidden)return null;
  var rect=node.getBoundingClientRect();
  var viewportWidth=Number(window.innerWidth),viewportHeight=Number(window.innerHeight);
  if(!Number.isFinite(viewportWidth)||!Number.isFinite(viewportHeight)||viewportWidth<2||viewportHeight<2)return null;
  if(![rect.left,rect.top,rect.right,rect.bottom].every(Number.isFinite))return null;
  var style=window.getComputedStyle(node);
  if(style.display==='none'||style.visibility==='hidden')return null;
  // The native surface must never cover panels outside the visible assistant slot.
  var left=Math.max(0,rect.left),top=Math.max(0,rect.top);
  var width=Math.min(viewportWidth,rect.right)-left;
  var height=Math.min(viewportHeight,rect.bottom)-top;
  if(width<2||height<2)return null;
  return {left:left,top:top,width:width,height:height};
}
function publish(){
  var slot=byId('assistantWebSlot');
  var rect=usableRect(slot);
  if(!rect){
    post({type:'ordax-assistant-surface',active:false});
    return;
  }
  post({
    type:'ordax-assistant-surface',
    active:true,
    rect:{left:rect.left,top:rect.top,width:rect.width,height:rect.height},
    viewport:{width:window.innerWidth,height:window.innerHeight}
  });
}
function apply(next){
  mode=next==='local'?'local':'web';
  var webButton=byId('assistantWebMode'),localButton=byId('assistantLocalMode');
  var webSlot=byId('assistantWebSlot'),localPanel=byId('localAssistantPanel');
  var isWeb=mode==='web';
  if(webButton){webButton.classList.toggle('active',isWeb);webButton.setAttribute('aria-selected',String(isWeb))}
  if(localButton){localButton.classList.toggle('active',!isWeb);localButton.setAttribute('aria-selected',String(!isWeb))}
  if(webSlot)webSlot.classList.toggle('hidden',!isWeb);
  if(localPanel)localPanel.classList.toggle('hidden',isWeb);
  if(!isWeb)post({type:'ordax-assistant-surface',active:false});
  requestAnimationFrame(publish);
}
function bind(){
  var webButton=byId('assistantWebMode'),localButton=byId('assistantLocalMode'),slot=byId('assistantWebSlot');
  if(webButton)webButton.addEventListener('click',function(){apply('web')});
  if(localButton)localButton.addEventListener('click',function(){apply('local')});
  if(slot&&window.ResizeObserver)new ResizeObserver(function(){requestAnimationFrame(publish)}).observe(slot);
  window.addEventListener('resize',function(){requestAnimationFrame(publish)});
  window.addEventListener('scroll',function(){requestAnimationFrame(publish)},true);
  document.addEventListener('visibilitychange',publish);
  window.addEventListener('beforeunload',function(){post({type:'ordax-assistant-surface',active:false})});
  new MutationObserver(function(){requestAnimationFrame(publish)}).observe(document.body,{attributes:true,attributeFilter:['class'],subtree:true});
  apply('web');
}
window.ordaxAssistantSurface=Object.freeze({
  setMode:apply,
  refresh:function(){lastPayload='';publish()},
  getMode:function(){return mode}
});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();