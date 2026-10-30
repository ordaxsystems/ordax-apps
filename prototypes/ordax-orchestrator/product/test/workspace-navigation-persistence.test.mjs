import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {Store} from '../src/store.mjs';
import {createTaskUiHandlers} from '../src/task-ui-handlers.mjs';

function createFixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-navigation-'));
  const database=path.join(root,'workspace.sqlite');
  let store=new Store(database);
  t.after(()=>{try{store.close();}catch{}fs.rmSync(root,{recursive:true,force:true});});
  store.db.exec(`
    CREATE TABLE lab_projects(id TEXT PRIMARY KEY,workspace_session_id TEXT NOT NULL);
    CREATE TABLE lab_orchestrators(id TEXT PRIMARY KEY,project_id TEXT NOT NULL);
    CREATE TABLE lab_task_bindings(task_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,orchestrator_id TEXT NOT NULL,kind TEXT NOT NULL);
  `);
  const session=store.getWorkspaceSession();
  const projectId='lab_project_test';
  const orchestratorId='lab_orchestrator_test';
  const task=store.createTask('Persistir seleção');
  store.db.prepare('INSERT INTO lab_projects(id,workspace_session_id) VALUES(?,?)').run(projectId,session.id);
  store.db.prepare('INSERT INTO lab_orchestrators(id,project_id) VALUES(?,?)').run(orchestratorId,projectId);
  store.db.prepare('INSERT INTO lab_task_bindings(task_id,project_id,orchestrator_id,kind) VALUES(?,?,?,?)')
    .run(task.id,projectId,orchestratorId,'work');
  const makeHandlers=()=>createTaskUiHandlers({store});
  return {
    database,task,projectId,orchestratorId,makeHandlers,
    reopen(){store.close();store=new Store(database);return store;},
    store:()=>store
  };
}

test('last task, project and orchestrator selection survive a real Store restart',t=>{
  const fixture=createFixture(t);
  const set=fixture.makeHandlers().get('ordax:workspace:navigation:set');
  const saved=set(null,{view:'task',taskId:fixture.task.id,projectId:fixture.projectId,orchestratorId:fixture.orchestratorId});
  assert.deepEqual(saved,{schema:'ordax.workspace-navigation.v1',view:'task',taskId:fixture.task.id,
    projectId:fixture.projectId,orchestratorId:fixture.orchestratorId});

  const reopened=fixture.reopen();
  const handlers=fixture.makeHandlers();
  assert.deepEqual(handlers.get('ordax:workspace:get')().metadata.navigation,saved);
  assert.equal(reopened.getTask(saved.taskId).title,'Persistir seleção');
});

test('navigation persistence rejects tasks outside the current workspace',t=>{
  const fixture=createFixture(t);
  fixture.store().db.prepare('UPDATE tasks SET workspace_session_id=? WHERE id=?').run('another_session',fixture.task.id);
  const set=fixture.makeHandlers().get('ordax:workspace:navigation:set');
  assert.throws(()=>set(null,{view:'task',taskId:fixture.task.id,projectId:fixture.projectId,
    orchestratorId:fixture.orchestratorId}),/task_not_found/);
  assert.equal(fixture.store().getWorkspaceSession().metadata.navigation,undefined);
});

test('task scope must agree with its persisted project and orchestrator binding',t=>{
  const fixture=createFixture(t);
  const set=fixture.makeHandlers().get('ordax:workspace:navigation:set');
  assert.throws(()=>set(null,{view:'task',taskId:fixture.task.id,projectId:fixture.projectId,
    orchestratorId:'another_orchestrator'}),/workspace_navigation_scope_mismatch/);
  assert.equal(fixture.store().getWorkspaceSession().metadata.navigation,undefined);
});

test('coordinator restoration requires a real workspace project and orchestrator',t=>{
  const fixture=createFixture(t);
  const set=fixture.makeHandlers().get('ordax:workspace:navigation:set');
  assert.throws(()=>set(null,{view:'coordinator',projectId:fixture.projectId,orchestratorId:null}),
    /workspace_navigation_coordinator_scope_required/);
  assert.throws(()=>set(null,{view:'coordinator',projectId:'unknown_project',orchestratorId:'unknown_orchestrator'}),
    /workspace_navigation_project_not_found/);
  assert.deepEqual(set(null,{view:'coordinator',projectId:fixture.projectId,orchestratorId:fixture.orchestratorId}),{
    schema:'ordax.workspace-navigation.v1',view:'coordinator',taskId:null,
    projectId:fixture.projectId,orchestratorId:fixture.orchestratorId
  });
});

test('Electron and Host expose the same validated workspace navigation command',()=>{
  const preload=readFileSync(new URL('../desktop/preload.cjs',import.meta.url),'utf8');
  const hostBridge=readFileSync(new URL('../desktop/host-browser-bridge.js',import.meta.url),'utf8');
  const hostServer=readFileSync(new URL('../host/host-browser-server.mjs',import.meta.url),'utf8');
  assert.match(preload,/setWorkspaceNavigation: navigation => ipcRenderer\.invoke\('ordax:workspace:navigation:set', navigation\)/);
  assert.match(hostBridge,/setWorkspaceNavigation:\['navigation'\]/);
  assert.match(hostServer,/setWorkspaceNavigation:\['ordax:workspace:navigation:set',a=>\[a\[0\]\]\]/);
});

test('startup restores scoped navigation before deciding whether to show the coordinator',()=>{
  const ui=readFileSync(new URL('../desktop/orchestrator-ui.mjs',import.meta.url),'utf8');
  const renderer=readFileSync(new URL('../desktop/ui.js',import.meta.url),'utf8');
  assert.match(ui,/async start\(\{restoreNavigation=null\}=\{\}\)/);
  assert.match(ui,/projectId=projects\.some\(project=>project\.id===saved\?\.projectId\)/);
  assert.match(ui,/shouldRestoreTask=saved\?\.view==='task'/);
  assert.match(renderer,/orchestrationUi\.start\(\{restoreNavigation:savedNavigation\}\)/);
  assert.match(renderer,/if\(inScope\)await openTask\(task\.id\)/);
});
