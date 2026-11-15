import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectForgeAppUiDom} from '../src/forge-app-ui-dom.mjs';

function withAppDom(run) {
  let clicked=0,underOverlay=false;
  const events=[];
  const rect=(y,width=220)=>({
    x:15,y,left:15,top:y,right:15+width,bottom:y+32,width,height:32
  });
  const element=(tag,id,y,label,{type='button',name='',value=''}={})=>{
    const attrs={id,'aria-label':label,placeholder:label,type};
    const node={tagName:tag,id,name,type,autocomplete:'off',value,
      innerText:label,textContent:label,disabled:false,readOnly:false,
      scrollHeight:32,clientHeight:32,scrollTop:0,
      getBoundingClientRect:()=>rect(y),
      getAttribute:key=>attrs[key]??null,
      matches:()=>false,closest:()=>null,contains:hit=>hit===node,
      dispatchEvent:event=>{events.push(event.type);return true;},
      click:()=>{clicked++;doc.title='Projetos abertos';attrs['aria-pressed']='true';}};
    return node;
  };
  const button=element('BUTTON','quickNewProject',12,'Novo projeto');
  const field=element('INPUT','projectName',65,'Nome do projeto',{type:'text'});
  const privateInput=element('INPUT','secretField',108,'Token de acesso',
    {type:'text',name:'api_key',value:'nao-expor-123'});
  const prompt=element('TEXTAREA','coordinatorPrompt',153,'Mensagem');
  const select=element('SELECT','filter',197,'Filtro');
  select.options=[{value:'all',textContent:'Todos'},{value:'active',textContent:'Ativos'}];
  select.value='all';
  const scroller=element('DIV','navigationRail',0,'Navegação');
  scroller.scrollHeight=1200;scroller.clientHeight=300;
  const heading=element('H1','title',0,'Meus projetos');
  const controls=[button,field,privateInput,prompt,select];
  const doc={title:'Forge',scrollingElement:scroller,
    querySelectorAll:selector=>selector.startsWith('button,')?controls:
      selector.startsWith('main,')?[scroller]:
      selector.startsWith('h1,')?[heading]:[],
    elementFromPoint:(_x,y)=>{
      if(underOverlay)return heading;
      return controls.find(c=>{
        const r=c.getBoundingClientRect();
        return y>=r.top&&y<r.bottom;
      })||null;
    }};
  const globals={document:doc,location:{origin:'file:'},
    getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),
    innerWidth:640,innerHeight:460};
  const original=Object.fromEntries(Object.keys(globals).map(key=>
    [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  try{
    for(const [key,value] of Object.entries(globals))
      Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
    return run({button,field,privateInput,prompt,select,scroller,doc,events,
      get clicked(){return clicked;},setOverlay:x=>{underOverlay=x;}});
  }finally{
    for(const [key,descriptor] of Object.entries(original)){
      if(descriptor)Object.defineProperty(globalThis,key,descriptor);
      else delete globalThis[key];
    }
  }
}

test('real app UI inspector exposes bounded accessible controls but never secret field values',()=>{
  withAppDom(f=>{
    const observed=inspectForgeAppUiDom();
    assert.equal(observed.available,true);
    assert.equal(observed.state.source,'active_forge_renderer');
    assert.deepEqual(observed.state.controls.map(x=>x.id),
      ['quickNewProject','projectName','coordinatorPrompt','filter']);
    assert.equal(observed.state.inputValuesIncluded,false);
    assert.equal(observed.state.controls[1].editable,true);
    assert.equal(observed.state.controls[1].hasValue,false);
    assert.deepEqual(observed.state.controls[3].options,[
      {value:'all',label:'Todos'},{value:'active',label:'Ativos'}]);
    assert.doesNotMatch(JSON.stringify(observed),/nao-expor-123|secretField/);
    assert.equal(observed.state.scrollable[0].id,'navigationRail');
  });
});

test('real app UI navigation clicks the actual button and rejects stale or occluded actions',()=>{
  withAppDom(f=>{
    const before=inspectForgeAppUiDom();
    const command={mode:'click',controlIndex:0,
      expectedLabel:'Novo projeto',expectedState:before.state};
    assert.deepEqual(inspectForgeAppUiDom(command),{applied:true});
    assert.equal(f.clicked,1);
    assert.equal(f.doc.title,'Projetos abertos');
    assert.deepEqual(inspectForgeAppUiDom(command),
      {applied:false,reason:'forge_app_ui_stale'});
    f.setOverlay(true);
    const blocked=inspectForgeAppUiDom();
    assert.equal(blocked.state.controls[0].obscured,true);
    assert.equal(inspectForgeAppUiDom({...command,expectedState:blocked.state}).applied,false);
    assert.equal(f.clicked,1);
    f.setOverlay(false);
    const native=inspectForgeAppUiDom({mode:'inspect',
      nativeOverlays:[{x:0,y:0,width:300,height:60}],zoomFactor:1});
    assert.equal(native.state.controls[0].interactable,false);
  });
});

test('native app text input preserves spacing, blocks sensitive fields and never echoes values',()=>{
  withAppDom(f=>{
    const before=inspectForgeAppUiDom();
    const payload={mode:'fill',expectedState:before.state,
      controlIndex:1,expectedLabel:'Nome do projeto',value:'  Site E2E  '};
    assert.deepEqual(inspectForgeAppUiDom(payload),
      {applied:true,valueAccepted:true});
    assert.equal(f.field.value,'  Site E2E  ');
    assert.deepEqual(f.events,['input','change']);
    const after=inspectForgeAppUiDom();
    assert.equal(after.state.controls[1].hasValue,true);
    assert.doesNotMatch(JSON.stringify(after),/Site E2E/);
    assert.equal(inspectForgeAppUiDom({mode:'verify_fill',
      controlIndex:1,expectedLabel:'Nome do projeto',value:'  Site E2E  '}).valueVerified,true);
    assert.equal(inspectForgeAppUiDom({...payload,value:'outro'}).applied,false);
    assert.equal(f.field.value,'  Site E2E  ');
    const next=inspectForgeAppUiDom();
    assert.deepEqual(inspectForgeAppUiDom({mode:'fill',expectedState:next.state,
      controlIndex:3,expectedLabel:'Filtro',value:'active'}),
      {applied:true,valueAccepted:true});
    assert.equal(f.select.value,'active');
    assert.equal(inspectForgeAppUiDom({mode:'fill',expectedState:inspectForgeAppUiDom().state,
      controlIndex:3,expectedLabel:'Filtro',value:'unknown'}).applied,false);
  });
});

test('native app pane scrolling has an exact state precondition',()=>{
  withAppDom(f=>{
    const first=inspectForgeAppUiDom();
    const command={mode:'scroll',scrollIndex:0,deltaY:240,
      expectedState:first.state};
    assert.deepEqual(inspectForgeAppUiDom(command),{applied:true});
    assert.equal(f.scroller.scrollTop,240);
    assert.equal(inspectForgeAppUiDom(command).applied,false);
    assert.equal(inspectForgeAppUiDom({mode:'scroll',
      scrollIndex:0,deltaY:1201,expectedState:inspectForgeAppUiDom().state}).applied,false);
  });
});
