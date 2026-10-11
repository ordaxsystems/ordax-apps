import assert from 'node:assert/strict';
import test from 'node:test';
import {projectCentralReceipts,centralReceiptSummary,CENTRAL_RECEIPT_PROJECTION_SCHEMA} from '../src/receipt-projection.mjs';

const ids=['e394badf-5b08-4bcb-aac4-2bd7e9653c01','211cae9f-6bf9-44be-ac02-15690524458f','b0fdd790-f6f0-4ac5-93ea-b9a4efef716f'];
const ev=(id,requestId,event,extra={})=>({id,requestId,event,time:'12:15:00',...extra});

test('receipts use Relay request UUID, never arrival order alone, even with interleaved clients',()=>{
  const events=[];
  for(let i=0;i<3;i++)events.push(ev('studio-'+(i+1),ids[i],'submitted',{preview:'mensagem de '+i}));
  for(let i=2;i>=0;i--)events.push(ev('studio-'+(i+1),ids[i],'central_received'));
  for(let i=0;i<3;i++)events.push(ev('studio-'+(i+1),ids[i],'provider_returned',{preview:'resultado '+i}));
  for(let i=1;i>=0;i--)events.push(ev('studio-'+(i+1),ids[i],'completed',{httpStatus:200,ok:true}));
  const interim=projectCentralReceipts(events);
  assert.equal(interim.schema,CENTRAL_RECEIPT_PROJECTION_SCHEMA);
  assert.equal(interim.state,'laboratory');
  assert.equal(interim.receipts.length,3);
  const byClient=new Map(interim.receipts.map(x=>[x.deviceId,x]));
  assert.equal(byClient.get('studio-1').status,'completed');
  assert.equal(byClient.get('studio-2').status,'completed');
  assert.equal(byClient.get('studio-3').status,'response-ready');
  assert.equal(byClient.get('studio-3').delivered,false);
  assert.equal(centralReceiptSummary(interim).completed,2);
  assert.equal(centralReceiptSummary(interim).pending,1);
  const final=projectCentralReceipts([...events,ev('studio-3',ids[2],'completed',{httpStatus:200,ok:true})]);
  assert.equal(centralReceiptSummary(final).completed,3);
  for(const row of final.receipts){
    assert.ok(Object.isFrozen(row));
    assert.equal(row.requestId,ids[Number(row.deviceId.slice(-1))-1]);
    assert.equal(row.status,'completed');
    assert.equal(row.received,true);
    assert.equal(row.providerReturned,true);
    assert.equal(row.delivered,true);
  }
});

test('a client 200 alone is uncertain and cannot fabricate a provider receipt',()=>{
  const events=[ev('studio-1',ids[0],'submitted',{preview:'pedido'}),
    ev('studio-1',ids[0],'completed',{httpStatus:200,ok:true})];
  const result=projectCentralReceipts(events);
  assert.equal(result.receipts[0].status,'uncertain');
  assert.equal(centralReceiptSummary(result).completed,0);
});

test('provider unavailable is failed; response without delivery is never completed',()=>{
  const events=[ev('studio-2',ids[1],'submitted'),
    ev('studio-2',ids[1],'central_received'),
    ev('studio-2',ids[1],'provider_failed',{preview:'provider unavailable'}),
    ev('studio-2',ids[1],'completed',{httpStatus:503,ok:false})];
  const result=projectCentralReceipts(events);
  assert.equal(result.receipts[0].status,'failed');
  assert.equal(result.receipts[0].httpStatus,503);
  assert.equal(result.receipts[0].received,true);
  assert.equal(centralReceiptSummary(result).failed,1);
  assert.equal(centralReceiptSummary(result).completed,0);
});

test('ignore uncorrelated events and sanitize bounded previews without leaking into unrelated clients',()=>{
  const events=[
    ev('studio-1',ids[0],'submitted',{preview:'hello\u0000world'}),
    ev('studio-2',ids[0],'central_received',{preview:'wrong device for same uuid'}),
    ev('../malicious',ids[1],'completed',{httpStatus:200,ok:true}),
    ev('studio-1','not-a-uuid','completed',{httpStatus:200,ok:true}),
    ev('studio-1',ids[0],'central_received'),
  ];
  const result=projectCentralReceipts(events);
  assert.equal(result.receipts.length,2);
  assert.equal(result.receipts.find(r=>r.deviceId==='studio-1').status,'received');
  assert.equal(result.receipts.find(r=>r.deviceId==='studio-1').requestPreview,'helloworld');
  assert.equal(result.receipts.find(r=>r.deviceId==='studio-2').status,'received');
  assert.equal(projectCentralReceipts(new Array(131).fill(null)).state,'unavailable');
  assert.equal(projectCentralReceipts({}).state,'unavailable');
});
