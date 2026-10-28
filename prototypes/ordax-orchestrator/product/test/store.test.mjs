import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { planProviderConversation, SUCCESSFUL_TURNS_PER_SEGMENT, MAX_OBSERVED_TRANSCRIPT_BYTES_PER_SEGMENT } from '../src/conversation-policy.mjs';
import { recordProviderSubmissionProvenance, providerPromptDigest } from '../src/provider-submission-provenance.mjs';

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordax-gratis-'));
  return { dir, dbPath: path.join(dir, 'state.sqlite') };
}

function cleanup(t, dir, getStore) {
  t.after(() => {
    getStore()?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

test('standalone message append commits its ledger and memory effects atomically',t=>{
  const {dir,dbPath}=tempStore();
  const store=new Store(dbPath);
  cleanup(t,dir,()=>store);
  const task=store.createTask('Atomic message append');
  const original=store.memoryCandidates.suggestFromMessage;
  store.memoryCandidates.suggestFromMessage=()=>{throw new Error('injected_memory_candidate_failure');};
  assert.throws(()=>store.appendMessage(task.id,'user','Fato Projeto: teste transacional.'),
    /injected_memory_candidate_failure/);
  store.memoryCandidates.suggestFromMessage=original;
  assert.equal(store.db.isTransaction,false);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM messages WHERE task_id=?').get(task.id).n,0);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM events WHERE task_id=? AND kind='message.appended'").get(task.id).n,0);
  assert.equal(store.memoryCandidates.list(task.id).length,0);

  store.db.exec('BEGIN IMMEDIATE');
  store.appendMessage(task.id,'user','Esta escrita pertence à transação externa.');
  assert.equal(store.db.isTransaction,true);
  store.db.exec('ROLLBACK');
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM messages WHERE task_id=?').get(task.id).n,0);
});

test('Task, workspace session and versioned checkpoint survive reopen', t => {
  const { dir, dbPath } = tempStore();
  let store = new Store(dbPath);
  cleanup(t, dir, () => store);
  const sessionId = store.getWorkspaceSession().id;
  const task = store.createTask('Persistência real');
  store.appendMessage(task.id, 'user', 'ping');
  store.appendMessage(task.id, 'assistant', 'pong');
  store.setChatUrl(task.id, 'https://chatgpt.com/c/example');
  store.checkpoint(task.id, 'safe point', { proof: 'ok' });

  store.close();
  store = new Store(dbPath);
  const restored = store.getTask(task.id);
  assert.equal(store.getWorkspaceSession().id, sessionId);
  assert.equal(restored.workspace_session_id, sessionId);
  assert.equal(restored.chat_url, 'https://chatgpt.com/c/example');
  assert.equal(restored.checkpoint_record.version, 1);
  assert.equal(restored.checkpoint_record.payload.proof, 'ok');
  assert.deepEqual(restored.messages.map(m => [m.role, m.content]), [['user', 'ping'], ['assistant', 'pong']]);
});

test('last GPT Run delivery state remains inspectable after failure and app restart',t=>{
  const {dir,dbPath}=tempStore();
  let store=new Store(dbPath);
  cleanup(t,dir,()=>store);
  const task=store.createTask('GPT retry state');
  const runId=store.startRun(task.id);
  store.recordRunMetrics(task.id,runId,'auto',{
    submitAttemptAt:100,submittedAt:120,completedAt:140,
    providerDeliveryState:'submitted',failedStage:'await-response',
    responsePromptExpansionAttempted:true,responsePromptExpanded:true
  });
  store.finishRun(task.id,runId,'await-response:chatgpt_response_retry_required');
  store.close();
  store=new Store(dbPath);
  const restored=store.getTask(task.id);
  assert.equal(restored.status,'error');
  assert.deepEqual(restored.latest_run,{
    id:runId,status:'failed',error:'await-response:chatgpt_response_retry_required',
    provider_delivery_state:'submitted',context_attachment_state:null,
    context_attachment_filename:null,context_attachment_sha256:null,submit_attempt_observed:true,
    submission_confirmed:true,started_at:restored.latest_run.started_at,
    completed_at:restored.latest_run.completed_at
  });
  const metrics=JSON.parse(store.db.prepare('SELECT metrics FROM runs WHERE id=?').get(runId).metrics);
  assert.equal(metrics.response_prompt_expansion_attempted,true);
  assert.equal(metrics.response_prompt_expanded,true);
});

test('context attachment receipt summary survives Store reopen without file content',t=>{
  const {dir,dbPath}=tempStore();
  let store=new Store(dbPath);
  cleanup(t,dir,()=>store);
  const task=store.createTask('Context attachment receipt');
  const runId=store.startRun(task.id);
  store.recordRunMetrics(task.id,runId,'auto',{
    submittedAt:120,completedAt:140,providerDeliveryState:'submitted',
    contextAttachmentState:'confirmed',contextAttachmentFilename:'ordax-handoff-task_12345678-c3-0123456789ab.txt',
    contextAttachmentSha256:'a'.repeat(64),contextAttachmentByteLength:32768,contextAttachmentUploadedAt:110,
    contextAttachmentSelectionConfirmed:true,contextAttachmentObservationCount:5,
    contextAttachmentFileInputCount:0,contextAttachmentSelectedFileCount:0,
    contextAttachmentExpectedFileSelected:false,contextAttachmentFilenameTextVisible:true,
    contextAttachmentFilenameAttributeVisible:false,contextAttachmentProgressVisible:false,
    contextAttachmentErrorVisible:false,contextAttachmentVisibleStableObservations:2
  });
  store.finishRun(task.id,runId,'');
  store.close();
  store=new Store(dbPath);
  const latest=store.getTask(task.id).latest_run;
  assert.equal(latest.context_attachment_state,'confirmed');
  assert.equal(latest.context_attachment_filename,'ordax-handoff-task_12345678-c3-0123456789ab.txt');
  assert.equal(latest.context_attachment_sha256,'a'.repeat(64));
  const metrics=JSON.parse(store.db.prepare('SELECT metrics FROM runs WHERE id=?').get(runId).metrics);
  assert.equal(metrics.context_attachment_byte_length,32768);
  assert.equal(metrics.context_attachment_uploaded_at,110);
  assert.equal(metrics.context_attachment_selection_confirmed,true);
  assert.equal(metrics.context_attachment_observation_count,5);
  assert.equal(metrics.context_attachment_file_input_count,0);
  assert.equal(metrics.context_attachment_filename_text_visible,true);
  assert.equal(metrics.context_attachment_visible_stable_observations,2);
  assert.doesNotMatch(JSON.stringify(metrics),/file contents|secret/i);
});

test('per-Task drafts persist across restart, reject stale saves and never enter provider context', t => {
  const { dir, dbPath } = tempStore();
  let store = new Store(dbPath);
  cleanup(t, dir, () => store);
  const first = store.createTask('Projeto A');
  const second = store.createTask('Projeto B');
  const originalOrder = store.listTasks().map(task => task.id);
  assert.equal(store.listTasks().find(task => task.id === first.id).has_draft, 0);
  const originalTimestamp = store.getTask(first.id).updated_at;

  assert.equal(store.setDraft(first.id, 'Ideia ainda não enviada', 1).draft_revision, 1);
  assert.equal(store.getTaskDraft(first.id).draft,'Ideia ainda não enviada');
  assert.equal(store.getTaskDraft(first.id).draft_revision,1);
  store.setDraft(second.id, 'Outra tarefa', 1);
  store.setDraft(first.id, 'Texto novo', 3);
  store.setDraft(first.id, 'Retorno atrasado', 2);
  assert.equal(store.getTask(first.id).draft, 'Texto novo');
  assert.equal(store.getTask(first.id).draft_revision, 3);
  assert.equal(store.getTask(second.id).draft, 'Outra tarefa');
  const navigation = store.listTasks();
  assert.equal(navigation.length, 2);
  assert.ok(navigation.every(row => !('draft' in row) && !('checkpoint' in row) && !('chat_url' in row)));
  assert.ok(navigation.every(row => 'status' in row && 'title' in row && 'conversation_count' in row && 'pending_memory_count' in row));
  assert.equal(navigation.find(row => row.id === first.id).has_draft, 1);
  assert.equal(navigation.find(row => row.id === second.id).has_draft, 1);
  assert.equal(store.getTask(first.id).updated_at, originalTimestamp);
  assert.deepEqual(store.listTasks().map(task => task.id), originalOrder);
  assert.doesNotMatch(store.buildContinuationPrompt(first.id, 'Continue'), /Texto novo/);

  store.close();
  store = new Store(dbPath);
  assert.equal(store.getTask(first.id).draft, 'Texto novo');
  assert.equal(store.getTask(first.id).draft_revision, 3);
  store.appendMessage(first.id, 'user', 'Texto novo');
  store.setDraft(first.id, '', 5);
  store.setDraft(first.id, 'Salvamento antigo', 4);
  assert.equal(store.getTask(first.id).draft, '');
  assert.equal(store.listTasks().find(task => task.id === first.id).has_draft, 0);
  assert.deepEqual(store.getTask(first.id).messages.map(row => row.content), ['Texto novo']);
  assert.throws(() => store.setDraft(first.id, 'x', 0), /invalid_task_draft_revision/);
  assert.throws(() => store.setDraft(first.id, 'x'.repeat(20001), 6), /task_draft_too_large/);
  assert.throws(() => store.setDraft('task_missing', 'x', 1), /task_not_found/);
  assert.throws(() => store.getTaskDraft('task_missing'), /task_not_found/);
});

test('project rename updates navigation title without touching draft or losing history', t => {
  const { dir, dbPath } = tempStore();
  const store = new Store(dbPath);
  cleanup(t, dir, () => store);
  const task = store.createTask('Nova conversa');
  store.setDraft(task.id, 'Por enviar', 1);
  store.appendMessage(task.id, 'user', 'Objetivo original');
  const updated = store.renameTask(task.id, '  Projeto   Contínuo  ');
  assert.equal(updated.title, 'Projeto Contínuo');
  assert.equal(updated.draft, 'Por enviar');
  assert.equal(updated.messages.length, 1);
  assert.equal(store.listTasks()[0].title, 'Projeto Contínuo');
  assert.match(store.buildContinuationPrompt(task.id, 'Retomar'), /Projeto Contínuo/);
  assert.equal(store.renameTask(task.id, 'Projeto Contínuo').events.filter(row => row.kind === 'task.renamed').length, 1);
  assert.throws(() => store.renameTask(task.id, '   '), /invalid_task_title/);
  assert.throws(() => store.renameTask(task.id, 'z'.repeat(141)), /invalid_task_title/);
  assert.throws(() => store.renameTask('task_missing', 'Valid'), /task_not_found/);
});

test('bounded continuity uses the canonical message order and keeps image references without full history reads', t => {
  const { dir, dbPath } = tempStore();
  const store = new Store(dbPath);
  cleanup(t, dir, () => store);
  const task = store.createTask('Pesquisa persistente');
  const insert = store.db.prepare('INSERT INTO messages(id,task_id,role,content,created_at) VALUES(?,?,?,?,?)');
  const image = store.db.prepare('INSERT INTO message_assets(id,task_id,message_id,kind,mime_type,local_path,alt,created_at) VALUES(?,?,?,?,?,?,?,?)');
  store.db.exec('BEGIN');
  try {
    // Deliberate timestamp ties and reverse-ordered IDs prove chronology is stored explicitly.
    for (let i = 0; i < 320; i++) {
      const messageId = `msg_${String(319-i).padStart(4, '0')}`;
      insert.run(messageId, task.id, i % 2 ? 'assistant' : 'user', `Marcador ${i}`, '2026-10-17T20:00:00.000Z');
      if (i === 314 || i === 319) {
        image.run(`asset_${i}`, task.id, messageId, 'image', 'image/png', `image_${i}.png`, `Imagem ${i}`, '2026-10-17T20:00:00.000Z');
      }
    }
    store.db.exec('COMMIT');
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }

  const full = store.messages(task.id);
  assert.equal(full.length, 320);
  assert.deepEqual(store.messages(task.id, { limit:8 }), full.slice(-8));
  assert.equal(full[314].assets[0].alt, 'Imagem 314');
  assert.equal(full[319].assets[0].alt, 'Imagem 319');
  const expected = store.buildContinuationPrompt(task.id, 'Continuar pesquisa');
  assert.match(expected, /Marcador 319/);
  assert.match(expected, /ARTEFATO image: Imagem 319/);
  assert.doesNotMatch(expected, /Marcador 22(?:0|1)/);
  const originalMessages = store.messages;
  const originalGetTask = store.getTask;
  store.messages = (id, options) => {
    assert.equal(id, task.id);
    assert.equal(options?.limit, 8);
    return originalMessages.call(store, id, options);
  };
  store.getTask = () => { throw new Error('full_task_hydration_forbidden'); };
  assert.equal(store.buildContinuationPrompt(task.id, 'Continuar pesquisa'), expected);
  assert.equal(store.continuationSummary(task.id).total_messages, 320);
  assert.equal(store.continuationSummary(task.id).recent_message_count, 10);
  assert.equal(store.buildContinuationPrompt('task_missing', 'Inalterado'), 'Inalterado');
  const queryPlan = store.db.prepare('EXPLAIN QUERY PLAN SELECT id FROM messages WHERE task_id=? ORDER BY sequence DESC LIMIT 8').all(task.id);
  assert.ok(queryPlan.some(row => String(row.detail).includes('idx_messages_task_sequence')));
});

test('execution snapshot reflects the same SQLite rotation policy without hydrating a full Task', t => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const task = store.createTask('Continuidade longa');
  let snapshot = store.getTaskExecutionSnapshot(task.id);
  assert.equal(snapshot.has_messages, 0);
  assert.equal(snapshot.checkpoint_version, 0);
  assert.deepEqual(planProviderConversation(snapshot), planProviderConversation(store.getTask(task.id)));
  store.appendMessage(task.id, 'user', 'Primeira etapa');
  store.checkpoint(task.id, 'Checkpoint de versão 1');
  store.setChatUrl(task.id, 'https://chatgpt.com/c/segment-a');
  const failed = store.startRun(task.id);
  store.finishRun(task.id, failed, 'response_not_observed');
  for (let i = 0; i < SUCCESSFUL_TURNS_PER_SEGMENT; i++) {
    const run = store.startRun(task.id);
    store.finishRun(task.id, run);
  }
  const fullPlan = planProviderConversation(store.getTask(task.id));
  assert.equal(fullPlan.automaticRotation, true);
  const original = store.getTask;
  store.getTask = () => { throw new Error('full_task_hydration_forbidden'); };
  snapshot = store.getTaskExecutionSnapshot(task.id);
  assert.equal(snapshot.has_messages, 1);
  assert.equal(snapshot.checkpoint_version, 1);
  assert.deepEqual(planProviderConversation(snapshot), fullPlan);
  assert.equal(store.getTaskExecutionSnapshot('task_missing'), null);
  store.getTask = original;
  store.rotateConversation(task.id);
  snapshot = store.getTaskExecutionSnapshot(task.id);
  assert.equal(snapshot.chat_url, null);
  assert.deepEqual(planProviderConversation(snapshot), planProviderConversation(store.getTask(task.id)));
});

test('message pages follow canonical keyset order without duplicating history or mixing Tasks', t => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const task = store.createTask('Histórico extenso');
  const unrelated = store.createTask('Outro projeto');
  const insert = store.db.prepare('INSERT INTO messages(id,task_id,role,content,created_at) VALUES(?,?,?,?,?)');
  const assetInsert = store.db.prepare('INSERT INTO message_assets(id,task_id,message_id,kind,mime_type,local_path,alt,created_at) VALUES(?,?,?,?,?,?,?,?)');
  store.db.exec('BEGIN');
  try {
    for (let i = 0; i < 125; i++) {
      // All timestamps collide intentionally; task-local sequence must define insertion order.
      insert.run('msg_' + String(i).padStart(4, '0'), task.id, i % 2 ? 'assistant' : 'user',
        'Passagem ' + i, '2026-10-01T00:00:00.000Z');
    }
    insert.run('msg_unrelated', unrelated.id, 'user', 'Mensagem privada', '2026-10-01T00:00:00.000Z');
    assetInsert.run('asset_0052',task.id,'msg_0052','image','image/png','/tmp/0052.png','Imagem 52','2026-10-01T00:00:00.000Z');
    assetInsert.run('asset_0121',task.id,'msg_0121','image','image/png','/tmp/0121.png','Imagem 121','2026-10-01T00:00:00.000Z');
    store.db.exec('COMMIT');
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
  const complete = store.messages(task.id);
  const firstView = store.getTask(task.id, { messageLimit:50 });
  assert.equal(firstView.messages.length, 50);
  assert.equal(firstView.continuation.total_messages, 125);
  assert.equal(firstView.message_page.has_more, true);
  assert.equal(firstView.messages[0].id, 'msg_0075');
  assert.equal(firstView.messages[49].id, 'msg_0124');
  assert.equal(firstView.messages.find(message => message.id === 'msg_0121').assets[0].alt, 'Imagem 121');
  assert.equal(store.getTask(task.id).messages.length, 125); // Existing full SSOT API remains compatible.

  const pages = [];
  let cursor = null;
  for (let i = 0; i < 4; i++) {
    const page = store.messagesPage(task.id, { before:cursor });
    pages.push(page);
    assert.equal(page.total_messages, 125);
    if (!page.has_more) break;
    cursor = page.next_cursor;
    assert.ok(cursor);
  }
  assert.deepEqual(pages.map(p => p.messages.length), [50,50,25]);
  assert.deepEqual(pages.map(p => p.has_more), [true,true,false]);
  assert.equal(pages[1].messages.find(m => m.id === 'msg_0052').assets[0].alt, 'Imagem 52');
  assert.deepEqual(pages.slice().reverse().flatMap(p => p.messages), complete);
  assert.equal(pages[2].next_cursor, null);
  assert.deepEqual(store.messagesPage(task.id, {before:pages[0].next_cursor}).messages, pages[1].messages);
  assert.ok(pages.every(p => p.messages.every(m => m.task_id == null && m.content !== 'Mensagem privada')));
  assert.equal(store.messagesPage(unrelated.id).messages.length,1);
  assert.equal(store.messagesPage(unrelated.id,{before:pages[0].next_cursor}).messages.length,0);
  assert.throws(() => store.messagesPage(task.id,{ before:'garbage' }), /invalid_message_cursor/);
  assert.throws(() => store.messagesPage(task.id,{ limit:101 }), /invalid_message_page_size/);
  assert.throws(() => store.messagesPage(task.id,{ limit:0 }), /invalid_message_page_size/);
  const stableOlder = store.messagesPage(task.id, { before:pages[0].next_cursor }).messages;
  store.appendMessage(task.id, 'user', 'Mensagem nova e posterior');
  assert.deepEqual(store.messagesPage(task.id, { before:pages[0].next_cursor }).messages, stableOlder);
  assert.equal(store.messagesPage(task.id).total_messages,126);
});

test('Interrupted run is explicit and resumable after reopen', t => {
  const { dir, dbPath } = tempStore();
  let store = new Store(dbPath);
  cleanup(t, dir, () => store);
  const task = store.createTask('Crash recovery');
  store.checkpoint(task.id, 'before crash', { durable: true });
  const runId = store.startRun(task.id);
  assert.equal(store.getTask(task.id).status, 'running');

  store.close();
  store = new Store(dbPath);
  assert.equal(store.getTask(task.id).status, 'running');
  const recovered = store.recoverInterruptedRuns();
  assert.equal(recovered, 1);
  const restored = store.getTask(task.id);
  const run = store.db.prepare('SELECT status,error,completed_at FROM runs WHERE id=?').get(runId);
  assert.equal(restored.status, 'interrupted');
  assert.equal(run.status, 'interrupted');
  assert.equal(run.error, 'process_interrupted');
  assert.ok(run.completed_at);
  assert.ok(restored.events.some(event => event.kind === 'run.interrupted'));
  const capsule = store.buildResumeCapsule(task.id);
  assert.equal(capsule.checkpoint.payload.durable, true);
  assert.equal(capsule.task.status, 'interrupted');
});

test('boot recovery atomically quarantines uncertain actions without replay or affecting other Runs', t => {
  const {dir,dbPath}=tempStore();
  let store=new Store(dbPath);
  cleanup(t,dir,()=>store);
  const affected=store.createTask('Crash while action may be executing');
  store.appendMessage(affected.id,'user','Existing harmless offline fixture');
  store.checkpoint(affected.id,'Durable before crash',{sequence:7});
  const interrupted=store.startRun(affected.id);
  const pending=store.beginAction(affected.id,interrupted,'test.local','pending',{test:true});
  const dispatching=store.beginAction(affected.id,interrupted,'test.local','dispatching',{test:true});
  const done=store.beginAction(affected.id,interrupted,'test.local','already_done',{test:true});
  const approval=store.beginAction(affected.id,interrupted,'test.local','await_owner',{test:true});
  const approvalId=store.requestApproval(affected.id,approval,'Owner permission needed');
  store.db.prepare("UPDATE action_ledger SET status='dispatching' WHERE id=?").run(dispatching);
  store.db.prepare("UPDATE action_ledger SET status='succeeded' WHERE id=?").run(done);
  store.db.prepare("UPDATE action_ledger SET status='pending_approval' WHERE id=?").run(approval);
  const other=store.createTask('Unrelated already successful');
  const otherRun=store.startRun(other.id);
  store.finishRun(other.id,otherRun);
  const otherAction=store.beginAction(other.id,otherRun,'test.local','unrelated',{});
  const priorMessageCount=store.db.prepare('SELECT COUNT(*) n FROM messages').get().n;
  const priorCheckpointCount=store.db.prepare('SELECT COUNT(*) n FROM checkpoints').get().n;
  const priorRunCount=store.db.prepare('SELECT COUNT(*) n FROM runs').get().n;
  store.close();
  store=new Store(dbPath);
  assert.equal(store.recoverInterruptedRuns(),1);
  const active=store.db.prepare('SELECT status,error FROM runs WHERE id=?').get(interrupted);
  assert.equal(active.status,'interrupted');
  assert.equal(active.error,'process_interrupted');
  assert.equal(store.getTask(affected.id).status,'interrupted');
  assert.equal(store.getTask(affected.id).checkpoint_record.payload.sequence,7);
  const status=id=>store.db.prepare('SELECT status FROM action_ledger WHERE id=?').get(id)?.status;
  assert.equal(status(pending),'indeterminate');
  assert.equal(status(dispatching),'indeterminate');
  assert.equal(status(done),'succeeded');
  assert.equal(status(approval),'pending_approval');
  assert.equal(status(otherAction),'pending');
  assert.equal(store.db.prepare('SELECT status FROM approval_ledger WHERE id=?').get(approvalId).status,'pending');
  assert.equal(store.pendingApprovals(affected.id).length,1);
  assert.equal(store.getTask(other.id).status,'ready');
  const actionsChanged=store.db.prepare(
    "SELECT COUNT(*) n FROM events WHERE task_id=? AND kind='action.indeterminate'"
  ).get(affected.id).n;
  assert.equal(actionsChanged,2);
  assert.equal(store.recoverInterruptedRuns(),0);
  assert.equal(store.db.prepare(
    "SELECT COUNT(*) n FROM events WHERE task_id=? AND kind='action.indeterminate'"
  ).get(affected.id).n,actionsChanged);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM messages').get().n,priorMessageCount);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM checkpoints').get().n,priorCheckpointCount);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,priorRunCount);
});

