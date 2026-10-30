import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {buildProjectContinuationPacket} from '../src/continuation-context.mjs';
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
    store.upsertProjectMemory(task.id,{category:'decision',key:'Entrega',content:'SEGREDO_CANONICO_NAO_DUPLICAR'});
    store.checkpoint(task.id,'Checkpoint confirmado');
    store.appendMessage(task.id,'user','Pedido anterior');
    const packet=store.buildContinuationPacket(task.id,'continue');
    const {userMessage,runId}=store.beginProviderRun(task.id,'continue');
    store.setChatUrl(task.id,url);
    const actual=packet.prompt;
    const submittedAt=Date.now();
    const receipt=recordProviderSubmissionProvenance({
      store,taskId:task.id,runId,messageId:userMessage.id,providerPrompt:actual,chatUrl:url,submittedAt,
      contextManifest:packet.manifest
    });
    assert.deepEqual(receipt,{recorded:true,reason:'receipt_recorded'});
    const found=findProviderSubmissionProvenance({store,taskId:task.id,chatUrl:url,messageId:userMessage.id});
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
    const payload=JSON.parse(events[0].payload);
    assert.equal(payload.context_manifest.format,'ordax-continuation-context/v1');
    assert.equal(payload.context_manifest.checkpoint_version,1);
    assert.equal(payload.context_manifest.context_sha256,packet.manifest.contextSha256);
    assert.deepEqual(payload.context_manifest.included_memory_ids,packet.manifest.includedMemoryIds);
    assert.equal(payload.context_manifest.included_memory_count,1);
    assert.equal(payload.context_manifest.history_window_omitted_count,0);
    assert.deepEqual(payload.context_manifest.omission_reasons,[]);
    assert.ok(!events[0].payload.includes('SEGREDO_CANONICO_NAO_DUPLICAR'));
  });
});

test('uploaded continuity file hash and source IDs bind to the exact submitted Run without storing contents',()=>{
  fixture(store=>{
    const task=store.createTask('Snapshot attachment provenance');
    const source=store.appendMessage(task.id,'user','Fonte secreta presente apenas no snapshot: HANDOFF_SECRET_CONTENT.');
    store.upsertProjectMemory(task.id,{category:'reference',key:'Referência',content:'HANDOFF_SECRET_CONTENT',source_type:'message',source_ref:source.id});
    const packet=store.buildContinuationPacket(task.id,'Recupere a referência.');
    const snapshot=store.buildTaskHandoffSnapshot(task.id,{request:'Recupere a referência.'});
    const attachmentNotice='\nPacote anexado: '+snapshot.filename;
    const actualPrompt=packet.prompt+attachmentNotice;
    const contextManifest={...packet.manifest,promptSha256:providerPromptDigest(actualPrompt),promptChars:actualPrompt.length};
    const {userMessage,runId}=store.beginProviderRun(task.id,'Recupere a referência.');
    store.setChatUrl(task.id,url);
    const receipt={format:snapshot.manifest.format,deliveryState:'uploaded',taskId:task.id,
      filename:snapshot.filename,sha256:snapshot.manifest.sha256,byteLength:snapshot.manifest.byteLength,
      checkpointVersion:snapshot.manifest.checkpointVersion,uploadedAt:Date.now(),
      memoryIds:snapshot.manifest.memoryIds,recentMessageIds:snapshot.manifest.recentMessageIds,
      historicalMessageIds:snapshot.manifest.historicalMessageIds};
    assert.deepEqual(recordProviderSubmissionProvenance({store,taskId:task.id,runId,
      messageId:userMessage.id,providerPrompt:actualPrompt,chatUrl:url,submittedAt:Date.now(),
      contextManifest,contextAttachmentReceipt:receipt}),{recorded:true,reason:'receipt_recorded'});
    const payload=JSON.parse(store.db.prepare("SELECT payload FROM events WHERE task_id=? AND kind='provider.submission.provenance'").get(task.id).payload);
    assert.equal(payload.context_attachment.sha256,snapshot.manifest.sha256);
    assert.equal(payload.context_attachment.byte_length,snapshot.manifest.byteLength);
    assert.deepEqual(payload.context_attachment.memory_ids,snapshot.manifest.memoryIds);
    assert.ok(!JSON.stringify(payload).includes('HANDOFF_SECRET_CONTENT'));
    assert.ok(!JSON.stringify(payload).includes(actualPrompt));
    assert.equal(recordProviderSubmissionProvenance({store,taskId:task.id,runId,
      messageId:userMessage.id,providerPrompt:actualPrompt,chatUrl:url,submittedAt:Date.now(),
      contextManifest,contextAttachmentReceipt:{...receipt,sha256:'invalid'}}).reason,'context_attachment_receipt_mismatch');
  });
});

