import test from 'node:test';
import assert from 'node:assert/strict';
import { assessProviderConversationEvidence } from '../src/provider-conversation-reconciliation.mjs';

const url='https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';
const prompt='ORDAX_UNIQUE_MESSAGE_1';
const user={role:'user',text:prompt};
const assistant={role:'assistant',text:'Output of the previous task'};
const inspect=overrides=>({expectedUrl:url,expectedMessage:prompt,observed:{
  available:true,url,domReliable:true,truncated:false,messages:[user,assistant],
  ...(overrides||{})
}});
test('bounded exact matching is only a candidate, never verified delivery or effect',()=>{
  assert.deepEqual(assessProviderConversationEvidence(inspect()),{
    kind:'response_candidate',reason:'dom_match_not_attributable',
    candidates:1,responseCandidate:true,requiresReconciliation:true
  });
});
test('same text duplicated is ambiguous, even if response appears',()=>{
  const result=assessProviderConversationEvidence(inspect({messages:[user,assistant,user,assistant]}));
  assert.equal(result.kind,'ambiguous');
  assert.equal(result.requiresReconciliation,true);
});
test('response before exact user message is not a response to that message',()=>{
  const result=assessProviderConversationEvidence(inspect({messages:[assistant,user]}));
  assert.equal(result.kind,'message_candidate');
  assert.equal(result.responseCandidate,false);
});
test('answer following a newer user message is not attributable to earlier matching message',()=>{
  const result=assessProviderConversationEvidence(inspect({messages:[
    user,{role:'user',text:'A different task'},assistant
  ]}));
  assert.equal(result.kind,'message_candidate');
  assert.equal(result.responseCandidate,false);
});
test('substring is not proof of exact match',()=>{
  const result=assessProviderConversationEvidence(inspect({messages:[
    {role:'user',text:'prefix '+prompt+' suffix'},assistant
  ]}));
  assert.equal(result.kind,'unresolved');
  assert.equal(result.requiresReconciliation,true);
});
test('wrong thread, anonymous home, missing DOM and incomplete text fail closed',()=>{
  assert.equal(assessProviderConversationEvidence(inspect({url:'https://chatgpt.com/c/elsewhere'})).kind,'unavailable');
  assert.equal(assessProviderConversationEvidence(inspect({url:'https://chatgpt.com/'})).kind,'unavailable');
  assert.equal(assessProviderConversationEvidence(inspect({domReliable:false})).kind,'unavailable');
  assert.equal(assessProviderConversationEvidence(inspect({messages:[{...user,textTruncated:true}]})).kind,'unavailable');
});
test('absence from a partial DOM is not evidence of no delivery',()=>{
  const r=assessProviderConversationEvidence(inspect({truncated:true,messages:[assistant]}));
  assert.equal(r.kind,'unresolved');
  assert.equal(r.reason,'message_not_visible_in_partial_dom');
  assert.equal(r.requiresReconciliation,true);
});
test('malformed or oversized observations cannot create a receipt',()=>{
  assert.equal(assessProviderConversationEvidence(inspect({messages:[null]})).kind,'unavailable');
  assert.equal(assessProviderConversationEvidence(inspect({messages:[{...user,text:'x'.repeat(12001)}]})).kind,'unavailable');
  assert.equal(assessProviderConversationEvidence(inspect({messages:Array(51).fill(user)})).kind,'unavailable');
});

test('long technical assistant response stays a candidate only for exact unique prompt',()=>{
  const long={role:'assistant',text:'CODE\\n'.repeat(17600)};
  const accepted=assessProviderConversationEvidence(inspect({messages:[user,long]}));
  assert.equal(accepted.kind,'response_candidate');
  assert.equal(accepted.requiresReconciliation,true);
  const wrong=assessProviderConversationEvidence(inspect({messages:[{role:'user',text:prompt+' changed'},long]}));
  assert.equal(wrong.kind,'unresolved');
  const tooLong=assessProviderConversationEvidence(inspect({messages:[user,{role:'assistant',text:'x'.repeat(100001)}]}));
  assert.equal(tooLong.kind,'unavailable');
  const truncated=assessProviderConversationEvidence(inspect({messages:[user,{...long,textTruncated:true}]}));
  assert.equal(truncated.kind,'unavailable');
});