test('crash recovery rolls back all Task/Run/action changes if an event fails', t => {
  const {dir,dbPath}=tempStore();
  const store=new Store(dbPath);
  cleanup(t,dir,()=>store);
  const task=store.createTask('Atomic recovery rollback');
  const run=store.startRun(task.id);
  const action=store.beginAction(task.id,run,'test.local','attempt',{});
  const eventCount=store.db.prepare('SELECT COUNT(*) n FROM events').get().n;
  const originalEvent=store.event.bind(store);
  store.event=()=>{throw new Error('simulated_sqlite_event_failure');};
  assert.throws(()=>store.recoverInterruptedRuns(),/simulated_sqlite_event_failure/);
  store.event=originalEvent;
  assert.equal(store.db.prepare('SELECT status FROM runs WHERE id=?').get(run).status,'running');
  assert.equal(store.getTask(task.id).status,'running');
  assert.equal(store.db.prepare('SELECT status FROM action_ledger WHERE id=?').get(action).status,'pending');
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM events').get().n,eventCount);
  assert.equal(store.recoverInterruptedRuns(),1);
  assert.equal(store.db.prepare('SELECT status FROM runs WHERE id=?').get(run).status,'interrupted');
  assert.equal(store.db.prepare('SELECT status FROM action_ledger WHERE id=?').get(action).status,'indeterminate');
});

