import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../desktop');
const read=file=>fs.readFileSync(path.join(desktop,file),'utf8');

test('all project activities share one Forge three-column workbench',()=>{
  const html=read('ui.html'),js=read('ui.js'),css=read('ui.css');
  assert.equal((html.match(/class="app-shell"/g)||[]).length,1);
  assert.equal((html.match(/id="taskPanel"/g)||[]).length,1);
  assert.equal((html.match(/id="orchestrationPanel"/g)||[]).length,1);
  assert.equal((html.match(/id="providerViewport"/g)||[]).length,1);
  for(const p of ['execution','preview','files','provider'])
    assert.equal((html.match(new RegExp('id="'+p+'PaneTab"','g'))||[]).length,1);
  assert.match(js,/document\.body\.classList\.add\('orchestrator-focus','forge-task-focus'\)/);
  assert.match(js,/onShowCoordinator:async\(\)=>\{\s*document\.body\.classList\.add\('orchestrator-focus'\);\s*document\.body\.classList\.remove\('forge-task-focus'\)/);
  assert.doesNotMatch(js,/orchestrationUi\?\.hide\(\);\s*document\.body\.classList\.remove\('orchestrator-focus'/);
  assert.match(css,/body\.orchestrator-focus\.forge-task-focus \.app-shell/);
  assert.match(css,/body\.orchestrator-focus\.forge-task-focus #taskPanel/);
  assert.match(css,/body\.orchestrator-focus\.forge-task-focus #composer/);
});

test('historical activity has a real back-to-Forjador control without a second chat or send route',()=>{
  const html=read('ui.html'),js=read('ui.js');
  assert.equal((html.match(/id="taskBackToForjador"/g)||[]).length,1);
  assert.match(js,/\$\('#taskBackToForjador'\)\.addEventListener\('click'/);
  assert.match(js,/void orchestrationUi\.showCoordinator\(\)\.catch/);
  assert.match(html,/id="taskPanel"/);
  assert.equal((html.match(/id="prompt"/g)||[]).length,1);
  assert.equal((html.match(/id="coordinatorPrompt"/g)||[]).length,1);
  assert.match(js,/await selectRightPane\('provider'\)/);
});

test('project navigation remains GPT-first, not a legacy Groq-fronted layout',()=>{
  const html=read('ui.html');
  assert.match(html,/id="coordinatorNavProvider">Conversa principal · GPT/);
  assert.match(html,/id="taskBackToForjador"/);
  assert.match(html,/id="rightPaneTabs"/);
});
