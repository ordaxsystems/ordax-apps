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
  assert.deepEqual(runtime.input({ ...selected, kind: 'blenderStart' }).arguments, { wait_seconds: 10, timeout_seconds: 30, adopt_blank: false });
  assert.deepEqual(runtime.input({ ...selected, kind: 'blenderTransform', objectName: 'Cube', transform: 'location', vector: [1,2,3] }).arguments, { object_name: 'Cube', location: [1,2,3], timeout_seconds: 30 });
  assert.deepEqual(runtime.input({ ...selected, kind: 'blenderTransform', objectId: 'ordax_object_42', transform: 'scale', vector: [1,1,1] }).arguments, { ordax_object_id: 'ordax_object_42', scale: [1,1,1], timeout_seconds: 30 });
  assert.throws(() => runtime.input({ ...selected, kind: 'blenderTransform', objectName: 'Cube', transform: 'scale', vector: [1,0,1] }), /Vetor Blender/);
  assert.deepEqual(runtime.input({ ...selected, kind: 'blenderBevel', objectName: 'Cube', modifierName: 'Soft Edges', width: 0.125, segments: 3 }).arguments, { object_name: 'Cube', name: 'Soft Edges', type: 'BEVEL', width: 0.125, segments: 3, timeout_seconds: 30 });
  assert.deepEqual(runtime.input({ ...selected, kind: 'blenderBevel', objectId: 'ordax_object_42', modifierName: 'Default Bevel' }).arguments, { ordax_object_id: 'ordax_object_42', name: 'Default Bevel', type: 'BEVEL', width: 0.05, segments: 2, timeout_seconds: 30 });
  assert.throws(() => runtime.input({ ...selected, kind: 'blenderBevel', objectName: 'Cube', modifierName: '', width: 0.1, segments: 2 }), /modifier Blender/);
  assert.throws(() => runtime.input({ ...selected, kind: 'blenderBevel', objectName: 'Cube', modifierName: 'Bad', width: 101, segments: 2 }), /Largura do bevel/);
  assert.throws(() => runtime.input({ ...selected, kind: 'blenderBevel', objectName: 'Cube', modifierName: 'Bad', width: 0.1, segments: 7 }), /Segmentos do bevel/);
  assert.throws(() => runtime.input({ ...selected, kind: 'blenderBevel', objectName: 'Cube', modifierName: 'Bad', width: 0.1, segments: 2, type: 'ARRAY' }), /Campo/);
  assert.deepEqual(runtime.input({ ...selected, kind: 'blenderCreate', name: 'Box', primitive: 'cube', location: [1,2,3], size: 2, depth: 99, segments: 64 }).arguments, { name: 'Box', primitive: 'cube', location: [1,2,3], timeout_seconds: 30, size: 2 });
  assert.deepEqual(runtime.input({ ...selected, kind: 'blenderCreate', name: 'Pipe', primitive: 'cylinder', location: [0,0,0], size: 1.5, depth: 4, segments: 24 }).arguments, { name: 'Pipe', primitive: 'cylinder', location: [0,0,0], timeout_seconds: 30, radius: 1.5, segments: 24, depth: 4 });
  assert.deepEqual(runtime.input({ ...selected, kind: 'blenderMaterial', objectName: 'Cube', materialName: 'Red', baseColor: '#ff0000', roughness: 0.3, metallic: 0.2 }).arguments, { object_name: 'Cube', material_name: 'Red', base_color: [1,0,0,1], roughness: 0.3, metallic: 0.2, transmission: 0, alpha: 1, ior: 1.45, surface_render_method: 'DITHERED', transparency_overlap: true, timeout_seconds: 30 });
  assert.throws(() => runtime.input({ ...selected, kind: 'blenderMaterial', objectName: 'Cube', materialName: 'Bad', baseColor: '#ffffff', roughness: 2, metallic: 0 }), /Roughness/);
  assert.deepEqual(runtime.input({ ...selected, kind: 'blenderSave', targetPath: 'scenes/demo.blend' }).arguments, { target_path: 'scenes/demo.blend', timeout_seconds: 120 });
  assert.deepEqual(runtime.input({ ...selected, kind: 'blenderSave', targetPath: '' }).arguments, { timeout_seconds: 120 });
  assert.throws(() => runtime.input({ ...selected, kind: 'blenderSave', targetPath: '../outside.blend' }), /relativo ao projeto/);
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
