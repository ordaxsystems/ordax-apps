import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {observeWithin,classifyProviderAuthObservation,classifyProviderAccessRestriction,assertProviderSendReadiness,normalizeProviderFailure} from '../src/provider-observation-policy.mjs';

test('provider failure exposes a safe retry disposition only before submit was attempted',()=>{
  const safe=normalizeProviderFailure(new Error('health:chatgpt_session_not_observed'),{stage:'health'});
  assert.equal(safe.message,'health:chatgpt_session_not_observed');
  assert.equal(safe.providerDeliveryState,'not_submitted');
  assert.equal(safe.providerFailureCode,'chatgpt_session_not_observed');
  const uncertain=normalizeProviderFailure(new Error('private provider detail'),{
    stage:'await-response',submitAttemptAt:123
  });
  assert.equal(uncertain.message,'await-response:provider_send_unconfirmed');
  assert.equal(uncertain.providerDeliveryState,'uncertain');
  assert.equal(uncertain.providerFailureCode,'provider_send_unconfirmed');
  const submitted=normalizeProviderFailure(new Error('await-response:chatgpt_response_retry_required'),{
    stage:'await-response',submitAttemptAt:123,submissionConfirmedAt:456
  });
  assert.equal(submitted.message,'await-response:chatgpt_response_retry_required');
  assert.equal(submitted.providerDeliveryState,'submitted');
  assert.equal(submitted.providerFailureCode,'chatgpt_response_retry_required');
  assert.equal(normalizeProviderFailure(new Error('provider_error'),{
    submitAttemptAt:123,submissionConfirmedAt:'456'
  }).providerDeliveryState,'uncertain');
});

test('DOM unavailable on ChatGPT home is UNKNOWN, not logged in',()=>{
  assert.equal(classifyProviderAuthObservation({url:'https://chatgpt.com/',page:null}),'unknown');
  assert.equal(classifyProviderAuthObservation({url:'https://chatgpt.com/',
    page:{composer:false,hasLogin:false,hasSignup:false}}),'unknown');
  assert.equal(classifyProviderAuthObservation({url:'https://chatgpt.com/',
    page:{composer:true,hasLogin:true,hasSignup:true}}),'anonymous');
  assert.equal(classifyProviderAuthObservation({url:'https://chatgpt.com/',
    page:{composer:true,hasLogin:false,hasSignup:false}}),'session_present');
  assert.equal(classifyProviderAuthObservation({url:'https://chatgpt.com/',
    page:{composer:true,hasLogin:true,hasSignup:false}}),'unknown');
});

test('authentication route remains authenticating even when DOM is unavailable',()=>{
  for(const url of ['https://chatgpt.com/auth/login',
    'https://auth.openai.com/authorize','https://accounts.google.com/signin']){
    assert.equal(classifyProviderAuthObservation({url,page:null}),'authenticating');
  }
});

test('provider observation timeout stops waiting but never retries uncertain navigation',async()=>{
  let calls=0,settle;
  const pending=new Promise(resolve=>{settle=resolve;});
  await assert.rejects(observeWithin(()=>{calls++;return pending;},
    {timeoutMs:20,code:'provider_navigation_timeout'}),/provider_navigation_timeout/);
  assert.equal(calls,1);
  settle('late-completion');
  assert.equal(await observeWithin(()=>Promise.resolve('observed'),{timeoutMs:30}),'observed');
});

test('provider observation propagates typed failure without reexecuting the operation',async()=>{
  let count=0;
  await assert.rejects(observeWithin(()=>{
    count++;throw new Error('load_failed');
  },{timeoutMs:40}),/load_failed/);
  assert.equal(count,1);
  await assert.rejects(observeWithin(()=>Promise.resolve(),{timeoutMs:0}),
    /invalid_observation_timeout/);
});

