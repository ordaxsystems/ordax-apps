import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {Store} from '../src/store.mjs';
import {canonicalProviderChatUrl} from '../src/conversation-policy.mjs';
import {findProviderSubmissionProvenance,recordProviderSubmissionProvenance} from '../src/provider-submission-provenance.mjs';

const link='https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';
const main=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
const start=main.indexOf("registerUiHandler('ordax:tasks:inspect-linked-thread'");
const end=main.indexOf("registerUiHandler('ordax:tasks:resume-capsule'",start);
assert.ok(start>=0&&end>start,'W3 canonical handler not found');
const handlerSource=main.slice(start,end);

function fixture(t) {
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const task=store.createTask('W3 Local receipt first');
  const {userMessage,runId}=store.beginProviderRun(task.id,'W3 local test only');
  store.setChatUrl(task.id,link);
  let inspectCalls=0;
  const registered=new Map();
  const worker={inspectConversationReadOnly:async()=>{inspectCalls++;return {
    available:false,reason:'thread_dom_not_ready'
  }}};
  const ctx={
    registerUiHandler:(name,fn)=>registered.set(name,fn),
    requireTrustedSupervisorRenderer:()=>{},
    liveRun:null,store,worker,canonicalProviderChatUrl,
    findProviderSubmissionProvenance,
    assessProviderConversationEvidence:()=>({
      kind:'unavailable',reason:'thread_dom_not_ready',
      responseCandidate:false,requiresReconciliation:true
    }),
    safeHistoricalThreadFailure:(reason)=>reason||'unknown'
  };
  vm.runInNewContext(handlerSource,ctx,{timeout:2000});
  const inspect=registered.get('ordax:tasks:inspect-linked-thread');
  assert.equal(typeof inspect,'function');
  return {store,task,userMessage,runId,ctx,inspect,
    calls:()=>inspectCalls};
}
test('W3 without latest-turn receipt stops before touching ChatGPT, but keeps task intact',async t=>{
  const x=fixture(t);
  const before={
    events:x.store.db.prepare('SELECT COUNT(*) n FROM events').get().n,
    messages:x.store.db.prepare('SELECT COUNT(*) n FROM messages').get().n,
    url:x.store.getTask(x.task.id).chat_url
  };
  const result=await x.inspect({},x.task.id);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{
    kind:'unavailable',reason:'provider_submission_provenance_missing',
    inspectionReason:'provider_submission_provenance_missing',
    threadRendered:false,responseCandidate:false,requiresReconciliation:true
  });
  assert.equal(x.calls(),0);
  assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM events').get().n,before.events);
  assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM messages').get().n,before.messages);
  assert.equal(x.store.getTask(x.task.id).chat_url,before.url);
});
test('W3 never navigates using an older receipt after a newer unsubmitted user turn',async t=>{
  const x=fixture(t);
  const proof=recordProviderSubmissionProvenance({
    store:x.store,taskId:x.task.id,runId:x.runId,
    messageId:x.userMessage.id,providerPrompt:'W3 local test only',
    chatUrl:link,submittedAt:Date.now()
  });
  assert.equal(proof.recorded,true);
  x.store.appendMessage(x.task.id,'user','A newer local-only prompt');
  const result=await x.inspect({},x.task.id);
  assert.equal(result.inspectionReason,'provider_submission_provenance_missing');
  assert.equal(x.calls(),0);
});
test('W3 valid latest-turn receipt retains a single authorized read-only inspection',async t=>{
  const x=fixture(t);
  const proof=recordProviderSubmissionProvenance({
    store:x.store,taskId:x.task.id,runId:x.runId,
    messageId:x.userMessage.id,providerPrompt:'W3 local test only',
    chatUrl:link,submittedAt:Date.now()
  });
  assert.equal(proof.recorded,true);
  const result=await x.inspect({},x.task.id);
  assert.equal(x.calls(),1);
  assert.equal(result.threadRendered,false);
  assert.equal(result.inspectionReason,'thread_dom_not_ready');
  assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM messages').get().n,1);
});
test('W3 missing-receipt check comes before any call that loads a provider URL',()=>{
 const guard=handlerSource.indexOf('if (!provenance) return {');
 const navigate=handlerSource.indexOf('worker.inspectConversationReadOnly(');
 assert.ok(guard>0&&navigate>guard);
 assert.doesNotMatch(handlerSource,/sendPrompt\(|requestSubmit\(|\.reload\(/);
});
