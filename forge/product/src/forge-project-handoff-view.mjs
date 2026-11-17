import {forgeProjectFileReceiptView} from './forge-project-file-receipts.mjs';
import {forgeProjectMissionsView} from './forge-project-missions-view.mjs';

// Deterministic handoff read model. Rehydrates one project from canonical SQLite;
// it does not summarize with a model, rotate chats or verify external artifacts.
const excerpt=(value,max=1400)=>({
  content:String(value||'').slice(0,max),
  truncated:String(value||'').length>max
});

export function forgeProjectHandoffView(store,projectId,{taskId=null}={}) {
  if(typeof projectId!=='string'||!/^project_[A-Za-z0-9-]+$/.test(projectId))
    throw Error('forge_project_handoff_scope_invalid');
  const db=store.db,session=store.getWorkspaceSession().id;
  const project=db.prepare(`SELECT id,name,objective,repository_url AS repositoryUrl
    FROM lab_projects WHERE id=? AND workspace_session_id=?`).get(projectId,session);
  if(!project)throw Error('orchestrator_project_unavailable');
  const task=taskId==null?null:db.prepare(`SELECT t.id,t.title,t.status,b.kind,
    b.orchestrator_id AS orchestratorId,t.draft,t.draft_revision AS draftRevision
    FROM tasks t JOIN lab_task_bindings b ON b.task_id=t.id
    WHERE b.project_id=? AND t.workspace_session_id=? AND t.id=?`)
    .get(projectId,session,taskId);
  if(taskId!=null&&!task)throw Error('orchestrator_task_unavailable');
  const tasks=db.prepare(`SELECT t.id AS taskId,t.title,b.kind,t.status AS localStatus,
    (SELECT r.id FROM runs r WHERE r.task_id=t.id ORDER BY r.rowid DESC LIMIT 1) AS lastRunId,
    (SELECT r.status FROM runs r WHERE r.task_id=t.id ORDER BY r.rowid DESC LIMIT 1) AS lastRunStatus,
    (SELECT COUNT(*) FROM task_conversations c WHERE c.task_id=t.id) AS conversationSegments
    FROM lab_task_bindings b JOIN tasks t ON t.id=b.task_id
    WHERE b.project_id=? AND t.workspace_session_id=?
    ORDER BY t.updated_at DESC,t.rowid DESC LIMIT 24`).all(projectId,session);
  // The existing Forge worktree table is the only persisted source of
  // Task -> branch ownership. Historical metadata, never a live Git HEAD,
  // GitHub permission, PR or verification of task completion.
  const worktreeTable=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='forge_task_worktrees'").get();
  const worktreeRows=worktreeTable?db.prepare(`SELECT task_id AS taskId,
    branch_name AS branchName,base_head_sha AS baseHeadSha,
    status,updated_at AS recordedAt
    FROM forge_task_worktrees WHERE project_id=? AND workspace_session_id=?
    ORDER BY updated_at DESC,task_id LIMIT 256`).all(projectId,session):[];
  const branches=new Map(worktreeRows.map(row=>[row.taskId,{
    branchName:row.branchName,baseHeadSha:row.baseHeadSha,
    worktreeStatus:row.status,recordedAt:row.recordedAt,
    provenance:'forge_task_worktrees_sqlite',
    currentHeadVerified:false,pullRequestVerified:false
  }]));
  const messageRows=db.prepare(`SELECT m.id AS messageId,m.task_id AS taskId,m.role,
    m.content,m.sequence,m.created_at AS createdAt
    FROM messages m JOIN lab_task_bindings b ON b.task_id=m.task_id
    JOIN tasks t ON t.id=m.task_id
    WHERE b.project_id=? AND t.workspace_session_id=?
      AND (? IS NULL OR m.task_id=?)
    ORDER BY m.rowid DESC LIMIT 8`).all(projectId,session,taskId,taskId).reverse();
  const memories=db.prepare(`SELECT m.id,m.task_id AS taskId,m.category,
    m.memory_key AS key,m.content,m.source_type AS sourceType,m.source_ref AS sourceRef
    FROM project_memory_items m JOIN lab_task_bindings b ON b.task_id=m.task_id
    WHERE b.project_id=? AND m.status='active'
    ORDER BY m.updated_at DESC,m.rowid DESC LIMIT 12`).all(projectId);
  const unresolved=db.prepare(`SELECT id AS commandId,operation,status
    FROM lab_command_receipts WHERE project_id=? AND status IN ('running','uncertain')
    ORDER BY updated_at DESC,id DESC LIMIT 12`).all(projectId);
  const counts=db.prepare(`SELECT
    (SELECT COUNT(*) FROM lab_task_bindings WHERE project_id=?) AS tasks,
    (SELECT COUNT(*) FROM messages m JOIN lab_task_bindings b ON b.task_id=m.task_id
      WHERE b.project_id=? AND (? IS NULL OR m.task_id=?)) AS messages,
    (SELECT COUNT(*) FROM project_memory_items m JOIN lab_task_bindings b ON b.task_id=m.task_id
      WHERE b.project_id=? AND m.status='active') AS acceptedMemories,
    (SELECT COUNT(*) FROM project_memory_candidates c JOIN lab_task_bindings b ON b.task_id=c.task_id
      WHERE b.project_id=? AND c.status='pending') AS pendingSuggestions,
    (SELECT COUNT(*) FROM lab_command_receipts
      WHERE project_id=? AND status IN ('running','uncertain')) AS unresolvedCommands`)
    .get(projectId,projectId,taskId,taskId,projectId,projectId,projectId);
  // Task continuation can proceed while a *different* Task has an uncertain
  // provider send. The established receipt-scope view is the authority; do
  // not infer ownership from the truncated twelve-item diagnostic list.
  // Any unscoped send or non-send project effect still blocks every Task.
  const receiptAdmission=taskId===null?null:(()=>{
    const result=db.prepare(`SELECT
      COUNT(*) AS totalUnresolvedCommands,
      COALESCE(SUM(CASE
        WHEN operation IN ('work_send','proposal_send')
          AND task_id IS NOT NULL AND task_id!=? THEN 1 ELSE 0 END),0)
        AS unrelatedTaskWorkReceipts,
      COALESCE(SUM(CASE
        WHEN operation NOT IN ('work_send','proposal_send')
          OR task_id=? OR unknown_work_target=1 THEN 1 ELSE 0 END),0)
        AS blockingUnresolvedCommands
      FROM lab_command_receipt_scope
      WHERE project_id=? AND status IN ('running','uncertain')`)
      .get(taskId,taskId,projectId);
    return {schema:'ordax.forge.receipt-admission/1',projectId,taskId,
      source:'canonical_app_sqlite_lab_command_receipt_scope',
      totalUnresolvedCommands:result.totalUnresolvedCommands,
      blockingUnresolvedCommands:result.blockingUnresolvedCommands,
      unrelatedTaskWorkReceipts:result.unrelatedTaskWorkReceipts,
      // Read-only summary is not an execution lease or permission to send.
      taskLeaseGranted:false,providerMessagesSent:0};
  })();
  const recentFileWrites=forgeProjectFileReceiptView(store,projectId,{limit:8});
  const selectedTask=task?{
    taskId:task.id,title:task.title,kind:task.kind,localStatus:task.status,
    orchestratorId:task.orchestratorId,
    draft:excerpt(task.draft,1600),draftRevision:task.draftRevision
  }:null;
  return {
    schema:'ordax.forge.project-handoff/1',project,
    projectMissions:forgeProjectMissionsView(store,projectId),
    selectedTask,
    provenance:{source:'canonical_app_sqlite',createdFor:'read_only_continuity',
      providerMessagesAreNotArtifactProof:true,physicalFilesInspected:false,
      acceptanceCriteriaVerified:false,semanticReviewPerformed:false},
    counts,
    tasks:tasks.map(row=>({...row,branchEvidence:branches.get(row.taskId)||null,
      physicalArtifactVerified:false,completionVerified:false})),
    recentMessages:messageRows.map(({content,...row})=>({...row,...excerpt(content)})),
    acceptedMemory:memories.map(({content,...row})=>({...row,...excerpt(content,1800),
      editorialNoteOnly:true,externalEffectVerified:false})),
    unresolvedCommands:unresolved,
    receiptAdmission,
    recentFileWriteReceipts:recentFileWrites.items,
    limits:{tasksTruncated:counts.tasks>tasks.length,
      messagesTruncated:counts.messages>messageRows.length,
      acceptedMemoryTruncated:counts.acceptedMemories>memories.length,
      unresolvedCommandsTruncated:counts.unresolvedCommands>unresolved.length,
      fileWriteReceiptsTruncated:recentFileWrites.truncated},
    nextSession:{automaticSendAllowed:false,automaticRotationPerformed:false,
      requiresExplicitAuthorizedChatSession:true,
      checkUncertainReceiptsBeforeRetry:taskId===null
        ?counts.unresolvedCommands>0:receiptAdmission.blockingUnresolvedCommands>0,
      instruction:'Continue only within this project. Read missing history through authorized MCP tools; do not assume a provider reply proves a filesystem change.'}
  };
}