test('Action and approval ledgers preserve deterministic side-effect state', t => {
  const { dir, dbPath } = tempStore();
  const store = new Store(dbPath);
  cleanup(t, dir, () => store);
  const task = store.createTask('Ledger');
  const runId = store.startRun(task.id);
  const actionId = store.beginAction(task.id, runId, 'write_file', 'file:test.txt', { bytes: 3 });
  const approvalId = store.requestApproval(task.id, actionId, 'Alteração externa');
  assert.equal(store.pendingApprovals(task.id).length, 1);
  store.resolveApproval(task.id, approvalId, true);
  store.finishAction(task.id, actionId, 'succeeded', { sha256: 'abc' });
  store.finishRun(task.id, runId);

  const action = store.db.prepare('SELECT status,result FROM action_ledger WHERE id=?').get(actionId);
  const approval = store.db.prepare('SELECT status,resolved_at FROM approval_ledger WHERE id=?').get(approvalId);
  assert.equal(action.status, 'succeeded');
  assert.equal(JSON.parse(action.result).sha256, 'abc');
  assert.equal(approval.status, 'approved');
  assert.ok(approval.resolved_at);
  assert.equal(store.pendingApprovals(task.id).length, 0);
});

test('Store close is idempotent and releases SQLite files immediately', () => {
  const { dir, dbPath } = tempStore();
  const store = new Store(dbPath);
  store.createTask('Close lifecycle');
  store.close();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(fs.existsSync(dir), false);
});