test('worker health is bounded and can never turn missing DOM into confirmed session',()=>{
  const here=path.dirname(fileURLToPath(import.meta.url));
  const code=fs.readFileSync(path.resolve(here,'../desktop/embedded-worker.mjs'),'utf8');
  const health=code.split('  async health() {')[1].split('  enqueue(fn) {')[0];
  assert.match(health,/observeWithin\(\(\) => this\.view\.webContents\.executeJavaScript/);
  assert.match(health,/timeoutMs:5000/);
  assert.match(health,/\.catch\(\(\) => null\)/);
  assert.match(health,/classifyProviderAuthObservation/);
  assert.match(health,/health_observed:page!==null/);
  const loader=code.split('  async #safeLoad(')[1].split('  async #assistantSnapshot(')[0];
  assert.match(loader,/observeWithin\(\(\) => wc\.loadURL\(url\)/);
  assert.match(loader,/provider_navigation_timeout/);
  assert.doesNotMatch(loader,/retry|attemptSend|requestSubmit/);
});

test('ChatGPT backend 403 evidence is not confused with account authentication',()=>{
  assert.equal(classifyProviderAccessRestriction({forbiddenCount:23,composerReady:false}),
    'backend_http_403_observed');
  assert.equal(classifyProviderAccessRestriction({forbiddenCount:1,composerReady:false}),null);
  assert.equal(classifyProviderAccessRestriction({forbiddenCount:23,composerReady:true}),null);
  assert.equal(classifyProviderAccessRestriction({forbiddenCount:-1}),null);
  assert.equal(classifyProviderAccessRestriction({forbiddenCount:'23'}),null);
  assert.equal(classifyProviderAuthObservation({
    url:'https://chatgpt.com/',page:{composer:false,hasLogin:false,hasSignup:false,
      backendForbiddenCount:23}
  }),'unknown');
});

test('worker health counts only HTTP 403 from first-party backend API with no URL export',()=>{
  const here=path.dirname(fileURLToPath(import.meta.url));
  const worker=fs.readFileSync(path.resolve(here,'../desktop/embedded-worker.mjs'),'utf8');
  const health=worker.split('  async health() {')[1].split('  enqueue(fn) {')[0];
  assert.match(health,/entry\.responseStatus !== 403 && entry\.responseStatus !== 429/);
  assert.match(health,/backendRateLimitedCount:Math\.min\(100,backendRateLimitedCount\)/);
  assert.match(health,/rateLimitedCount:page\?\.backendRateLimitedCount/);
  assert.match(health,/backend_api_429_count:page\?\.backendRateLimitedCount/);
  assert.match(health,/requestUrl\.origin==='https:\/\/chatgpt\.com'/);
  assert.match(health,/pathname\.startsWith\('\/backend-api\/'\)/);
  assert.match(health,/backendForbiddenCount:Math\.min\(100,backendForbiddenCount\)/);
  assert.match(health,/classifyProviderAccessRestriction/);
  assert.match(health,/provider_access_problem:providerAccessProblem/);
  assert.doesNotMatch(health,/return.*entry\.name|return.*requestUrl\.href/);
});

test('one observed first-party HTTP 429 is a warning, not authentication proof',()=>{
  assert.equal(classifyProviderAccessRestriction({rateLimitedCount:1,composerReady:false}),
    'backend_http_429_observed');
  assert.equal(classifyProviderAccessRestriction({rateLimitedCount:1,composerReady:true}),null);
  assert.equal(classifyProviderAccessRestriction({rateLimitedCount:1,forbiddenCount:23,composerReady:false}),
    'backend_http_429_observed');
  assert.equal(classifyProviderAccessRestriction({rateLimitedCount:-1,composerReady:false}),null);
  assert.equal(classifyProviderAccessRestriction({rateLimitedCount:'1',composerReady:false}),null);
  assert.equal(classifyProviderAuthObservation({url:'https://chatgpt.com/',page:{
    composer:false,hasLogin:false,hasSignup:false,backendRateLimitedCount:1}}),'unknown');
  assert.throws(()=>assertProviderSendReadiness({
    provider_access_problem:'backend_http_429_observed',auth_state:'unknown',
    composer_ready:false,health_observed:true
  }),/chatgpt_provider_rate_limited_observed/);
});

test('429 is surfaced only through sanitized first-party status counts, not private URLs',()=>{
  const here=path.dirname(fileURLToPath(import.meta.url));
  const worker=fs.readFileSync(path.resolve(here,'../desktop/embedded-worker.mjs'),'utf8');
  const ui=fs.readFileSync(path.resolve(here,'../desktop/ui.js'),'utf8');
  const health=worker.split('  async health() {')[1].split('  enqueue(fn) {')[0];
  assert.match(health,/requestUrl\.origin==='https:\/\/chatgpt\.com'/);
  assert.match(health,/requestUrl\.pathname\.startsWith\('\/backend-api\/'\)/);
  assert.match(health,/entry\.responseStatus===429/);
  assert.doesNotMatch(health,/return.*entry\.name|return.*requestUrl\.href/);
  assert.match(ui,/ChatGPT • limitação observada \(429\)/);
  assert.match(ui,/chatgpt_provider_rate_limited_observed:/);
  assert.doesNotMatch(ui,/429.*(?:setTimeout|retry|reload)/i);
});

test('provider preflight blocks composing over active GPT generation or unresolved response failure',()=>{
  const ready={auth_state:'session_present',composer_ready:true,health_observed:true};
  assert.throws(()=>assertProviderSendReadiness({...ready,response_generation_active:true}),
    /chatgpt_response_in_progress/);
  assert.throws(()=>assertProviderSendReadiness({...ready,
    provider_response_failure:'chatgpt_response_retry_required'}),/chatgpt_response_retry_required/);
  assert.throws(()=>assertProviderSendReadiness({...ready,
    provider_response_failure:'chatgpt_response_error_observed'}),/chatgpt_response_error_observed/);
});
