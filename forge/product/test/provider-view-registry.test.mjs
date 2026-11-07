import test from 'node:test';
import assert from 'node:assert/strict';
import {createProviderViewRegistry} from '../src/provider-view-registry.mjs';

const fixture=id=>{
  let destroyed=false;
  const webContents={id,isDestroyed:()=>destroyed};
  return {worker:{view:{webContents}},webContents,destroy:()=>{destroyed=true;}};
};

test('independent browser views retain isolated channel ownership',()=>{
  const registry=createProviderViewRegistry();
  const a=fixture(11),b=fixture(12),c=fixture(13);
  registry.register(a.worker);registry.register(b.worker);registry.register(c.worker);
  assert.equal(registry.size,3);
  assert.equal(registry.resolve(a.webContents),a.worker);
  assert.equal(registry.resolve(b.webContents),b.worker);
  assert.equal(registry.resolve(c.webContents),c.worker);
  // Forged numeric IDs cannot impersonate any other renderer.
  assert.equal(registry.resolve({id:11}),null);
  assert.equal(registry.resolve({id:12}),null);
  assert.equal(registry.resolve({id:13}),null);
  assert.equal(registry.resolve({id:14}),null);
  assert.equal(registry.resolve(null),null);
});

test('duplicate worker or WebContents ID cannot register a second owner',()=>{
  const registry=createProviderViewRegistry();
  const a=fixture(19),b=fixture(19);
  registry.register(a.worker);
  assert.throws(()=>registry.register(a.worker),/provider_view_registration_conflict/);
  assert.throws(()=>registry.register(b.worker),/provider_view_registration_conflict/);
  assert.equal(registry.size,1);
  assert.equal(registry.resolve(b.webContents),null);
  assert.equal(registry.resolve(a.webContents),a.worker);
});

test('destruction and unregister revoke channel authority without reviving old renderers',()=>{
  const registry=createProviderViewRegistry();
  const a=fixture(21);
  registry.register(a.worker);
  a.destroy();
  assert.equal(registry.resolve(a.webContents),null);
  assert.equal(registry.unregister(a.worker),true);
  assert.equal(registry.unregister(a.worker),false);
  const replacement=fixture(21);
  registry.register(replacement.worker);
  assert.equal(registry.resolve(a.webContents),null);
  assert.equal(registry.resolve(replacement.webContents),replacement.worker);
  assert.equal(registry.size,1);
});

test('invalid or destroyed view fails closed at registration',()=>{
  const registry=createProviderViewRegistry();
  for(const candidate of [null,{}, {view:{}},{view:{webContents:{id:0}}},
    {view:{webContents:{id:1.5}}},{view:{webContents:{id:'4'}}}]){
    assert.throws(()=>registry.register(candidate),/provider_view_registration_invalid/);
  }
  const destroyed=fixture(25);
  destroyed.destroy();
  assert.throws(()=>registry.register(destroyed.worker),/provider_view_registration_invalid/);
  assert.equal(registry.size,0);
});

test('registry only routes browser instances; it has no Run, Task, or send authority',()=>{
  const registry=createProviderViewRegistry();
  assert.equal('dispatch' in registry,false);
  assert.equal('send' in registry,false);
  assert.equal('startRun' in registry,false);
  assert.equal('store' in registry,false);
  assert.ok(Object.isFrozen(registry));
});
test('two independent WebContents are bound to their own exact Task and Run',()=>{
  const registry=createProviderViewRegistry(),a=fixture(41),b=fixture(42);
  registry.register(a.worker);registry.register(b.worker);
  const first={taskId:'task_A',runId:'run_A',startedAt:123,firstDeltaAt:null};
  const second={taskId:'task_B',runId:'run_B',startedAt:124,firstDeltaAt:null};
  assert.equal(registry.bindRun(a.worker,first),first);
  assert.equal(registry.bindRun(b.worker,second),second);
  assert.equal(registry.activeRunCount,2);
  assert.equal(registry.runForSender(a.webContents),first);
  assert.equal(registry.runForSender(b.webContents),second);
  assert.equal(registry.runForSender({id:41}),null);
  assert.equal(registry.runForSender({id:42}),null);
  assert.throws(()=>{first.taskId='task_forged';},TypeError);
  assert.throws(()=>{first.runId='run_forged';},TypeError);
  assert.throws(()=>{first.startedAt=999;},TypeError);
  first.firstDeltaAt=200;
  assert.equal(registry.runForSender(a.webContents).firstDeltaAt,200);
  assert.equal(registry.runForSender(b.webContents).firstDeltaAt,null);
});

