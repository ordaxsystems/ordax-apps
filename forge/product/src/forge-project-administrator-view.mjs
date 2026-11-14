import {forgeProjectMemoryView} from './forge-project-memory-view.mjs';
import {forgeProjectFileReceiptView} from './forge-project-file-receipts.mjs';

// A project-wide, bounded read of real app evidence for the optional GPT Admin.
// This does NOT run a model, read external files, or decide that work is done.
export function forgeProjectAdministratorView(store,projectId) {
  const db=store.db;
  const project=db.prepare(`SELECT id,name,objective,repository_url AS repositoryUrl
    FROM lab_projects WHERE id=? AND workspace_session_id=?`)
    .get(projectId,store.getWorkspaceSession().id);
  if(!project)throw Error('orchestrator_project_unavailable');
  const works=db.prepare(`SELECT t.id AS taskId,t.title,t.status AS localStatus,
    (SELECT r.id FROM runs r WHERE r.task_id=t.id ORDER BY r.rowid DESC LIMIT 1) AS lastRunId,
    (SELECT r.status FROM runs r WHERE r.task_id=t.id ORDER BY r.rowid DESC LIMIT 1) AS lastRunStatus,
    (SELECT COUNT(*) FROM task_conversations c WHERE c.task_id=t.id) AS providerConversations
    FROM lab_task_bindings b JOIN tasks t ON t.id=b.task_id
    WHERE b.project_id=? AND b.kind='work' AND t.workspace_session_id=?
    ORDER BY t.updated_at DESC,t.id DESC LIMIT 24`).all(projectId,store.getWorkspaceSession().id);
  const unresolved=db.prepare(`SELECT id AS commandId,operation,status,updated_at AS updatedAt
    FROM lab_command_receipts WHERE project_id=? AND status IN ('running','uncertain')
    ORDER BY updated_at DESC,id DESC LIMIT 16`).all(projectId);
  const totals=db.prepare(`SELECT
    (SELECT COUNT(*) FROM lab_task_bindings b WHERE b.project_id=? AND b.kind='work') AS works,
    (SELECT COUNT(*) FROM lab_command_receipts WHERE project_id=?
      AND status IN ('running','uncertain')) AS unresolvedCommands,
    (SELECT COUNT(*) FROM lab_orchestrators WHERE project_id=?) AS coordinatorConversations`)
    .get(projectId,projectId,projectId);
  const memory=forgeProjectMemoryView(store,projectId,{maxItems:16,maxRuns:8});
  const recentFileWrites=forgeProjectFileReceiptView(store,projectId,{limit:12});
  return {
    schema:'ordax.forge.project-administrator/1',project,
    provenance:{source:'canonical_app_sqlite',externalFilesInspected:false,
      authenticatedRemoteRepositoryRead:false,semanticReviewPerformed:false,
      acceptanceCriteriaVerified:false},
    totals:{...totals,messages:memory.counts.messages,runs:memory.counts.runs,
      acceptedNotes:memory.counts.canonicalMemories,pendingNotes:memory.counts.pendingSuggestions},
    works:works.map(row=>({...row,
      providerReplyIsCompletionProof:false,physicalArtifactVerified:false})),
    unresolvedCommands:unresolved,
    recentFileWriteReceipts:recentFileWrites.items,
    memory:{accepted:memory.canonical,pending:memory.suggested},
    limits:{worksTruncated:totals.works>works.length,
      unresolvedTruncated:totals.unresolvedCommands>unresolved.length,
      memoryTruncated:memory.limitations.missingItemsBeyondPage,
      fileWriteReceiptsTruncated:recentFileWrites.truncated},
    administrator:{
      role:'optional_gpt_semantic_review',status:'not_invoked',
      canProposeMemory:true,canApproveMemory:false,
      canVerifyPhysicalArtifacts:false,canAutomaticallyDispatch:false,
      nextStep:'Review this evidence and ask for more authorized MCP reads if needed. Any proposed memory note must quote a persisted assistant message and remain pending for review.'
    }
  };
}