test('WAL mode is stable across reopen without reconfiguring an existing database', t => {
  const { dir, dbPath } = tempStore();
  let store = new Store(dbPath);
  cleanup(t, dir, () => store);
  assert.equal(String(store.db.prepare('PRAGMA journal_mode').get().journal_mode).toLowerCase(), 'wal');
  store.createTask('WAL lifecycle');
  store.close();
  store = new Store(dbPath);
  assert.equal(String(store.db.prepare('PRAGMA journal_mode').get().journal_mode).toLowerCase(), 'wal');
  assert.equal(store.listTasks().length, 1);
});

test('Task memory survives provider conversation rotation and seeds the next chat', t => {
  const { dir, dbPath } = tempStore();
  const store = new Store(dbPath);
  cleanup(t, dir, () => store);
  const task = store.createTask('Livro - Horizonte');
  store.appendMessage(task.id, 'user', 'O protagonista se chama Caio.');
  store.appendMessage(task.id, 'assistant', 'Definimos Caio como protagonista e a abertura no litoral.');
  store.checkpoint(task.id, 'Caio é o protagonista; abertura no litoral.', { project: 'book' });
  store.setChatUrl(task.id, 'https://chatgpt.com/c/part-1');

  let current = store.getTask(task.id);
  assert.equal(current.conversations.length, 1);
  assert.equal(current.conversations[0].status, 'active');
  assert.equal(store.listTasks()[0].conversation_count, 1);

  current = store.rotateConversation(task.id, 'test_limit');
  assert.equal(current.chat_url, null);
  assert.equal(current.conversations[0].status, 'archived');

  const prompt = store.buildContinuationPrompt(task.id, 'Continue escrevendo o capítulo 2.');
  assert.match(prompt, /Livro - Horizonte/);
  assert.match(prompt, /Caio é o protagonista/);
  assert.match(prompt, /O protagonista se chama Caio/);
  assert.match(prompt, /Continue escrevendo o capítulo 2/);

  store.setChatUrl(task.id, 'https://chatgpt.com/c/part-2', 1);
  current = store.getTask(task.id);
  assert.equal(current.conversations.length, 2);
  assert.equal(current.conversations[0].sequence, 2);
  assert.equal(current.conversations[0].status, 'active');
  assert.equal(current.conversations[0].context_checkpoint_version, 1);
  assert.equal(current.continuation.conversation_count, 2);
  const capsule = store.buildResumeCapsule(task.id);
  assert.equal(capsule.version, 2);
  assert.equal(capsule.conversations.length, 2);
});

test('OrdaX project memory survives a GPT account change and resumes in a fresh provider chat', t => {
  const { dir, dbPath } = tempStore();
  let store = new Store(dbPath);
  cleanup(t, dir, () => store);
  const task = store.createTask('Loja VESTE');
  store.appendMessage(task.id, 'user', 'A marca usa tons areia e verde-escuro.');
  store.appendMessage(task.id, 'assistant', 'A identidade visual e as decisões ficam registradas no OrdaX.');
  store.upsertProjectMemory(task.id, {
    category:'constraint', key:'Paleta da marca', content:'Areia e verde-escuro.', source_type:'manual'
  });
  store.checkpoint(task.id, 'Catálogo pendente; paleta areia e verde-escuro aprovada.', { stage:'catalog' });
  store.setChatUrl(task.id, 'https://chatgpt.com/c/previous-account-chat');

  // Provider login/account identity is intentionally not the owner of the task.
  // Treat the next account's empty conversation as a new segment of this Task.
  store.rotateConversation(task.id, 'provider_account_changed');
  store.setChatUrl(task.id, 'https://chatgpt.com/c/new-account-chat', 1);
  store.close();

  store = new Store(dbPath);
  const restored = store.getTask(task.id);
  assert.equal(restored.title, 'Loja VESTE');
  assert.equal(restored.conversations.length, 2);
  assert.equal(restored.conversations[0].status, 'active');
  assert.equal(restored.conversations[0].chat_url, 'https://chatgpt.com/c/new-account-chat');
  assert.equal(restored.checkpoint_record.summary, 'Catálogo pendente; paleta areia e verde-escuro aprovada.');
  assert.equal(restored.project_memory.items.find(item => item.key === 'Paleta da marca').content,
    'Areia e verde-escuro.');
  const continuation = store.buildContinuationPrompt(task.id, 'Continue o catálogo de produtos.');
  assert.match(continuation, /Loja VESTE/);
  assert.match(continuation, /Paleta da marca: Areia e verde-escuro/);
  assert.match(continuation, /Catálogo pendente/);
  assert.match(continuation, /Continue o catálogo de produtos/);
});

test('Structured project memory is canonical, durable and injected into continuation', t => {
  const { dir, dbPath } = tempStore();
  let store = new Store(dbPath);
  cleanup(t, dir, () => store);
  const task = store.createTask('Livro - Horizonte');

  const entity = store.upsertProjectMemory(task.id, {
    category: 'entity', key: 'Caio', content: 'Protagonista de 34 anos; nasceu em Salvador.', source_type: 'manual'
  });
  store.upsertProjectMemory(task.id, {
    category: 'constraint', key: 'Ponto de vista', content: 'Terceira pessoa limitada em Caio.', source_type: 'manual'
  });
  store.upsertProjectMemory(task.id, {
    category: 'structure', key: 'Capítulo 1', content: 'Abertura no litoral antes da viagem.', source_type: 'manual'
  });
  store.upsertProjectMemory(task.id, {
    category: 'entity', key: 'caio', content: 'Protagonista de 35 anos; nasceu em Salvador.', source_type: 'manual'
  });

  let current = store.getTask(task.id);
  assert.equal(current.project_memory.summary.total, 3);
  assert.equal(current.project_memory.items.filter(item => item.key === 'Caio').length, 1);
  assert.match(current.project_memory.items.find(item => item.id === entity.id).content, /35 anos/);
  assert.equal(current.continuation.structured_memory_count, 3);

  const prompt = store.buildContinuationPrompt(task.id, 'Abra o capítulo 2.');
  assert.match(prompt, /Memória estruturada canônica/);
  assert.match(prompt, /\[ENTIDADE\] Caio: Protagonista de 35 anos/);
  assert.match(prompt, /\[RESTRICAO\] Ponto de vista/);
  assert.match(prompt, /Pedido atual:\nAbra o capítulo 2\./);

  store.close();
  store = new Store(dbPath);
  current = store.getTask(task.id);
  assert.equal(current.project_memory.summary.total, 3);
  assert.equal(store.buildResumeCapsule(task.id).project_memory.items.length, 3);

  const structure = current.project_memory.items.find(item => item.category === 'structure');
  store.archiveProjectMemory(task.id, structure.id);
  current = store.getTask(task.id);
  assert.equal(current.project_memory.summary.total, 2);
  assert.equal(store.listProjectMemory(task.id, { includeArchived: true }).find(item => item.id === structure.id).status, 'archived');
});

