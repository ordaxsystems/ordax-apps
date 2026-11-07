// The durable continuation consent is per project AND coordinator. A process-wide
// Groq chat switch never substitutes for an explicit project automation opt-in.
// This predicate grants API analysis/proposals only; no GPT sends or device actions.
export function projectCoordinatorContinuationEnabled(db, projectId, orchestratorId) {
  if (!db?.prepare || typeof projectId !== 'string' || !projectId ||
      typeof orchestratorId !== 'string' || !orchestratorId) return false;
  // Initialization may precede the continuation schema on fresh profiles.
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='lab_continuation_policies'").get())
    return false;
  return Boolean(db.prepare(`SELECT 1 FROM lab_continuation_policies p
    JOIN lab_orchestrators o ON o.id=p.orchestrator_id AND o.project_id=p.project_id
    WHERE p.project_id=? AND p.orchestrator_id=? AND p.enabled=1
    AND o.status='ready' LIMIT 1`).get(projectId,orchestratorId));
}
