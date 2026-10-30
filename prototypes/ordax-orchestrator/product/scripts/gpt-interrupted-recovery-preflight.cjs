// Canonical, SQLite-backed preflight shared by the physical read-only
// certifier and isolated restart tests. The caller owns the DB lifetime.
// This module NEVER navigates, submits, authenticates or mutates the ledger.
function readInterruptedRecoverySnapshot(db, expectedTaskId) {
  if(!db||!/^task_[0-9a-f-]{20,80}$/i.test(String(expectedTaskId||'')))
    throw Error('lab_recovery_explicit_task_approval_required');
    const task=db.prepare('SELECT id,status,chat_url FROM tasks WHERE id=?').get(expectedTaskId);
    if(!task?.chat_url||!['error','interrupted'].includes(task.status))
      throw Error('lab_recovery_interrupted_task_required');
    const message=db.prepare("SELECT id FROM messages WHERE task_id=? AND role='user' ORDER BY sequence DESC LIMIT 1").get(expectedTaskId);
    const run=db.prepare('SELECT id,status FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 1').get(expectedTaskId);
    if(!message||!run||!['failed','interrupted'].includes(run.status))
      throw Error('lab_recovery_failed_run_required');
    const receipt=db.prepare("SELECT json_extract(payload,'$.run_id') AS run_id, json_extract(payload,'$.message_id') AS message_id, json_extract(payload,'$.conversation_id') AS conversation_id, json_extract(payload,'$.prompt_sha256') AS prompt_sha256, json_extract(payload,'$.submitted_at') AS submitted_at FROM events WHERE task_id=? AND kind='provider.submission.provenance' AND json_extract(payload,'$.message_id')=? ORDER BY seq DESC LIMIT 1").get(expectedTaskId,message.id);
    const active=db.prepare("SELECT id FROM task_conversations WHERE task_id=? AND status='active' AND chat_url=? ORDER BY sequence DESC LIMIT 1").get(expectedTaskId,task.chat_url);
    if(!receipt||receipt.run_id!==run.id||receipt.message_id!==message.id||
       receipt.conversation_id!==active?.id||!/^[a-f0-9]{64}$/.test(receipt.prompt_sha256||'')||
       !Number.isSafeInteger(receipt.submitted_at)||receipt.submitted_at<=0)
      throw Error('lab_recovery_verified_receipt_required');
    const count=(query,...args)=>db.prepare(query).get(...args).n;
    return {
      runStatus:run.status,taskStatus:task.status,
      lastUserId:message.id,runId:run.id,
      totalMessages:count('SELECT COUNT(*) n FROM messages'),
      taskAssistants:count("SELECT COUNT(*) n FROM messages WHERE task_id=? AND role='assistant'",expectedTaskId),
      allRuns:count('SELECT COUNT(*) n FROM runs'),
      taskCheckpoints:count('SELECT COUNT(*) n FROM checkpoints WHERE task_id=?',expectedTaskId),
      allActions:count('SELECT COUNT(*) n FROM action_ledger'),
      reconciled:count("SELECT COUNT(*) n FROM events WHERE task_id=? AND kind='provider.response.reconciled'",expectedTaskId)
    };
}

module.exports={readInterruptedRecoverySnapshot};
