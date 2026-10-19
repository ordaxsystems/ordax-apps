import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { SupervisorCoordinator } from '../supervisor/coordinator.mjs';
import { chatReceiptFromRunTask,requireConfirmedChatReceipt } from '../src/supervisor-chat-receipt.mjs';

const runId='run_11111111-2222-4333-8444-555555555555';
const goodResult={ result:{runId,observedAt:'2026-10-19T14:00:00.000Z',
  metrics:{submittedAt:1792418400000} } };

test('adapter distinguishes delivered, response-observed and effect-unverified',()=>{
  const receipt=chatReceiptFromRunTask(goodResult);
  assert.deepEqual(receipt,{
    confirmed:true,deliveryObserved:true,responseObserved:true,runId,effectVerified:false
  });
  assert.deepEqual(requireConfirmedChatReceipt(receipt),{runId,
    transport:{delivery_observed:true,response_observed:true,effect_verified:false}});
});

test('response timestamp alone is never evidence of delivery',()=>{
  const receipt=chatReceiptFromRunTask({result:{runId,observedAt:goodResult.result.observedAt}});
  assert.equal(receipt.responseObserved,true);
  assert.equal(receipt.deliveryObserved,false);
  assert.equal(receipt.confirmed,false);
  assert.throws(()=>requireConfirmedChatReceipt(receipt),/chat_receipt_incomplete/);
});

test('delivery timestamp without observed response cannot be a completed turn',()=>{
  const receipt=chatReceiptFromRunTask({result:{runId,metrics:{submittedAt:1792418400000}}});
  assert.equal(receipt.deliveryObserved,true);
  assert.equal(receipt.responseObserved,false);
  assert.equal(receipt.confirmed,false);
});

test('missing Run identity or malformed timestamp fail closed',()=>{
  const missingId=chatReceiptFromRunTask({result:{...goodResult.result,runId:undefined}});
  assert.equal(missingId.confirmed,false);
  const invalidDate=chatReceiptFromRunTask({result:{...goodResult.result,observedAt:'not-a-date'}});
  assert.equal(invalidDate.confirmed,false);
  assert.throws(()=>requireConfirmedChatReceipt({
    ...chatReceiptFromRunTask(goodResult), effectVerified:true
  }),/chat_receipt_incomplete/);
});

test('legacy boolean-only success receipt remains indeterminate, without retry, using real SQLite',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-transport-receipt-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new Store(path.join(dir,'lab.sqlite'));
  t.after(()=>store.close());
  const task=store.createTask('Transport-only proof');
  let sends=0;
  const coordinator=new SupervisorCoordinator({
    store,enabled:true,actorId:'lab-owner',environment:'internal',
    authorizeTask:({taskId,operation})=>taskId===task.id && ['plan','review','approve','dispatch'].includes(operation),
    planner:{decide:async()=>({type:'send_message',taskId:task.id,content:'One test message',reason:'Need review'})},
    chat:{send:async()=>{sends++;return {confirmed:true,runId};}}
  });
  const proposal=await coordinator.plan({taskId:task.id,requestId:'receipt-negative',objective:'Check delivery'});
  coordinator.approve({taskId:task.id,actionId:proposal.actionId,approvalId:proposal.approvalId,explicitOwnerApproval:true});
  assert.equal((await coordinator.dispatch({taskId:task.id,actionId:proposal.actionId})).status,'indeterminate');
  assert.equal(sends,1);
  await assert.rejects(coordinator.dispatch({taskId:task.id,actionId:proposal.actionId}),/action_not_approved/);
  assert.equal(sends,1);
  const row=store.db.prepare('SELECT status,result FROM action_ledger WHERE id=?').get(proposal.actionId);
  assert.equal(row.status,'indeterminate');
  assert.equal(JSON.parse(row.result).reason,'send_or_receipt_unknown_no_automatic_retry');
});

test('real SQLite ledger records message observations without claiming file effects',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-transport-success-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new Store(path.join(dir,'lab.sqlite'));
  t.after(()=>store.close());
  const task=store.createTask('Transport evidence');
  const coordinator=new SupervisorCoordinator({
    store,enabled:true,actorId:'lab-owner',environment:'internal',
    authorizeTask:({taskId})=>taskId===task.id,
    planner:{decide:async()=>({type:'send_message',taskId:task.id,content:'One test message',reason:'Need review'})},
    chat:{send:async()=>chatReceiptFromRunTask(goodResult)}
  });
  const proposal=await coordinator.plan({taskId:task.id,requestId:'receipt-positive',objective:'Check delivery'});
  coordinator.approve({taskId:task.id,actionId:proposal.actionId,approvalId:proposal.approvalId,explicitOwnerApproval:true});
  assert.equal((await coordinator.dispatch({taskId:task.id,actionId:proposal.actionId})).status,'succeeded');
  const row=store.db.prepare('SELECT status,result FROM action_ledger WHERE id=?').get(proposal.actionId);
  assert.equal(row.status,'succeeded');
  assert.deepEqual(JSON.parse(row.result).transport,{
    delivery_observed:true,response_observed:true,effect_verified:false
  });
  assert.equal(JSON.parse(row.result).runId,runId);
  assert.ok(store.events(task.id).some(e=>e.kind==='supervisor.chat.response_observed'));
});
