import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { responseObservationComplete, requireObservedCompletion } from '../src/provider-response-completion.mjs';

const candidate={ text:'Partial ChatGPT message', complete:false };

test('a partial ChatGPT answer after timeout is not a successful receipt',()=>{
  for(const stable of [0,1,2,3]) {
    assert.equal(responseObservationComplete({candidate,stable,transient:false,generating:true}),false);
    assert.equal(responseObservationComplete({candidate,stable,transient:false,generating:null}),false);
  }
  assert.throws(()=>requireObservedCompletion({candidate,completed:false}),/response_completion_unconfirmed/);
});

test('unknown DOM/stop-state does not prove generation stopped',()=>{
  assert.equal(responseObservationComplete({
    candidate:{...candidate,complete:true},stable:15,transient:false,generating:null
  }),false);
});

test('stable response and observed stopped generation pass the conservative UI policy',()=>{
  assert.equal(responseObservationComplete({
    candidate:{...candidate,complete:true},stable:2,transient:false,generating:false
  }),true);
  assert.equal(responseObservationComplete({
    candidate,stable:4,transient:false,generating:false
  }),true);
  assert.doesNotThrow(()=>requireObservedCompletion({candidate,completed:true}));
});

test('image-generation placeholder cannot be mistaken for a final answer',()=>{
  assert.equal(responseObservationComplete({
    candidate:{text:'Gerando imagem',complete:true},stable:50,transient:true,generating:false
  }),false);
});

test('no answer raises not observed, not a false completion',()=>{
  assert.throws(()=>requireObservedCompletion({candidate:null,completed:false}),/response_not_observed/);
});

test('worker gates observedAt behind an explicit completion confirmation',()=>{
  const here=path.dirname(fileURLToPath(import.meta.url));
  const worker=fs.readFileSync(path.resolve(here,'../desktop/embedded-worker.mjs'),'utf8');
  const start=worker.indexOf('let latest = null, latestSignature');
  const end=worker.indexOf('return { text:String(latest.text',start);
  const loop=worker.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(loop,/completionConfirmed = true;/);
  assert.match(loop,/requireObservedCompletion\(\{ candidate:latest, completed:completionConfirmed \}\)/);
  assert.ok(loop.indexOf('requireObservedCompletion')<loop.indexOf('const images ='));
  assert.match(loop,/catch\(\(\) => null\)/);
});
