import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import {buildInteractiveHtmlDocument,INTERACTIVE_PREVIEW_CSP,
  isPreviewNetworkRequestAllowed,INTERACTIVE_PREVIEW_MAX_BYTES} from '../src/interactive-html-preview-policy.mjs';

const base=fileURLToPath(new URL('../',import.meta.url));
test('interactive document can execute inline JS but has no network, forms, frames or external scripts',()=>{
  const html='<!doctype html><html><head><title>Estação Café</title></head><body>'+
    '<button id="go" onclick="document.body.dataset.ready=1">Testar</button>'+
    '<script>document.documentElement.dataset.script="yes"</script></body></html>';
  const document=buildInteractiveHtmlDocument(html);
  assert.ok(document.startsWith('<meta http-equiv="Content-Security-Policy"'));
  assert.ok(document.indexOf('Content-Security-Policy')<document.indexOf('onclick'));
  assert.ok(document.includes(html));
  for(const rule of ["default-src 'none'","script-src 'unsafe-inline'","connect-src 'none'",
    "frame-src 'none'","form-action 'none'","base-uri 'none'","worker-src 'none'"])
    assert.ok(INTERACTIVE_PREVIEW_CSP.includes(rule),rule);
  assert.ok(!INTERACTIVE_PREVIEW_CSP.includes('unsafe-eval'));
  assert.throws(()=>buildInteractiveHtmlDocument('<script>leak()</script>'),/source_invalid/);
  assert.throws(()=>buildInteractiveHtmlDocument('x'.repeat(INTERACTIVE_PREVIEW_MAX_BYTES+1)),/source_invalid/);
});
test('dedicated preview session rejects every network protocol',()=>{
  for(const url of ['https://example.test','http://127.0.0.1:8080','file:///C:/',
    'ws://127.0.0.1:9000','wss://example.test','blob:xyz','filesystem:https://x'])
    assert.equal(isPreviewNetworkRequestAllowed(url),false,url);
  assert.equal(isPreviewNetworkRequestAllowed('data:image/png;base64,AA=='),true);
});
test('native Work Surface has separate transient WebContentsView with no IPC or persisted GPT session',()=>{
  const source=fs.readFileSync(path.join(base,'desktop','isolated-interactive-preview.mjs'),'utf8');
  const main=fs.readFileSync(path.join(base,'desktop','main.mjs'),'utf8');
  const ui=fs.readFileSync(path.join(base,'desktop','ui.js'),'utf8');
  const preload=fs.readFileSync(path.join(base,'desktop','preload.cjs'),'utf8');
  const markup=fs.readFileSync(path.join(base,'desktop','ui.html'),'utf8');
  assert.match(source,/new WebContentsView\(/);
  assert.match(source,/partition='ordax-preview-'\+randomUUID\(\)/);
  assert.match(source,/sandbox:true,nodeIntegration:false,contextIsolation:true/);
  assert.match(source,/setPermissionRequestHandler\(/);
  assert.match(source,/setPermissionCheckHandler\(/);
  assert.match(source,/webRequest\.onBeforeRequest\(/);
  assert.match(source,/setWindowOpenHandler\(\(\)=>\(\{action:'deny'\}\)\)/);
  assert.match(source,/will-frame-navigate/);
  assert.match(source,/will-download/);
  assert.match(source,/win\.contentView\.addChildView\(view\)/);
  assert.match(source,/win\.contentView\.removeChildView\(view\)/);
  assert.doesNotMatch(source,/preload\s*:/);
  assert.doesNotMatch(source,/persist:ordax-forge-chatgpt/);
  assert.match(main,/readVerifiedHtmlPreview\(payload\)/);
  assert.match(main,/interactiveHtmlPreview\.open\(proof\)/);
  assert.match(main,/requireTrustedSupervisorRenderer\(event\)/);
  assert.match(preload,/openInteractivePreview/);
  assert.match(preload,/setInteractivePreviewBounds/);
  assert.match(ui,/workSurfaceInteractiveRequested=true/);
  assert.doesNotMatch(ui,/if\(epoch!==workSurfacePreviewEpoch\)\{\s*await window\.ordax\.closeInteractivePreview/,
    'a stale refresh must not close the active native preview');
  assert.match(source,/devTools:false/);
  assert.match(source,/async observeRender\(\)/);
  assert.match(source,/async observeControls\(html\)/);
  assert.match(source,/sandboxedPreviewView\(\{session:ses\}\)/);
  assert.match(source,/executeJavaScriptInIsolatedWorld\(/);
  assert.doesNotMatch(source,/tester\.webContents\.executeJavaScript\(script\)/);
  assert.match(source,/normalizedHtmlControlChecks\(result\.report\)/);
  assert.match(source,/view\.webContents\.capturePage\(\)/);
  assert.match(source,/screenshotSha256:createHash\('sha256'\)/);
  assert.match(main,/recordBrowserRenderObservation\(observation\)/);
  assert.match(main,/recordBrowserControlsObservation\(observation\)/);
  assert.match(ui,/controles locais aprovados/);
  assert.match(main,/const proof=readVerifiedHtmlPreview\(\{/);
  assert.match(ui,/receipt\?\.browserRenderObserved!==true/);
  assert.match(ui,/Não certifica site completo ou publicação/);
  assert.match(ui,/funcionamento e publicação não certificados/);
  assert.match(ui,/onArtifactPreviewTask:refreshVerifiedWorkSurface/);
  assert.match(markup,/id="workSurfaceModeToggle"/);
  assert.match(markup,/id="workSurfaceVersion"/);
  assert.match(markup,/id="workSurfaceVersionBar"/);
  assert.match(ui,/workSurfaceVersionTaskId!==taskId/);
  assert.match(ui,/message\.role!=='assistant'/);
  assert.match(ui,/versions\.slice\(0,20\)/);
  assert.match(ui,/readHtmlPreview\(taskId,asset\.id\)/);
  assert.match(ui,/currentDelivery:Boolean\(currentAsset&&!isHistorical\)/);
  assert.match(ui,/workSurfaceVersionAssetId=selected===workSurfaceLatestAssetId\?null:selected/);
  assert.match(ui,/Histórico, sem restauração/);
  const handler=main.slice(main.indexOf("registerUiHandler('ordax:preview:interactive:open'"),
    main.indexOf('// Exact-profile attestation for Lab E2E'));
  assert.doesNotMatch(handler,/runTask\(|provider\.send|\.loadFile|\.writeFile/);
});

test('Work Surface version history re-verifies each asset and never promotes an old delivery',async()=>{
  const ui=fs.readFileSync(path.join(base,'desktop','ui.js'),'utf8');
  const start=ui.indexOf('async function refreshVerifiedWorkSurface(taskId){');
  const end=ui.indexOf("$('#workSurfaceVersion').addEventListener",start);
  assert.ok(start>0&&end>start);
  const elements=new Map();
  for(const id of ['#workSurfaceVersionBar','#workSurfacePreview','#workSurfaceFilename',
    '#workSurfaceProof','#workSurfaceStatus','#workSurfaceModeToggle'])
    elements.set(id,{hidden:true,textContent:'',style:{}});
  const select={options:[],value:'',
    replaceChildren(){this.options=[];},
    append(option){this.options.push(option);}};
  elements.set('#workSurfaceVersion',select);
  elements.set('#previewPanel .preview-state-card',{hidden:false});
  const frame={style:{},srcdoc:'',
    setAttribute(name,value){this[name]=value;}};
  elements.set('#workSurfaceFrame',frame);
  const old={kind:'file',mime_type:'text/html',id:'old'};
  const current={kind:'file',mime_type:'text/html',id:'new'};
  const task={messages:[{role:'assistant',assets:[old]},
    {role:'user',assets:[{kind:'file',mime_type:'text/html',id:'user-asset'}]},
    {role:'assistant',assets:[current]}]};
  const reads=[];
  let authentic=true;
  const sandbox={
    document:{createElement:()=>({}),body:{classList:{add(){}}}},
    window:{ordax:{
      getTask:async()=>task,
      readHtmlPreview:async(taskId,assetId)=>{
        reads.push(assetId);
        return {verified:authentic,taskId,assetId,sha256:'a'.repeat(64),
          bytes:42,filename:'index.html',html:'<!doctype html><title>ok</title>'};
      }
    }},
    $:id=>{assert.ok(elements.has(id),'unexpected element '+id);return elements.get(id);},
    buildStaticPreviewSource:html=>html,
    queueWorkSurfaceBounds:()=>{}
  };
  vm.createContext(sandbox);
  vm.runInContext(`let workSurfacePreviewEpoch=0,workSurfacePreviewKey=null;
    let workSurfaceVersionTaskId=null,workSurfaceVersionAssetId=null,workSurfaceLatestAssetId=null;
    let workSurfacePreviewTaskId=null,workSurfaceInteractiveActive=false;
    let workSurfaceInteractiveRequested=false;
    function clearWorkSurfacePreview(){
      workSurfacePreviewEpoch++;
      $('#workSurfacePreview').hidden=true;
      $('#workSurfaceFrame').srcdoc='';
      workSurfacePreviewKey=null;
    }
    ${ui.slice(start,end)}
    globalThis.refresh=refreshVerifiedWorkSurface;
    globalThis.choose=id=>{workSurfaceVersionAssetId=id;};
    globalThis.selected=()=>workSurfaceVersionAssetId;`,sandbox);
  const latest=await sandbox.refresh('task-a');
  assert.equal(latest.verified,true);
  assert.equal(latest.currentDelivery,true);
  assert.equal(latest.assetId,'new');
  assert.deepEqual(reads,['new']);
  assert.equal(select.options.length,2);
  assert.equal(select.options[0].value,'new');
  assert.equal(elements.get('#workSurfaceVersionBar').hidden,false);
  sandbox.choose('old');
  const historical=await sandbox.refresh('task-a');
  assert.equal(historical.verified,true);
  assert.equal(historical.currentDelivery,false);
  assert.equal(historical.assetId,'old');
  assert.deepEqual(reads,['new','old']);
  assert.match(elements.get('#workSurfaceStatus').textContent,/Versão anterior/);
  // A revoked or altered local asset must not leave stale HTML visible.
  authentic=false;
  const rejected=await sandbox.refresh('task-a');
  assert.equal(rejected,undefined);
  assert.equal(elements.get('#workSurfacePreview').hidden,true);
  assert.equal(frame.srcdoc,'');
  authentic=true;
  task.messages=[{role:'assistant',assets:[current]}];
  const switched=await sandbox.refresh('task-b');
  assert.equal(switched.currentDelivery,true);
  assert.equal(switched.assetId,'new');
  assert.equal(sandbox.selected(),null);
  assert.equal(elements.get('#workSurfaceVersionBar').hidden,true);
});
