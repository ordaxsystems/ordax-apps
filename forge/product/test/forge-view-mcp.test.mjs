import test from 'node:test';
import assert from 'node:assert/strict';
import {ORCHESTRATOR_TOOLS,validateOrchestratorInput} from '../src/forge-contract.mjs';
import {inspectForgeLiveViewDom} from '../src/forge-live-view-dom.mjs';
import {createOrchestratorMcp} from '../src/orchestrator-mcp.mjs';
import {FORGE_APP_MCP_OPERATIONS} from '../src/forge-loopback-mcp.mjs';

const imageData=Buffer.from('test-jpeg-bytes').toString('base64');
const project='project_VisualTest';

test('one canonical tool catalog publishes bounded app and scoped preview views',()=>{
  const tools=new Map(ORCHESTRATOR_TOOLS.map(tool=>[tool.name,tool]));
  for(const name of ['forge_app_view_status','forge_app_view_capture','forge_project_view_capture','forge_project_view_probe','forge_project_view_live_inspect']){
    assert.equal(tools.get(name)?.readOnly,true);
    assert.equal(FORGE_APP_MCP_OPERATIONS.includes(name.slice(6)),true);
  }
  assert.deepEqual(tools.get('forge_project_view_capture').inputSchema.required,['projectId','target']);
  assert.deepEqual(tools.get('forge_project_view_probe').inputSchema.required,
    ['projectId','target','expectedSha256','controlIndex','expectedLabel']);
  const live=tools.get('forge_project_view_live_click');
  assert.equal(live.readOnly,false);
  assert.ok(FORGE_APP_MCP_OPERATIONS.includes('project_view_live_click'));
  assert.deepEqual(live.inputSchema.required,['requestId','projectId','taskId','assetId',
    'expectedRevision','controlIndex','expectedLabel']);
  const fill=tools.get('forge_project_view_live_fill');
  assert.equal(fill.readOnly,false);
  assert.equal(FORGE_APP_MCP_OPERATIONS.includes('project_view_live_fill'),true);
  assert.deepEqual(fill.inputSchema.required,['requestId','projectId','taskId','assetId',
    'expectedRevision','controlIndex','expectedLabel','value']);
});

