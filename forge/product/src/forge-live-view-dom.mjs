// Canonical DOM inspection and button action shared by the native Forge View.
// Evaluated in Electron's isolated world. No user-provided JavaScript,
// selectors, network calls, input values or filesystem access.
export function inspectForgeLiveViewDom(command={mode:'inspect'}){
  const clean=value=>String(value??'').replace(/\s+/g,' ').trim().slice(0,100);
  const visible=element=>{
    const rect=element.getBoundingClientRect();
    const style=getComputedStyle(element);
    return rect.width>=4&&rect.height>=4&&style.display!=='none'&&
      style.visibility!=='hidden'&&Number(style.opacity)>0&&
      rect.bottom>0&&rect.right>0&&rect.top<innerHeight&&rect.left<innerWidth;
  };
  // A DOM click can bypass modal overlays and pointer-events:none.
  // Verify the actual hit target at the center of the visible intersection
  // before treating a button as interactable.
  const hitTest=element=>{
    const rect=element.getBoundingClientRect();
    const left=Math.max(0,rect.left),right=Math.min(innerWidth,rect.right);
    const top=Math.max(0,rect.top),bottom=Math.min(innerHeight,rect.bottom);
    if(right<=left||bottom<=top)return false;
    const hit=document.elementFromPoint((left+right)/2,(top+bottom)/2);
    return Boolean(hit&&(hit===element||element.contains(hit)));
  };
  if(location.origin!=='null')return {available:false,reason:'forge_live_view_origin_invalid'};
  const nodes=Array.from(document.querySelectorAll('button,[role="button"]'))
    .filter(visible).slice(0,40);
  const controls=nodes.map((element,index)=>{
    const rect=element.getBoundingClientRect();
    const tag=element.tagName.toLowerCase();
    const type=clean(element.getAttribute('type')||'');
    const inForm=Boolean(element.closest('form'));
    const disabled=element.disabled===true||
      element.getAttribute('aria-disabled')==='true';
    const obscured=!hitTest(element);
    return {index,tag,type,
      label:clean(element.getAttribute('aria-label')||
        element.getAttribute('title')||element.innerText||element.textContent),
      disabled,inForm,obscured,
      interactable:!disabled&&!obscured&&(!inForm||type==='button'),
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
  if(command?.mode!=='click')return {available:true,state};
  const index=command.index,expectedLabel=command.expectedLabel;
  const selected=Number.isInteger(index)&&index>=0&&index<nodes.length?controls[index]:null;
  if(!selected||selected.label!==expectedLabel||!selected.interactable||
     JSON.stringify(state)!==JSON.stringify(command.expectedState))
    return {applied:false,reason:'forge_view_live_stale'};
  // This is the already-open, network-denied native View. It is not a
  // disposable test or a publish/deploy operation.
  nodes[index].click();
  return {applied:true};
}
