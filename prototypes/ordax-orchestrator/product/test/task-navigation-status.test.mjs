import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { taskNavigationStatus, safeTaskNavigationReason, taskListStatusLabel } from '../src/task-navigation-status.mjs';

test('task navigation distinguishes a saved draft from completed work', () => {
  assert.equal(taskListStatusLabel({ status:'ready', has_draft:1, conversation_count:0 }), 'Rascunho salvo');
  assert.equal(taskListStatusLabel({ status:'ready', has_draft:0, conversation_count:0 }), 'Nova conversa');
  assert.equal(taskListStatusLabel({ status:'ready', has_draft:0, conversation_count:2 }), 'Em espera');
});

test('task navigation keeps active and terminal states explicit', () => {
  assert.equal(taskListStatusLabel({ status:'running' }), 'Em andamento');
  assert.equal(taskListStatusLabel({ status:'interrupted' }), 'Interrompida');
  assert.equal(taskListStatusLabel({ status:'succeeded' }), 'Concluída');
  assert.equal(taskListStatusLabel({ status:'unknown' }), 'Estado indisponível');
  assert.equal(taskListStatusLabel(null), 'Estado indisponível');
});

test('W3 navigation timeout is visible without certifying historical response', () => {
  const result = taskNavigationStatus({
    provider_navigation:'failed',
    provider_navigation_error:'provider_navigation_timeout'
  });
  assert.equal(result.kind,'unavailable');
  assert.equal(result.state,'error');
  assert.equal(result.reason,'provider_navigation_timeout');
  assert.equal(result.threadRendered,'false');
  assert.match(result.message,/conversa vinculada não pôde ser aberta/);
  assert.doesNotMatch(result.message,/resposta.*observada/i);
});

test('W3 draft protection remains a navigation block, not a confirmed open', () => {
  const result=taskNavigationStatus({
    provider_navigation:'not_navigated',
    provider_navigation_reason:'visible_draft_present'
  });
  assert.equal(result.reason,'visible_draft_present');
  assert.equal(result.threadRendered,'false');
  assert.match(result.message,/não foi aberta/);
});

test('W3 provider errors do not print arbitrary URLs or session details in the App', () => {
  const result=taskNavigationStatus({
    provider_navigation:'failed',
    provider_navigation_error:'https://chatgpt.com/c/private?token=example'
  });
  assert.equal(result.reason,'provider_navigation_unavailable');
  assert.doesNotMatch(result.message,/token|private|https:/i);
});

test('W3 local task load and successful navigation do not assert remote answer', () => {
  assert.equal(taskNavigationStatus({title:'Local'}),null);
  assert.equal(taskNavigationStatus({provider_navigation:'navigated'}),null);
  assert.equal(taskNavigationStatus(null),null);
});

test('W3 App binds the task navigation result into its existing read-only status', () => {
  const ui=readFileSync(new URL('../desktop/ui.js',import.meta.url),'utf8');
  const main=readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
  assert.match(ui,/import \{[^}]*\btaskNavigationStatus\b[^}]*\} from '\.\.\/src\/task-navigation-status\.mjs'/);
  assert.match(ui,/const navigationStatus = taskNavigationStatus\(task\);/);
  assert.match(ui,/status\.dataset\.threadRendered = navigationStatus\.threadRendered/);
  assert.match(ui,/status\.textContent = navigationStatus\.message/);
  assert.match(ui,/if \(nextVisible && currentTaskId\) await openTask\(currentTaskId\)/);
  assert.match(main,/provider_navigation:'failed'/);
  assert.match(main,/provider_navigation:'not_navigated'/);
});
test('W3 IPC never accepts arbitrary provider text even when it resembles a code', () => {
  for (const raw of [
    'secret_token_abcdef', 'access_key_hidden', 'user_email',
    'https://chatgpt.com/c/private', 'provider_navigation_timeout: bearer xyz',
    '', null, undefined, {message:'provider_navigation_timeout'}
  ]) {
    assert.equal(safeTaskNavigationReason(raw),'provider_navigation_unavailable');
    const status=taskNavigationStatus({provider_navigation:'failed',provider_navigation_reason:raw});
    assert.equal(status.reason,'provider_navigation_unavailable');
    assert.equal(status.threadRendered,'false');
    assert.doesNotMatch(status.message,/secret_token|access_key|bearer|private|user_email/i);
  }
});

test('W3 main sanitizes before sending any navigation diagnostic over IPC', () => {
  const main=readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
  const start=main.indexOf("registerUiHandler('ordax:tasks:open'");
  const end=main.indexOf("registerUiHandler('ordax:tasks:inspect-linked-thread'",start);
  assert.ok(start>=0 && end>start);
  const handler=main.slice(start,end);
  assert.match(handler,/safeTaskNavigationReason\(navigation\.reason\)/);
  assert.match(handler,/safeTaskNavigationReason\(error\?\.message\)/);
  assert.doesNotMatch(handler,/provider_navigation_error/);
  assert.doesNotMatch(handler,/String\(error\?\.message/);
  assert.equal(safeTaskNavigationReason('provider_navigation_timeout'),'provider_navigation_timeout');
  assert.equal(safeTaskNavigationReason('visible_draft_present'),'visible_draft_present');
});
