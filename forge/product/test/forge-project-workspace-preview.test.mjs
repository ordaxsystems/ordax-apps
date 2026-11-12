import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const ui=fs.readFileSync(path.join(here,'../desktop/ui.js'),'utf8');
const start=ui.indexOf('async function refreshForgeProjectHtmlPreview({force=false}={}){');
const end=ui.indexOf('async function refreshVerifiedWorkSurface(taskId){',start);
assert.ok(start>=0&&end>start,'local preview uses existing right-rail frame');
const fn=ui.slice(start,end);
const PROJECT='project_a6ae4ca0-a62a-428e-9005-37b68cda3562';
const HTML='<!doctype html><html lang="pt-BR"><head><title>Vereda</title></head><body>Vereda Cafe</body></html>';
const HASH='a'.repeat(64);

function harness({workspace={projectId:PROJECT,configured:true,verified:true},
  file={projectId:PROJECT,path:'index.html',content:HTML,bytes:HTML.length,sha256:HASH,verified:'local_readback'}}={}){
  const calls=[];
  let selected=PROJECT,latest=file,latestWorkspace=workspace;
  const elements=new Map();
  const el=name=>{
    if(!elements.has(name))elements.set(name,{hidden:name==='#workSurfacePreview',
      textContent:'',style:{},disabled:false,setAttribute(prop,value){this[prop]=value;}});
    return elements.get(name);
  };
  const env={
    window:{ordax:{
      forgeWorkspaceStatus:async id=>{calls.push(['status',id]);return await latestWorkspace;},
      orchestratorInvoke:async(operation,input)=>{calls.push([operation,input]);return await latest;},
      openInteractivePreview:()=>{throw Error('native_browser_not_authorized_for_project_file');}
    }},
    orchestrationUi:{getProjectId:()=>selected},
    document:{body:{classList:{add(){}}}},
    buildStaticPreviewSource:html=>'<meta data-csp="verified">'+html,
    queueWorkSurfaceBounds:()=>{},$:el,
    clearWorkSurfacePreview:()=>{el('#workSurfacePreview').hidden=true;el('#workSurfaceFrame').srcdoc=undefined;el('#workSurfaceRefresh').hidden=true;}
  };
  const globals="let activeRightPane='preview',workSurfacePreviewEpoch=0,workSurfacePreviewKey=null,workSurfacePreviewTaskId=null,workSurfaceInteractiveActive=false;";
  vm.runInNewContext(globals+fn+"globalThis.refresh=refreshForgeProjectHtmlPreview;",env);
  return {refresh:env.refresh,el,calls,select:id=>selected=id,
    setFile:value=>latest=value,setWorkspace:value=>latestWorkspace=value};
}

test('project index.html with verified binding appears in the existing right Preview tab',async()=>{
  const h=harness();
  await h.refresh();
  assert.equal(h.el('#workSurfacePreview').hidden,false);
  assert.equal(h.el('#previewPanel .preview-state-card').hidden,true);
  assert.match(h.el('#workSurfaceFrame').srcdoc,/Vereda Cafe/);
  assert.equal(h.el('#workSurfaceFrame').sandbox,'');
  assert.equal(h.el('#workSurfaceFilename').textContent,'index.html');
  assert.equal(h.el('#workSurfaceModeToggle').disabled,true);
  assert.match(h.el('#workSurfaceStatus').textContent,/N.o . uma resposta GPT/);
  assert.equal(h.calls[0][1],PROJECT);
  assert.equal(h.calls[1][0],'project_file_read');
  assert.equal(h.calls[1][1].projectId,PROJECT);
  assert.equal(h.calls[1][1].path,'index.html');
  assert.match(ui,/if\(name==='preview'\)void refreshForgeProjectHtmlPreview\(\{force:true\}\)/);
});

test('local Preview re-reads a new verified revision without switching tabs',async()=>{
  const h=harness();
  await h.refresh();
  const first=h.el('#workSurfaceFrame').srcdoc;
  h.setFile({projectId:PROJECT,path:'index.html',content:HTML.replace('Vereda Cafe','Vereda Atualizado'),
    bytes:HTML.length+7,sha256:'b'.repeat(64),verified:'local_readback'});
  await h.refresh({force:true});
  assert.notEqual(h.el('#workSurfaceFrame').srcdoc,first);
  assert.match(h.el('#workSurfaceFrame').srcdoc,/Vereda Atualizado/);
  assert.equal(h.el('#workSurfacePreview').hidden,false);
  assert.equal(h.el('#workSurfaceRefresh').hidden,false);
  assert.match(ui,/onForgeProjectFileChanged\?\.\(payload=>/);
  assert.match(ui,/let externalPreviewInspectionBusy=false/);
  assert.match(ui,/activeRightPane!=='preview'\|\|document.hidden===true/);
  assert.match(ui,/refreshForgeProjectHtmlPreview\(\{force:true\}\)\.finally/);
  assert.match(ui,/\},5000\);/);
});

test('revoked workspace clears an already displayed local Preview',async()=>{
  const h=harness();
  await h.refresh();
  assert.equal(h.el('#workSurfacePreview').hidden,false);
  h.setWorkspace({projectId:PROJECT,configured:false,verified:false});
  await h.refresh({force:true});
  assert.equal(h.el('#workSurfacePreview').hidden,true);
  assert.equal(h.el('#workSurfaceFrame').srcdoc,undefined);
});

test('a bad new file cannot leave the previous verified HTML displayed',async()=>{
  const h=harness();
  await h.refresh();
  h.setFile({projectId:PROJECT,path:'index.html',content:HTML,
    bytes:HTML.length,sha256:'bad',verified:'unknown'});
  await h.refresh({force:true});
  assert.equal(h.el('#workSurfacePreview').hidden,true);
});

test('unverified workspace never grants Preview read',async()=>{
  const h=harness({workspace:{projectId:PROJECT,configured:true,verified:false}});
  await h.refresh();
  assert.equal(h.el('#workSurfacePreview').hidden,true);
  assert.equal(h.calls.length,1);
});

test('cross-project file reply is rejected even after a valid workspace binding',async()=>{
  const h=harness({file:{projectId:'project_11111111-1111-4111-8111-111111111111',
    path:'index.html',content:HTML,bytes:HTML.length,sha256:HASH,verified:'local_readback'}});
  await h.refresh();
  assert.equal(h.el('#workSurfacePreview').hidden,true);
  assert.equal(h.el('#workSurfaceFrame').srcdoc,undefined);
});

test('switching project while workspace status is in flight invalidates stale Preview',async()=>{
  let resolve;
  const pending=new Promise(done=>{resolve=done;});
  const h=harness({workspace:pending});
  const attempt=h.refresh();
  h.select('project_11111111-1111-4111-8111-111111111111');
  resolve({projectId:PROJECT,configured:true,verified:true});
  await attempt;
  assert.equal(h.calls.length,1);
  assert.equal(h.el('#workSurfacePreview').hidden,true);
});
