(function(){
'use strict';

var mode='web';
var lastPayload='';

function byId(id){return document.getElementById(id)}
function webview(){return window.chrome&&window.chrome.webview&&typeof window.chrome.webview.postMessage==='function'?window.chrome.webview:null}
function post(payload){
  var bridge=webview();
  if(!bridge)return;
  var serialized=JSON.stringify(payload);
  if(serialized===lastPayload)return;
  lastPayload=serialized;
  bridge.postMessage(payload);
}
function usableRect(node){
  if(!node||mode!=='web'||document.hidden)return null;
  var rect=node.getBoundingClientRect();
  if(rect.width<2||rect.height<2)return null;
  var style=window.getComputedStyle(node);
  if(style.display==='none'||style.visibility==='hidden')return null;
  return rect;
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
    provider:'chatgpt',
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