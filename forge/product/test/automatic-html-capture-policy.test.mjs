import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {shouldAttemptAutomaticHtmlCapture} from '../src/automatic-html-capture-policy.mjs';

test('only confirmed autonomous work can inspect a real HTML attachment',()=>{
  const yes={authorSource:'orchestrator',runId:'run_real',text:'Arquivo criado: index.html'};
  assert.equal(shouldAttemptAutomaticHtmlCapture(yes),true);
  assert.equal(shouldAttemptAutomaticHtmlCapture({...yes,authorSource:'human'}),false);
  assert.equal(shouldAttemptAutomaticHtmlCapture({...yes,text:'Analisar o site.'}),false);
  assert.equal(shouldAttemptAutomaticHtmlCapture({authorSource:'orchestrator',runId:'run_site',
    text:'Fiz uma página para a cafeteria.',userRequest:'Quero um site para minha cafeteria.'}),true,
    'an official HTML card may exist even if GPT omits the filename in its prose');
  assert.equal(shouldAttemptAutomaticHtmlCapture({authorSource:'orchestrator',runId:'run_site',
    text:'A criação está pronta.',userRequest:'Como criar um site?'}),false);
  assert.equal(shouldAttemptAutomaticHtmlCapture({...yes,text:''}),false);
  assert.equal(shouldAttemptAutomaticHtmlCapture({...yes,runId:null}),false);
  assert.equal(shouldAttemptAutomaticHtmlCapture({}),false);
});

test('passive App retains explicit read-only HTML capture without post-Run dispatch',()=>{
  const main=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
  assert.match(main,/async function captureConfirmedHtmlArtifact\(requestedId,\{/);
  assert.match(main,/return captureConfirmedHtmlArtifact\(requestedId\)/);
  assert.match(main,/inspectProviderLinkedThread\(\{store,worker:captureWorker,taskId\}\)/);
  assert.match(main,/captureWorker\.downloadLinkedHtmlArtifact\(/);
  assert.doesNotMatch(main,/shouldAttemptAutomaticHtmlCapture|captureWorker:executionWorker|async function runTask\(|enqueueExecution\(/);
  assert.doesNotMatch(main,/createOrchestratorKernel\(\{[\s\S]{0,1600}\bprovider\s*:/);
});
