// Canonical Forge app-shell DOM inspector executed inside the EXISTING Electron
// renderer's isolated world. No new window, preload, service or shadow DOM.
// The MCP only supplies a bounded action and an exact prior revision; it cannot
// supply JavaScript, CSS selectors, IPC channels or a path to navigate.
export function inspectForgeAppUiDom(command={mode:'inspect'}){
  const clean=value=>String(value??'').replace(/\s+/g,' ').trim().slice(0,120);
  const rectOf=element=>element.getBoundingClientRect();
  const visible=element=>{
    const rect=rectOf(element),style=getComputedStyle(element);
    return rect.width>=3&&rect.height>=3&&style.display!=='none'&&
      style.visibility!=='hidden'&&Number(style.opacity)>0&&
      rect.bottom>0&&rect.right>0&&rect.top<innerHeight&&rect.left<innerWidth&&
      !element.closest('[hidden],[inert],[aria-hidden="true"]');
  };
  const nativeOverlays=Array.isArray(command.nativeOverlays)?
    command.nativeOverlays.slice(0,12):[];
  const hitTest=element=>{
    const r=rectOf(element),left=Math.max(0,r.left),top=Math.max(0,r.top),
      right=Math.min(innerWidth,r.right),bottom=Math.min(innerHeight,r.bottom);
    if(right<=left||bottom<=top)return false;
    const x=(left+right)/2,y=(top+bottom)/2;
    const scale=Number(command.zoomFactor)||1;
    if(nativeOverlays.some(o=>o&&x*scale>=o.x&&y*scale>=o.y&&
       x*scale<o.x+o.width&&y*scale<o.y+o.height))return false;
    const hit=document.elementFromPoint(x,y);
    return Boolean(hit&&(hit===element||element.contains(hit)));
  };
  const sensitive=element=>{
    const hint=[element.type,element.name,element.id,element.autocomplete,
      element.getAttribute('aria-label'),element.getAttribute('placeholder')]
      .join(' ').toLowerCase();
    return /(?:pass(?:word)?|senha|secret|segredo|one-time|otp|token|api.?key|credential|credit|card.?number|cc-|cvv|cvc|2fa|pin.?code)/.test(hint);
  };
  const canEdit=element=>{
    if(element.tagName==='TEXTAREA')return !sensitive(element);
    if(element.tagName==='SELECT')return !sensitive(element);
    return element.tagName==='INPUT'&&
      ['text','search','email','url','tel','number'].includes(element.type)&&
      !sensitive(element);
  };
  const controlsRaw=Array.from(document.querySelectorAll(
    'button,a[href],summary,[role="button"],[role="tab"],[role="menuitem"],input,textarea,select'))
    .filter(element=>visible(element)&&
      (element.tagName!=='INPUT'&&element.tagName!=='TEXTAREA'&&
       element.tagName!=='SELECT'||canEdit(element))).slice(0,120);
  const controls=controlsRaw.map((element,index)=>{
    const r=rectOf(element),tag=element.tagName.toLowerCase();
    const editable=canEdit(element),disabled=element.disabled===true||
      element.matches?.(':disabled')===true||
      element.getAttribute('aria-disabled')==='true'||
      Boolean(element.closest('[aria-disabled="true"],[inert]'));
    const readOnly=editable&&(element.readOnly===true||
      element.getAttribute('aria-readonly')==='true');
    const obscured=!hitTest(element);
    const label=clean(element.getAttribute('aria-label')||
      element.getAttribute('title')||element.labels?.[0]?.textContent||
      element.getAttribute('placeholder')||
      element.innerText||element.textContent||element.id||tag);
    const type=clean(element.getAttribute('type')||element.getAttribute('role')||'');
    return {index,id:clean(element.id),tag,type,label,editable,disabled,readOnly,
      obscured,interactable:!disabled&&!readOnly&&!obscured,
      hasValue:editable?Boolean(element.value):false,
      ...(tag==='select'?{options:Array.from(element.options).slice(0,32).map(o=>({
        value:clean(o.value),label:clean(o.textContent)}))}:{}),
      pressed:element.getAttribute('aria-pressed')==='true',
      selected:element.getAttribute('aria-selected')==='true',
      expanded:element.getAttribute('aria-expanded')==='true',
      rect:{x:Math.round(r.left),y:Math.round(r.top),
        width:Math.round(r.width),height:Math.round(r.height)}};
  });
  const scrollRaw=[document.scrollingElement,
    ...document.querySelectorAll('main,section,aside,nav,div,[role="region"]')]
    .filter(Boolean).filter((el,i,list)=>list.indexOf(el)===i)
    .filter(el=>(el===document.scrollingElement||visible(el))&&
      el.scrollHeight>el.clientHeight+8).slice(0,24);
  const scrollable=scrollRaw.map((el,index)=>({
    index,id:clean(el.id),label:clean(el.getAttribute('aria-label')||
      el.getAttribute('role')||el.id||el.tagName),
    top:Math.round(el.scrollTop),height:Math.round(el.clientHeight),
    totalHeight:Math.round(el.scrollHeight)
  }));
  const headings=Array.from(document.querySelectorAll('h1,h2,h3,[role="dialog"]'))
    .filter(visible).slice(0,24)
    .map(el=>({tag:el.tagName.toLowerCase(),
      text:clean(el.getAttribute('aria-label')||el.innerText||el.textContent)}));
  const state={schema:'ordax.forge.app-ui-dom/1',
    title:clean(document.title),viewport:{width:innerWidth,height:innerHeight},
    headings,controls,scrollable,truncated:controls.length===120,
    inputValuesIncluded:false,source:'active_forge_renderer'};
  if(!command.mode||command.mode==='inspect')return {available:true,state};
  if(command.mode==='scroll'){
    const index=command.scrollIndex,deltaY=command.deltaY;
    if(JSON.stringify(state)!==JSON.stringify(command.expectedState)||
       !Number.isInteger(index)||index<0||index>=scrollRaw.length||
       !Number.isInteger(deltaY)||Math.abs(deltaY)>1200)
      return {applied:false,reason:'forge_app_ui_stale'};
    scrollRaw[index].scrollTop+=deltaY;
    return {applied:true};
  }
  const index=command.controlIndex;
  const control=Number.isInteger(index)&&index>=0&&index<controls.length?
    controls[index]:null;
  if(!control||!control.interactable||
     control.label!==command.expectedLabel)
    return {applied:false,reason:'forge_app_ui_stale'};
  if(command.mode==='verify_fill'){
    if(!control.editable||typeof command.value!=='string')
      return {applied:false,reason:'forge_app_ui_stale'};
    return {applied:false,valueVerified:controlsRaw[index].value===command.value};
  }
  if(JSON.stringify(state)!==JSON.stringify(command.expectedState))
    return {applied:false,reason:'forge_app_ui_stale'};
  if(command.mode==='click'){
    if(control.editable)return {applied:false,reason:'forge_app_ui_stale'};
    controlsRaw[index].click();
    return {applied:true};
  }
  if(command.mode==='fill'){
    if(!control.editable||typeof command.value!=='string'||
       command.value.length>2000)
      return {applied:false,reason:'forge_app_ui_stale'};
    const element=controlsRaw[index];
    if(element.tagName==='SELECT'&&
       !Array.from(element.options).some(option=>option.value===command.value))
      return {applied:false,reason:'forge_app_ui_stale'};
    let proto=Object.getPrototypeOf(element),setter=null;
    while(proto&&!setter){
      setter=Object.getOwnPropertyDescriptor(proto,'value')?.set??null;
      proto=Object.getPrototypeOf(proto);
    }
    if(setter)setter.call(element,command.value);else element.value=command.value;
    element.dispatchEvent(new Event('input',{bubbles:true}));
    element.dispatchEvent(new Event('change',{bubbles:true}));
    return {applied:true,valueAccepted:element.value===command.value};
  }
  return {applied:false,reason:'forge_app_ui_mode_invalid'};
}
