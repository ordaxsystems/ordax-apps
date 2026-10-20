import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { observeWithin } from '../src/provider-observation-policy.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const worker=fs.readFileSync(path.resolve(here,'../desktop/embedded-worker.mjs'),'utf8');
function section(start,end) {
  const a=worker.indexOf(start),b=worker.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'canonical worker section not found');
  return worker.slice(a,b);
}

test('composer WebContents observation has a finite bound, even on a never-settling DOM',async()=>{
  const composer=section('  async #composerState() {','  async #waitForComposer(');
  assert.match(composer,/observeWithin\(\(\) => this\.view\.webContents\.executeJavaScript/);
  assert.match(composer,/timeoutMs:4000/);
  assert.match(composer,/provider_composer_observation_timeout/);
  let attempts=0;
  await assert.rejects(observeWithin(()=>{
    attempts++;return new Promise(()=>{});
  },{timeoutMs:15,code:'provider_composer_observation_timeout'}),/provider_composer_observation_timeout/);
  assert.equal(attempts,1); // Never start another observation or navigation.
});

test('unreadable draft never becomes a synthetic empty draft during thread switch or send',()=>{
  const show=section('  async showConversation(', '  async inspectDiagnosticReadOnly()');
  assert.match(show,/const state = await this\.#composerState\(\);/);
  assert.doesNotMatch(show,/this\.#composerState\(\)\.catch/);
  const load=section('  async #safeLoad(','  async #assistantSnapshot()');
  assert.match(load,/if \(protectDraft\) \{\s*const state = await this\.#composerState\(\);/);
  assert.match(load,/let alreadyAtTarget = false/);
  assert.match(load,/if \(alreadyAtTarget && !forceReload\) \{/);
  assert.match(load,/const state = await this\.#composerState\(\);\s*if \(state\.found\) return/);
  const samePageBlock=load.split('if (alreadyAtTarget && !forceReload) {')[1].split('    try {\n      await observeWithin')[0];
  assert.doesNotMatch(samePageBlock,/catch \{/);
  const send=worker.slice(worker.indexOf('  async sendPrompt({'));
  assert.match(send,/const currentDraft = await this\.#composerState\(\);/);
  assert.doesNotMatch(send,/const currentDraft = await this\.#composerState\(\)\.catch/);
});

test('read-only provider inspectors have deadlines and remain no-send',()=>{
  const diagnostic=section('  async inspectDiagnosticReadOnly()','  async inspectConversationReadOnly(');
  const conversation=section('  async inspectConversationReadOnly(','  async #composerState()');
  assert.match(diagnostic,/provider_diagnostic_observation_timeout/);
  assert.match(diagnostic,/timeoutMs:5000/);
  assert.match(conversation,/provider_conversation_observation_timeout/);
  assert.match(conversation,/timeoutMs:5000/);
  for(const area of [diagnostic,conversation]){
    assert.doesNotMatch(area,/submitExactlyOnce|requestSubmit|setComposerAndSend|sendPrompt/);
  }
});

test('historical read-only thread can render without a composer; sending still requires one',()=>{
  const show=section('  async showConversation(', '  async inspectDiagnosticReadOnly()');
  const read=section('  async inspectConversationReadOnly(', '  async #composerState()');
  const load=section('  async #safeLoad(', '  async #assistantSnapshot()');
  assert.match(show,/requireComposer = true/);
  assert.match(show,/this\.#safeLoad\(url, \{ requireComposer, protectDraft: !force \}\)/);
  assert.match(read,/this\.showConversation\(expected, \{force:false,requireComposer:false\}\)/);
  assert.match(read,/canonicalProviderChatUrl\(this\.view\.webContents\.getURL\(\)\) !== expected/);
  assert.match(load,/if \(protectDraft\) \{\s*const state = await this\.#composerState\(\)/);
  assert.match(load,/if \(requireComposer\) await this\.#waitForComposer\(\)/);
  const send=worker.slice(worker.indexOf('  async sendPrompt({'));
  assert.match(send,/assertProviderSendReadiness/);
  assert.match(send,/await this\.#setComposerAndSend\(/);
  assert.doesNotMatch(read,/sendPrompt|requestSubmit|Input\.insertText|setComposerAndSend/);
});

test('safe observation timeout does not turn absence into session or success',async()=>{
  const code='test_observation_expired';
  await assert.rejects(observeWithin(()=>new Promise(()=>{}),{timeoutMs:20,code}),/test_observation_expired/);
  assert.deepEqual(await observeWithin(()=>Promise.resolve({found:false}),{timeoutMs:40}),{found:false});
});
