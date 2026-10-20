import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForHistoricalThreadDom } from '../src/provider-historical-thread-observation.mjs';

const url='https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';
const notReady={available:true,url,domReliable:false,messages:[]};
const ready={available:true,url,domReliable:true,messages:[{role:'user',text:'synthetic'}]};

test('read-only thread waits for asynchronous DOM hydration, with no navigation or sending',async()=>{
  let reads=0,clock=0;
  const result=await waitForHistoricalThreadDom({
    expectedUrl:url,
    read:async()=>++reads===1?notReady:ready,
    now:()=>clock,sleep:async ms=>{clock+=ms;},timeoutMs:800,pollMs:50
  });
  assert.deepEqual(result,ready);
  assert.equal(reads,2);
});

test('DOM absent after finite observation is inconclusive, never success',async()=>{
  let now=0,reads=0;
  const result=await waitForHistoricalThreadDom({
    expectedUrl:url,read:async()=>{reads++;return notReady;},
    now:()=>now,sleep:async ms=>{now+=ms;},
    timeoutMs:120,pollMs:40
  });
  assert.equal(result.available,false);
  assert.equal(result.reason,'thread_dom_not_ready');
  assert.ok(reads>=1&&reads<=4);
});

test('hung provider JavaScript observation is never re-issued',async()=>{
  let attempts=0;
  const result=await waitForHistoricalThreadDom({
    expectedUrl:url,read:()=>{attempts++;return new Promise(()=>{});},
    timeoutMs:20,pollMs:1
  });
  assert.equal(result.available,false);
  assert.equal(result.reason,'observation_failed');
  assert.equal(attempts,1);
});

test('navigation mismatch or invalid request cannot be certified',async()=>{
  const result=await waitForHistoricalThreadDom({
    expectedUrl:url,read:async()=>({...ready,url:'https://chatgpt.com/'})
  });
  assert.equal(result.available,false);
  assert.equal(result.reason,'thread_navigation_changed');
  await assert.rejects(waitForHistoricalThreadDom({expectedUrl:'https://evil.example/',read:async()=>ready}),
    /invalid_thread_observation_request/);
});
