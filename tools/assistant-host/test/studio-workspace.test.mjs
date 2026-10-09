import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductRuntime } from '../native/product-runtime.mjs';
import { workspaceText, workspaceResultBelongs } from '../../../apps/studio/conversation/src/workspace-results.mjs';

test('Studio tools cannot inject arbitrary actions, scope, or terminal arguments into read capabilities', () => {
  const runtime = new ProductRuntime({ storage: {}, env: {} }); runtime.targets = [{ deviceId: 'device-a' }];
  const selected = { deviceId: 'device-a', project: 'project-a' };
  assert.equal(runtime.input({ ...selected, kind: 'gitStatus' }).action, 'git.status');
  assert.equal(runtime.input({ ...selected, kind: 'preview' }).action, 'project.preview_status');
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
  assert.equal(workspaceText('continuity', { data: { project: 'demo', state: { summary: 'Concluído', next_action: 'Testar' } } }), 'Concluído\n\nPróximo passo: Testar');
  assert.equal(workspaceText('gitDiff', { data: { diff: '' } }), 'Sem alterações no diff.');
  assert.equal(workspaceText('gitDiff', { data: { diff: 'x'.repeat(160000) } }).length, 150000);
  assert.equal(workspaceResultBelongs({ deviceId: 'a', project: 'one' }, { deviceId: 'b', project: 'one' }), false);
  assert.equal(workspaceResultBelongs({ deviceId: 'a', project: 'one' }, { deviceId: 'a', project: 'two' }), false);
});
