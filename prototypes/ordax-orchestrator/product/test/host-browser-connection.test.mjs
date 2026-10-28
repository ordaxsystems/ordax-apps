import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const productRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bridgePath=path.join(productRoot,'desktop','host-browser-bridge.js');

function element(id) {
  return {id,hidden:true,textContent:'',disabled:false,dataset:{},listeners:new Map(),
    addEventListener(name,callback){this.listeners.set(name,callback);},
    close(){this.open=false;},showModal(){this.open=true;}};
}

async function createHostBridgeHarness(fetchImpl) {
  const source=await fs.readFile(bridgePath,'utf8');
  const ids=['hostBrowserSessionNotice','hostBrowserSessionTitle','hostBrowserSessionMessage',
    'hostBrowserOfflineNotice','hostBrowserOfflineTitle','hostBrowserOfflineMessage',
    'hostBrowserControls','hostBrowserStatusSummary','hostBrowserShutdown','hostBrowserShutdownStatus',
    'hostBrowserConfirmation','hostBrowserConfirmationTitle','hostBrowserConfirmationMessage',
    'hostBrowserConfirmationDetail','hostBrowserConfirmationStatus','hostBrowserConfirmationApprove','hostBrowserConfirmationCancel'];
  const elements=new Map(ids.map(id=>[id,element(id)]));
  const document={documentElement:{dataset:{}},getElementById:id=>elements.get(id)||null};
  const fetchCalls=[];
  class EventSourceFixture {
    static instances=[];
    constructor(url){this.url=url;this.listeners=new Map();EventSourceFixture.instances.push(this);}
    addEventListener(name,callback){this.listeners.set(name,callback);}
    close(){this.closed=true;}
    emit(name,event={data:'{}'}){this.listeners.get(name)?.(event);}
  }
  const context={window:{},location:{protocol:'http:',hostname:'127.0.0.1'},document,
    EventSource:EventSourceFixture,fetch:async(url,options)=>{fetchCalls.push({url,options});return fetchImpl(url,options);}};
  vm.runInNewContext(source,context,{filename:bridgePath});
  await context.window.ordaxHost.ready;
  return {window:context.window,document,elements,fetchCalls,EventSource:EventSourceFixture};
}

test('Host bridge reports a dead transport and never retries an uncertain POST',async()=>{
  let invokeCount=0;
  const harness=await createHostBridgeHarness(async url=>{
    if(url==='/api/session')return {ok:true,status:200,json:async()=>({ok:true})};
    if(url==='/api/invoke'){invokeCount++;throw new TypeError('connection refused');}
    throw new Error('unexpected_route');
  });

  await assert.rejects(harness.window.ordax.orchestratorInvoke('project_create',{}),error=>{
    assert.equal(error.code,'host_request_outcome_unknown');
    assert.equal(error.transportOutcome,'unknown');
    return true;
  });
  assert.equal(invokeCount,1);
  assert.equal(harness.document.documentElement.dataset.ordaxHostSession,'offline');
  assert.equal(harness.elements.get('hostBrowserOfflineNotice').hidden,false);
  assert.equal(harness.elements.get('hostBrowserOfflineTitle').textContent,'Resultado da solicitação incerto');
  assert.equal(harness.elements.get('hostBrowserSessionNotice').hidden,true);
  assert.equal(harness.elements.get('hostBrowserControls').hidden,true);

  await assert.rejects(harness.window.ordax.orchestratorInvoke('project_create',{}),error=>{
    assert.equal(error.code,'host_transport_offline');
    assert.equal(error.transportOutcome,'not_submitted');
    return true;
  });
  assert.equal(invokeCount,1,'a failed action must not be replayed after reconnect is required');
});

