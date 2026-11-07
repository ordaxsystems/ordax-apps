import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {Store} from '../src/store.mjs';

// The worker is a REAL second Windows process. It deliberately holds a
// transaction open when the parent kills it. It never opens a browser/network.
const storeModule=fileURLToPath(new URL('../src/store.mjs',import.meta.url));
const workerSource=`
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const {Store}=await import(pathToFileURL(process.env.E2E_STORE_MODULE).href);
const store=new Store(process.env.E2E_DB);
const task=process.env.E2E_TASK;
const run=process.env.E2E_RUN;
const phase=process.env.E2E_PHASE;
const hold=()=>process.stdout.write('READY\\n',()=>{
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,120000);
});
if(phase==='before_commit') {
  store.db.exec('BEGIN IMMEDIATE');
  store.appendMessage(task,'user','hypothetical uncommitted send');
  store.startRun(task);
  hold();
}else if(phase==='after_commit') {
  store.beginProviderRun(task,'hypothetical committed send');
  hold();
}else if(phase==='after_external_effect') {
  store.beginProviderRun(task,'synthetic potentially irreversible effect');
  const ledger=new DatabaseSync(process.env.E2E_LEDGER);
  ledger.exec('CREATE TABLE IF NOT EXISTS effects(task_id TEXT PRIMARY KEY, applied INTEGER NOT NULL)');
  ledger.prepare('INSERT INTO effects(task_id,applied) VALUES(?,1)').run(task);
  ledger.close();
  hold();
}else if(phase==='during_finish') {
  store.finishRun(task,run,null,()=>{
    store.appendMessage(task,'assistant','uncommitted reply');
    store.checkpoint(task,'uncommitted checkpoint');
    hold();
  });
}else if(phase==='after_finish'){
  store.commitObservedProviderReply(task,run,{
    text:'completed synthetic reply',observedAt:'2026-11-03T19:00:00Z'
  });
  hold();
}else throw Error('invalid_phase');
`;

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-process-kill-wal-'));
  const database=path.join(dir,'canonical.sqlite');
  let current=new Store(database);
  const taskA=current.createTask('Isolated task A');
  const taskB=current.createTask('Isolated task B');
  current.close();current=null;
  t.after(()=>{
    try{current?.close();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  });
  return {
    database,taskA,taskB,
    open(){assert.equal(current,null);current=new Store(database);return current;},
    close(){current?.close();current=null;}
  };
}

async function killAtDurableBoundary(t,{database,taskId,phase,runId=null,ledgerPath=''}) {
  const child=spawn(process.execPath,['--input-type=module','-e',workerSource],{
    env:{...process.env,E2E_STORE_MODULE:storeModule,E2E_DB:database,
      E2E_TASK:taskId,E2E_PHASE:phase,E2E_RUN:runId||'',E2E_LEDGER:ledgerPath},
    stdio:['ignore','pipe','pipe'],windowsHide:true
  });
  let stderr='';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  let buffer='';
  const arrived=new Promise((resolve,reject)=>{
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{
      buffer+=chunk;
      if(buffer.includes('READY\n'))resolve();
    });
    child.on('error',reject);
    child.once('exit',(code,signal)=>{
      if(!buffer.includes('READY\n'))
        reject(Error('worker_exited_before_boundary:'+code+':'+signal+':'+stderr.slice(-500)));
    });
  });
  const timeout=setTimeout(()=>{child.kill('SIGKILL');},18000);
  try{
    await arrived;
    const exited=new Promise((resolve,reject)=>{
      child.once('exit',resolve);
      child.once('error',reject);
    });
    assert.equal(child.kill('SIGKILL'),true,'Windows worker must be terminated');
    await exited;
  }finally{
    clearTimeout(timeout);
    if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
  }
}

function snapshot(store,taskId) {
  const q=(sql,...args)=>store.db.prepare(sql).get(...args).n;
  return {
    user:q("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='user'",taskId),
    assistant:q("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='assistant'",taskId),
    runs:q('SELECT COUNT(*) n FROM runs WHERE task_id=?',taskId),
    checkpoints:q('SELECT COUNT(*) n FROM checkpoints WHERE task_id=?',taskId),
    events:q('SELECT COUNT(*) n FROM events WHERE task_id=?',taskId),
    status:store.db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId).status
  };
}
function clean(store){
  assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  assert.equal(store.db.prepare('PRAGMA journal_mode').get().journal_mode,'wal');
}

test('real child termination before SQLite COMMIT rolls back message, Run and events',async t=>{
  const f=fixture(t);
  await killAtDurableBoundary(t,{database:f.database,taskId:f.taskA.id,phase:'before_commit'});
  for(let restart=0;restart<6;restart++){
    const s=f.open();
    clean(s);
    assert.deepEqual(snapshot(s,f.taskA.id),{
      user:0,assistant:0,runs:0,checkpoints:0,events:1,status:'ready'
    });
    assert.equal(s.recoverInterruptedRuns(),0);
    assert.equal(snapshot(s,f.taskB.id).runs,0);
    f.close();
  }
});

