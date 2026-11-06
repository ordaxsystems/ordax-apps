// Read-only project memory assembled from the ONE canonical Store.
// No copied summaries, inferred filesystem state or independent memory DB.
export function forgeProjectMemoryView(store,projectId,{maxItems=24,maxRuns=12}={}) {
  if(typeof projectId!=='string'||!/^project_[A-Za-z0-9-]+$/.test(projectId))
    throw Error('forge_project_memory_scope_invalid');
  const db=store.db;
  const memory=db.prepare(`SELECT m.id,m.task_id,m.category,m.memory_key AS key,m.content,
    m.source_type,m.source_ref,m.updated_at
    FROM project_memory_items m JOIN lab_task_bindings b ON b.task_id=m.task_id
    WHERE b.project_id=? AND m.status='active'
    ORDER BY m.updated_at DESC,m.id DESC LIMIT ?`)
    .all(projectId,Math.min(40,Math.max(1,maxItems)));
  const pending=db.prepare(`SELECT c.id,c.task_id,c.category,c.memory_key AS key,
    c.source_message_id,c.created_at
    FROM project_memory_candidates c JOIN lab_task_bindings b ON b.task_id=c.task_id
    WHERE b.project_id=? AND c.status='pending'
    ORDER BY c.created_at DESC,c.id DESC LIMIT ?`)
    .all(projectId,Math.min(40,Math.max(1,maxItems)));
  const runs=db.prepare(`SELECT r.id AS runId,r.task_id AS taskId,r.status,r.started_at AS startedAt
    FROM runs r JOIN lab_task_bindings b ON b.task_id=r.task_id
    WHERE b.project_id=? ORDER BY r.started_at DESC,r.id DESC LIMIT ?`)
    .all(projectId,Math.min(24,Math.max(1,maxRuns)));
  const counts=db.prepare(`SELECT
    (SELECT COUNT(*) FROM lab_task_bindings WHERE project_id=? AND kind='work') AS works,
    (SELECT COUNT(*) FROM messages m JOIN lab_task_bindings b ON b.task_id=m.task_id
      WHERE b.project_id=?) AS messages,
    (SELECT COUNT(*) FROM runs r JOIN lab_task_bindings b ON b.task_id=r.task_id
      WHERE b.project_id=?) AS runs,
    (SELECT COUNT(*) FROM project_memory_items m JOIN lab_task_bindings b ON b.task_id=m.task_id
      WHERE b.project_id=? AND m.status='active') AS canonicalMemories,
    (SELECT COUNT(*) FROM project_memory_candidates c JOIN lab_task_bindings b ON b.task_id=c.task_id
      WHERE b.project_id=? AND c.status='pending') AS pendingSuggestions`)
    .get(projectId,projectId,projectId,projectId,projectId);
  return {
    schema:'ordax.forge.project-memory/1',projectId,
    provenance:{source:'canonical_app_sqlite',externalFilesInspected:false,
      gptClaimsAreVerifiedEffects:false,remoteReadPerformed:false},
    counts,
    canonical:memory.map(row=>({...row,verifiedExternalEffect:false})),
    suggested:pending.map(row=>({...row,status:'requires_review',
      verifiedExternalEffect:false})),
    recentRuns:runs.map(row=>({...row,responseMayBeObserved:row.status==='succeeded',
      externalEffectVerified:false})),
    limitations:{
      missingItemsBeyondPage:counts.canonicalMemories>memory.length||counts.pendingSuggestions>pending.length,
      externalArtifactVerification:'not_in_this_read_model',
      memoryEdits:'existing_candidate_review_workflow_only',
      administratorModel:'not_invoked'
    }
  };
}