test('memory proposals remain pending through restart and require explicit review', t => {
  const { dir, dbPath } = tempStore();
  let store = new Store(dbPath);
  cleanup(t, dir, () => store);
  const task = store.createTask('Livro - Caminhos');
  const user = store.appendMessage(task.id, 'user', [
    'Personagem Caio: Protagonista de 35 anos, nascido em Salvador.',
    'Regra: a narrativa deve permanecer em terceira pessoa limitada.'
  ].join('\n'));
  store.appendMessage(task.id, 'assistant', 'Entendido: personagem Caio e ponto de vista limitado.');
  store.appendMessage(task.id, 'user', 'Personagem Caio: Protagonista de 35 anos, nascido em Salvador.'); // repeated evidence stays one pending suggestion

  let current = store.getTask(task.id);
  assert.equal(current.project_memory.summary.total, 0);
  assert.equal(current.project_memory.pending_count, 2);
  assert.equal(store.memoryCandidates.list(task.id).length, 2);
  const before = store.buildContinuationPrompt(task.id, 'Continue.');
  assert.doesNotMatch(before, /Memória estruturada canônica/);

  store.close();
  store = new Store(dbPath);
  current = store.getTask(task.id);
  assert.equal(current.project_memory.pending_count, 2);
  assert.equal(store.memoryCandidates.scan(task.id).added, 0);
  const rejected = current.project_memory.candidates.find(item => item.category === 'constraint');
  store.memoryCandidates.review(task.id, rejected.id, 'reject');
  assert.equal(store.memoryCandidates.scan(task.id).added, 0);
  assert.equal(store.getTask(task.id).project_memory.pending_count, 1);
  assert.throws(() => store.memoryCandidates.review(task.id, rejected.id, 'accept'), /project_memory_candidate_reviewed/);

  const accepted = store.memoryCandidates.list(task.id)[0];
  const sourceRef = accepted.source_message_id;
  assert.equal(sourceRef, user.id);
  store.memoryCandidates.review(task.id, accepted.id, 'accept', {
    key:'Caio Mendes',
    content:'Protagonista de 35 anos, nascido em Salvador; usa o nome Caio Mendes.'
  });
  current = store.getTask(task.id);
  assert.equal(current.project_memory.pending_count, 0);
  assert.equal(current.project_memory.summary.total, 1);
  assert.equal(current.project_memory.items[0].source_type, 'message');
  assert.equal(current.project_memory.items[0].source_ref, sourceRef);
  assert.equal(current.project_memory.items[0].key, 'Caio Mendes');
  assert.match(store.buildContinuationPrompt(task.id, 'Avance.'), /\[ENTIDADE\] Caio Mendes/);
  assert.doesNotMatch(store.buildContinuationPrompt(task.id, 'Avance.'), /\[RESTRICAO\]/);
  assert.ok(store.getTask(task.id).events.some(event => event.kind === 'project_memory.candidate_reviewed'));
});

test('GPT-authored proposals remain noncanonical and retain assistant provenance until reviewed', t => {
  const { dir, dbPath } = tempStore();
  const store = new Store(dbPath);
  cleanup(t,dir,()=>store);
  const task = store.createTask('Livro - Continuidade assistida');
  const assistant = store.appendMessage(task.id,'assistant',[
    'A cena desenvolve a travessia sem fixar fatos fora do texto.',
    '[[ORDAX_MEMORY_PROPOSALS_V1]]',
    'Fato Embarcação: A caravela se chama Aurora e leva os mapas da expedição.',
    'Decisão Travessia: a partida ocorre ao amanhecer.',
    '[[/ORDAX_MEMORY_PROPOSALS_V1]]'
  ].join('\n'));
  const candidates = store.memoryCandidates.list(task.id);
  assert.equal(candidates.length,2);
  assert.ok(candidates.every(candidate=>candidate.source_role==='assistant'));
  assert.ok(candidates.every(candidate=>candidate.source_message_id===assistant.id));
  assert.equal(store.getTask(task.id).project_memory.summary.total,0);
  assert.equal(store.memoryCandidates.pendingCount(task.id),2);
  assert.doesNotMatch(store.buildContinuationPrompt(task.id,'Continue a missão.'),/\[FATO\] Embarcação/);

  const accepted=candidates.find(candidate=>candidate.key==='Embarcação');
  const item=store.memoryCandidates.review(task.id,accepted.id,'accept');
  assert.equal(item.source_type,'message');
  assert.equal(item.source_ref,assistant.id);
  assert.match(store.buildContinuationPrompt(task.id,'Continue a missão.'),/\[FATO\] Embarcação: A caravela se chama Aurora/);
  assert.equal(store.memoryCandidates.pendingCount(task.id),1);
  assert.equal(store.memoryCandidates.scan(task.id).added,0);
});

test('candidate review rollback preserves pending proposal when canon validation fails', t => {
  const { dir, dbPath } = tempStore();
  const store = new Store(dbPath);
  cleanup(t, dir, () => store);
  const task = store.createTask('Pesquisa');
  store.appendMessage(task.id, 'user', 'Fato: o estudo utiliza dados de 2026.');
  const candidate = store.memoryCandidates.list(task.id)[0];
  assert.ok(candidate);
  assert.throws(() => store.memoryCandidates.review(task.id,candidate.id,'accept',{category:'invalid'}), /invalid_project_memory_category/);
  assert.equal(store.memoryCandidates.list(task.id).length,1);
  assert.equal(store.getTask(task.id).project_memory.summary.total,0);
  assert.throws(() => store.memoryCandidates.review('task_unknown',candidate.id,'reject'), /project_memory_candidate_not_found/);
});

test('conflicting suggestion never silently overwrites approved canon', t => {
  const { dir, dbPath } = tempStore();
  const store = new Store(dbPath);
  cleanup(t,dir,()=>store);
  const task = store.createTask('Livro - Proteção de cânone');
  const existing = store.upsertProjectMemory(task.id,{
    category:'entity',key:'Caio',content:'Caio tem 34 anos.',source_type:'manual'
  });
  store.appendMessage(task.id,'user','Personagem Caio: Caio agora tem 35 anos.');
  const candidate = store.memoryCandidates.list(task.id)[0];
  assert.equal(candidate.conflict,true);
  assert.equal(candidate.canonical_content,'Caio tem 34 anos.');
  assert.equal(candidate.canonical_memory_id,existing.id);
  assert.throws(
    () => store.memoryCandidates.review(task.id,candidate.id,'accept'),
    /project_memory_conflict_requires_review/
  );
  assert.equal(store.projectMemorySummary(task.id).total,1);
  assert.equal(store.listProjectMemory(task.id)[0].content,'Caio tem 34 anos.');
  assert.equal(store.memoryCandidates.pendingCount(task.id),1);
  assert.throws(
    () => store.memoryCandidates.review(task.id,candidate.id,'accept',{
      confirm_conflict:true,expected_canonical_memory_id:existing.id,
      expected_canonical_content:'Caio tinha 34 anos.'
    }),/project_memory_conflict_requires_review/
  );
  assert.equal(store.memoryCandidates.pendingCount(task.id),1);
  store.memoryCandidates.review(task.id,candidate.id,'accept',{
    confirm_conflict:true,expected_canonical_memory_id:existing.id,
    expected_canonical_content:'Caio tem 34 anos.'
  });
  assert.equal(store.listProjectMemory(task.id)[0].content,'Caio agora tem 35 anos.');
  assert.equal(store.memoryCandidates.pendingCount(task.id),0);
  assert.match(store.buildContinuationPrompt(task.id,'Continue.'),/Caio agora tem 35 anos/);
});

test('concurrent canon revision makes an earlier conflict confirmation stale', t => {
  const { dir, dbPath } = tempStore();
  const store = new Store(dbPath);
  cleanup(t,dir,()=>store);
  const task = store.createTask('Pesquisa versionada');
  const canon = store.upsertProjectMemory(task.id,{category:'fact',key:'Ano',content:'O ano é 2025.'});
  store.appendMessage(task.id,'user','Fato: o ano agora é 2026.');
  // The explicit fact prefix uses the statement as the key, so create a targeted candidate from named content.
  store.appendMessage(task.id,'user','Personagem Caio: Caio tem 35 anos.');
  const entity = store.upsertProjectMemory(task.id,{category:'entity',key:'Caio',content:'Caio tem 34 anos.'});
  const suggestion = store.memoryCandidates.list(task.id).find(x=>x.category==='entity');
  assert.ok(suggestion?.conflict);
  store.upsertProjectMemory(task.id,{id:entity.id,category:'entity',key:'Caio',content:'Caio tem 36 anos.'});
  assert.throws(() => store.memoryCandidates.review(task.id,suggestion.id,'accept',{
    confirm_conflict:true,expected_canonical_memory_id:entity.id,
    expected_canonical_content:'Caio tem 34 anos.'
  }),/project_memory_conflict_requires_review/);
  assert.equal(store.listProjectMemory(task.id).find(x=>x.key==='Caio').content,'Caio tem 36 anos.');
});

