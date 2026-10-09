import test from 'node:test';
import assert from 'node:assert/strict';
import { beginActivity, observedActivity, transitionActivity } from '../native/activity.mjs';
import { elapsedLabel } from '../../../apps/studio/conversation/src/activity-view.mjs';

test('thinking and tool phases require an observed status; generic generation never invents thinking', () => {
  assert.equal(observedActivity({ busy: true }, null).kind, 'working');
  assert.equal(observedActivity({ busy: true }, { text: 'Resposta' }).kind, 'responding');
  assert.deepEqual(observedActivity({ busy: true, signals: [{ label: 'Thinking…' }] }, null), { kind: 'thinking', label: 'Thinking…', source: 'web' });
  assert.equal(observedActivity({ busy: true, signals: [{ label: 'Pesquisando na Web' }] }, null).kind, 'searching');
  assert.equal(observedActivity({ busy: true, signals: [{ label: 'Executando análise' }] }, null).kind, 'tool');
  assert.equal(observedActivity({ busy: false, signals: [{ label: 'Thinking…' }] }, { status: 'completed' }).kind, 'completed');
});
test('activity deduplicates repeated observations, bounds history and preserves terminal states', () => {
  const activity = beginActivity('turn', 1000);
  const step = { kind: 'thinking', label: 'Pensando', source: 'web' };
  assert.equal(transitionActivity(activity, step, 1000), true);
  assert.equal(transitionActivity(activity, step, 2000), false);
  for (let i = 0; i < 100; i++) transitionActivity(activity, { ...step, label: 'Etapa ' + i }, 3000 + i);
  transitionActivity(activity, { kind: 'completed', label: 'Concluído', source: 'response' }, 5000);
  assert.equal(activity.events.length, 40); assert.equal(activity.endedAt, 5000);
  assert.equal(transitionActivity(activity, step, 6000), false); assert.equal(activity.current.kind, 'completed');
});
test('elapsed time handles short, long and clock-skewed observations', () => {
  assert.equal(elapsedLabel(1000, 1000), '0s'); assert.equal(elapsedLabel(1000, 64500), '1min 03s'); assert.equal(elapsedLabel(2000, 1000), '0s');
});
