(function(){
'use strict';

var DEFAULTS=Object.freeze({sidebar:278,assistant:540});
var LIMITS=Object.freeze({
  sidebar:{min:190,max:420},
  assistant:{min:360,max:860},
  workspaceMin:520
});
var currentProject='';
var prefs={sidebar:DEFAULTS.sidebar,assistant:DEFAULTS.assistant};
var dragging=null;

function shellProject(){
  try{
    var shell=window.ordaxIdeShell&&window.ordaxIdeShell.getState?window.ordaxIdeShell.getState():null;
    return shell&&shell.project?String(shell.project):'';
  }catch(_error){return''}
}
function storageKey(project){return 'ordax-studio:'+(project||'global')+':ide-layout-v1'}
function number(value,fallback){var parsed=Number(value);return Number.isFinite(parsed)?parsed:fallback}
function clamp(value,min,max){return Math.max(min,Math.min(max,value))}
function normalize(value){
  value=value&&typeof value==='object'?value:{};
  return{
    sidebar:clamp(number(value.sidebar,DEFAULTS.sidebar),LIMITS.sidebar.min,LIMITS.sidebar.max),
    assistant:clamp(number(value.assistant,DEFAULTS.assistant),LIMITS.assistant.min,LIMITS.assistant.max)
  };
}
function load(project){
  var raw=null;
  try{raw=localStorage.getItem(storageKey(project))}catch(_error){}
  if(!raw)return normalize(DEFAULTS);
  try{return normalize(JSON.parse(raw))}catch(_error){return normalize(DEFAULTS)}
}
function save(){
  if(!currentProject)return;
  try{localStorage.setItem(storageKey(currentProject),JSON.stringify(prefs))}catch(_error){}
}
function availableAssistantMax(){
  var grid=document.querySelector('.ideWorkGrid');
  if(!grid)return LIMITS.assistant.max;
  var total=grid.getBoundingClientRect().width;
  return Math.max(LIMITS.assistant.min,Math.min(LIMITS.assistant.max,total-prefs.sidebar-LIMITS.workspaceMin-12));
}
function apply(){
  var grid=document.querySelector('.ideWorkGrid');if(!grid)return;
  prefs.sidebar=clamp(prefs.sidebar,LIMITS.sidebar.min,LIMITS.sidebar.max);
  prefs.assistant=clamp(prefs.assistant,LIMITS.assistant.min,availableAssistantMax());
  grid.style.setProperty('--ide-sidebar-width',Math.round(prefs.sidebar)+'px');
  grid.style.setProperty('--ide-assistant-width',Math.round(prefs.assistant)+'px');
  grid.dataset.layoutProject=currentProject||'';
}
function reset(){
  prefs=normalize(DEFAULTS);apply();save();
}
function setWidth(kind,value){
  if(kind==='sidebar')prefs.sidebar=clamp(value,LIMITS.sidebar.min,LIMITS.sidebar.max);
  if(kind==='assistant')prefs.assistant=clamp(value,LIMITS.assistant.min,availableAssistantMax());
  apply();
}
function begin(event,kind){
  if(event.button!==0)return;
  event.preventDefault();
  var handle=event.currentTarget;
  dragging={
    kind:kind,
    startX:event.clientX,
    startSidebar:prefs.sidebar,
    startAssistant:prefs.assistant,
    pointerId:event.pointerId,
    handle:handle
  };
  handle.setPointerCapture?.(event.pointerId);
  document.body.classList.add('ideResizing');
}
function move(event){
  if(!dragging)return;
  var delta=event.clientX-dragging.startX;
  if(dragging.kind==='sidebar')setWidth('sidebar',dragging.startSidebar+delta);
  else setWidth('assistant',dragging.startAssistant+delta);
}
function end(event){
  if(!dragging)return;
  try{dragging.handle.releasePointerCapture?.(dragging.pointerId)}catch(_error){}
  dragging=null;
  document.body.classList.remove('ideResizing');
  save();
}
function nudge(event,kind){
  if(!['ArrowLeft','ArrowRight','Home'].includes(event.key))return;
  event.preventDefault();
  if(event.key==='Home'){
    setWidth(kind,DEFAULTS[kind]);save();return;
  }
  var delta=event.key==='ArrowLeft'?-16:16;
  setWidth(kind,prefs[kind]+delta);save();
}
function bindHandle(id,kind){
  var handle=document.getElementById(id);if(!handle)return;
  handle.addEventListener('pointerdown',function(event){begin(event,kind)});
  handle.addEventListener('keydown',function(event){nudge(event,kind)});
  handle.addEventListener('dblclick',function(){setWidth(kind,DEFAULTS[kind]);save()});
}
function syncProject(force){
  var project=shellProject();
  if(!force&&project===currentProject)return;
  currentProject=project;
  prefs=load(project);
  apply();
}
function bind(){
  bindHandle('sidebarResizeHandle','sidebar');
  bindHandle('assistantResizeHandle','assistant');
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',end);
  window.addEventListener('pointercancel',end);
  window.addEventListener('resize',apply);
  document.addEventListener('keydown',function(event){
    if((event.ctrlKey||event.metaKey)&&event.altKey&&event.key==='0'){
      event.preventDefault();reset();
    }
  });
  syncProject(true);
  setInterval(function(){syncProject(false)},350);
}
window.ordaxIdeLayout=Object.freeze({
  getState:function(){return{project:currentProject,sidebar:prefs.sidebar,assistant:prefs.assistant}},
  reset:reset,
  refresh:function(){syncProject(true)}
});
bind();
})();