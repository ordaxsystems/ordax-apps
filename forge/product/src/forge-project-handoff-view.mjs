import {forgeProjectFileReceiptView} from './forge-project-file-receipts.mjs';

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
  const recentFileWrites=forgeProjectFileReceiptView(store,projectId,{limit:8});
  const selectedTask=task?{
    taskId:task.id,title:task.title,kind:task.kind,localStatus:task.status,
    orchestratorId:task.orchestratorId,
    draft:excerpt(task.draft,1600),draftRevision:task.draftRevision
  }:null;
  return {
    schema:'ordax.forge.project-handoff/1',project,
    selectedTask,
    provenance:{source:'canonical_app_sqlite',createdFor:'read_only_continuity',
      providerMessagesAreNotArtifactProof:true,physicalFilesInspected:false,
      acceptanceCriteriaVerified:false,semanticReviewPerformed:false},
    counts,
    tasks:tasks.map(row=>({...row,physicalArtifactVerified:false,
      completionVerified:false})),
    recentMessages:messageRows.map(({content,...row})=>({...row,...excerpt(content)})),
    acceptedMemory:memories.map(({content,...row})=>({...row,...excerpt(content,1800),
      editorialNoteOnly:true,externalEffectVerified:false})),
    unresolvedCommands:unresolved,
    recentFileWriteReceipts:recentFileWrites.items,
    limits:{tasksTruncated:counts.tasks>tasks.length,
      messagesTruncated:counts.messages>messageRows.length,
      acceptedMemoryTruncated:counts.acceptedMemories>memories.length,
      unresolvedCommandsTruncated:counts.unresolvedCommands>unresolved.length,
      fileWriteReceiptsTruncated:recentFileWrites.truncated},
    nextSession:{automaticSendAllowed:false,automaticRotationPerformed:false,
      requiresExplicitAuthorizedChatSession:true,
      checkUncertainReceiptsBeforeRetry:unresolved.length>0,
      instruction:'Continue only within this project. Read missing history through authorized MCP tools; do not assume a provider reply proves a filesystem change.'}
  };
}