test('a generic long-running project preserves full canonical memory across provider rotations', t => {
  const { dir, dbPath } = tempStore();
  let store = new Store(dbPath);
  cleanup(t, dir, () => store);
  const project = store.createTask('Plataforma de atendimento');
  store.setChatUrl(project.id, 'https://chatgpt.com/c/segment-one');
  store.checkpoint(project.id, 'Base local pronta; próximas etapas: SSO e sincronização.');
  for (let i = 0; i < 60; i++) {
    store.upsertProjectMemory(project.id, {
      category: i % 2 === 0 ? 'decision' : 'open_loop',
      key: 'Workstream ' + i,
      content: 'Contrato canônico do workstream ' + i + ': ' + 'documentado '.repeat(30)
    });
  }
  store.rotateConversation(project.id);
  let task = store.getTask(project.id);
  assert.equal(task.project_memory.summary.total, 60);
  assert.equal(task.chat_url, null);
  const request = 'Continuar a integração SSO sem perder decisões anteriores.';
  const injected = store.buildContinuationPrompt(project.id, request);
  assert.ok(injected.length <= 16000);
  assert.ok(injected.endsWith('Pedido atual:\n' + request));
  assert.match(injected, /\[MEMORIA PARCIAL\]/);
  assert.match(injected, /\[DECISAO\]/);
  assert.match(injected, /\[PENDENCIA\]/);
  store.close();
  store = new Store(dbPath);
  task = store.getTask(project.id);
  assert.equal(task.project_memory.items.length, 60);
  assert.equal(store.buildResumeCapsule(project.id).project_memory.items.length, 60);
  assert.ok(store.buildContinuationPrompt(project.id, request).endsWith('Pedido atual:\n' + request));
});

test('automatic provider rotation counts only completed runs and is restart-safe', t => {
  const { dir, dbPath } = tempStore();
  let store = new Store(dbPath);
  cleanup(t, dir, () => store);
  const task = store.createTask('Projeto permanente');
  store.setChatUrl(task.id,'https://chatgpt.com/c/provider-1');
  const failed = store.startRun(task.id);
  store.finishRun(task.id,failed,'response_not_observed');
  assert.equal(store.getTask(task.id).conversations[0].completed_turns,0);
  const first = store.startRun(task.id);
  store.finishRun(task.id,first);
  assert.equal(store.getTask(task.id).conversations[0].completed_turns,1);
  assert.equal(store.recordConversationCompletion(task.id,first),1);
  assert.equal(store.getTask(task.id).conversations[0].completed_turns,1);
  for (let i=1;i<SUCCESSFUL_TURNS_PER_SEGMENT;i++) {
    const id=store.startRun(task.id);
    store.finishRun(task.id,id);
  }
  let project=store.getTask(task.id);
  assert.equal(project.conversations[0].completed_turns,SUCCESSFUL_TURNS_PER_SEGMENT);
  assert.equal(planProviderConversation(project).automaticRotation,true);
  assert.equal(store.getTask(task.id).chat_url,'https://chatgpt.com/c/provider-1');
  store.close();
  store = new Store(dbPath);
  project=store.getTask(task.id);
  assert.equal(planProviderConversation(project).automaticRotation,true);
  assert.equal(project.conversations.length,1);
  // The provider returns a new URL after a successful send: only then bind another segment.
  store.setChatUrl(task.id,'https://chatgpt.com/c/provider-2',0);
  const newRun=store.startRun(task.id);
  store.finishRun(task.id,newRun);
  project=store.getTask(task.id);
  assert.equal(project.conversations.length,2);
  assert.equal(project.conversations[0].completed_turns,1);
  assert.equal(project.conversations[1].completed_turns,SUCCESSFUL_TURNS_PER_SEGMENT);
  assert.equal(planProviderConversation(project).automaticRotation,false);
  assert.equal(project.conversations[1].status,'archived');
  assert.equal(project.conversations[0].status,'active');
});

test('provider conversation execution snapshot measures confirmed UTF-8 transcript and rotates before turn cap',t=>{
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const task=store.createTask('Transcript pressure');
  const chatUrl='https://chatgpt.com/c/transcript-pressure';
  store.setChatUrl(task.id,chatUrl);
  const sendAndComplete=(prompt,response)=>{
    const {userMessage,runId}=store.beginProviderRun(task.id,prompt);
    assert.deepEqual(recordProviderSubmissionProvenance({store,taskId:task.id,runId,
      messageId:userMessage.id,providerPrompt:prompt,chatUrl,submittedAt:Date.now()}),
    {recorded:true,reason:'receipt_recorded'});
    store.commitObservedProviderReply(task.id,runId,{text:response,observedAt:new Date().toISOString(),chatUrl});
  };

  sendAndComplete('á'.repeat(10_000),'🧵'.repeat(3_000));
  let snapshot=store.getTaskExecutionSnapshot(task.id);
  assert.equal(snapshot.conversations[0].observed_transcript_bytes,
    Buffer.byteLength('á'.repeat(10_000),'utf8')+Buffer.byteLength('🧵'.repeat(3_000),'utf8'));
  assert.equal(planProviderConversation(snapshot,{nextPromptBytes:1}).automaticRotation,false);

  sendAndComplete('x'.repeat(12_000),'y'.repeat(10_000));
  snapshot=store.getTaskExecutionSnapshot(task.id);
  assert.equal(snapshot.conversations[0].completed_turns,2);
  assert.ok(snapshot.conversations[0].observed_transcript_bytes>MAX_OBSERVED_TRANSCRIPT_BYTES_PER_SEGMENT-12_000);
  const plan=planProviderConversation(snapshot,{nextPromptBytes:12_000});
  assert.equal(plan.automaticRotation,true);
  assert.equal(plan.reason,'observed_transcript_budget');
});

test('observed transcript measurement fails closed when receipts or multimodal bytes are unavailable',t=>{
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const task=store.createTask('Multimodal transcript measurement');
  const chatUrl='https://chatgpt.com/c/transcript-unknown';
  store.setChatUrl(task.id,chatUrl);
  let begun=store.beginProviderRun(task.id,'mensagem textual');
  assert.deepEqual(recordProviderSubmissionProvenance({store,taskId:task.id,runId:begun.runId,
    messageId:begun.userMessage.id,providerPrompt:'mensagem textual',chatUrl,submittedAt:Date.now()}),
  {recorded:true,reason:'receipt_recorded'});
  store.commitObservedProviderReply(task.id,begun.runId,{text:'resposta textual',observedAt:new Date().toISOString(),chatUrl});
  assert.ok(Number.isSafeInteger(store.getTaskExecutionSnapshot(task.id).conversations[0].observed_transcript_bytes));
  const userMessage=store.db.prepare("SELECT id FROM messages WHERE task_id=? AND role='user'").get(task.id);
  store.db.prepare(`INSERT INTO message_assets(id,task_id,message_id,kind,mime_type,local_path,created_at)
    VALUES('asset_transcript_probe',?,?,'image','image/png','unused-test-path',?)`).run(task.id,userMessage.id,new Date().toISOString());
  // Even with a valid text receipt, image/token payload size is outside this
  // visible-text metric, so the policy must not treat it as a complete budget.
  begun=store.beginProviderRun(task.id,'segunda mensagem');
  assert.deepEqual(recordProviderSubmissionProvenance({store,taskId:task.id,runId:begun.runId,
    messageId:begun.userMessage.id,providerPrompt:'segunda mensagem',chatUrl,submittedAt:Date.now()}),
  {recorded:true,reason:'receipt_recorded'});
  store.commitObservedProviderReply(task.id,begun.runId,{text:'segunda resposta',observedAt:new Date().toISOString(),chatUrl});
  assert.equal(store.getTaskExecutionSnapshot(task.id).conversations[0].observed_transcript_bytes,null);

  const noReceipt=store.createTask('Transcript without provider receipt');
  const noReceiptUrl='https://chatgpt.com/c/transcript-no-receipt';
  store.setChatUrl(noReceipt.id,noReceiptUrl);
  const unreceipted=store.beginProviderRun(noReceipt.id,'mensagem sem recibo');
  store.commitObservedProviderReply(noReceipt.id,unreceipted.runId,{text:'resposta',observedAt:new Date().toISOString(),chatUrl:noReceiptUrl});
  assert.equal(store.getTaskExecutionSnapshot(noReceipt.id).conversations[0].observed_transcript_bytes,null);
});

