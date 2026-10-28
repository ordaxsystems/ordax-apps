import test from 'node:test';
import assert from 'node:assert/strict';
import { planProviderConversation, SUCCESSFUL_TURNS_PER_SEGMENT, MAX_OBSERVED_TRANSCRIPT_BYTES_PER_SEGMENT, assessProviderRotation, canonicalProviderChatUrl } from '../src/conversation-policy.mjs';

const makeTask = (turns, options = {}) => ({
  chat_url: options.url === undefined ? 'https://chatgpt.com/c/old' : options.url,
  conversations: options.url === null ? [] : [{
    id:'segment_old',chat_url:'https://chatgpt.com/c/old',
    status:'active',completed_turns:turns,
    ...(Object.hasOwn(options,'observedTranscriptBytes')?{observed_transcript_bytes:options.observedTranscriptBytes}:{})
  }]
});

test('one continuous task can hold arbitrarily many internal provider conversations', () => {
  assert.equal(SUCCESSFUL_TURNS_PER_SEGMENT,24);
  assert.equal(planProviderConversation(makeTask(23)).newSession,false);
  assert.equal(planProviderConversation(makeTask(24)).automaticRotation,true);
  assert.equal(planProviderConversation(makeTask(36)).newSession,true);
  assert.equal(planProviderConversation(makeTask(24)).reason,'completed_turn_threshold');
});

test('first and manually prepared sessions receive continuation without an automatic retry', () => {
  assert.equal(planProviderConversation(makeTask(0,{url:null})).newSession,true);
  assert.equal(planProviderConversation(makeTask(0),{forceNew:true}).newSession,true);
  assert.equal(planProviderConversation(makeTask(0)).newSession,false);
});

test('observed transcript pressure rotates before the completed-turn ceiling',()=>{
  const bytes=MAX_OBSERVED_TRANSCRIPT_BYTES_PER_SEGMENT;
  const plan=planProviderConversation(makeTask(3,{observedTranscriptBytes:bytes-10}),{nextPromptBytes:10});
  assert.equal(plan.automaticRotation,true);
  assert.equal(plan.newSession,true);
  assert.equal(plan.reason,'observed_transcript_budget');
  assert.equal(plan.completedTurns,3);
  assert.equal(plan.observedTranscriptBytes,bytes-10);
  assert.equal(plan.nextPromptBytes,10);
});

test('unavailable or malformed transcript measurements preserve the hard turn ceiling',()=>{
  const task=makeTask(3,{observedTranscriptBytes:null});
  assert.equal(planProviderConversation(task,{nextPromptBytes:MAX_OBSERVED_TRANSCRIPT_BYTES_PER_SEGMENT*4}).automaticRotation,false);
  assert.equal(planProviderConversation(makeTask(3,{observedTranscriptBytes:-1}),{nextPromptBytes:1}).automaticRotation,false);
  assert.equal(planProviderConversation(makeTask(3,{observedTranscriptBytes:MAX_OBSERVED_TRANSCRIPT_BYTES_PER_SEGMENT}),{nextPromptBytes:1}).automaticRotation,true);
});

test('the policy does not rotate on unavailable or inconsistent segment counts', () => {
  const task={chat_url:'https://chatgpt.com/c/old',conversations:[]};
  assert.equal(planProviderConversation(task).automaticRotation,false);
  assert.equal(planProviderConversation({chat_url:task.chat_url,conversations:[{id:'other',chat_url:'https://chatgpt.com/c/different',status:'active',completed_turns:300}]}).newSession,false);
});

test('rotation never claims success when the provider stayed on the same URL', () => {
  const plan=planProviderConversation(makeTask(24));
  assert.equal(assessProviderRotation(plan,'https://chatgpt.com/c/old','https://chatgpt.com/c/old'),'same_url');
  assert.equal(assessProviderRotation(plan,'https://chatgpt.com/c/old','https://chatgpt.com/c/new'),'rotated');
  assert.equal(assessProviderRotation(plan,'https://chatgpt.com/c/old',null),'missing_url');
  assert.equal(assessProviderRotation(planProviderConversation(makeTask(0)),'https://chatgpt.com/c/old','https://chatgpt.com/c/new'),'not_requested');
});

test('chat URL identity ignores query, fragment and trailing slash without inventing segments', () => {
  const url='https://chatgpt.com/c/abc-def-123';
  assert.equal(canonicalProviderChatUrl(url+'/?model=auto#latest'),url);
  assert.equal(canonicalProviderChatUrl('https://chatgpt.com/g/g-ordax/c/abc-123?foo=bar'),'https://chatgpt.com/g/g-ordax/c/abc-123');
  assert.equal(canonicalProviderChatUrl('https://chat.openai.com/c/abc-123'),'https://chat.openai.com/c/abc-123');
  for (const bad of [
    'https://chatgpt.com/','https://chatgpt.com/share/a-b-c',
    'https://example.org/c/abc-def-123','http://chatgpt.com/c/abc-def-123',
    'https://chatgpt.com.evil.test/c/abc-def-123',
    'https://chatgpt.com/c/abc-def-123/more',
    'https://chatgpt.com@evil.test/c/abc-def-123','data:text/html,hello',null
  ]) assert.equal(canonicalProviderChatUrl(bad),null);
  const plan=planProviderConversation(makeTask(24));
  assert.equal(assessProviderRotation(plan,url,url+'?model=auto'),'same_url');
  assert.equal(assessProviderRotation(plan,url,'https://chatgpt.com/'),'invalid_url');
  assert.equal(planProviderConversation({
    chat_url:url+'?model=auto',
    conversations:[{id:'same',chat_url:url,status:'active',completed_turns:24}]
  }).automaticRotation,true);
});