test('duplicate Task, duplicate Run and occupied worker fail closed',()=>{
  const registry=createProviderViewRegistry(),a=fixture(50),b=fixture(51);
  registry.register(a.worker);registry.register(b.worker);
  registry.bindRun(a.worker,{taskId:'task_1',runId:'run_1',startedAt:400});
  assert.throws(()=>registry.bindRun(a.worker,{taskId:'task_2',runId:'run_2',startedAt:401}),/provider_run_worker_occupied/);
  assert.throws(()=>registry.bindRun(b.worker,{taskId:'task_1',runId:'run_2',startedAt:401}),/provider_run_context_conflict/);
  assert.throws(()=>registry.bindRun(b.worker,{taskId:'task_2',runId:'run_1',startedAt:401}),/provider_run_context_conflict/);
  assert.equal(registry.activeRunCount,1);
  assert.equal(registry.runForSender(b.webContents),null);
});

test('stale Run unbinding never affects a newer Run; destroyed sender loses authority',()=>{
  const registry=createProviderViewRegistry(),a=fixture(52),b=fixture(53);
  registry.register(a.worker);registry.register(b.worker);
  const old={taskId:'task_old',runId:'run_old',startedAt:500};
  registry.bindRun(a.worker,old);
  assert.equal(registry.unbindRun(a.worker,'run_wrong'),false);
  assert.equal(registry.runForSender(a.webContents),old);
  assert.equal(registry.unbindRun(a.worker,'run_old'),true);
  assert.equal(registry.runForSender(a.webContents),null);
  const next={taskId:'task_new',runId:'run_new',startedAt:501};
  registry.bindRun(a.worker,next);
  registry.bindRun(b.worker,{taskId:'task_b',runId:'run_b',startedAt:503});
  assert.equal(registry.unbindRun(a.worker,'run_old'),false);
  assert.equal(registry.runForSender(a.webContents),next);
  a.destroy();
  assert.equal(registry.runForSender(a.webContents),null);
  assert.equal(registry.unregister(a.worker),true);
  assert.equal(registry.activeRunCount,1);
  assert.equal(registry.runForSender(b.webContents).runId,'run_b');
});

test('malformed Run and unregistered worker do not acquire routing authority',()=>{
  const registry=createProviderViewRegistry(),a=fixture(54),b=fixture(55);
  registry.register(a.worker);
  for(const run of [null,{}, {taskId:'task_a',runId:'bad/run',startedAt:4},
    {taskId:'task_a',runId:'run_a',startedAt:0},
    {taskId:'task_a',runId:'run_a',startedAt:1.5}]){
    assert.throws(()=>registry.bindRun(a.worker,run),/provider_run_context_invalid/);
  }
  assert.throws(()=>registry.bindRun(b.worker,{taskId:'task_b',runId:'run_b',startedAt:100}),
    /provider_run_worker_unregistered/);
  assert.equal(registry.activeRunCount,0);
});

test('Electron routes stage and streaming IPC only through registered per-worker Run context',async()=>{
  const fs=await import('node:fs');
  const url=await import('node:url');
  const path=await import('node:path');
  const main=fs.readFileSync(path.resolve(path.dirname(url.fileURLToPath(import.meta.url)),
    '../desktop/main.mjs'),'utf8');
  // The scheduler supplies the physical worker and the exact immutable
  // Run context; the old worker/liveRun source assertion predates this gate.
  assert.match(main,/providerViews\.bindRun\(runWorker,runContext\)/);
  assert.match(main,/providerViews\.unbindRun\(runWorker,runId\)/);
  assert.match(main,/providerViews\.runForWorker\(registeredWorker\)/);
  assert.match(main,/providerViews\.runForSender\(event\.sender\)/);
  assert.match(main,/const delta = fromWorker\.acceptStreamSnapshot\(snapshot\)/);
  assert.match(main,/taskId:routed\.taskId, runId:routed\.runId/);
});