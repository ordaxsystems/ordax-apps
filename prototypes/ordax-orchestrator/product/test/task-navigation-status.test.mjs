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

test('local task memory is available while provider navigation remains pending', () => {
  const result=taskNavigationStatus({provider_navigation:'pending'});
  assert.equal(result.kind,'navigating');
  assert.equal(result.state,'pending');
  assert.equal(result.threadRendered,'false');
  assert.match(result.message,/Histórico e memória locais abertos/);
  assert.match(result.message,/nenhuma mensagem foi enviada/);
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
  assert.match(ui,/function renderTaskNavigationStatus\(task\)/);
  assert.match(ui,/status\.dataset\.threadRendered=navigationStatus\.threadRendered/);
  assert.match(ui,/status\.textContent=navigationStatus\.message/);
  assert.match(ui,/const task = await window\.ordax\.openTask\(id\);/);
  assert.match(ui,/window\.ordax\.onTaskProviderNavigation\(payload=>/);
  assert.match(main,/onOpenTask:createProviderAwareTaskOpener\(/);
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

test('Electron main delegates task navigation to the shared safe provider-aware opener', () => {
  const main=readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
  const shared=readFileSync(new URL('../src/task-ui-handlers.mjs',import.meta.url),'utf8');
  assert.match(main,/createProviderAwareTaskOpener/);
  assert.match(main,/safeTaskNavigationReason\s*,\s*onNavigationResult:result=>emitRendererEvent\('ordax:task:provider-navigation',result\)\s*\}\)/);
  assert.doesNotMatch(shared,/provider_navigation_error|String\(error\?\.message/);
  assert.equal(safeTaskNavigationReason('provider_navigation_timeout'),'provider_navigation_timeout');
  assert.equal(safeTaskNavigationReason('visible_draft_present'),'visible_draft_present');
});


test('recorded GPT reply and failed follow-up navigation cannot be shown as unsent',()=>{
  const result=taskNavigationStatus({
    provider_navigation:'post_commit_failed',
    provider_navigation_reason:'visible_draft_present'
  });
  assert.equal(result.kind,'unavailable');
  assert.equal(result.reason,'visible_draft_present');
  assert.match(result.message,/resposta do GPT já foi registrada/);
  assert.match(result.message,/Nenhuma mensagem foi reenviada/);
  assert.doesNotMatch(result.message,/nenhuma mensagem foi enviada/i);
  const unsafe=taskNavigationStatus({
    provider_navigation:'post_commit_failed',
    provider_navigation_reason:'https://chatgpt.com/c/private?token=secret'
  });
  assert.equal(unsafe.reason,'provider_navigation_unavailable');
  assert.doesNotMatch(unsafe.message,/private|token=secret/i);
});
