import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  assertTaskHandoffCoversOmissions,buildProviderContextAttachmentNotice,
  classifyProviderContextAttachmentObservation,selectProviderContextFileInput,
  validateProviderContextAttachment
} from '../src/provider-context-attachment.mjs';

const attachment={filename:'ordax-handoff-task_12345678-c3-0123456789ab.txt',
  filePath:'C:/profile/data/handoffs/ordax-handoff-task_12345678-c3-0123456789ab.txt',
  taskId:'task_12345678',checkpointVersion:3,byteLength:700,sha256:'a'.repeat(64)};

test('context attachment descriptor is bounded and the notice never carries context content',()=>{
  assert.deepEqual(validateProviderContextAttachment(attachment),attachment);
  const notice=buildProviderContextAttachmentNotice(attachment);
  assert.match(notice,/mesma tarefa/u);
  assert.match(notice,/pedido atual/u);
  assert.doesNotMatch(notice,/a{64}/u);
  assert.throws(()=>validateProviderContextAttachment({...attachment,byteLength:1_000_001}),/provider_context_attachment_invalid/u);
  assert.throws(()=>validateProviderContextAttachment({...attachment,filename:'../../secrets.txt'}),/provider_context_attachment_invalid/u);
});

test('selects only one general file input and fails closed on missing or duplicate controls',()=>{
  const inputs=[
    {type:'file',ariaLabel:'Anexar fotos',accept:'image/*',multiple:true},
    {type:'file',ariaLabel:'Anexar arquivos',accept:null,multiple:true}
  ];
  assert.equal(selectProviderContextFileInput(inputs),inputs[1]);
  assert.throws(()=>selectProviderContextFileInput(inputs.slice(0,1)),/provider_context_file_input_unavailable/u);
  assert.throws(()=>selectProviderContextFileInput([...inputs,inputs[1]]),/provider_context_file_input_ambiguous/u);
});

test('file selection stays scoped to the active composer and upload confirmation uses its visible file chip',()=>{
  const worker=fs.readFileSync(new URL('../desktop/embedded-worker.mjs',import.meta.url),'utf8');
  assert.match(worker,/const composer=\$\{composerExpression\(\)\}; return composer\?\.closest\('form'\)/u);
  assert.match(worker,/DOM\.getDocument/u);
  assert.match(worker,/DOM\.requestNode/u);
  assert.match(worker,/nodeId:activeFormNodeId,selector:'input\[type="file"\]'/u);
  assert.doesNotMatch(worker,/document\.querySelectorAll\('input\[type="file"\]'\)/u);
  assert.ok(worker.includes('document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT)'));
  assert.ok(worker.includes("String(walker.currentNode.nodeValue||'').includes(expected)"));
  assert.ok(worker.includes("element.getAttribute('aria-label'),element.getAttribute('title')"));
  assert.doesNotMatch(worker,/provider_context_attachment_input_not_observed/u);
});

test('upload is confirmed only after the exact file is visible and stable without progress',()=>{
  assert.deepEqual(classifyProviderContextAttachmentObservation({filename:attachment.filename,
    selectionConfirmed:true,visibleFilename:false,stableObservations:0}),
  {state:'pending',reason:'attachment_chip_not_visible'});
  assert.equal(classifyProviderContextAttachmentObservation({filename:attachment.filename,
    selectionConfirmed:true,visibleFilename:true,progressVisible:true,stableObservations:2}).state,'pending');
  assert.equal(classifyProviderContextAttachmentObservation({filename:attachment.filename,
    selectionConfirmed:true,visibleFilename:true,stableObservations:2}).state,'confirmed');
  assert.equal(classifyProviderContextAttachmentObservation({filename:attachment.filename,
    selectionConfirmed:true,visibleFilename:true,uploadErrorVisible:true,stableObservations:2}).state,'failed');
  assert.equal(classifyProviderContextAttachmentObservation({filename:attachment.filename,
    selectionConfirmed:false,visibleFilename:true,stableObservations:2}).state,'unverified');
});

test('snapshot coverage is required for every memory and message omitted from inline continuation',()=>{
  const packet={format:'ordax-continuation-context/v1',omittedMemoryIds:['mem-1'],omittedMessageIds:['msg-1']};
  const snapshot={format:'ordax-task-handoff/v1',deliveryState:'not_attached',memoryIds:['mem-1'],
    recentMessageIds:['msg-1'],historicalMessageIds:[]};
  assert.equal(assertTaskHandoffCoversOmissions(packet,snapshot),true);
  assert.throws(()=>assertTaskHandoffCoversOmissions(packet,{...snapshot,recentMessageIds:[]}),/task_handoff_omission_not_covered/u);
});