test('transcript pressure counts the expanded provider prompt and verified continuation attachment',t=>{
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const finish=({title,chatUrl,prompt,providerPrompt,contextManifest,contextAttachmentReceipt=null})=>{
    const task=store.createTask(title);
    const conversation=store.setChatUrl(task.id,chatUrl);
    const {userMessage,runId}=store.beginProviderRun(task.id,prompt);
    assert.deepEqual(recordProviderSubmissionProvenance({store,taskId:task.id,runId,
      messageId:userMessage.id,providerPrompt,chatUrl,submittedAt:Date.now(),
      contextManifest,contextAttachmentReceipt}),{recorded:true,reason:'receipt_recorded'});
    store.commitObservedProviderReply(task.id,runId,{text:'resposta confirmada',observedAt:new Date().toISOString(),chatUrl});
    return {task,runId,conversation};
  };

  const prompt='Continue o projeto';
  const expanded='CONTEXTO CANÔNICO '+'decisão importante '.repeat(2_000)+'\n'+prompt;
  const expandedTask=finish({title:'Expanded continuation prompt',
    chatUrl:'https://chatgpt.com/c/expanded-context',prompt,providerPrompt:expanded,
    contextManifest:{format:'ordax-continuation-context/v1',promptSha256:providerPromptDigest(expanded),
      contextIncluded:true,attachmentUseful:false}});
  let observed=store.getTaskExecutionSnapshot(expandedTask.task.id).conversations[0].observed_transcript_bytes;
  assert.equal(observed,Buffer.byteLength(expanded,'utf8')+Buffer.byteLength('resposta confirmada','utf8'));
  const provenance=store.db.prepare("SELECT payload FROM events WHERE task_id=? AND kind='provider.submission.provenance' AND json_extract(payload,'$.run_id')=?").get(expandedTask.task.id,expandedTask.runId);
  const savedReceipt=JSON.parse(provenance.payload);
  assert.equal(savedReceipt.provider_prompt_bytes,Buffer.byteLength(expanded,'utf8'));
  assert.equal(Object.hasOwn(savedReceipt,'provider_prompt'),false);
  for(let i=0;i<200;i++)store.event(expandedTask.task.id,'provider.submission.provenance',{
    run_id:'failed_'+i,message_id:'uncertain_'+i,conversation_id:expandedTask.conversation.id
  });
  observed=store.getTaskExecutionSnapshot(expandedTask.task.id).conversations[0].observed_transcript_bytes;
  assert.equal(observed,Buffer.byteLength(expanded,'utf8')+Buffer.byteLength('resposta confirmada','utf8'));
  const queryPlan=store.db.prepare(`EXPLAIN QUERY PLAN SELECT kind,payload FROM events WHERE task_id=?
    AND kind IN ('provider.submission.provenance','provider.response.reconciled')
    AND json_extract(payload,'$.conversation_id')=?
    AND json_extract(payload,'$.run_id') IN (?) ORDER BY seq LIMIT ?`)
    .all(expandedTask.task.id,expandedTask.conversation.id,expandedTask.runId,SUCCESSFUL_TURNS_PER_SEGMENT*4+1)
    .map(row=>row.detail).join(' ');
  assert.match(queryPlan,/idx_events_provider_transcript/);

  const attachmentTask=store.createTask('Verified continuation attachment');
  const attachmentChatUrl='https://chatgpt.com/c/attachment-context';
  store.setChatUrl(attachmentTask.id,attachmentChatUrl);
  const attachmentReceipt={format:'ordax-task-handoff/v1',deliveryState:'uploaded',
    taskId:attachmentTask.id,filename:'ordax-handoff-'+attachmentTask.id+'-c1-abcdef123456.txt',
    sha256:'a'.repeat(64),byteLength:4096,checkpointVersion:0,uploadedAt:Date.now(),
    memoryIds:[],recentMessageIds:[],historicalMessageIds:[]};
  const attachmentProviderPrompt='Arquivo de continuidade anexado: handoff.txt';
  const attachmentManifest={format:'ordax-continuation-context/v1',
    promptSha256:providerPromptDigest(attachmentProviderPrompt),contextIncluded:true,attachmentUseful:true};
  const attachmentRun=store.beginProviderRun(attachmentTask.id,'Retome com o arquivo de handoff');
  assert.deepEqual(recordProviderSubmissionProvenance({store,taskId:attachmentTask.id,runId:attachmentRun.runId,
    messageId:attachmentRun.userMessage.id,providerPrompt:attachmentProviderPrompt,
    chatUrl:attachmentChatUrl,submittedAt:Date.now(),contextManifest:attachmentManifest,
    contextAttachmentReceipt:attachmentReceipt}),{recorded:true,reason:'receipt_recorded'});
  store.commitObservedProviderReply(attachmentTask.id,attachmentRun.runId,{
    text:'resposta confirmada',observedAt:new Date().toISOString(),chatUrl:attachmentChatUrl});
  observed=store.getTaskExecutionSnapshot(attachmentTask.id).conversations[0].observed_transcript_bytes;
  assert.equal(observed,Buffer.byteLength(attachmentProviderPrompt,'utf8')+attachmentReceipt.byteLength+
    Buffer.byteLength('resposta confirmada','utf8'));

  const uncertainAttachment=store.createTask('Unconfirmed continuation attachment');
  const uncertainUrl='https://chatgpt.com/c/unconfirmed-attachment';
  store.setChatUrl(uncertainAttachment.id,uncertainUrl);
  const uncertainPrompt='Continue';
  const uncertainExpanded='Contexto enviado com arquivo';
  const uncertainRun=store.beginProviderRun(uncertainAttachment.id,uncertainPrompt);
  assert.deepEqual(recordProviderSubmissionProvenance({store,taskId:uncertainAttachment.id,
    runId:uncertainRun.runId,messageId:uncertainRun.userMessage.id,providerPrompt:uncertainExpanded,
    chatUrl:uncertainUrl,submittedAt:Date.now(),
    contextManifest:{format:'ordax-continuation-context/v1',
      promptSha256:providerPromptDigest(uncertainExpanded),contextIncluded:true,attachmentUseful:true}}),
  {recorded:true,reason:'receipt_recorded'});
  store.commitObservedProviderReply(uncertainAttachment.id,uncertainRun.runId,{
    text:'resposta confirmada',observedAt:new Date().toISOString(),chatUrl:uncertainUrl});
  assert.equal(store.getTaskExecutionSnapshot(uncertainAttachment.id).conversations[0].observed_transcript_bytes,null);

  const legacyPayload=JSON.parse(provenance.payload);
  delete legacyPayload.provider_prompt_bytes;
  store.db.prepare("UPDATE events SET payload=? WHERE task_id=? AND kind='provider.submission.provenance' AND json_extract(payload,'$.run_id')=?")
    .run(JSON.stringify(legacyPayload),expandedTask.task.id,expandedTask.runId);
  assert.equal(store.getTaskExecutionSnapshot(expandedTask.task.id).conversations[0].observed_transcript_bytes,null);
});

test('reconciled provider replies retain their conversation transcript attribution',t=>{
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const task=store.createTask('Reconciled transcript usage');
  const chatUrl='https://chatgpt.com/c/transcript-recovery';
  const conversation=store.setChatUrl(task.id,chatUrl);
  const prompt='Uma pergunta já enviada';
  const response='Resposta recuperada após observação interrompida';
  const {userMessage,runId}=store.beginProviderRun(task.id,prompt);
  assert.deepEqual(recordProviderSubmissionProvenance({store,taskId:task.id,runId,
    messageId:userMessage.id,providerPrompt:prompt,chatUrl,submittedAt:Date.now()}),
  {recorded:true,reason:'receipt_recorded'});
  store.finishRun(task.id,runId,'observer_interrupted');
  const result=store.reconcileObservedProviderReply(task.id,{runId,userMessageId:userMessage.id,
    conversationId:conversation.id,chatUrl,promptSha256:providerPromptDigest(prompt),
    responseSha256:createHash('sha256').update(response,'utf8').digest('hex'),text:response});
  assert.equal(result.reconciled,true);
  const snapshot=store.getTaskExecutionSnapshot(task.id);
  assert.equal(snapshot.conversations[0].completed_turns,1);
  assert.equal(snapshot.conversations[0].observed_transcript_bytes,
    Buffer.byteLength(prompt,'utf8')+Buffer.byteLength(response,'utf8'));
});

