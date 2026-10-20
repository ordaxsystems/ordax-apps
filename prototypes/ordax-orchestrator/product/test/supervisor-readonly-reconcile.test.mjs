import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.mjs';
import { inspectSupervisorChatReadOnly } from '../supervisor/read-only-reconcile.mjs';
import { listLocalSupervisorRecoverable } from '../supervisor/coordinator.mjs';

const url='https://chatgpt.com/c/11111111-2222-4333-8444-555555555555';
function setup(t,{status='indeterminate',decision=true,chatUrl=url,actorId='lab-owner'}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-reconcile-readonly-'));
  const store=new Store(path.join(dir,'state.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const task=store.createTask('Read-only recovery fixture');
  store.db.prepare('UPDATE tasks SET chat_url=? WHERE id=?').run(chatUrl,task.id);
  const actionId='action_11111111-2222-4333-8444-555555555555';
  const payload={objective:'Read only',environment:'internal',tenantId:null,actorId};
  const result=decision ? {decision:{type:'send_message',taskId:task.id,
    content:'ORDAX_RECOVERY_MESSAGE',reason:'Approved earlier'}} : {reason:'legacy_lost_decision'};
  store.db.prepare(
    'INSERT INTO action_ledger(id,task_id,run_id,action_type,resource_key,status,payload,result,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
  ).run(actionId,task.id,null,'supervisor.plan','internal:owner:test',status,
    JSON.stringify(payload),JSON.stringify(result),store.now(),store.now());
  let inspected=0;
  const sample={
    available:true,url,domReliable:true,truncated:false,
    messages:[{role:'user',text:'ORDAX_RECOVERY_MESSAGE'},{role:'assistant',text:'Ready'}]
  };
  const worker={inspectConversationReadOnly:async()=>{inspected++;return sample;}};
  return {store,task,actionId,worker,counts:()=>inspected,sample};
}
const call=f=>inspectSupervisorChatReadOnly({store:f.store,worker:f.worker,
  taskId:f.task.id,actionId:f.actionId});

test('real SQLite: candidate inspected but action, messages and events are never mutated',async t=>{
  const f=setup(t);
  const before={
    action:f.store.db.prepare('SELECT * FROM action_ledger WHERE id=?').get(f.actionId),
    messages:f.store.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,
    events:f.store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n
  };
  const result=await call(f);
  assert.equal(result.kind,'response_candidate');
  assert.equal(result.persistedStatus,'indeterminate');
  assert.equal(result.requiresReconciliation,true);
  assert.equal(f.counts(),1);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM action_ledger WHERE id=?').get(f.actionId),before.action);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,before.messages);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n,before.events);
  assert.equal(JSON.stringify(result).includes('ORDAX_RECOVERY_MESSAGE'),false);
});
test('legacy uncertain action without approved message cannot inspect or resend',async t=>{
  const f=setup(t,{decision:false});
  const result=await call(f);
  assert.equal(result.reason,'legacy_decision_missing');
  assert.equal(f.counts(),0);
});
test('no canonical linked thread forbids web inspection',async t=>{
  const f=setup(t,{chatUrl:null});
  assert.equal((await call(f)).reason,'canonical_chat_url_missing');
  assert.equal(f.counts(),0);
});
test('approved but undispatched action must not be searched as uncertain',async t=>{
  const f=setup(t,{status:'approved'});
  assert.equal((await call(f)).reason,'action_not_dispatched_uncertain');
  assert.equal(f.counts(),0);
});
test('foreign actor/session and wrong action are rejected before browser access',async t=>{
  const f=setup(t,{actorId:'another-owner'});
  await assert.rejects(call(f),/supervisor_access_denied/);
  assert.equal(f.counts(),0);
  f.store.db.prepare('UPDATE action_ledger SET payload=? WHERE id=?').run(
    JSON.stringify({objective:'Read only',environment:'internal',tenantId:null,actorId:'lab-owner'}),
    f.actionId);
  f.store.db.prepare('UPDATE tasks SET workspace_session_id=NULL WHERE id=?').run(f.task.id);
  await assert.rejects(call(f),/supervisor_access_denied/);
  assert.equal(f.counts(),0);
});
test('concurrent change during inspection invalidates candidate',async t=>{
  const f=setup(t);
  f.worker.inspectConversationReadOnly=async()=>{
    f.store.db.prepare('UPDATE action_ledger SET status=? WHERE id=?').run('succeeded',f.actionId);
    return f.sample;
  };
  const result=await call(f);
  assert.equal(result.reason,'reconciliation_state_changed');
});
test('manual UI guards IPC; browser inspection uses no submission path',()=>{
  const here=path.dirname(fileURLToPath(import.meta.url));
  const main=fs.readFileSync(path.resolve(here,'../desktop/main.mjs'),'utf8');
  const worker=fs.readFileSync(path.resolve(here,'../desktop/embedded-worker.mjs'),'utf8');
  const ui=fs.readFileSync(path.resolve(here,'../desktop/ui.html'),'utf8');
  const chunk=main.split("ipcMain.handle('ordax:supervisor:inspect'")[1]
    .split("ipcMain.handle('ordax:supervisor:approve'")[0];
  assert.match(chunk,/requireTrustedSupervisorRenderer\(event\)/);
  assert.match(chunk,/inspectSupervisorChatReadOnly/);
  assert.match(ui,/id="labSupervisorInspect"/);
  const inspector=worker.split('async inspectConversationReadOnly(')[1].split('async #composerState()')[0];
  assert.match(inspector,/this\.enqueue/);
  assert.match(inspector,/showConversation\(expected, \{force:false,requireComposer:false\}\)/);
  assert.doesNotMatch(inspector,/submitExactlyOnce|requestSubmit|setComposerAndSend|sendPrompt/);
});

test('existing pending actions are readable without enabling the supervisor or Groq',t=>{
  const f=setup(t);
  const before=f.store.db.prepare('SELECT * FROM action_ledger WHERE id=?').get(f.actionId);
  const pending=listLocalSupervisorRecoverable({store:f.store,taskId:f.task.id});
  assert.equal(pending.length,1);
  assert.equal(pending[0].actionId,f.actionId);
  assert.equal(pending[0].status,'indeterminate');
  assert.equal(pending[0].decision.content,'ORDAX_RECOVERY_MESSAGE');
  assert.equal(f.counts(),0);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM action_ledger WHERE id=?').get(f.actionId),before);
  f.store.db.prepare('UPDATE tasks SET workspace_session_id=NULL WHERE id=?').run(f.task.id);
  assert.throws(()=>listLocalSupervisorRecoverable({store:f.store,taskId:f.task.id}),
    /supervisor_access_denied/);
});

test('recovery IPC and UI allow inspection without planner API access',()=>{
  const here=path.dirname(fileURLToPath(import.meta.url));
  const main=fs.readFileSync(path.resolve(here,'../desktop/main.mjs'),'utf8');
  const ui=fs.readFileSync(path.resolve(here,'../desktop/ui.js'),'utf8');
  const chunk=main.split("ipcMain.handle('ordax:supervisor:recoverable'")[1]
    .split("ipcMain.handle('ordax:supervisor:inspect'")[0];
  assert.match(chunk,/listLocalSupervisorRecoverable/);
  assert.doesNotMatch(chunk,/requireLabSupervisor/);
  assert.match(ui,/labRecoverButton.disabled = false;/);
});
