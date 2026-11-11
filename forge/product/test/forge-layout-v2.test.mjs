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
  assert.match(html,/id="coordinatorPrompt"[^>]*placeholder="Descreva o que você quer criar ou mudar…"/);
  assert.match(css,/body\.orchestrator-focus \.app-shell\s*\{\s*grid-template-columns:250px minmax\(385px,1fr\) minmax\(360px,420px\)/);
  assert.match(css,/right-pane-tabs\{[^}]*display:grid!important;grid-template-columns:repeat\(4/);
  assert.doesNotMatch(css,/body\.orchestrator-focus #contextRail>:not\(#contextPanel\)[^{]*\{display:none!important\}/);
  assert.match(read('orchestrator-ui.mjs'),/\$\('coordinatorRouteLabel'\)\.textContent='FORJADOR'/);
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

test('project creation stays canonical and Files displays only verified owner-bound contents',()=>{
  const html=read('ui.html'),ui=read('ui.js'),orchestration=read('orchestrator-ui.mjs');
  assert.match(html,/<details id="forgeProjectAdvanced"/);
  assert.match(html,/id="quickNewProject"/);
  assert.match(orchestration,/\$\('forgeProjectAdvanced'\)\.open=true/);
  assert.match(html,/id="projectNavList"/);
  for(const id of ['forgeFilesRefresh','forgeFilesState','forgeFilesBrowser',
    'forgeFilesEntries','forgeFilesUp','forgeFilesReaderContent'])assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(ui,/window\.ordax\.forgeWorkspaceStatus\(projectId\)/);
  assert.match(ui,/orchestratorInvoke\('project_files_list',\{projectId,directory\}\)/);
  assert.match(ui,/orchestratorInvoke\('project_file_read'/);
  assert.match(ui,/content\?\.verified!=='local_readback'/);
  assert.match(ui,/\$\('#forgeFilesReaderContent'\)\.textContent=content\.content/);
  assert.doesNotMatch(ui,/orchestratorInvoke\('workspace_status',\{projectId\}\)/);
  assert.equal((html.match(/id="newProjectForm"/g)||[]).length,1);
  assert.equal((html.match(/id="coordinatorComposer"/g)||[]).length,1);
});
