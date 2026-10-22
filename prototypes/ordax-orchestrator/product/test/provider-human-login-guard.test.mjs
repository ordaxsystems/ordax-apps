import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertProviderSendReadiness} from '../src/provider-observation-policy.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
test('anonymous, unreadable and in-progress sessions cannot reach send preparation',()=>{
  for(const [health,expected] of [
    [null,'chatgpt_session_not_observed'],
    [{auth_state:'anonymous',composer_ready:true},'chatgpt_login_required'],
    [{auth_state:'unknown',composer_ready:true},'chatgpt_session_not_observed'],
    [{auth_state:'loading',composer_ready:false},'chatgpt_session_not_observed'],
    [{auth_state:'authenticating',composer_ready:true},'chatgpt_authentication_in_progress'],
    [{auth_state:'session_present',composer_ready:false},'chatgpt_session_not_observed'],
    [{auth_state:'session_present',composer_ready:true,health_observed:false},'chatgpt_session_not_observed'],
    [{auth_state:'session_present',composer_ready:true,verification_required:true},'chatgpt_verification_required'],
    [{auth_state:'unknown',composer_ready:false,provider_access_problem:'backend_http_403_observed'},'chatgpt_provider_backend_access_restricted'],
  ])assert.throws(()=>assertProviderSendReadiness(health),{message:expected});
});

test('a positively observed composer plus session heuristics may pass PREP only',()=>{
  assert.equal(assertProviderSendReadiness({
    auth_state:'session_present',composer_ready:true,health_observed:true,
    verification_required:false
  }),true);
  // This is only a necessary preliminary gate. Never claim account identity,
  // message delivery or verified local effects based on this function.
});

test('actual worker invokes pre-submit gate before draft, baseline and submission',()=>{
  const worker=fs.readFileSync(path.resolve(here,'../desktop/embedded-worker.mjs'),'utf8');
  const send=worker.split('  async sendPrompt({')[1];
  assert.ok(send);
  const auth=send.indexOf('assertProviderSendReadiness(health)');
  const draft=send.indexOf('const currentDraft =');
  const submit=send.indexOf('await this.#setComposerAndSend(promptText)');
  assert.ok(auth>0&&auth<draft&&draft<submit);
  assert.match(worker,/classifyProviderAuthObservation/);
});

test('login button uses official login navigation without auto-clicking Google',()=>{
  const ui=fs.readFileSync(path.resolve(here,'../desktop/ui.js'),'utf8');
  const handler=ui.split("$('#login').addEventListener('click'")[1]
    .split("$('#observerMode').addEventListener('change'")[0];
  assert.match(handler,/await setDirectModeVisible\(true\)/);
  assert.match(ui,/async function setDirectModeVisible\(visible\)/);
  assert.match(ui,/await window\.ordax\.setChatVisible\(visible\)/);
  assert.match(ui,/dataset\.ordaxView = visible \? 'provider' : 'app'/);
  assert.match(handler,/window\.ordax\.login\(\)/);
  assert.doesNotMatch(handler,/loginGoogle|Continue with Google|mouseDown/);
  const worker=fs.readFileSync(path.resolve(here,'../desktop/embedded-worker.mjs'),'utf8');
  const main=fs.readFileSync(path.resolve(here,'../desktop/main.mjs'),'utf8');
  const preload=fs.readFileSync(path.resolve(here,'../desktop/preload.cjs'),'utf8');
  assert.doesNotMatch(worker,/async loginGoogle\(\)/);
  assert.doesNotMatch(main,/ordax:provider:login-google/);
  assert.doesNotMatch(preload,/loginGoogle/);
  const refresh=ui.split('async function refreshProvider()')[1]
    .split('function setContextOpen(')[0];
  assert.doesNotMatch(refresh,/if \(loginFlowVisible && status\.auth_state/);
  assert.doesNotMatch(refresh,/Sessão persistente do OrdaX/);
  assert.match(refresh,/identidade não verificada/);
  assert.match(ui,/chatgpt_session_not_observed/);
  assert.match(ui,/ChatGPT • acesso recusado \(403\)/);
  assert.match(ui,/chatgpt_provider_backend_access_restricted/);
});
