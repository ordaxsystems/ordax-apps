import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(file)=>fs.readFileSync(path.join(root,'desktop',file),'utf8');

test('Forge V2 has three columns and four honest workspace tabs',()=>{
  const html=read('ui.html'),css=read('ui.css');
  assert.match(html,/<aside class="left-rail">/);
  assert.match(html,/<section class="chat-column">/);
  assert.match(html,/<aside id="contextRail" class="context-rail">/);
  const tabs=['execution','preview','files','provider'];
  for(const name of tabs){
    assert.match(html,new RegExp('id="'+name+'PaneTab"[^>]*role="tab"'));
    assert.match(html,new RegExp('id="'+name+'PaneTab"[^>]*data-pane="'+name+'"'));
  }
  assert.match(html,/id="contextPaneTab"[^>]*hidden/);
  assert.match(html,/id="executionOverview"[^>]*role="tabpanel"/);
  assert.match(html,/id="filesPanel"[^>]*role="tabpanel"/);
  assert.match(html,/id="coordinatorComposer"/);
  assert.match(html,/id="coordinatorPrompt"[^>]*placeholder="O que você quer criar\?"/);
  assert.match(css,/body\.orchestrator-focus \.app-shell\s*\{\s*grid-template-columns:250px minmax\(385px,1fr\) minmax\(360px,420px\)/);
  assert.match(css,/right-pane-tabs\{[^}]*display:grid!important;grid-template-columns:repeat\(4/);
  assert.doesNotMatch(css,/body\.orchestrator-focus #contextRail>:not\(#contextPanel\):not\(#executionOverview\)\{display:none!important\}/);
});

test('existing canonical preview moves to Preview and the GPT browser stays isolated',()=>{
  const html=read('ui.html'),js=read('ui.js');
  assert.match(js,/\$\('#previewPanel'\)\.prepend\(\$\('#workSurfacePreview'\)\)/);
  assert.match(js,/let activeRightPane='execution'/);
  assert.match(js,/await selectRightPane\('execution'\)/);
  assert.match(js,/const rail=\$\('#previewPanel'\)/);
  assert.match(js,/activeRightPane==='preview'/);
  for(const id of ['workSurfacePreview','workSurfaceFrame','workSurfaceVersion','providerViewport']){
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
  }
  assert.match(html,/id="workSurfaceFrame"[^>]*sandbox=""/);
  assert.match(js,/window\.ordax\.setChatVisible\(visible\)/);
});

test('project creation stays canonical and Files never fabricates an explorer',()=>{
  const html=read('ui.html'),ui=read('ui.js'),orchestration=read('orchestrator-ui.mjs');
  assert.match(html,/<details id="forgeProjectAdvanced"/);
  assert.match(html,/id="quickNewProject"/);
  assert.match(orchestration,/\$\('forgeProjectAdvanced'\)\.open=true/);
  assert.match(html,/id="projectNavList"/);
  assert.match(html,/id="forgeFilesRefresh"/);
  assert.match(html,/id="forgeFilesState"/);
  assert.match(ui,/orchestratorInvoke\('workspace_status',\{projectId\}\)/);
  assert.match(ui,/Nenhum arquivo foi lido ou alterado/);
  assert.equal((html.match(/id="newProjectForm"/g)||[]).length,1);
  assert.equal((html.match(/id="coordinatorComposer"/g)||[]).length,1);
});