test('real child termination after committed send quarantines exactly once across repeated restarts',async t=>{
  const f=fixture(t);
  await killAtDurableBoundary(t,{database:f.database,taskId:f.taskA.id,phase:'after_commit'});
  let runId;
  for(let restart=0;restart<10;restart++){
    const s=f.open();
    clean(s);
    const run=s.db.prepare('SELECT id,status FROM runs WHERE task_id=?').get(f.taskA.id);
    runId??=run.id;
    assert.equal(run.id,runId);
    assert.equal(run.status,restart===0?'running':'interrupted');
    assert.equal(s.recoverInterruptedRuns(),restart===0?1:0);
    const a=snapshot(s,f.taskA.id);
    assert.equal(a.user,1);
    assert.equal(a.assistant,0);
    assert.equal(a.runs,1);
    assert.equal(a.checkpoints,0);
    assert.equal(a.status,'interrupted');
    assert.equal(snapshot(s,f.taskB.id).status,'ready');
    assert.equal(snapshot(s,f.taskB.id).runs,0);
    f.close();
  }
});

test('real child termination inside finishRun transaction leaves no false success or orphan checkpoint',async t=>{
  const f=fixture(t);
  let s=f.open();
  const {runId}=s.beginProviderRun(f.taskA.id,'committed hypothetical request');
  f.close();
  await killAtDurableBoundary(t,{database:f.database,taskId:f.taskA.id,phase:'during_finish',runId});
  s=f.open();
  clean(s);
  assert.equal(s.db.prepare('SELECT status FROM runs WHERE id=?').get(runId).status,'running');
  assert.equal(snapshot(s,f.taskA.id).assistant,0);
  assert.equal(snapshot(s,f.taskA.id).checkpoints,0);
  assert.equal(s.recoverInterruptedRuns(),1);
  assert.equal(s.db.prepare('SELECT status FROM runs WHERE id=?').get(runId).status,'interrupted');
  assert.throws(()=>s.finishRun(f.taskA.id,runId),/run_finish_state_invalid/);
  assert.equal(snapshot(s,f.taskA.id).assistant,0);
  f.close();
});

test('real child termination after committed finish survives 8 restarts without replay',async t=>{
  const f=fixture(t);
  let s=f.open();
  const {runId}=s.beginProviderRun(f.taskA.id,'committed hypothetical request');
  f.close();
  await killAtDurableBoundary(t,{database:f.database,taskId:f.taskA.id,phase:'after_finish',runId});
  for(let restart=0;restart<8;restart++){
    s=f.open();
    clean(s);
    assert.equal(s.recoverInterruptedRuns(),0);
    assert.equal(s.db.prepare('SELECT status FROM runs WHERE id=?').get(runId).status,'succeeded');
    const state=snapshot(s,f.taskA.id);
    assert.equal(state.user,1);
    assert.equal(state.assistant,1);
    assert.equal(state.checkpoints,1);
    assert.equal(state.runs,1);
    assert.throws(()=>s.finishRun(f.taskA.id,runId),/run_finish_state_invalid/);
    assert.equal(snapshot(s,f.taskB.id).runs,0);
    f.close();
  }
});

test('two independent Windows processes contending for one Task reserve just one GPT Run',async t=>{
  const f=fixture(t);
  // Both child processes open the SAME real database and contend for
  // BEGIN IMMEDIATE. There can be only one committed request.
  const results=await Promise.allSettled([
    killAtDurableBoundary(t,{database:f.database,taskId:f.taskA.id,phase:'after_commit'}),
    killAtDurableBoundary(t,{database:f.database,taskId:f.taskA.id,phase:'after_commit'})
  ]);
  const completed=results.filter(x=>x.status==='fulfilled');
  const rejected=results.filter(x=>x.status==='rejected');
  assert.equal(completed.length,1,'one contender must reserve the logical send');
  assert.equal(rejected.length,1,'the competing process must be refused');
  assert.match(String(rejected[0].reason),/task_run_already_active/);
  let s=f.open();
  clean(s);
  assert.equal(snapshot(s,f.taskA.id).runs,1);
  assert.equal(snapshot(s,f.taskA.id).user,1);
  assert.equal(snapshot(s,f.taskB.id).runs,0);
  assert.equal(s.recoverInterruptedRuns(),1);
  assert.equal(s.recoverInterruptedRuns(),0);
  f.close();
});

test('external effect applied before lost acknowledgement stays uncertain across 24 real SQLite restarts',async t=>{
  const f=fixture(t);
  const ledgerPath=path.join(path.dirname(f.database),'simulated-external-ledger.sqlite');
  // External world is a SECOND, independent SQLite ledger, not the
  // Orchestrator DB. Its effect commits before the child dies.
  await killAtDurableBoundary(t,{database:f.database,taskId:f.taskA.id,
    phase:'after_external_effect',ledgerPath});
  let runId;
  for(let restart=0;restart<24;restart++){
    const s=f.open();
    clean(s);
    const run=s.db.prepare('SELECT id,status FROM runs WHERE task_id=?').get(f.taskA.id);
    runId??=run.id;
    assert.equal(run.id,runId);
    assert.equal(run.status,restart===0?'running':'interrupted');
    assert.equal(s.recoverInterruptedRuns(),restart===0?1:0);
    const v=snapshot(s,f.taskA.id);
    assert.equal(v.runs,1);
    assert.equal(v.user,1);
    assert.equal(v.assistant,0);
    assert.equal(v.checkpoints,0);
    assert.equal(v.status,'interrupted');
    assert.equal(snapshot(s,f.taskB.id).runs,0);
    const external=new DatabaseSync(ledgerPath,{readOnly:true});
    try{
      assert.equal(external.prepare('SELECT COUNT(*) n FROM effects WHERE task_id=?').get(f.taskA.id).n,1);
      assert.equal(external.prepare('PRAGMA quick_check').get().quick_check,'ok');
    }finally{external.close();}
    f.close();
  }
  // A missing local success receipt is not proof that the external
  // operation did not happen. No code in this test retries the effect.
});
