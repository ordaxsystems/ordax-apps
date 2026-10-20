import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {recordProviderSubmissionProvenance,findProviderSubmissionProvenance,providerPromptDigest} from '../src/provider-submission-provenance.mjs';
import {assessProviderConversationEvidence} from '../src/provider-conversation-reconciliation.mjs';

const url='https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';
function fixture(fn) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-w3-provenance-'));
  const store=new Store(path.join(dir,'lab.sqlite'));
  try { return fn(store); }
  finally { store.close(); fs.rmSync(dir,{recursive:true,force:true}); }
}

test('W3 real Store records exact context-expanded prompt only after submitted receipt',()=>{
  fixture(store=>{
    const task=store.createTask('Continuacao');
    const {userMessage,runId}=store.beginProviderRun(task.id,'continue');
    store.setChatUrl(task.id,url);
    const actual='[CONTEXTO ORDAX - CONTINUIDADE]\nPedido atual: continue';
    const submittedAt=Date.now();
    const receipt=recordProviderSubmissionProvenance({
      store,taskId:task.id,runId,messageId:userMessage.id,providerPrompt:actual,chatUrl:url,submittedAt
    });
    assert.deepEqual(receipt,{recorded:true,reason:'receipt_recorded'});
    const found=findProviderSubmissionProvenance({store,taskId:task.id,chatUrl:url});
    assert.equal(found.runId,runId);
    assert.equal(found.promptSha256,providerPromptDigest(actual));
    const evidence=assessProviderConversationEvidence({
      expectedUrl:url,expectedMessage:'continue',expectedPromptSha256:found.promptSha256,
      observed:{available:true,url,domReliable:true,truncated:false,messages:[
        {role:'user',text:actual},{role:'assistant',text:'Resumo do trabalho'}
      ]}
    });
    assert.equal(evidence.kind,'response_candidate');
    assert.equal(evidence.responseCandidate,true);
    const naive=assessProviderConversationEvidence({
      expectedUrl:url,expectedMessage:'continue',
      observed:{available:true,url,domReliable:true,truncated:false,messages:[
        {role:'user',text:actual},{role:'assistant',text:'Resumo do trabalho'}
      ]}
    });
    assert.equal(naive.kind,'unresolved');
    assert.equal(recordProviderSubmissionProvenance({
      store,taskId:task.id,runId,messageId:userMessage.id,providerPrompt:actual,chatUrl:url,submittedAt
    }).reason,'receipt_already_recorded');
    const events=store.db.prepare("SELECT payload FROM events WHERE kind='provider.submission.provenance'").all();
    assert.equal(events.length,1);
    assert.ok(!events[0].payload.includes(actual));
    assert.ok(!events[0].payload.includes('continue'));
    assert.ok(!events[0].payload.includes(url));
  });
});

test('W3 cannot attribute a synthetic linked thread with only a local message',()=>{
  fixture(store=>{
    const task=store.createTask('Nao enviado');
    store.appendMessage(task.id,'user','Mensagem local');
    store.setChatUrl(task.id,url);
    assert.equal(findProviderSubmissionProvenance({store,taskId:task.id,chatUrl:url}),null);
  });
});

test('W3 provenance never binds an unrelated URL, message, or Run',()=>{
  fixture(store=>{
    const task=store.createTask('Contrato');
    const {userMessage,runId}=store.beginProviderRun(task.id,'Pergunta');
    store.setChatUrl(task.id,url);
    const args={store,taskId:task.id,runId,messageId:userMessage.id,providerPrompt:'Pergunta',chatUrl:url,submittedAt:Date.now()};
    assert.equal(recordProviderSubmissionProvenance({...args,messageId:'invalid'}).recorded,false);
    assert.equal(recordProviderSubmissionProvenance({...args,chatUrl:'https://chatgpt.com/c/22222222-3333-4444-8555-666666666666'}).recorded,false);
    assert.equal(recordProviderSubmissionProvenance({...args,submittedAt:undefined}).recorded,false);
    assert.equal(findProviderSubmissionProvenance({store,taskId:task.id,chatUrl:url}),null);
    assert.equal(recordProviderSubmissionProvenance(args).recorded,true);
    assert.equal(findProviderSubmissionProvenance({store,taskId:task.id,chatUrl:'https://chatgpt.com/c/22222222-3333-4444-8555-666666666666'}),null);
  });
});

test('W3 provenance changes only the evidence predicate, never retries provider submission',()=>{
  const main=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
  const inspect=main.slice(main.indexOf("ipcMain.handle('ordax:tasks:inspect-linked-thread'"),
    main.indexOf("ipcMain.handle('ordax:tasks:resume-capsule'"));
  assert.match(inspect,/findProviderSubmissionProvenance\(\{store,taskId,chatUrl:expectedUrl\}\)/);
  assert.match(inspect,/const threadRendered=Boolean\(provenance\)/);
  assert.match(inspect,/expectedPromptSha256:provenance\?\.promptSha256/);
  assert.match(inspect,/provider_submission_provenance_missing/);
  const receipt=main.slice(main.indexOf('onDeliveryObserved:('), main.indexOf('const rotationOutcome'));
  assert.match(receipt,/recordProviderSubmissionProvenance/);
  assert.match(receipt,/return binding;/);
  assert.doesNotMatch(receipt,/sendPrompt\(/);
});
