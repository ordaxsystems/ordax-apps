import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
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
  assert.doesNotMatch(source,/persist:ordax-orchestrator-lab-chatgpt/);
  assert.match(main,/readVerifiedHtmlPreview\(payload\)/);
  assert.match(main,/interactiveHtmlPreview\.open\(proof\)/);
  assert.match(main,/requireTrustedSupervisorRenderer\(event\)/);
  assert.match(preload,/openInteractivePreview/);
  assert.match(preload,/setInteractivePreviewBounds/);
  assert.match(ui,/workSurfaceInteractiveRequested=true/);
  assert.match(ui,/onArtifactPreviewTask:refreshVerifiedWorkSurface/);
  assert.match(markup,/id="workSurfaceModeToggle"/);
  const handler=main.slice(main.indexOf("registerUiHandler('ordax:preview:interactive:open'"),
    main.indexOf('// Exact-profile attestation for Lab E2E'));
  assert.doesNotMatch(handler,/runTask\(|provider\.send|\.loadFile|\.writeFile/);
});
