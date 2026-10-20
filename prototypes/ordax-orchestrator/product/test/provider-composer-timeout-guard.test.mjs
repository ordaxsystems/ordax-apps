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
  assert.match(conversation,/waitForHistoricalThreadDom/);
  const observation=fs.readFileSync(path.resolve(here,'../src/provider-historical-thread-observation.mjs'),'utf8');
  assert.match(observation,/provider_conversation_observation_timeout/);
  assert.match(observation,/timeoutMs:Math\.min\(2000,remaining\)/);
  for(const area of [diagnostic,conversation]){
    assert.doesNotMatch(area,/submitExactlyOnce|requestSubmit|setComposerAndSend|sendPrompt/);
  }
});

test('historical read-only thread can render without a composer; sending still requires one',()=>{
  const show=section('  async showConversation(', '  async inspectDiagnosticReadOnly()');
  const read=section('  async inspectConversationReadOnly(', '  async #composerState()');
  const load=section('  async #safeLoad(', '  async #assistantSnapshot()');
  assert.match(show,/requireComposer = true/);
  assert.match(show,/this\.#safeLoad\(url, \{ requireComposer, protectDraft: !force, readOnlyThread \}\)/);
  assert.match(read,/this\.showConversation\(expected, \{force:false,requireComposer:false,readOnlyThread:true\}\)/);
  assert.match(read,/canonicalProviderChatUrl\(this\.view\.webContents\.getURL\(\)\) !== expected/);
  assert.match(load,/if \(protectDraft\) \{\s*const state = await this\.#composerState\(\)/);
  assert.match(load,/if \(requireComposer\) await this\.#waitForComposer\(\)/);
  assert.match(load,/readOnlyThread &&/);
  assert.match(load,/canInspectHistoricalThreadAfterNavigationTimeout/);
  assert.match(read,/safeHistoricalThreadFailure\(error\?\.message\)/);
  const send=worker.slice(worker.indexOf('  async sendPrompt({'));
  assert.match(send,/assertProviderSendReadiness/);
  assert.match(send,/await this\.#setComposerAndSend\(/);
  assert.doesNotMatch(read,/sendPrompt|requestSubmit|Input\.insertText|setComposerAndSend/);
});

test('historical thread uses one bounded CDP Runtime.evaluate without input or navigation',()=>{
  const inspector=section('  async #readHistoricalThreadDOM() {',
    '  // Explicit, read-only inspection of an existing, canonical conversation.');
  const read=section('  async inspectConversationReadOnly(', '  async #composerState()');
  assert.match(inspector,/wc\.debugger\.sendCommand\('Runtime\.evaluate'/);
  assert.match(inspector,/awaitPromise:false,returnByValue:true/);
  assert.match(read,/read:\(\)=>this\.#readHistoricalThreadDOM\(\)/);
  assert.doesNotMatch(inspector,/Input\.insertText|requestSubmit|loadURL|sendPrompt|\.click\(/);
  assert.doesNotMatch(read,/executeJavaScript/);
  const observation=fs.readFileSync(path.resolve(here,'../src/provider-historical-thread-observation.mjs'),'utf8');
  assert.match(observation,/safeHistoricalThreadFailure\(error\?\.message\)/);
});

test('OrdaX UI inspection uses existing Task/SQLite, trusted IPC and no replay',()=>{
  const main=fs.readFileSync(path.resolve(here,'../desktop/main.mjs'),'utf8');
  const preload=fs.readFileSync(path.resolve(here,'../desktop/preload.cjs'),'utf8');
  const ui=fs.readFileSync(path.resolve(here,'../desktop/ui.js'),'utf8');
  const html=fs.readFileSync(path.resolve(here,'../desktop/ui.html'),'utf8');
  const chunk=main.split("ipcMain.handle('ordax:tasks:inspect-linked-thread'")[1]
    .split("ipcMain.handle('ordax:tasks:resume-capsule'")[0];
  assert.match(chunk,/requireTrustedSupervisorRenderer\(event\)/);
  assert.match(chunk,/workspace_session_id !== currentSession\?\.id/);
  assert.match(chunk,/liveRun/);
  assert.match(chunk,/canonicalProviderChatUrl\(row\.chat_url\)/);
  assert.match(chunk,/assessProviderConversationEvidence/);
  assert.match(chunk,/worker\.inspectConversationReadOnly/);
  assert.doesNotMatch(chunk,/appendMessage|startRun|finishRun|sendPrompt|requestSubmit|insert into|update tasks/i);
  assert.match(preload,/inspectLinkedThread:/);
  assert.match(html,/id="inspectLinkedThread"/);
  assert.match(ui,/window\.ordax\.inspectLinkedThread\(taskId\)/);
  assert.doesNotMatch(ui.split("$('#inspectLinkedThread').addEventListener")[1].split("$('#directMode').addEventListener")[0],/requestSubmit|sendPrompt|setChatVisible/);
});

test('W3 success requires attributable Task user-and-assistant turn, never bare provider DOM',()=>{
  const main=fs.readFileSync(path.resolve(here,'../desktop/main.mjs'),'utf8');
  const ui=fs.readFileSync(path.resolve(here,'../desktop/ui.js'),'utf8');
  const script=fs.readFileSync(path.resolve(here,'../scripts/live-ui-linked-thread-smoke.cjs'),'utf8');
  const chunk=main.split("ipcMain.handle('ordax:tasks:inspect-linked-thread'")[1]
    .split("ipcMain.handle('ordax:tasks:resume-capsule'")[0];
  assert.match(chunk,/assessment\.kind==='response_candidate'/);
  assert.match(chunk,/assessment\.candidates===1/);
  assert.match(chunk,/assessment\.responseCandidate===true/);
  assert.match(chunk,/observed\?\.truncated!==true/);
  assert.doesNotMatch(chunk,/threadRendered=observed\?\.available===true/);
  assert.match(ui,/Conversa e resposta da tarefa observadas/);
  assert.match(ui,/dataset\.state = 'pending'/);
  assert.match(ui,/dataset\.state = 'complete'/);
  assert.match(ui,/dataset\.state = 'error'/);
  assert.match(ui,/dataset\.threadRendered = result\?\.threadRendered === true/);
  assert.match(script,/diagnosis\.kind==='response_candidate'/);
  assert.match(script,/diagnosis\.reason==='thread_rendered'/);
  assert.match(script,/diagnosis\.attributable===true/);
  assert.match(script,/diagnosis\.state==='complete'\|\|diagnosis\.state==='error'/);
  assert.doesNotMatch(script,/status\.includes\(|Conversa carregada|Conversa e resposta da tarefa observadas/);
  assert.match(script,/if\(!result\.threadRendered\)process\.exitCode=2/);
});

test('safe observation timeout does not turn absence into session or success',async()=>{
  const code='test_observation_expired';
  await assert.rejects(observeWithin(()=>new Promise(()=>{}),{timeoutMs:20,code}),/test_observation_expired/);
  assert.deepEqual(await observeWithin(()=>Promise.resolve({found:false}),{timeoutMs:40}),{found:false});
});
