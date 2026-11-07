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

test('post-Run handler reuses canonical capture and never dispatches a second prompt',()=>{
  const main=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
  assert.match(main,/async function captureConfirmedHtmlArtifact\(requestedId\)/);
  assert.match(main,/return captureConfirmedHtmlArtifact\(requestedId\)/);
  assert.match(main,/shouldAttemptAutomaticHtmlCapture\(\{/);
  assert.match(main,/const captured=await captureConfirmedHtmlArtifact\(taskId\)/);
  const begin=main.indexOf("send:async({taskId,content,draftRevision,taskKind,authorSource='human'})=>");
  const end=main.indexOf("coordinator:createGroqCoordinatorConversation",begin);
  const text=main.slice(begin,end);
  assert.ok(begin>0&&end>begin);
  assert.equal((text.match(/enqueueExecution\(/g)||[]).length,1,
    'the sender must have exactly one work execution lane');
  assert.equal((text.match(/captureConfirmedHtmlArtifact\(/g)||[]).length,1,
    'recovery must call the one canonical capture function');
  assert.doesNotMatch(text,/requestSubmit|sendPrompt|\.send\(/);
  assert.match(text,/attachment_not_verified/);
});
