import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {canAcceptObservedNavigationAfterTimeout} from '../src/provider-observation-policy.mjs';

const good={
  expectedUrl:'https://chatgpt.com/',
  actualUrl:'https://chatgpt.com/',
  requireComposer:true,
  mainFrameLoading:false,
  composerFound:true,
  composerFormReady:true,
  authState:'session_present',
  healthObserved:true
};
test('accepts timeout only if target is an already-observed usable ChatGPT home',()=>{
  assert.equal(canAcceptObservedNavigationAfterTimeout(good),true);
  assert.equal(canAcceptObservedNavigationAfterTimeout({
    ...good,expectedUrl:'https://chatgpt.com/c/11111111-2222-4333-8444-555555555555',
    actualUrl:'https://chatgpt.com/c/11111111-2222-4333-8444-555555555555'
  }),true);
});
test('rejects stale previous page, login, redirect, credentials and unknown state',()=>{
  for(const variant of [
    {actualUrl:'https://chatgpt.com/c/old-thread'},
    {actualUrl:'https://chatgpt.com/auth/login'},
    {actualUrl:'https://evil.example/'},
    {expectedUrl:'https://evil.example/',actualUrl:'https://evil.example/'},
    {expectedUrl:'https://chatgpt.com/auth/login',requireComposer:false},
    {expectedUrl:'https://chatgpt.com/',actualUrl:'https://chatgpt.com/?unexpected=1'},
    {expectedUrl:'https://chatgpt.com/',actualUrl:'https://chatgpt.com:443@evil.example/'},
    {mainFrameLoading:true},
    {mainFrameLoading:null},
    {requireComposer:false},
    {composerFound:false},
    {composerFormReady:false},
    {authState:'anonymous'},
    {authState:'authenticating'},
    {authState:'unknown'},
    {healthObserved:false},
    {healthObserved:undefined}
  ])assert.equal(canAcceptObservedNavigationAfterTimeout({...good,...variant}),false,
    JSON.stringify(variant));
});
test('worker checks destination and stable interactive DOM after timeout without a second load',()=>{
  const code=fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),
    '../desktop/embedded-worker.mjs'),'utf8');
  const segment=code.split('  async #safeLoad(')[1].split('  async #assistantSnapshot(')[0];
  assert.match(segment,/provider_navigation_timeout/);
  assert.match(segment,/canAcceptObservedNavigationAfterTimeout/);
  assert.match(segment,/mainFrameLoading:wc\.isLoadingMainFrame\(\)/);
  assert.match(segment,/authState:health\?\.auth_state/);
  assert.match(segment,/if \(!confirmed\) throw error/);
  const navCalls=segment.match(/wc\.loadURL\(url\)/g)||[];
  assert.equal(navCalls.length,1,'no automatic second navigation');
  assert.doesNotMatch(segment,/sendPrompt|requestSubmit|click\(/);
});
