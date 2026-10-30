import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProviderUserMessage, providerUserMessageMatchesPrompt, providerUserMessageIsCollapsedPromptPrefix, shouldExpandCollapsedProviderPromptForResponse } from '../src/provider-user-message.mjs';

const prompt = '[CONTEXTO ORDAX]\nPedido atual:\nQual era o marcador?';

test('provider text normalization keeps ordinary exact prompts', () => {
  assert.equal(normalizeProviderUserMessage(prompt), prompt.replace(/\s+/g, ' ').trim());
  assert.equal(providerUserMessageMatchesPrompt(prompt, prompt), true);
});

test('long collapsed ChatGPT bubble ignores its observed expand button and UI ellipsis', () => {
  const visible = prompt.slice(0,-8) + '\n…\nMostrar mais';
  assert.equal(providerUserMessageMatchesPrompt(visible, prompt, { expandControlPresent:true }), false);
  assert.equal(providerUserMessageIsCollapsedPromptPrefix(visible, prompt, { expandControlPresent:true }), false);
  assert.equal(providerUserMessageMatchesPrompt(visible, prompt), false);
});

test('a genuinely collapsed long prompt is only a trigger to expand, not a delivery receipt',()=>{
  const longPrompt='x'.repeat(12000)+' nonce-a4f87c';
  const collapsed=longPrompt.slice(0,10100)+'…\nMostrar mais';
  assert.equal(providerUserMessageIsCollapsedPromptPrefix(collapsed,longPrompt,{expandControlPresent:true}),true);
  assert.equal(providerUserMessageMatchesPrompt(collapsed,longPrompt,{expandControlPresent:true}),false);
  assert.equal(providerUserMessageIsCollapsedPromptPrefix(collapsed,longPrompt),false);
  assert.equal(providerUserMessageIsCollapsedPromptPrefix('unrelated'.repeat(20),longPrompt,{expandControlPresent:true}),false);
});

test('response observation expands one exact collapsed prompt once before considering an assistant bubble',()=>{
  const longPrompt='x'.repeat(12000)+' nonce-a4f87c';
  const collapsed=longPrompt.slice(0,10100)+'…\nMostrar mais';
  assert.equal(shouldExpandCollapsedProviderPromptForResponse({
    observed:collapsed,prompt:longPrompt,expandControlPresent:true
  }),true);
  assert.equal(shouldExpandCollapsedProviderPromptForResponse({
    observed:collapsed,prompt:longPrompt,expandControlPresent:true,alreadyAttempted:true
  }),false);
  assert.equal(shouldExpandCollapsedProviderPromptForResponse({
    observed:collapsed,prompt:longPrompt,expandControlPresent:false
  }),false);
  assert.equal(shouldExpandCollapsedProviderPromptForResponse({
    observed:'unrelated'.repeat(200),prompt:longPrompt,expandControlPresent:true
  }),false);
});

test('an expanded provider bubble strips its visible collapse control and matches the full prompt',()=>{
  assert.equal(providerUserMessageMatchesPrompt(prompt+'\nMostrar menos',prompt,{expandControlPresent:true}),true);
  assert.equal(providerUserMessageMatchesPrompt(prompt+'\nShow less',prompt,{expandControlPresent:true}),true);
});

test('expand suffix is not stripped unless the matching control was observed', () => {
  assert.equal(providerUserMessageMatchesPrompt(prompt + '\n…', prompt, { expandControlPresent:true }), true);
  assert.equal(providerUserMessageMatchesPrompt(prompt + '\n…', prompt), false);
  assert.equal(providerUserMessageMatchesPrompt(prompt + '\nextra', prompt, { expandControlPresent:true }), false);
});

test('expand control normalization does not remove an ellipsis belonging to the prompt', () => {
  const promptEndingInEllipsis = prompt + '…';
  assert.equal(providerUserMessageMatchesPrompt(promptEndingInEllipsis + '\n…\nMostrar mais', promptEndingInEllipsis, { expandControlPresent:true }), true);
});
