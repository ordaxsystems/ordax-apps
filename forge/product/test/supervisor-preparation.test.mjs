import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Store} from '../src/store.mjs';
import {SUPERVISOR_ROLES,supervisorRole,assertSupervisorRole} from '../src/supervisor-role-presets.mjs';

test('role catalog has two distinct preparation examples and no executable authority',()=>{
  assert.deepEqual(SUPERVISOR_ROLES.map(x=>x.id),['none','math-teacher','ordax-architect']);
  assert.match(supervisorRole('math-teacher').draft,/matemática/);
  assert.match(supervisorRole('ordax-architect').draft,/OrdaX/);
  assert.equal(supervisorRole('unknown').id,'none');
  assert.throws(()=>assertSupervisorRole('shell:exec'),/invalid_supervisor_role/);
});

test('roles are persisted per Task in canonical events, not as fake provider messages',t=>{
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const first=store.createTask('Contas e equações');
  const second=store.createTask('Projeto OrdaX');
  assert.equal(store.getTask(first.id).supervisor_role,'none');
  assert.equal(store.setTaskSupervisorRole(first.id,'math-teacher').supervisor_role,'math-teacher');
  assert.equal(store.setTaskSupervisorRole(second.id,'ordax-architect').supervisor_role,'ordax-architect');
  assert.equal(store.getTask(first.id).supervisor_role,'math-teacher');
  assert.equal(store.listTasks().find(x=>x.id===second.id).supervisor_role,'ordax-architect');
  store.setTaskSupervisorRole(first.id,'math-teacher');
  const count=store.db.prepare("SELECT count(*) n FROM events WHERE task_id=? AND kind='task.supervisor_role'").get(first.id).n;
  assert.equal(count,1,'idempotent role selection');
  assert.equal(store.db.prepare('SELECT count(*) n FROM runs').get().n,0);
  assert.equal(store.db.prepare('SELECT count(*) n FROM messages').get().n,0);
  assert.throws(()=>store.setTaskSupervisorRole(first.id,'invalid-role'),/invalid_supervisor_role/);
  assert.throws(()=>store.setTaskSupervisorRole('task_nonexistent','math-teacher'),/task_access_denied/);
});

test('legacy model-key preparation IPC is removed and local role metadata stays available',()=>{
  const main=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
  const preload=fs.readFileSync(new URL('../desktop/preload.cjs',import.meta.url),'utf8');
  const hostBridge=fs.readFileSync(new URL('../desktop/host-browser-bridge.js',import.meta.url),'utf8');
  const ui=fs.readFileSync(new URL('../desktop/ui.js',import.meta.url),'utf8');
  const html=fs.readFileSync(new URL('../desktop/ui.html',import.meta.url),'utf8');
  for(const name of ['ordax:supervisor:key:save','ordax:supervisor:key:test',
    'ordax:supervisor:key:remove','ordax:supervisor:plan','ordax:supervisor:approve',
    'ordax:supervisor:dispatch'])
    assert.equal(main.includes("registerUiHandler('"+name+"'"),false);
  assert.doesNotMatch(preload,/supervisorSaveKey|supervisorTestKey|supervisorRemoveKey/);
  assert.doesNotMatch(hostBridge,/supervisorSaveKey|supervisorRemoveKey|supervisorPlan|supervisorApprove|supervisorDispatch/);
  assert.doesNotMatch(html,/labSupervisorKeyInput|labSupervisorKeySettings/);
  assert.match(main,/store\.setTaskSupervisorRole\(/);
  assert.match(preload,/setTaskSupervisorRole:/);
  assert.match(ui,/labRoleSelect\.addEventListener\('change'/);
  assert.doesNotMatch(ui,/labKeyForm\.addEventListener/);
});

test('optional packaged MVP App proof stays read-only and requires external-model credentials to be absent',()=>{
  const source=fs.readFileSync(new URL('../scripts/live-ui-build-proof-readonly.cjs',import.meta.url),'utf8');
  assert.match(source,/ORDAX_LAB_E2E_VERIFY_MVP_PREPARATION/);
  assert.match(source,/preparationUiVerified/);
  assert.match(source,/labSupervisorRole/);
  assert.match(source,/keyInputAbsent/);
  assert.match(source,/legacyCredentialStatusAbsent/);
  assert.match(source,/provider!=='chatgpt_web'/);
  assert.match(source,/externalModelCredentialsAbsent:true/);
  assert.match(source,/window\.ordax\.supervisorStatus\(\)/);
  assert.match(source,/lab_build_mvp_preparation_not_ready/);
  assert.doesNotMatch(source,/keyType|formPresent|keySavePresent|keyRemovePresent|keySaved:false/);
  assert.doesNotMatch(source,/window\.ordax\.(?:send|supervisorPlan|supervisorDispatch|supervisorSaveKey|supervisorRemoveKey|setTaskSupervisorRole)\(/);
});
