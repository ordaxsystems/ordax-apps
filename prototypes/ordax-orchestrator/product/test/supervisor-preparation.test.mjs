import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Store} from '../src/store.mjs';
import {SUPERVISOR_ROLES,supervisorRole,assertSupervisorRole} from '../src/supervisor-role-presets.mjs';
import {createLocalGroqCredential} from '../src/local-supervisor-credential.mjs';

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

test('Groq key is encrypted and scoped to private userData; never stored as plaintext',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-lab-groq-vault-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const safeStorage={
    isEncryptionAvailable:()=>true,
    encryptString:v=>Buffer.from('protected:'+Buffer.from(v).toString('base64')),
    decryptString:b=>Buffer.from(b.toString().slice('protected:'.length),'base64').toString()
  };
  const key='gsk_'+('A'.repeat(40));
  const vault=createLocalGroqCredential({userRoot:dir,safeStorage,platform:'win32'});
  assert.equal(vault.hasSaved(),false);
  assert.equal(vault.isAvailable(),true);
  assert.throws(()=>vault.save('sk-openai-not-groq'),/supervisor_key_invalid_format/);
  assert.equal(vault.save(key).saved,true);
  const persisted=fs.readFileSync(path.join(dir,'config','groq-key.enc'));
  assert.ok(!persisted.toString().includes(key));
  assert.equal(vault.hasSaved(),true);
  assert.equal(vault.read(),key);
  assert.equal(vault.remove().saved,false);
  assert.equal(vault.read(),null);
  assert.equal(fs.existsSync(path.join(dir,'config','groq-key.enc')),false);
});

test('no encrypted storage means fail closed, never fallback to a plaintext key file',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-lab-no-vault-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const key='gsk_'+('X'.repeat(32));
  for(const [platform,safeStorage] of [
    ['linux',{isEncryptionAvailable:()=>true,encryptString:()=>Buffer.from('not-safe')}],
    ['win32',{isEncryptionAvailable:()=>false,encryptString:()=>Buffer.from('not-safe')}]
  ]){
    const vault=createLocalGroqCredential({userRoot:dir,platform,safeStorage});
    assert.equal(vault.isAvailable(),false);
    assert.throws(()=>vault.save(key),/supervisor_secure_storage_unavailable/);
    assert.equal(vault.read(),null);
  }
  assert.equal(fs.existsSync(path.join(dir,'config','groq-key.enc')),false);
});

test('preparation IPC checks trusted renderer and does not invoke planning or ChatGPT',()=>{
  const main=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
  const preload=fs.readFileSync(new URL('../desktop/preload.cjs',import.meta.url),'utf8');
  const ui=fs.readFileSync(new URL('../desktop/ui.js',import.meta.url),'utf8');
  const setup=main.slice(main.indexOf("ipcMain.handle('ordax:supervisor:key:save'"),
    main.indexOf("ipcMain.handle('ordax:supervisor:plan'"));
  assert.match(setup,/requireTrustedSupervisorRenderer\(event\)/);
  assert.match(setup,/groqCredential\.save\(key\)/);
  assert.match(setup,/groqCredential\.remove\(\)/);
  assert.match(setup,/store\.setTaskSupervisorRole\(/);
  assert.doesNotMatch(setup,/runTask\(|\.plan\(|\.dispatch\(|fetch\(|\.send\(/);
  assert.match(preload,/supervisorSaveKey:/);
  assert.match(preload,/setTaskSupervisorRole:/);
  assert.match(ui,/labRoleSelect\.addEventListener\('change'/);
  assert.match(ui,/labKeyForm\.addEventListener\('submit'/);
  assert.doesNotMatch(ui.slice(ui.indexOf('labKeyForm.addEventListener'),ui.indexOf('labKeyRemove.addEventListener')),/supervisorPlan\(|supervisorDispatch\(/);
});
