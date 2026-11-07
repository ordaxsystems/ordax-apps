import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canInspectHistoricalThreadAfterNavigationTimeout,
  safeHistoricalThreadFailure
} from '../src/provider-observation-policy.mjs';

const chat='https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';

test('only stopped main-frame at exact historical canonical URL may be inspected after timeout',()=>{
  assert.equal(canInspectHistoricalThreadAfterNavigationTimeout({
    expectedUrl:chat,actualUrl:chat,mainFrameLoading:false
  }),true);
  assert.equal(canInspectHistoricalThreadAfterNavigationTimeout({
    expectedUrl:chat+'/',actualUrl:chat,mainFrameLoading:false
  }),true);
  assert.equal(canInspectHistoricalThreadAfterNavigationTimeout({
    expectedUrl:chat,actualUrl:chat,mainFrameLoading:true
  }),false);
  assert.equal(canInspectHistoricalThreadAfterNavigationTimeout({
    expectedUrl:chat,actualUrl:'https://chatgpt.com/',mainFrameLoading:false
  }),false);
  assert.equal(canInspectHistoricalThreadAfterNavigationTimeout({
    expectedUrl:chat,actualUrl:chat.replace('11111111','99999999'),mainFrameLoading:false
  }),false);
  assert.equal(canInspectHistoricalThreadAfterNavigationTimeout({
    expectedUrl:chat,actualUrl:chat+'?unknown=true',mainFrameLoading:false
  }),false);
  assert.equal(canInspectHistoricalThreadAfterNavigationTimeout({
    expectedUrl:chat,actualUrl:'https://evil.example/c/11111111-2222-4333-8444-555555555555',
    mainFrameLoading:false
  }),false);
  assert.equal(canInspectHistoricalThreadAfterNavigationTimeout({
    expectedUrl:'https://chatgpt.com/auth/login',
    actualUrl:'https://chatgpt.com/auth/login',mainFrameLoading:false
  }),false);
});

test('diagnostic failure codes are allowlisted; private URLs and arbitrary errors never returned',()=>{
  for(const code of ['provider_navigation_timeout','provider_composer_observation_timeout',
    'chatgpt_draft_present','thread_dom_not_ready','thread_navigation_changed'])
    assert.equal(safeHistoricalThreadFailure(code),code);
  assert.equal(safeHistoricalThreadFailure('https://chatgpt.com/c/private-token?auth=secret'),
    'provider_inspection_unavailable');
  assert.equal(safeHistoricalThreadFailure('some private conversation'), 'provider_inspection_unavailable');
  assert.equal(safeHistoricalThreadFailure(undefined), 'provider_inspection_unavailable');
});