test('Host event stream marks offline and restores controls only after a real reconnect',async()=>{
  const harness=await createHostBridgeHarness(async url=>{
    if(url==='/api/session')return {ok:true,status:200,json:async()=>({ok:true})};
    if(url==='/api/invoke')return {ok:true,status:200,json:async()=>({state:'active'})};
    throw new Error('unexpected_route');
  });
  harness.window.ordax.onOrchestratorChanged(()=>{});
  await new Promise(resolve=>setImmediate(resolve));
  const stream=harness.EventSource.instances[0];
  assert.ok(stream);

  stream.emit('error');
  assert.equal(harness.document.documentElement.dataset.ordaxHostSession,'offline');
  assert.equal(harness.elements.get('hostBrowserOfflineNotice').hidden,false);
  await assert.rejects(harness.window.ordax.orchestratorInvoke('status',{}),error=>error.code==='host_transport_offline');
  assert.equal(harness.fetchCalls.filter(call=>call.url==='/api/invoke').length,0);

  stream.emit('open');
  assert.equal(harness.document.documentElement.dataset.ordaxHostSession,'ready');
  assert.equal(harness.elements.get('hostBrowserOfflineNotice').hidden,true);
  assert.equal(harness.elements.get('hostBrowserControls').hidden,false);
  assert.deepEqual(await harness.window.ordax.orchestratorInvoke('status',{}),{state:'active'});
  assert.equal(harness.fetchCalls.filter(call=>call.url==='/api/invoke').length,1);
});

test('Host keeps authorization pending while offline and submits a decision only after reconnect',async()=>{
  const harness=await createHostBridgeHarness(async(url)=>{
    if(url==='/api/session')return {ok:true,status:200,json:async()=>({ok:true})};
    if(url==='/api/confirmation')return {ok:true,status:200,json:async()=>({resolved:true})};
    throw new Error('unexpected_route');
  });
  harness.window.ordax.onOrchestratorChanged(()=>{});
  await new Promise(resolve=>setImmediate(resolve));
  const stream=harness.EventSource.instances[0];
  const dialog=harness.elements.get('hostBrowserConfirmation');
  const approve=harness.elements.get('hostBrowserConfirmationApprove');
  const cancel=harness.elements.get('hostBrowserConfirmationCancel');
  stream.emit('confirm',{data:JSON.stringify({id:'approval-1',title:'Confirmar',message:'Enviar ação'})});
  assert.equal(dialog.open,true);
  assert.equal(approve.disabled,false);

  stream.emit('error');
  assert.equal(approve.disabled,true);
  assert.equal(cancel.disabled,true);
  assert.match(harness.elements.get('hostBrowserConfirmationStatus').textContent,/continua pendente/);
  await approve.listeners.get('click')({preventDefault(){}});
  assert.equal(harness.fetchCalls.filter(call=>call.url==='/api/confirmation').length,0);
  assert.equal(dialog.open,true);

  stream.emit('open');
  assert.equal(approve.disabled,false);
  await cancel.listeners.get('click')({preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(harness.fetchCalls.filter(call=>call.url==='/api/confirmation').length,1);
  assert.equal(JSON.parse(harness.fetchCalls.find(call=>call.url==='/api/confirmation').options.body).approved,false);
  assert.equal(dialog.open,false);
});

test('Host freezes an authorization when the decision response is uncertain',async()=>{
  const harness=await createHostBridgeHarness(async(url)=>{
    if(url==='/api/session')return {ok:true,status:200,json:async()=>({ok:true})};
    if(url==='/api/confirmation')throw new TypeError('connection reset');
    throw new Error('unexpected_route');
  });
  harness.window.ordax.onOrchestratorChanged(()=>{});
  await new Promise(resolve=>setImmediate(resolve));
  const stream=harness.EventSource.instances[0];
  const dialog=harness.elements.get('hostBrowserConfirmation');
  const approve=harness.elements.get('hostBrowserConfirmationApprove');
  stream.emit('confirm',{data:JSON.stringify({id:'approval-uncertain',title:'Confirmar',message:'Enviar ação'})});
  approve.listeners.get('click')({preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(dialog.open,true);
  assert.equal(approve.disabled,true);
  assert.equal(harness.document.documentElement.dataset.ordaxHostSession,'offline');
  assert.equal(harness.elements.get('hostBrowserOfflineNotice').hidden,false);
  assert.match(harness.elements.get('hostBrowserConfirmationStatus').textContent,/decisão chegou ao Host/);

  stream.emit('open');
  assert.equal(approve.disabled,true,'reconnect must not automatically replay an uncertain authorization');
  approve.listeners.get('click')({preventDefault(){}});
  assert.equal(harness.fetchCalls.filter(call=>call.url==='/api/confirmation').length,1);
});