test('Forge MCP returns real image content once, without duplicating base64 in structured metadata',async()=>{
  const calls=[];
  const service={
    invoke:async(_context,operation,args)=>{
      calls.push({operation,args});
      if(operation==='status')return {ok:true};
      if(operation==='app_view_status')return {minimized:true,available:true};
      if(['project_view_capture','project_view_probe'].includes(operation))return {
        schema:'ordax.forge.view-capture/1',source:'verified_project_html',
        identity:{projectId:project,sha256:'a'.repeat(64)},
        image:{mimeType:'image/jpeg',data:imageData,width:900,height:500,sha256:'b'.repeat(64)}
      };
      throw Error('unexpected');
    },
    requireAccess:()=>{}
  };
  const mcp=createOrchestratorMcp({service,getContext:()=>({actorId:'owner'}),allowedProjectId:project});
  const init=await mcp.handle({jsonrpc:'2.0',id:1,method:'initialize',
    params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}});
  assert.ok(init.result);
  await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const tools=await mcp.handle({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
  const view=tools.result.tools.find(tool=>tool.name==='forge_project_view_capture');
  assert.ok(view);
  assert.equal(Object.hasOwn(view.inputSchema.properties,'projectId'),false);
  const result=await mcp.handle({jsonrpc:'2.0',id:3,method:'tools/call',
    params:{name:'forge_project_view_capture',arguments:{target:'project_index'}}});
  assert.equal(result.result.content[0].type,'image');
  assert.equal(result.result.content[0].mimeType,'image/jpeg');
  assert.equal(result.result.content[0].data,imageData);
  assert.equal(result.result.structuredContent.image.data,undefined);
  assert.equal(result.result.structuredContent.identity.projectId,project);
  assert.equal(calls.at(-1).args.projectId,project);
  const denied=await mcp.handle({jsonrpc:'2.0',id:4,method:'tools/call',
    params:{name:'forge_project_view_capture',arguments:{projectId:'project_Another',target:'project_index'}}});
  assert.equal(denied.error.code,-32602);
  const preview=await mcp.handle({jsonrpc:'2.0',id:5,method:'tools/call',params:{
    name:'forge_project_view_probe',arguments:{target:'project_index',
      expectedSha256:'a'.repeat(64),controlIndex:0,expectedLabel:'Publicar'}
  }});
  assert.equal(preview.result.content[0].type,'image');
  assert.equal(calls.at(-1).operation,'project_view_probe');
  assert.equal(calls.at(-1).args.projectId,project);
  const deniedProbe=await mcp.handle({jsonrpc:'2.0',id:6,method:'tools/call',params:{
    name:'forge_project_view_probe',arguments:{projectId:'project_Another',
      target:'project_index',expectedSha256:'a'.repeat(64),controlIndex:0,expectedLabel:'Publicar'}
  }});
  assert.equal(deniedProbe.error.code,-32602);
});

test('MCP reports a bounded recovery route for occluded app pixels without leaking errors',async()=>{
  let failure='forge_app_view_renderer_occluded';
  const service={
    requireAccess:()=>{},
    invoke:async(_context,operation)=>{
      if(operation==='status')return {ok:true};
      if(operation==='app_view_capture')throw Error(failure);
      return {available:true};
    }
  };
  const mcp=createOrchestratorMcp({service,getContext:()=>({actorId:'owner'})});
  await mcp.handle({jsonrpc:'2.0',id:10,method:'initialize',
    params:{protocolVersion:'2025-11-25',capabilities:{},
      clientInfo:{name:'view-test',version:'1'}}});
  await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const call=()=>mcp.handle({jsonrpc:'2.0',id:11,method:'tools/call',
    params:{name:'forge_app_view_capture',arguments:{}}});
  const occluded=await call();
  assert.equal(occluded.result.isError,true);
  assert.equal(occluded.result.structuredContent.schema,'ordax.forge.capture-error/1');
  assert.equal(occluded.result.structuredContent.reason,'forge_app_view_renderer_occluded');
  assert.equal(occluded.result.structuredContent.effectDispatched,false);
  assert.match(occluded.result.structuredContent.recovery,/forge_project_view_capture/);
  assert.match(occluded.result.structuredContent.recovery,/forge_project_view_live_inspect/);
  assert.equal(occluded.result.content.some(x=>x.type==='image'),false);

  failure='forge_app_view_capture_timeout';
  const timeout=await call();
  assert.equal(timeout.result.structuredContent.reason,'forge_app_view_capture_timeout');
  assert.equal(timeout.result.structuredContent.effectDispatched,false);

  failure='private_debug_token_never_expose';
  const unknown=await call();
  assert.equal(unknown.result.isError,true);
  assert.equal(unknown.result.structuredContent,undefined);
  assert.doesNotMatch(unknown.result.content[0].text,/private_debug_token/);
});

test('live View does not click controls covered by a modal or pointer interception',()=>{
  const rect={x:12,y:18,left:12,top:18,right:132,bottom:54,width:120,height:36};
  let clicked=0;
  const button={
    tagName:'BUTTON',innerText:'Confirmar',disabled:false,
    getBoundingClientRect:()=>rect,
    getAttribute:key=>key==='aria-label'?'Confirmar':null,
    closest:()=>null,contains:element=>element===button,
    click:()=>{clicked++;}
  };
  const overlay={tagName:'DIV'};
  let topmost=button;
  const doc={
    title:'Teste visual',querySelectorAll:selector=>
      selector==='button,[role="button"],input,textarea'?[button]:[],
    elementFromPoint:()=>topmost
  };
  const globals={document:doc,location:{origin:'null'},
    getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),
    innerWidth:600,innerHeight:400};
  const previous=Object.fromEntries(Object.keys(globals).map(key=>
    [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  try{
    for(const [key,value] of Object.entries(globals))
      Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
    const allowed=inspectForgeLiveViewDom();
    assert.equal(allowed.available,true);
    assert.equal(allowed.state.controls[0].interactable,true);
    assert.equal(allowed.state.controls[0].obscured,false);
    const accepted=inspectForgeLiveViewDom({mode:'click',index:0,
      expectedLabel:'Confirmar',expectedState:allowed.state});
    assert.equal(accepted.applied,true);
    assert.equal(clicked,1);

    topmost=overlay;
    const blocked=inspectForgeLiveViewDom();
    assert.equal(blocked.state.controls[0].obscured,true);
    assert.equal(blocked.state.controls[0].interactable,false);
    const rejected=inspectForgeLiveViewDom({mode:'click',index:0,
      expectedLabel:'Confirmar',expectedState:blocked.state});
    assert.equal(rejected.applied,false);
    assert.equal(rejected.reason,'forge_view_live_stale');
    assert.equal(clicked,1);
    const stale=inspectForgeLiveViewDom({mode:'click',index:0,
      expectedLabel:'Confirmar',expectedState:allowed.state});
    assert.equal(stale.applied,false);
    assert.equal(clicked,1);
  }finally{
    for(const [key,descriptor] of Object.entries(previous)){
      if(descriptor)Object.defineProperty(globalThis,key,descriptor);
      else delete globalThis[key];
    }
  }
});

test('live text fill keeps exact spacing, hides field values and rejects sensitive fields',()=>{
  const rect={x:8,y:24,left:8,top:24,right:220,bottom:58,width:212,height:34};
  const events=[];
  const input={
    tagName:'INPUT',type:'text',name:'query',id:'query',autocomplete:'off',
    value:'',readOnly:false,disabled:false,labels:[],
    getBoundingClientRect:()=>rect,
    getAttribute:key=>key==='aria-label'?'Busca':key==='type'?'text':null,
    closest:()=>null,matches:()=>false,
    contains:hit=>hit===input,
    dispatchEvent:event=>{events.push(event.type);return true;}
  };
  const password={...input,type:'password',name:'senha',id:'password',
    getAttribute:key=>key==='type'?'password':key==='aria-label'?'Senha':null};
  const globals={
    document:{title:'Teste de campo',querySelectorAll:selector=>
      selector==='button,[role="button"],input,textarea'?[input,password]:[],
      elementFromPoint:()=>input},
    location:{origin:'null'},
    getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),
    innerWidth:600,innerHeight:400
  };
  const previous=Object.fromEntries(Object.keys(globals).map(key=>
    [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  try{
    for(const [key,value] of Object.entries(globals))
      Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
    const before=inspectForgeLiveViewDom();
    assert.equal(before.state.controls.length,1);
    assert.equal(before.state.controls[0].label,'Busca');
    assert.equal(before.state.controls[0].editable,true);
    assert.equal(before.state.controls[0].hasValue,false);
    const fill=inspectForgeLiveViewDom({mode:'fill',index:0,
      expectedLabel:'Busca',expectedState:before.state,value:'  termo exato  '});
    assert.deepEqual(fill,{applied:true,valueAccepted:true});
    assert.equal(input.value,'  termo exato  ');
    assert.deepEqual(events,['input','change']);
    const after=inspectForgeLiveViewDom();
    assert.equal(after.state.controls[0].hasValue,true);
    assert.equal(after.state.inputValuesIncluded,false);
    assert.doesNotMatch(JSON.stringify(after),/termo exato/);
    assert.deepEqual(inspectForgeLiveViewDom({mode:'verify_fill',index:0,
      expectedLabel:'Busca',value:'  termo exato  '}),
    {applied:false,valueVerified:true});
    assert.equal(inspectForgeLiveViewDom({mode:'fill',index:0,
      expectedLabel:'Busca',expectedState:before.state,value:'outro'}).applied,false);
    assert.equal(input.value,'  termo exato  ');
  }finally{
    for(const [key,descriptor] of Object.entries(previous)){
      if(descriptor)Object.defineProperty(globalThis,key,descriptor);
      else delete globalThis[key];
    }
  }
  const normalized=validateOrchestratorInput('project_view_live_fill',{
    requestId:'fill_1',projectId:'project_A',taskId:'task_A',assetId:'asset_A',
    expectedRevision:'a'.repeat(64),controlIndex:0,expectedLabel:'Busca',
    value:'  termo exato  '});
  assert.equal(normalized.input.value,'  termo exato  ');
  assert.throws(()=>validateOrchestratorInput('project_view_live_fill',{
    requestId:'fill_2',projectId:'project_A',taskId:'task_A',assetId:'asset_A',
    expectedRevision:'a'.repeat(64),controlIndex:0,expectedLabel:'Busca',
    value:'x'.repeat(501)}),/orchestrator_invalid_input/);
});