test('submission provenance identifies retrieved historical sources without storing their content',()=>{
  fixture(store=>{
    const task=store.createTask('Retrieved history provenance');
    const old=store.appendMessage(task.id,'user','Código antigo da referência: HIST_REF_9142.');
    store.appendMessage(task.id,'assistant','Registro recebido.');
    for(let index=1;index<=4;index++){
      store.appendMessage(task.id,'user',`Mensagem recente ${index}.`);
      store.appendMessage(task.id,'assistant',`Confirmação recente ${index}.`);
    }
    const prompt='Recupere o código da referência antiga do começo da tarefa.';
    const packet=store.buildContinuationPacket(task.id,prompt);
    assert.ok(packet.manifest.retrievedMessageIds.includes(old.id));
    assert.match(packet.prompt,/HIST_REF_9142/);
    const {userMessage,runId}=store.beginProviderRun(task.id,prompt);
    store.setChatUrl(task.id,url);
    assert.deepEqual(recordProviderSubmissionProvenance({
      store,taskId:task.id,runId,messageId:userMessage.id,providerPrompt:packet.prompt,
      chatUrl:url,submittedAt:Date.now(),contextManifest:packet.manifest
    }),{recorded:true,reason:'receipt_recorded'});
    const payload=JSON.parse(store.db.prepare(
      "SELECT payload FROM events WHERE task_id=? AND kind='provider.submission.provenance'"
    ).get(task.id).payload);
    assert.deepEqual(payload.context_manifest.retrieved_message_ids,packet.manifest.retrievedMessageIds);
    assert.equal(payload.context_manifest.history_window_message_count,2);
    assert.equal(payload.context_manifest.history_window_retrieved_count,1);
    assert.equal(payload.context_manifest.history_window_omitted_count,1);
    assert.ok(!JSON.stringify(payload).includes('HIST_REF_9142'));
  });
});

test('continuation provenance is rejected when its manifest does not describe the actual prompt',()=>{
  fixture(store=>{
    const task=store.createTask('Manifesto inconsistente');
    const {userMessage,runId}=store.beginProviderRun(task.id,'Pedido');
    store.setChatUrl(task.id,url);
    const result=recordProviderSubmissionProvenance({
      store,taskId:task.id,runId,messageId:userMessage.id,providerPrompt:'Pedido',chatUrl:url,
      submittedAt:Date.now(),contextManifest:{format:'ordax-continuation-context/v1',promptSha256:'0'.repeat(64)}
    });
    assert.deepEqual(result,{recorded:false,reason:'context_manifest_mismatch'});
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='provider.submission.provenance'").get().n,0);
  });
});

test('W3 cannot attribute a synthetic linked thread with only a local message',()=>{
  fixture(store=>{
    const task=store.createTask('Nao enviado');
    const local=store.appendMessage(task.id,'user','Mensagem local');
    store.setChatUrl(task.id,url);
    assert.equal(findProviderSubmissionProvenance({store,taskId:task.id,chatUrl:url,messageId:local.id}),null);
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
    assert.equal(findProviderSubmissionProvenance({store,taskId:task.id,chatUrl:url,messageId:userMessage.id}),null);
    assert.equal(recordProviderSubmissionProvenance(args).recorded,true);
    assert.equal(findProviderSubmissionProvenance({store,taskId:task.id,chatUrl:'https://chatgpt.com/c/22222222-3333-4444-8555-666666666666',messageId:userMessage.id}),null);
  });
});

test('W3 provenance changes only the evidence predicate, never retries provider submission',()=>{
  const main=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
  const inspect=fs.readFileSync(new URL('../src/provider-linked-thread-recovery.mjs',import.meta.url),'utf8');
  assert.match(inspect,/findProviderSubmissionProvenance/);
  assert.match(inspect,/messageId:message\?\.id/);
  assert.match(inspect,/expectedPromptSha256:provenance\.promptSha256/);
  assert.match(inspect,/provider_submission_provenance_missing/);
  assert.match(main,/ordax:tasks:reconcile-linked-reply/);
  assert.match(main,/reconcileProviderLinkedReply/);
  assert.doesNotMatch(inspect,/sendPrompt\(|requestSubmit\(/);
  const receipt=main.slice(main.indexOf('onDeliveryObserved:('), main.indexOf('const rotationOutcome'));
  assert.match(receipt,/recordProviderSubmissionProvenance/);
  assert.match(receipt,/return binding;/);
  assert.doesNotMatch(receipt,/sendPrompt\(/);
});

test('conversation rotation fails closed before Run creation if canonical continuity cannot fit',()=>{
  const main=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
  const start=main.indexOf('async function runTask(');
  const end=main.indexOf('\nfunction ',start+10);
  const runTask=main.slice(start,end>start?end:undefined);
  const packet=runTask.indexOf('store.buildContinuationPacket(taskId,prompt)');
  const contextGuard=runTask.indexOf('assertContinuationContextReady(continuationPacket)');
  const beginRun=runTask.indexOf('store.beginProviderRun(taskId, prompt');
  assert.ok(packet>=0&&contextGuard>packet&&beginRun>contextGuard);
  assert.match(runTask,/contextManifest=continuationPacket\?\.manifest/);
});
