import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessHistoricalThreadPreflight,mayReturnFromFailedProviderConversation} from '../src/provider-historical-thread-preflight.mjs';
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
  const recovery=fs.readFileSync(path.join(here,'../src/provider-linked-thread-recovery.mjs'),'utf8');
  assert.match(main,/inspectProviderLinkedThread\(\{store,worker,taskId:requestedId\}\)/);
  assert.match(recovery,/const provenance=findProviderSubmissionProvenance\(\{/);
  assert.match(recovery,/messageId:message\?\.id/);
  assert.match(recovery,/const threadRendered=assessment\.kind==='response_candidate'/);
  assert.match(recovery,/provider_submission_provenance_missing/);
  assert.ok(recovery.indexOf('if(!provenance)return')<recovery.indexOf('worker.inspectConversationReadOnly('));
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

test('explicit Back can leave a proven failed linked thread with no draft',()=>{
  const url=expectedUrl;
  const health={...base,url,composer_ready:false,auth_state:'unknown',
    page_state:'conversation_load_failed',health_observed:true,
    response_generation_active:false};
  const empty={found:false,text:''};
  assert.equal(mayReturnFromFailedProviderConversation({
    url,health,composerState:empty
  }),true);
  // Resource restrictions cannot justify a message send, but cannot trap the
  // operator on an already-failed empty document either.
  assert.equal(mayReturnFromFailedProviderConversation({
    url,health:{...health,provider_access_problem:'backend_http_403_observed'},
    composerState:empty
  }),true);
});

test('Back exception never accepts unknown pages, drafts, generation or wrong URL',()=>{
  const url=expectedUrl;
  const health={...base,url,composer_ready:false,
    page_state:'conversation_load_failed',response_generation_active:false};
  const empty={found:false,text:''};
  const cases=[
    {url:anotherUrl,health,composerState:empty},
    {url,health:{...health,url:anotherUrl},composerState:empty},
    {url,health:{...health,page_state:'unknown'},composerState:empty},
    {url,health:{...health,composer_ready:true},composerState:empty},
    {url,health:{...health,health_observed:false},composerState:empty},
    {url,health:{...health,connected:false},composerState:empty},
    {url,health:{...health,response_generation_active:true},composerState:empty},
    {url,health:{...health,verification_required:true},composerState:empty},
    {url,health,composerState:{found:true,text:''}},
    {url,health,composerState:{found:false,text:'Rascunho'}},
    {url,health,composerState:null},
    {url,health:null,composerState:empty},
    {url:'https://evil.example/c/11111111-2222-4333-8444-555555555555',health,composerState:empty}
  ];
  for(const state of cases)
    assert.equal(mayReturnFromFailedProviderConversation(state),false,JSON.stringify(state));
});

test('only manual Back can use failed-thread exception: never Reload or Forward',()=>{
  const guard=worker.slice(worker.indexOf('  async #assertManualNavigationSafe('),
    worker.indexOf('  async health()'));
  assert.match(guard,/mayReturnFromFailedProviderConversation/);
  assert.match(guard,/allowReturnFromFailedThread:direction==='back'/);
  const back=guard.slice(guard.indexOf('  async navigateHistory('),
    guard.indexOf('  async reloadCurrentPage('));
  assert.match(back,/if\(this\.active\)/);
  assert.match(back,/history\.goBack\(\)/);
  assert.doesNotMatch(back,/loadURL\(|sendPrompt\(|requestSubmit\(/);
  const reload=guard.slice(guard.indexOf('  async reloadCurrentPage('));
  assert.match(reload,/await this\.#assertManualNavigationSafe\(\);/);
  assert.doesNotMatch(reload,/allowReturnFromFailedThread/);
});
