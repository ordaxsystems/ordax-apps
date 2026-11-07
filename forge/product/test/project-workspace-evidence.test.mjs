import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {describeWorkspaceConnection,describeWorkspaceSnapshot}
  from '../desktop/orchestrator-ui.mjs';

test('absent Runtime port cannot borrow ChatGPT computer grant',()=>{
  const description=describeWorkspaceConnection({available:false,state:'capability_unavailable',bindings:[]});
  assert.match(description,/não conectado ao Forge/);
  assert.match(description,/MCP do ChatGPT não concede permissão/);
  assert.doesNotMatch(description,/autenticado pelo Runtime/);
});

test('saved binding is not a current Runtime grant or verified snapshot',()=>{
  const output=describeWorkspaceConnection({available:true,state:'bound',
    bindings:[{bindingId:'binding_123456789'}]});
  assert.match(output,/ainda sem grant atual confirmado/);
  assert.doesNotMatch(output,/Snapshot autenticado/);
});

test('only a verified bounded Runtime snapshot is displayed as evidence',()=>{
  const snap={verified:true,state:'connected',fileCount:8,changedCount:2,
    observedAt:'2026-11-05T14:00:00.000Z',revision:'rev_1',
    git:{isRepository:true,branch:'main',head:'a'.repeat(40)},
    path:'C:\\Users\\secret',content:'SHOULD_NOT_DISPLAY'};
  const result=describeWorkspaceSnapshot(snap);
  assert.match(result,/Snapshot autenticado pelo Runtime/);
  assert.match(result,/8 arquivo\(s\), 2 alteração\(ões\)/);
  assert.match(result,/Git main @ a{12}/);
  assert.doesNotMatch(result,/secret|SHOULD_NOT_DISPLAY|rev_1/);
  assert.match(describeWorkspaceSnapshot({...snap,verified:false}),/Nenhum workspace verificado/);
  assert.match(describeWorkspaceSnapshot({...snap,fileCount:-1}),/Resposta incompleta/);
  assert.match(describeWorkspaceSnapshot({verified:false,state:'revoked'}),/grant revogado/);
});

test('UI requests only scoped read-only Runtime status and one snapshot on explicit click',()=>{
  const root=path.resolve(import.meta.dirname,'..');
  const ui=fs.readFileSync(path.join(root,'desktop','orchestrator-ui.mjs'),'utf8');
  const html=fs.readFileSync(path.join(root,'desktop','ui.html'),'utf8');
  assert.match(html,/id="inspectWorkspace"[^>]*disabled/);
  assert.match(ui,/\$\('inspectWorkspace'\)\.addEventListener\('click'/);
  assert.match(ui,/call\('workspace_status',\{projectId:p\}\)/);
  assert.match(ui,/call\('workspace_snapshot',\{/);
  assert.match(ui,/generation!==workspaceInspectionGeneration\|\|p!==projectId/);
  assert.match(ui,/workspacePortAvailable=engineStatus\.workspacePortAvailable===true/);
  assert.doesNotMatch(ui,/call\('workspace_bind'/);
});
