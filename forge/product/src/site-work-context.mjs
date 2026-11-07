// Single project-scoped read model for continuing a real site in its
// existing GPT conversation. A text claim alone is never an artifact.
export function latestSiteWork(store,projectId,orchestratorId){
  if(!store?.db||typeof projectId!=='string'||typeof orchestratorId!=='string')
    return null;
  const row=store.db.prepare(`SELECT t.id AS taskId,t.chat_url AS chatUrl,
        a.id AS assetId,a.sha256 AS sha256,a.created_at AS assetCreatedAt,
        (SELECT r.id FROM runs r WHERE r.task_id=t.id ORDER BY r.rowid DESC LIMIT 1) AS latestRunId,
        (SELECT r.status FROM runs r WHERE r.task_id=t.id ORDER BY r.rowid DESC LIMIT 1) AS latestRunStatus
      FROM lab_task_bindings b
      JOIN tasks t ON t.id=b.task_id
      JOIN message_assets a ON a.task_id=t.id
      JOIN messages m ON m.id=a.message_id AND m.task_id=t.id AND m.role='assistant'
      WHERE b.project_id=? AND b.orchestrator_id=? AND b.kind='work'
        AND t.workspace_session_id=? AND a.kind='file' AND a.mime_type='text/html'
        AND a.sha256 IS NOT NULL AND length(a.sha256)=64
        AND t.chat_url LIKE 'https://chatgpt.com/c/%'
      ORDER BY a.rowid DESC LIMIT 1`).get(projectId,orchestratorId,
      store.getWorkspaceSession()?.id);
  if(!row||row.latestRunStatus!=='succeeded'||
     !store.db.prepare('SELECT 1 FROM conversation_completed_runs WHERE run_id=? AND task_id=?')
       .get(row.latestRunId,row.taskId))return null;
  return Object.freeze({...row});
}
