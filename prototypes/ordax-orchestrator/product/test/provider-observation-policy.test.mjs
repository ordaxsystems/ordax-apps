import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {observeWithin,classifyProviderAuthObservation,classifyProviderAccessRestriction} from '../src/provider-observation-policy.mjs';

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
  assert.match(health,/entry\.responseStatus !== 403/);
  assert.match(health,/requestUrl\.origin==='https:\/\/chatgpt\.com'/);
  assert.match(health,/pathname\.startsWith\('\/backend-api\/'\)/);
  assert.match(health,/backendForbiddenCount:Math\.min\(100,backendForbiddenCount\)/);
  assert.match(health,/classifyProviderAccessRestriction/);
  assert.match(health,/provider_access_problem:providerAccessProblem/);
  assert.doesNotMatch(health,/return.*entry\.name|return.*requestUrl\.href/);
});
