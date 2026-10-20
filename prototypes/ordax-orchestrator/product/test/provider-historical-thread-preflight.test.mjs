import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessHistoricalThreadPreflight} from '../src/provider-historical-thread-preflight.mjs';
import {safeHistoricalThreadFailure} from '../src/provider-observation-policy.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const worker=fs.readFileSync(path.join(here,'../desktop/embedded-worker.mjs'),'utf8');
const main=fs.readFileSync(path.join(here,'../desktop/main.mjs'),'utf8');
const ui=fs.readFileSync(path.join(here,'../desktop/ui.js'),'utf8');
const expectedUrl='https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';
const anotherUrl='https://chatgpt.com/c/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const base={
  connected:true,health_observed:true,verification_required:false,
  provider_access_problem:null,auth_state:'session_present',
  composer_ready:true,url:'https://chatgpt.com/'
};
const inspect=health=>assessHistoricalThreadPreflight({expectedUrl,health});

test('W3 navigation requires observed provider session, never speculative login',()=>{
  assert.deepEqual(inspect(base),{
    allowed:true,reason:'session_observed_for_navigation'
  });
  for(const value of [null,undefined,{}, {...base,health_observed:false},
    {...base,connected:false}])
    assert.deepEqual(inspect(value),{allowed:false,reason:'provider_health_unavailable'});
  assert.deepEqual(inspect({...base,auth_state:'unknown'}),{
    allowed:false,reason:'provider_session_not_observed'
  });
  assert.deepEqual(inspect({...base,composer_ready:false}),{
    allowed:false,reason:'provider_session_not_observed'
  });
});

test('W3 blocks definitive login, verification, observed first-party 429/403 before navigation',()=>{
  const cases=[
    [{...base,auth_state:'anonymous'},'provider_login_required'],
    [{...base,auth_state:'authenticating'},'provider_authentication_in_progress'],
    [{...base,verification_required:true},'provider_verification_required'],
    [{...base,provider_access_problem:'backend_http_429_observed'},'provider_rate_limited_observed'],
    [{...base,provider_access_problem:'backend_http_403_observed'},'provider_access_restricted_observed']
  ];
  for(const [health,reason] of cases){
    const result=inspect(health);
    assert.deepEqual(result,{allowed:false,reason});
    assert.equal(safeHistoricalThreadFailure(reason),reason);
  }
});

test('already-linked provider URL may be observed without composer but never over warnings',()=>{
  assert.deepEqual(inspect({...base,url:expectedUrl,auth_state:'unknown',composer_ready:false}),{
    allowed:true,reason:'already_at_linked_thread'
  });
  assert.deepEqual(inspect({...base,url:expectedUrl,auth_state:'session_present',composer_ready:false}),{
    allowed:true,reason:'already_at_linked_thread'
  });
  assert.deepEqual(inspect({...base,url:expectedUrl,auth_state:'unknown',
    composer_ready:false,provider_access_problem:'backend_http_429_observed'}),{
    allowed:false,reason:'provider_rate_limited_observed'
  });
  assert.deepEqual(inspect({...base,url:anotherUrl,auth_state:'unknown'}),{
    allowed:false,reason:'provider_session_not_observed'
  });
});

test('invalid target never initiates observation',()=>{
  assert.deepEqual(assessHistoricalThreadPreflight({expectedUrl:'https://evil.test',health:base}),{
    allowed:false,reason:'canonical_chat_url_missing'
  });
  assert.deepEqual(assessHistoricalThreadPreflight({expectedUrl:'https://chatgpt.com/',health:base}),{
    allowed:false,reason:'canonical_chat_url_missing'
  });
});

test('real worker implementation stops before showConversation when W3 preflight fails',()=>{
  const method=worker.slice(worker.indexOf('  async inspectConversationReadOnly('),
    worker.indexOf('  async #composerState(',worker.indexOf('  async inspectConversationReadOnly(')));
  assert.match(method,/const health=await this\.health\(\)\.catch/);
  assert.match(method,/assessHistoricalThreadPreflight\(\{expectedUrl:expected,health\}\)/);
  assert.match(method,/if\(!preflight\.allowed\)/);
  assert.match(method,/return \{available:false,url:expected,reason:preflight\.reason\}/);
  assert.ok(method.indexOf('if(!preflight.allowed)') < method.indexOf('this.showConversation('));
  assert.doesNotMatch(method,/sendPrompt\(|requestSubmit\(|\.login\(/);
  assert.match(main,/const provenance=findProviderSubmissionProvenance\(\{/);
  assert.match(main,/messageId:message\?\.id/);
  assert.match(main,/const threadRendered=Boolean\(provenance\)/);
  assert.match(main,/provider_submission_provenance_missing/);
  assert.match(ui,/provider_rate_limited_observed/);
  assert.match(ui,/provider_session_not_observed/);
});

test('historical CDP debugger is detached only when inspection attached it',()=>{
  const start=worker.indexOf('  async #readHistoricalThreadDOM()');
  const end=worker.indexOf('  async inspectConversationReadOnly(',start);
  assert.ok(start>=0&&end>start);
  const body=worker.slice(start,end);
  assert.match(body,/let attachedHere=false/);
  assert.match(body,/attachedHere=true/);
  assert.match(body,/finally \{/);
  assert.match(body,/if\(attachedHere\)/);
  assert.match(body,/wc\.debugger\.detach\(\)/);
  assert.match(body,/timeoutMs:1800,code:'provider_readonly_dom_evaluation_timeout'/);
  assert.equal(safeHistoricalThreadFailure('provider_readonly_dom_evaluation_timeout'),
    'provider_readonly_dom_evaluation_timeout');
  assert.ok(body.indexOf('finally {')>body.indexOf("wc.debugger.sendCommand('Runtime.evaluate'"));
});
