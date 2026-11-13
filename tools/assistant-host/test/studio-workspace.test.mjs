import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductRuntime } from '../native/product-runtime.mjs';
import { workspaceText, workspaceResultBelongs } from '../../../apps/studio/conversation/src/workspace-results.mjs';

test('Studio tools cannot inject arbitrary actions, scope, or terminal arguments into read capabilities', () => {
  const runtime = new ProductRuntime({ storage: {}, env: {} }); runtime.targets = [{ deviceId: 'device-a' }]; runtime.catalogAvailable = true;
  const selected = { deviceId: 'device-a', project: 'project-a' };
  assert.equal(runtime.input({ ...selected, kind: 'gitStatus' }).action, 'git.status');
  assert.equal(runtime.input({ ...selected, kind: 'preview' }).action, 'project.preview_status');
  assert.equal(runtime.input({ ...selected, kind: 'blenderStatus' }).action, 'blender.live_status');
  assert.equal(runtime.input({ ...selected, kind: 'blenderSchema' }).action, 'blender.live_modeling_schema');
  assert.deepEqual(runtime.input({ ...selected, kind: 'blenderScene' }).arguments, { max_objects: 120, timeout_seconds: 15 });
  assert.deepEqual(runtime.input({ ...selected, kind: 'blenderInspect', objectName: 'Cube' }).arguments, { object_name: 'Cube', timeout_seconds: 15 });
  assert.deepEqual(runtime.input({ ...selected, kind: 'blenderInspect', objectId: 'ordax_object_42' }).arguments, { ordax_object_id: 'ordax_object_42', timeout_seconds: 15 });
  assert.throws(() => runtime.input({ ...selected, kind: 'blenderInspect', objectName: '' }), /exatamente um nome/);
  assert.throws(() => runtime.input({ ...selected, kind: 'blenderInspect', objectName: 'Cube', objectId: 'id' }), /exatamente um nome/);
  assert.throws(() => runtime.input({ ...selected, kind: 'gitStatus', argv: ['push'] }), /Campo/);
  assert.throws(() => runtime.input({ ...selected, kind: 'gitDiff', action: 'terminal.exec' }), /Campo/);
  assert.throws(() => runtime.input({ ...selected, kind: 'search', query: '' }), /busca/);
  assert.throws(() => runtime.input({ ...selected, kind: 'search', query: 'x'.repeat(1001) }), /busca/);
  assert.equal(runtime.input({ ...selected, kind: 'search', query: 'x'.repeat(200) }).arguments.query.length, 200);
  assert.throws(() => runtime.input({ ...selected, kind: 'search', query: 'x'.repeat(201) }), /busca/);
  assert.equal(runtime.input({ ...selected, kind: 'briefing', query: 'x'.repeat(500) }).arguments.query.length, 500);
  assert.throws(() => runtime.input({ ...selected, kind: 'briefing', query: 'x'.repeat(501) }), /busca/);
  assert.throws(() => runtime.input({ ...selected, kind: 'continuitySave', summary: 'ok', nextAction: '', grant: 'forged' }), /Campo/);
  const details = { completed: ['foundation'], blockers: ['review'], changedPaths: ['src/main.py'] };
  assert.deepEqual(runtime.input({ ...selected, ...details, kind: 'continuitySave', summary: 'Progresso', nextAction: 'Testar' }).arguments, { summary: 'Progresso', next_action: 'Testar', completed: details.completed, blockers: details.blockers, changed_paths: details.changedPaths });
  assert.throws(() => runtime.input({ ...selected, kind: 'continuitySave', summary: 'Progresso', nextAction: '' }), /preservar/);
  assert.throws(() => runtime.input({ ...selected, kind: 'continuitySave', summary: ' ', nextAction: '' }), /resumo/);
});

test('workspace presentation bounds data and rejects results from another device or project', () => {
  assert.equal(workspaceText('gitDiff', { data: { diff: '+updated\n' } }), '+updated\n');
  assert.equal(workspaceText('gitDiff', { data: { stdout: '+runtime-output\n' } }), '+runtime-output\n');
  assert.equal(workspaceText('continuity', { data: { project: 'demo', state: { summary: 'Concluído', next_action: 'Testar', completed: ['Base pronta'], blockers: ['Revisar'], changed_paths: ['src/main.mjs'] } } }), 'Concluído\n\nPróximo passo: Testar\n\nConcluído: Base pronta\n\nPendência: Revisar\n\nArquivo alterado: src/main.mjs');
  const briefing = workspaceText('briefing', { data: {
    project: { slug: 'demo' }, repository: { branch: 'main' },
    health: { git: { dirty: true, changed_entries: 2 }, adapters: { blender: { enabled: true, state: 'ready' }, unity: { enabled: false, state: 'disabled' } } },
    preview: { mode: 'web', runtime: { state: 'running' } },
    continuity: { project_state: { summary: 'Feature pronta', next_action: 'Publicar', completed: ['UI'], blockers: ['Revisão'], changed_paths: ['src/main.mjs'] }, open_tasks: [{ title: 'Validar release' }], latest_checkpoint: { summary: 'Checkpoint 7' }, memories: [{ snippet: 'Decisão arquitetural preservada' }] },
    workspace: { context_files: ['README.md'], documents: [{ path: 'docs/PLAN.md' }], scripts: [{ path: 'scripts/check.mjs' }], models: [] }, attention: ['Git has 2 tracked changed entries'],
  } });
  for (const expected of ['Projeto: demo','Onde paramos: Feature pronta','Próximo passo: Publicar','Concluído: UI','Pendência: Revisão','Arquivo alterado: src/main.mjs','Git: branch main','Git: 2 alteração(ões) pendente(s)','Preview: web · running','Adapter: blender · ready','Tarefa aberta: Validar release','Checkpoint: Checkpoint 7','Memória do projeto: Decisão arquitetural preservada','Atenção: Git has 2 tracked changed entries','Arquivo de contexto: README.md','Documento: docs/PLAN.md','Script: scripts/check.mjs']) assert.ok(briefing.includes(expected), `briefing missing: ${expected}`);
  assert.equal(briefing.includes('Adapter: unity'), false);
  assert.equal(workspaceText('gitDiff', { data: { diff: '' } }), 'Sem alterações no diff.');
  assert.equal(workspaceText('gitDiff', { data: { diff: 'x'.repeat(160000) } }).length, 150000);
  assert.equal(workspaceResultBelongs({ deviceId: 'a', project: 'one' }, { deviceId: 'b', project: 'one' }), false);
  assert.equal(workspaceResultBelongs({ deviceId: 'a', project: 'one' }, { deviceId: 'a', project: 'two' }), false);
});
