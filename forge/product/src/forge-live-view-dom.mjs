// Single native Forge View inspector and bounded DOM interaction.
// Executed only in Electron's isolated world. No user JS, paths, network,
// input values in results, preload or duplicate preview session.
export function inspectForgeLiveViewDom(command={mode:'inspect'}){
  const clean=value=>String(value??'').replace(/\s+/g,' ').trim().slice(0,100);
  const visible=element=>{
    const rect=element.getBoundingClientRect();
    const style=getComputedStyle(element);
    return rect.width>=4&&rect.height>=4&&style.display!=='none'&&
      style.visibility!=='hidden'&&Number(style.opacity)>0&&
      rect.bottom>0&&rect.right>0&&rect.top<innerHeight&&rect.left<innerWidth;
  };
  const hitTest=element=>{
    const rect=element.getBoundingClientRect();
    const left=Math.max(0,rect.left),right=Math.min(innerWidth,rect.right);
    const top=Math.max(0,rect.top),bottom=Math.min(innerHeight,rect.bottom);
    if(right<=left||bottom<=top)return false;
    const hit=document.elementFromPoint((left+right)/2,(top+bottom)/2);
    return Boolean(hit&&(hit===element||element.contains(hit)));
  };
  const editableField=element=>{
    if(element.tagName!=='TEXTAREA'&&
       (element.tagName!=='INPUT'||
        !['text','search','email','url','tel','number'].includes(element.type)))
      return false;
    // Reject password/OTP/payment fields even if the page mislabels the type.
    const hint=[element.autocomplete,element.name,element.id,
      element.getAttribute('aria-label'),element.getAttribute('placeholder')]
      .join(' ').toLowerCase();
    return !/(?:password|senha|secret|segredo|one-time-code|otp|token|cc-|cvv|cvc|2fa)/.test(hint);
  };
  if(location.origin!=='null')return {available:false,reason:'forge_live_view_origin_invalid'};
  const nodes=Array.from(document.querySelectorAll('button,[role="button"],input,textarea'))
    .filter(element=>visible(element)&&
      (element.tagName!=='INPUT'&&element.tagName!=='TEXTAREA'||editableField(element)))
    .slice(0,40);
  const controls=nodes.map((element,index)=>{
    const rect=element.getBoundingClientRect();
    const tag=element.tagName.toLowerCase();
    const type=clean(element.getAttribute('type')||'');
    const inForm=Boolean(element.closest('form'));
    const editable=editableField(element);
    const disabled=element.disabled===true||
      element.matches?.(':disabled')===true||
      element.getAttribute('aria-disabled')==='true'||
      Boolean(element.closest('[inert],[aria-disabled="true"]'));
    const readOnly=editable&&(element.readOnly===true||
      element.getAttribute('aria-readonly')==='true');
    const obscured=!hitTest(element);
    return {index,tag,type,
      label:clean(element.getAttribute('aria-label')||
        element.getAttribute('title')||
        element.labels?.[0]?.textContent||
        element.getAttribute('placeholder')||
        element.innerText||element.textContent),
      disabled,inForm,obscured,editable,readOnly,
      hasValue:editable?Boolean(element.value):false,
      interactable:!disabled&&!obscured&&!readOnly&&
        (editable||!inForm||type==='button'),
      rect:{x:Math.round(rect.x),y:Math.round(rect.y),
        width:Math.round(rect.width),height:Math.round(rect.height)}};
  });
  const headings=Array.from(document.querySelectorAll('h1,h2,h3')).filter(visible)
    .slice(0,12).map(element=>({
      level:element.tagName.toLowerCase(),text:clean(element.innerText||element.textContent)
    }));
  const state={schema:'ordax.forge.live-view-dom/1',title:clean(document.title),
    viewport:{width:innerWidth,height:innerHeight},headings,controls,
    truncated:controls.length===40,inputValuesIncluded:false};
  if(command?.mode==='inspect'||command?.mode===undefined)return {available:true,state};
  const index=command.index,expectedLabel=command.expectedLabel;
  const selected=Number.isInteger(index)&&index>=0&&index<nodes.length?controls[index]:null;
  if(!selected||selected.label!==expectedLabel||!selected.interactable)
    return {applied:false,reason:'forge_view_live_stale'};
  if(command.mode==='verify_fill'){
    if(!selected.editable||typeof command.value!=='string')
      return {applied:false,reason:'forge_view_live_stale'};
    return {applied:false,valueVerified:nodes[index].value===command.value};
  }
  if(JSON.stringify(state)!==JSON.stringify(command.expectedState))
    return {applied:false,reason:'forge_view_live_stale'};
  if(command.mode==='click'){
    if(selected.editable)return {applied:false,reason:'forge_view_live_stale'};
    nodes[index].click();
    return {applied:true};
  }
  if(command.mode==='fill'){
    if(!selected.editable||typeof command.value!=='string'||command.value.length>500)
      return {applied:false,reason:'forge_view_live_stale'};
    const element=nodes[index];
    const descriptor=Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element),'value');
    if(typeof descriptor?.set==='function')descriptor.set.call(element,command.value);
    else element.value=command.value;
    element.dispatchEvent(new Event('input',{bubbles:true}));
    element.dispatchEvent(new Event('change',{bubbles:true}));
    return {applied:true,valueAccepted:element.value===command.value};
  }
  return {applied:false,reason:'forge_view_live_mode_invalid'};
}
