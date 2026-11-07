import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildStaticPreviewSource,STATIC_PREVIEW_CSP} from '../src/static-html-preview.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
test('preview has earliest CSP and never permits untrusted scripts, network or forms',()=>{
  const sample='<!doctype html><html><head><style>body{color:red}</style>'+
    '<script>window.__pwned=true</script></head><body><form action="https://evil.test">'+
    '<input required></form><img src="https://evil.test/img"></body></html>';
  const output=buildStaticPreviewSource(sample);
  assert.ok(output.startsWith('<meta http-equiv="Content-Security-Policy"'));
  assert.ok(output.indexOf('Content-Security-Policy')<output.indexOf('<script>'));
  for(const part of ["default-src 'none'","script-src 'none'","connect-src 'none'",
    "form-action 'none'","frame-src 'none'","base-uri 'none'"])
    assert.ok(STATIC_PREVIEW_CSP.includes(part));
  assert.ok(!STATIC_PREVIEW_CSP.includes("script-src 'unsafe-inline'"));
  assert.equal((output.match(/Content-Security-Policy/g)||[]).length,1);
  assert.throws(()=>buildStaticPreviewSource('<script>alert(1)</script>'),/source_invalid/);
  assert.throws(()=>buildStaticPreviewSource('x'.repeat(2*1024*1024+1)),/source_invalid/);
});

test('work surface is visibly inside the existing right rail and only receives hash-verified assets',()=>{
  const html=fs.readFileSync(path.join(root,'desktop','ui.html'),'utf8');
  const ui=fs.readFileSync(path.join(root,'desktop','ui.js'),'utf8');
  const orchestration=fs.readFileSync(path.join(root,'desktop','orchestrator-ui.mjs'),'utf8');
  const main=fs.readFileSync(path.join(root,'desktop','main.mjs'),'utf8');
  const css=fs.readFileSync(path.join(root,'desktop','ui.css'),'utf8');
  const preload=fs.readFileSync(path.join(root,'desktop','preload.cjs'),'utf8');
  const rail=html.slice(html.indexOf('<aside id="contextRail"'),
    html.indexOf('</aside>',html.indexOf('<aside id="contextRail"')));
  assert.ok(rail.includes('id="workSurfacePreview"'));
  assert.ok(rail.includes('id="workSurfaceFrame"'));
  assert.match(rail,/<iframe[^>]+sandbox=""/);
  assert.doesNotMatch(rail,/sandbox="[^"]*allow-scripts/);
  assert.doesNotMatch(rail,/sandbox="[^"]*allow-same-origin/);
  assert.match(ui,/frame\.srcdoc=buildStaticPreviewSource\(proof\.html\)/);
  assert.match(ui,/onArtifactPreviewTask:refreshVerifiedWorkSurface/);
  assert.match(orchestration,/onArtifactPreviewTask\?\.\(job\?\.reviewedTaskId\|\|job\?\.taskAId\|\|null\)/);
  assert.match(main,/registerUiHandler\('ordax:tasks:html-artifact:preview'/);
  assert.match(main,/requireTrustedSupervisorRenderer\(event\)/);
  assert.match(main,/verifyLocalHtmlArtifact\(real\)/);
  assert.match(main,/readVerifiedLocalHtmlArtifact\(real\)/);
  assert.match(main,/sha256:proof\.sha256,bytes:proof\.bytes,html:proof\.html/);
  assert.doesNotMatch(main,/html:fs\.readFileSync\(real,'utf8'\)/);
  assert.match(main,/proof\.sha256!==asset\.sha256/);
  assert.match(main,/will-frame-navigate/);
  assert.match(main,/details\.preventDefault\(\)/);
  assert.match(main,/setWindowOpenHandler\(\(\)=>\(\{action:'deny'\}\)\)/);
  assert.match(preload,/readHtmlPreview/);
  assert.match(css,/work-surface-active/);
  const source=main.slice(main.indexOf("registerUiHandler('ordax:tasks:html-artifact:preview'"),
    main.indexOf('// Exact-profile attestation for Lab E2E'));
  assert.doesNotMatch(source,/runTask|provider\.send|downloadURL|loadFile|showItemInFolder/);
});
