// Project-owned SQLite deletion. Caller provides an authorized project-scoped
// BEGIN IMMEDIATE transaction and retains only its generic deletion receipt.
// No host paths, credentials, grants or external workspaces are removed here.
export function deleteProjectRecords(db,{projectId,workspaceSessionId,confirmName}) {
  const project=db.prepare('SELECT name,observation_requested FROM lab_projects WHERE id=? AND workspace_session_id=?')
    .get(projectId,workspaceSessionId);
  if(!project || project.name!==confirmName)throw Error('orchestrator_project_delete_confirmation_invalid');
  if(project.observation_requested===1)throw Error('orchestrator_project_delete_observation_active');
  if(db.prepare('SELECT 1 FROM lab_project_workspaces WHERE project_id=? LIMIT 1').get(projectId))
    throw Error('orchestrator_project_delete_workspace_bound');
  if(db.prepare("SELECT 1 FROM lab_command_receipts WHERE project_id=? AND status IN ('running','uncertain') LIMIT 1").get(projectId))
    throw Error('orchestrator_project_delete_commands_unresolved');
  if(db.prepare("SELECT 1 FROM runs r JOIN lab_task_bindings b ON b.task_id=r.task_id WHERE b.project_id=? AND r.status='running' LIMIT 1").get(projectId))
    throw Error('orchestrator_project_delete_run_active');
  const taskIds=db.prepare('SELECT task_id FROM lab_task_bindings WHERE project_id=?').all(projectId).map(r=>r.task_id);
  const taskParams=taskIds.map(()=>'?').join(',');
  // Live work is fenced above. Every child table without ON DELETE CASCADE
  // is removed before its owner; task-owned Store records cascade normally.
  const remove=(sql,...values)=>db.prepare(sql).run(...values);
  remove('DELETE FROM lab_autonomous_story_quality WHERE mission_id IN (SELECT id FROM lab_autonomous_dialogues WHERE project_id=?)',projectId);
  remove('DELETE FROM lab_autonomous_story_turns WHERE mission_id IN (SELECT id FROM lab_autonomous_dialogues WHERE project_id=?)',projectId);
  for(const table of ['lab_next_proposals','lab_continuation_reviews','lab_next_proposal_policy',
    'lab_continuation_policies','lab_work_dependencies','lab_autonomous_dialogues',
    'lab_command_receipts','lab_repository_head_evidence'])
    remove('DELETE FROM '+table+' WHERE project_id=?',projectId);
  // Project resource grants are intentionally NOT revoked by this API.
  // Projects with a live workspace binding were rejected above.
  if(taskIds.length){
    remove('DELETE FROM project_memory_candidates WHERE task_id IN ('+taskParams+')',...taskIds);
    remove('DELETE FROM events WHERE task_id IN ('+taskParams+')',...taskIds);
  }
  remove('DELETE FROM lab_task_bindings WHERE project_id=?',projectId);
  remove('DELETE FROM lab_orchestrators WHERE project_id=?',projectId);
  if(taskIds.length)remove('DELETE FROM tasks WHERE id IN ('+taskParams+')',...taskIds);
  if(remove('DELETE FROM lab_projects WHERE id=? AND workspace_session_id=?',projectId,workspaceSessionId).changes!==1)
    throw Error('orchestrator_project_delete_state_conflict');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('orchestrator_project_delete_foreign_key_violation');
  return {projectId,deleted:true,tasksRemoved:taskIds.length,
    externalFilesRemoved:false,workspaceGrantsChanged:false,providerMessagesSent:0};
}
