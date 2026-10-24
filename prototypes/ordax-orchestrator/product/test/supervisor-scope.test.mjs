import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.mjs';
import { authorizeLocalSupervisorTask, SupervisorCoordinator } from '../supervisor/coordinator.mjs';

const current = path.dirname(fileURLToPath(import.meta.url));
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-lab-scope-'));
  const store=new Store(path.join(dir,'local.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  return store;
}
const check=(store,taskId,operation='plan',extras={})=>
  authorizeLocalSupervisorTask({store,taskId,operation,
    actorId:'lab-owner',tenantId:null,environment:'internal',...extras});

test('supervisor cannot plan, approve or dispatch tasks outside active local workspace session',t=>{
  const store=fixture(t);
  const task=store.createTask('Owner task');
  for(const operation of ['plan','review','approve','dispatch']) {
    assert.equal(check(store,task.id,operation),true,operation);
  }
  const other='session_other';
  const now=store.now();
  store.db.prepare('INSERT INTO workspace_sessions(id,status,metadata,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run(other,'active','{}',now,now);
  store.db.prepare('UPDATE tasks SET workspace_session_id=? WHERE id=?').run(other,task.id);
  for(const operation of ['plan','review','approve','dispatch'])
    assert.equal(check(store,task.id,operation),false,operation);
});

test('supervisor authorization fails closed for foreign actor, tenant, operation or absent session ownership',t=>{
  const store=fixture(t);
  const task=store.createTask('Local only');
  assert.equal(check(store,task.id,'execute'),false);
  assert.equal(check(store,task.id,'send_message'),false);
  assert.equal(check(store,task.id,'plan',{actorId:'other'}),false);
  assert.equal(check(store,task.id,'plan',{tenantId:'tenant-a'}),false);
  assert.equal(check(store,task.id,'plan',{environment:'external'}),false);
  assert.equal(check(store,'nonexistent'),false);
  store.db.prepare('UPDATE tasks SET workspace_session_id=NULL WHERE id=?').run(task.id);
  assert.equal(check(store,task.id),false);
});

test('inactive session and archived task cannot authorize a fresh supervisor effect',t=>{
  const store=fixture(t);
  const task=store.createTask('Not authorized while archived');
  store.db.prepare('UPDATE tasks SET status=? WHERE id=?').run('archived',task.id);
  assert.equal(check(store,task.id),false);
  store.db.prepare('UPDATE tasks SET status=? WHERE id=?').run('ready',task.id);
  assert.equal(check(store,task.id),true);
  store.db.prepare('UPDATE workspace_sessions SET status=? WHERE id=?')
    .run('closed',store.getWorkspaceSession().id);
  assert.equal(check(store,task.id),false);
});

test('coordinator uses local scope on every operation and leaves the model disabled on denied task',async t=>{
  const store=fixture(t);
  const task=store.createTask('Foreign task');
  store.db.prepare('UPDATE tasks SET workspace_session_id=NULL WHERE id=?').run(task.id);
  let called=0;
  const sup=new SupervisorCoordinator({
    store,enabled:true,actorId:'lab-owner',environment:'internal',
    authorizeTask:scope=>authorizeLocalSupervisorTask({store,...scope}),
    planner:{decide:async()=>{called++;return {type:'hold',taskId:task.id,reason:'blocked'};}},
    chat:{send:async()=>{called++;return {confirmed:true};}}
  });
  await assert.rejects(sup.plan({taskId:task.id,requestId:'denied',objective:'No access'}),/supervisor_access_denied/);
  assert.throws(()=>sup.listRecoverable({taskId:task.id}),/supervisor_access_denied/);
  assert.equal(called,0);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM action_ledger WHERE task_id=?").get(task.id).n,0);
});

test('supervisor IPC entry points must enforce trusted local renderer identity',()=>{
  const main=fs.readFileSync(path.resolve(current,'../desktop/main.mjs'),'utf8');
  const methods=['status','plan','recoverable','approve','dispatch'];
  assert.match(main,/event\.senderFrame !== win\.webContents\.mainFrame/);
  assert.match(main,/pathToFileURL\(path\.join\(here, 'ui\.html'\)\)\.href/);
  for(const method of methods) {
    const snippet=main.split("registerUiHandler('ordax:supervisor:"+method+"'")[1];
    assert.ok(snippet,method+' missing');
    assert.match(snippet.slice(0,190),/requireTrustedSupervisorRenderer\(event\)/,method);
  }
});

test('approval IPC denies foreign task before reading or displaying proposed content',()=>{
  const main=fs.readFileSync(path.resolve(current,'../desktop/main.mjs'),'utf8');
  const approval=main.split("registerUiHandler('ordax:supervisor:approve'")[1]
    .split("registerUiHandler('ordax:supervisor:dispatch'")[0];
  const permission=approval.indexOf("controller.authorize(payload?.taskId, 'approve')");
  const read=approval.indexOf("SELECT result,status FROM action_ledger");
  const show=approval.indexOf("confirmInActiveUi({");
  assert.ok(permission>=0 && read>permission && show>read);
});
