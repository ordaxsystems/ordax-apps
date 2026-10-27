import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {createProviderDeliveryRecorder} from '../src/provider-delivery-recorder.mjs';
import {bindObservedSubmittedConversation} from '../src/provider-submitted-conversation.mjs';
import {recordProviderSubmissionProvenance,findProviderSubmissionProvenance,providerPromptDigest} from '../src/provider-submission-provenance.mjs';

const url='https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';
const otherUrl='https://chatgpt.com/c/22222222-3333-4444-8555-666666666666';
const submittedAt=Date.now();
function fixture(fn) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-followup-receipt-'));
  const store=new Store(path.join(dir,'lab.sqlite'));
  const cleanup=()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});};
  return Promise.resolve().then(()=>fn(store)).finally(cleanup);
}

test('W3 durable receipt for an existing Task thread is captured exactly once after submission',async()=>{
  await fixture(async store=>{
    const task=store.createTask('Existing conversation');
    store.setChatUrl(task.id,url);
    const beforeCount=store.db.prepare('SELECT COUNT(*) n FROM task_conversations WHERE task_id=?').get(task.id).n;
    const {runId,userMessage}=store.beginProviderRun(task.id,'continue');
    const expanded='[CONTEXTO ORDAX]\nPedido atual: continue';
    let callbacks=0;
    const record=createProviderDeliveryRecorder({
      startsFresh:false,expectedChatUrl:url,
      onDeliveryObserved:async ({chatUrl,submittedAt:at})=>{
        callbacks++;
        const binding=bindObservedSubmittedConversation({
          store,taskId:task.id,runId,chatUrl,submittedAt:at,
          plannedNewSession:false
        });
        assert.deepEqual(binding,{bound:false,reason:'not_new_conversation'});
        return recordProviderSubmissionProvenance({
          store,taskId:task.id,runId,messageId:userMessage.id,
          providerPrompt:expanded,chatUrl,submittedAt:at
        });
      }
    });
    assert.equal(await record({currentUrl:url}),false);
    assert.equal(await record({currentUrl:url,submittedAt:0}),false);
    assert.equal(await record({currentUrl:otherUrl,submittedAt}),false);
    assert.equal(await record({currentUrl:'https://chatgpt.com/',submittedAt}),false);
    assert.equal(callbacks,0);
    assert.equal(await record({currentUrl:url+'?utm_source=other',submittedAt}),true);
    assert.equal(await record({currentUrl:url,submittedAt}),false);
    assert.equal(callbacks,1);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM task_conversations WHERE task_id=?').get(task.id).n,beforeCount);
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM events WHERE kind='provider.submission.provenance' AND task_id=?").get(task.id).n,1);
    const latest=findProviderSubmissionProvenance({store,taskId:task.id,chatUrl:url,messageId:userMessage.id});
    assert.equal(latest.runId,runId);
    assert.equal(latest.promptSha256,providerPromptDigest(expanded));
  });
});

test('W3 first conversation still records its permalink before response and exactly once',async()=>{
  await fixture(async store=>{
    const task=store.createTask('New conversation');
    const {runId,userMessage}=store.beginProviderRun(task.id,'hello');
    let callbacks=0;
    const record=createProviderDeliveryRecorder({
      startsFresh:true,expectedChatUrl:null,
      onDeliveryObserved:async ({chatUrl,submittedAt:at})=>{
        callbacks++;
        const bound=bindObservedSubmittedConversation({
          store,taskId:task.id,runId,chatUrl,submittedAt:at,plannedNewSession:true
        });
        assert.equal(bound.bound,true);
        const receipt=recordProviderSubmissionProvenance({
          store,taskId:task.id,runId,messageId:userMessage.id,
          providerPrompt:'hello',chatUrl,submittedAt:at
        });
        assert.equal(receipt.recorded,true);
      }
    });
    assert.equal(await record({currentUrl:'https://chatgpt.com/',submittedAt}),false);
    assert.equal(await record({currentUrl:url,submittedAt}),true);
    assert.equal(await record({currentUrl:url,submittedAt}),false);
    assert.equal(callbacks,1);
    assert.equal(store.getTaskExecutionSnapshot(task.id).chat_url,url);
    assert.ok(findProviderSubmissionProvenance({store,taskId:task.id,chatUrl:url,messageId:userMessage.id}));
  });
});

test('W3 cannot record a callback on another conversation or without a confirmed UI receipt',async()=>{
  let callbacks=0;
  const record=createProviderDeliveryRecorder({
    startsFresh:false,expectedChatUrl:url,
    onDeliveryObserved:async()=>{callbacks++;}
  });
  for(const candidate of [
    {currentUrl:otherUrl,submittedAt},
    {currentUrl:'https://chatgpt.com/',submittedAt},
    {currentUrl:url,submittedAt:'2026-10-20'},
    {currentUrl:url,submittedAt:null},
    {currentUrl:url,submittedAt:-1}
  ]) assert.equal(await record(candidate),false);
  assert.equal(callbacks,0);
});

test('W3 a failed callback does not assert successful provenance',async()=>{
  let calls=0;
  const record=createProviderDeliveryRecorder({
    startsFresh:false,expectedChatUrl:url,
    onDeliveryObserved:async()=>{calls++;if(calls===1)throw Error('local_store_unavailable');}
  });
  await assert.rejects(record({currentUrl:url,submittedAt}),/local_store_unavailable/);
  assert.equal(await record({currentUrl:url,submittedAt}),true);
  assert.equal(await record({currentUrl:url,submittedAt}),false);
  assert.equal(calls,2);
});

test('W3 worker invokes only the original callback after one UI submission, for both modes',()=>{
  const src=fs.readFileSync(new URL('../desktop/embedded-worker.mjs',import.meta.url),'utf8');
  const start=src.indexOf('  async sendPrompt({');
  const end=src.indexOf('      const snap = await this.#assistantSnapshot()',start);
  assert.ok(start>=0 && end>start);
  const run=src.slice(start,end);
  const submitted=run.indexOf('await this.#setComposerAndSend(promptText,{onSubmissionIntent})');
  const recorder=run.indexOf('createProviderDeliveryRecorder({');
  const firstReceipt=run.indexOf('await retainSubmittedConversation()');
  assert.ok(submitted>=0 && recorder>submitted && firstReceipt>recorder);
  assert.match(run,/startsFresh,expectedChatUrl:chatUrl,onDeliveryObserved/);
  assert.doesNotMatch(run,/!newSession\s*\|\|\s*typeof onDeliveryObserved/);
  assert.match(run,/const retainSubmittedConversation=\(\)=>recordDelivery/);
  assert.equal((run.match(/await this\.#setComposerAndSend\(promptText,\{onSubmissionIntent\}\)/g)||[]).length,1);
});

