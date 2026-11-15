import test from 'node:test';
import assert from 'node:assert/strict';
import {ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';
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
