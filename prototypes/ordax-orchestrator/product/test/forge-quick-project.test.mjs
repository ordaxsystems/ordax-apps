import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {suggestForgeProjectTitle,UNTITLED_FORGE_PROJECT} from '../src/project-auto-title.mjs';

function fixture(t){
  const store=new Store(':memory:');t.after(()=>store.close());
  const context={actorId:'owner',clientId:'desktop',workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,authorize:({context:who})=>who===context});
  const run=(operation,input)=>service.invoke(context,operation,input);
  return {store,context,service,run};
}

test('Novo projeto creates ONLY a blank project and Forjador chat, no prompt or GPT work',async t=>{
  const {store,run}=fixture(t);
  const first=await run('project_quick_create',{requestId:'quick_1',creationNonce:'first_1'});
  assert.equal(first.status,'succeeded');
  const {projectId,orchestratorId,chatTaskId}=first.result;
  assert.equal(first.result.projectName,'Novo projeto');
  assert.equal(first.result.workCreated,0);
  assert.equal(first.result.providerMessagesSent,0);
  assert.equal(store.db.prepare('SELECT count(*) n FROM messages').get().n,0);
  assert.equal(store.db.prepare('SELECT count(*) n FROM runs').get().n,0);
  assert.equal(store.db.prepare("SELECT count(*) n FROM lab_task_bindings WHERE project_id=? AND kind='work'").get(projectId).n,0);
  const owner=await run('orchestrators_list',{projectId});
  assert.equal(owner.orchestrators[0].id,orchestratorId);
  assert.equal(owner.orchestrators[0].chat_task_id,chatTaskId);
  assert.equal((await run('work_messages',{projectId,taskId:chatTaskId})).messages.length,0);
  assert.deepEqual(await run('project_quick_create',{requestId:'quick_1',creationNonce:'first_1'}),first);
  const another=await run('project_quick_create',{requestId:'quick_2',creationNonce:'second_2'});
  assert.notEqual(another.result.projectId,projectId);
  assert.equal(another.result.projectName,'Novo projeto');
  assert.equal((await run('projects_list')).projects.length,2);
  await assert.rejects(run('project_quick_create',{requestId:'quick_1',creationNonce:'different'}),/request_conflict/);
});

test('first user turn labels only still-untitled project; manual rename wins',async t=>{
  const {store,run}=fixture(t);
  const first=(await run('project_quick_create',{requestId:'q_1',creationNonce:'c_1'})).result;
  const idle=await run('project_auto_title',{requestId:'title_idle',projectId:first.projectId});
  assert.equal(idle.result.changed,false);
  store.appendMessage(first.chatTaskId,'user','Crie um site de cafeteria');
  const title=await run('project_auto_title',{requestId:'title_first',projectId:first.projectId});
  assert.equal(title.status,'succeeded');
  assert.equal(title.result.changed,true);
  assert.equal(title.result.name,'Site de cafeteria');
  store.appendMessage(first.chatTaskId,'user','Coloque botão de contato');
  const again=await run('project_auto_title',{requestId:'title_again',projectId:first.projectId});
  assert.equal(again.result.changed,false);
  assert.equal(again.result.name,'Site de cafeteria');
  const renamed=await run('project_rename',{requestId:'rename_1',projectId:first.projectId,name:'Minha marca'});
  assert.equal(renamed.result.name,'Minha marca');
  const still=await run('project_auto_title',{requestId:'title_after',projectId:first.projectId});
  assert.equal(still.result.name,'Minha marca');
  assert.equal(still.result.changed,false);
});

test('owner authorization is enforced for no-form creation and auto title',async t=>{
  const {context,service,run,store}=fixture(t);
  const foreign={...context,actorId:'foreign'};
  await assert.rejects(service.invoke(foreign,'project_quick_create',{requestId:'bad',creationNonce:'bad'}),
    /orchestrator_access_denied/);
  const created=(await run('project_quick_create',{requestId:'good',creationNonce:'good'})).result;
  store.appendMessage(created.chatTaskId,'user','Crie um blog');
  await assert.rejects(service.invoke(foreign,'project_auto_title',{requestId:'bad_title',projectId:created.projectId}),
    /orchestrator_access_denied/);
});

test('natural-language first request gives a useful safe title, not a path',()=>{
  assert.equal(suggestForgeProjectTitle('Crie um site de cafeteria'),'Site de cafeteria');
  assert.equal(suggestForgeProjectTitle('Quero uma loja virtual'),'Quero uma loja virtual');
  assert.equal(suggestForgeProjectTitle(''),UNTITLED_FORGE_PROJECT);
  assert.equal(suggestForgeProjectTitle('Crie um'),UNTITLED_FORGE_PROJECT);
  assert.ok(suggestForgeProjectTitle('Crie um projeto para a cafeteria').length<=70);
});

test('quick project UI opens chat immediately and never requests name or goal',()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const js=fs.readFileSync(path.join(root,'desktop/orchestrator-ui.mjs'),'utf8');
  assert.match(js,/\$\('quickNewProject'\)\.addEventListener\('click',\(\)=>void createBlankProject\(\)\)/);
  assert.match(js,/command\('project_quick_create',\{creationNonce:crypto\.randomUUID\(\)\}\)/);
  assert.match(js,/await refreshProjects\(\);await refreshOrchestrators\(\);\s*await showCoordinator\(\)/);
  assert.match(js,/command\('project_auto_title',\{projectId:p\}\)/);
  assert.match(js,/\$\('renameProjectButton'\)\.addEventListener/);
});
