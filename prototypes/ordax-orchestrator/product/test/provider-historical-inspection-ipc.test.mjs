import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const main=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
const inspectStart=main.indexOf("registerUiHandler('ordax:tasks:inspect-linked-thread'");
const reconcileStart=main.indexOf("registerUiHandler('ordax:tasks:reconcile-linked-reply'",inspectStart);
const nextHandler=main.indexOf("registerUiHandler('ordax:lab:build-proof'",reconcileStart);
assert.ok(inspectStart>=0&&reconcileStart>inspectStart&&nextHandler>reconcileStart,'linked_thread_ipc_handlers_missing');
const inspectHandler=main.slice(inspectStart,reconcileStart);
const reconcileHandler=main.slice(reconcileStart,nextHandler);

function mount(source,{liveRun=null}={}) {
  let handler=null,trusted=0,calls=0,received=null;
  const store={},worker={};
  const context={
    requireTrustedSupervisorRenderer:()=>{trusted++;},liveRun,store,worker,
    inspectProviderLinkedThread:async value=>{calls++;assert.equal(value.store,store);assert.equal(value.worker,worker);received=value.taskId;return {kind:'response_candidate',threadRendered:true};},
    reconcileProviderLinkedReply:async value=>{calls++;received=value;return {reconciled:true,reason:'reconciled'};},
    registerUiHandler:(name,fn)=>{handler=fn;}
  };
  vm.runInNewContext(source,context,{timeout:1500});
  return {invoke:arg=>handler({},arg),trusted:()=>trusted,calls:()=>calls,received:()=>received};
}

test('linked-thread inspection IPC is trusted, read-only, and refuses active runs',async()=>{
  const app=mount(inspectHandler);
  assert.deepEqual(await app.invoke('task-1'),{kind:'response_candidate',threadRendered:true});
  assert.equal(app.trusted(),1);
  assert.equal(app.calls(),1);
  assert.equal(app.received(),'task-1');
  const active=mount(inspectHandler,{liveRun:{taskId:'task-1'}});
  assert.equal((await active.invoke('task-1')).reason,'run_active');
  assert.equal(active.calls(),0);
});

test('reply reconciliation IPC requires trusted renderer and refuses active runs before storage',async()=>{
  const app=mount(reconcileHandler);
  assert.deepEqual(await app.invoke({taskId:'task-2',responseSha256:'a'.repeat(64)}),{reconciled:true,reason:'reconciled'});
  assert.equal(app.trusted(),1);
  assert.equal(JSON.stringify(app.received()),JSON.stringify({store:{},worker:{},taskId:'task-2',responseSha256:'a'.repeat(64)}));
  const active=mount(reconcileHandler,{liveRun:{taskId:'task-2'}});
  await assert.rejects(active.invoke({taskId:'task-2',responseSha256:'a'.repeat(64)}),/provider_reply_recovery_run_active/);
  assert.equal(active.calls(),0);
});

test('W3 DOM inspector captures generation stop state without additional navigation or sends',()=>{
  const source=fs.readFileSync(new URL('../desktop/embedded-worker.mjs',import.meta.url),'utf8');
  const start=source.indexOf('  async #readHistoricalThreadDOM()');
  const end=source.indexOf('  async inspectConversationReadOnly(',start);
  assert.ok(start>=0&&end>start);
  const inspector=source.slice(start,end);
  assert.match(inspector,/generationStopVisible/);
  assert.match(inspector,/responseCompletionObserved/);
  assert.match(inspector,/responseControlState=\$\{providerResponseControlStateExpression\}/);
  assert.match(source,/import \{ providerGenerationStopProbeExpression, providerResponseControlStateExpression \} from '\.\.\/src\/provider-generation-stop-probe\.mjs'/);
  assert.ok(!inspector.includes('sendPrompt(')&&!inspector.includes('requestSubmit(')&&!inspector.includes('.loadURL('));
});
