import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerUserMessageIsCollapsedPromptPrefix, providerUserMessageMatchesPrompt } from '../src/provider-user-message.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('the worker expands a verified long prompt before exact send and response correlation',()=>{
  const worker=fs.readFileSync(path.join(root,'desktop/embedded-worker.mjs'),'utf8');
  const preload=fs.readFileSync(path.join(root,'desktop/worker-preload.cjs'),'utf8');
  const receipt=fs.readFileSync(path.join(root,'src/provider-submit-receipt.mjs'),'utf8');
  assert.match(worker,/providerUserMessageIsCollapsedPromptPrefix\(state\.latestUserText,prompt/);
  assert.match(worker,/const expanded=await this\.#expandLatestUserMessageForVerification\(\)/);
  assert.match(worker,/control\.click\(\)/);
  assert.match(worker,/rect\.width>0&&rect\.height>0/);
  assert.match(worker,/Mostrar menos\|Show less/);
  assert.match(preload,/Mostrar menos\|Show less/);
  assert.doesNotMatch(receipt,/canonicalNewUrl|chatPermalink/);
});

test('collapsed prefix can request expansion but cannot itself become an exact receipt',()=>{
  const prompt='context-and-progress '.repeat(520)+'final nonce 743d';
  const collapsed=prompt.slice(0,10100)+'…\nShow more';
  assert.equal(providerUserMessageIsCollapsedPromptPrefix(collapsed,prompt,{expandControlPresent:true}),true);
  assert.equal(providerUserMessageMatchesPrompt(collapsed,prompt,{expandControlPresent:true}),false);
  assert.equal(providerUserMessageMatchesPrompt(prompt+'\nShow less',prompt,{expandControlPresent:true}),true);
});