test('provider conversation links are canonical: URL params cannot create false chat segments', t => {
  const { dir, dbPath }=tempStore();
  let store=new Store(dbPath);
  cleanup(t,dir,()=>store);
  const task=store.createTask('Projeto contínuo - identidade de conversa');
  const base='https://chatgpt.com/c/segment-alpha';
  const first=store.setChatUrl(task.id,base+'?model=auto#reply');
  const again=store.setChatUrl(task.id,base+'/?model=high');
  assert.equal(first.id,again.id);
  assert.equal(store.getTask(task.id).chat_url,base);
  assert.equal(store.getTask(task.id).conversations.length,1);
  assert.throws(()=>store.setChatUrl(task.id,'https://chatgpt.com/'),/invalid_provider_conversation_url/);
  assert.throws(()=>store.setChatUrl(task.id,'https://not-chatgpt.example/c/segment-alpha'),/invalid_provider_conversation_url/);
  assert.equal(store.getTask(task.id).conversations.length,1);
  store.close();
  store=new Store(dbPath);
  assert.equal(store.getTask(task.id).chat_url,base);
  assert.equal(store.getTask(task.id).conversations.length,1);
});

test('multiple planned provider rotations preserve a single Task and do not recount failed runs', t => {
  // The persistence/reopen contract is covered separately on a real SQLite file.
  // This stress case exercises 72 run records in memory without filesystem fsync overhead.
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const task=store.createTask('Projeto de longa duração');
  store.upsertProjectMemory(task.id,{category:'goal',key:'Produto',content:'Concluir produto modular.'});
  const provider=(n)=>'https://chatgpt.com/c/segment-'+n;
  store.setChatUrl(task.id,provider(1));
  for(let segment=1;segment<=3;segment++){
    for(let turn=0;turn<SUCCESSFUL_TURNS_PER_SEGMENT;turn++){
      const id=store.startRun(task.id);
      if(turn===7){
        store.finishRun(task.id,id,'provider_timeout');
        assert.equal(store.getTask(task.id).conversations[0].completed_turns,turn);
        const recovery=store.startRun(task.id);
        store.finishRun(task.id,recovery);
      }else{
        store.finishRun(task.id,id);
      }
    }
    const current=store.getTask(task.id);
    assert.equal(planProviderConversation(current).automaticRotation,true);
    assert.equal(current.conversations[0].completed_turns,SUCCESSFUL_TURNS_PER_SEGMENT);
    if(segment<3) store.setChatUrl(task.id,provider(segment+1),store.latestCheckpoint(task.id)?.version||0);
  }
  const current=store.getTask(task.id);
  assert.equal(current.conversations.length,3);
  assert.equal(current.project_memory.items.length,1);
  assert.equal(current.conversations.reduce((total,item)=>total+item.completed_turns,0),72);
  assert.ok(store.buildContinuationPrompt(task.id,'Continuar.').includes('Concluir produto modular.'));
});

test('continuation provenance counts old messages excluded by the bounded SQLite projection',t=>{
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const task=store.createTask('Histórico além da janela');
  store.upsertProjectMemory(task.id,{category:'goal',key:'Missão',content:'Manter continuidade pela memória canônica.'});
  for(let index=1;index<=24;index++)
    store.appendMessage(task.id,index%2?'user':'assistant',`Turno ${index}`);

  const packet=store.buildContinuationPacket(task.id,'Continue a tarefa.');
  assert.equal(packet.manifest.historyWindowOmittedCount,16);
  assert.deepEqual(packet.manifest.historyWindowOmittedIds,[]);
  assert.deepEqual(packet.manifest.omissionReasons,['history_window']);
  assert.equal(packet.manifest.partial,true);
  assert.equal(packet.manifest.attachmentUseful,false);
  assert.match(packet.prompt,/\[JANELA DE HISTORICO\]/);
  assert.doesNotMatch(packet.prompt,/Turno 1(?:\D|$)/);
  assert.match(packet.prompt,/Turno 24/);
});

test('task-scoped full-text retrieval injects a relevant old message with a source id and useful excerpt',t=>{
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const task=store.createTask('VESTE historical retrieval');
  const otherTask=store.createTask('Other isolated task');
  const old=store.appendMessage(task.id,'user',
    'A referência antiga da VESTE é VESTE_REF_7391. Guarde esse identificador para consulta futura.');
  store.appendMessage(task.id,'assistant','VESTE_INICIO_OK');
  for(let index=1;index<=4;index++){
    store.appendMessage(task.id,'user',`Detalhe recente da VESTE ${index}.`);
    store.appendMessage(task.id,'assistant',`Confirmação recente ${index}.`);
  }
  store.appendMessage(otherTask.id,'user','A referência antiga da VESTE é OTHER_REF_2840.');
  store.appendMessage(otherTask.id,'assistant','Registro da outra tarefa.');

  const boundary=store.messages(task.id,{limit:8})[0];
  const matches=store.searchHistoricalMessages(task.id,
    'Recupere o código da referência antiga citado no início desta tarefa.',{beforeMessage:boundary});
  assert.equal(matches.length,1);
  assert.equal(matches[0].id,old.id);
  assert.match(matches[0].excerpt,/VESTE_REF_7391/);
  assert.doesNotMatch(matches.map(message=>message.content).join('\n'),/OTHER_REF_2840/);

  const packet=store.buildContinuationPacket(task.id,
    'Recupere o código da referência antiga citado no início desta tarefa.');
  assert.ok(packet.manifest.retrievedMessageIds.includes(old.id));
  assert.match(packet.prompt,/VESTE_REF_7391/);
  assert.doesNotMatch(packet.prompt,/OTHER_REF_2840/);
  assert.equal(packet.manifest.historyWindowMessageCount,2);
  assert.equal(packet.manifest.historyWindowRetrievedCount,1);
  assert.equal(packet.manifest.historyWindowOmittedCount,1);
  assert.equal(packet.manifest.attachmentUseful,false);
});

test('historical search migration backfills an existing canonical SQLite without replacing message rows',t=>{
  const {dir,dbPath}=tempStore();
  let store=new Store(dbPath);
  cleanup(t,dir,()=>store);
  const task=store.createTask('Legacy history index');
  const old=store.appendMessage(task.id,'user','Marcador pesquisável legado: LEGACY_REF_6620.');
  store.appendMessage(task.id,'assistant','Recebido.');
  store.appendMessage(task.id,'user','Mensagem recente não relacionada.');

  // Recreate the database state from before the derived search index existed.
  store.db.exec(`DROP TRIGGER task_message_search_insert;
    DROP TRIGGER task_message_search_update;
    DROP TRIGGER task_message_search_delete;
    DROP TABLE task_message_search;
    DELETE FROM store_migrations WHERE name='task-message-search-fts-v1';`);
  const canonicalBefore=store.db.prepare('SELECT id,task_id,role,content,created_at,sequence FROM messages WHERE task_id=? ORDER BY sequence').all(task.id);
  store.close();

  store=new Store(dbPath);
  const canonicalAfter=store.db.prepare('SELECT id,task_id,role,content,created_at,sequence FROM messages WHERE task_id=? ORDER BY sequence').all(task.id);
  assert.deepEqual(canonicalAfter,canonicalBefore);
  const boundary=store.messages(task.id,{limit:1})[0];
  const matches=store.searchHistoricalMessages(task.id,'Localize o marcador pesquisável legado.',{beforeMessage:boundary});
  assert.equal(matches.length,1);
  assert.equal(matches[0].id,old.id);
  assert.match(matches[0].excerpt,/LEGACY_REF_6620/);

  store.appendMessage(task.id,'assistant','Outro texto indexado após a migração.');
  store.appendMessage(task.id,'user','Mensagem delimitadora posterior.');
  assert.equal(store.searchHistoricalMessages(task.id,'Localize o texto indexado após a migração.',
    {beforeMessage:store.messages(task.id,{limit:1})[0]}).length,1);
});
