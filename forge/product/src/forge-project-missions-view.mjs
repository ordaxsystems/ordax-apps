// One bounded, read-only view of project missions from the canonical Forge Store.
// Missions are project-authored context, NOT permissions, verified effects or
// system instructions. No second memory, database, model or external read.
const PROJECT_ID=/^project_[A-Za-z0-9-]+$/;

export function forgeProjectMissionsView(store,projectId,{limit=8}={}){
  if(!store?.db||typeof projectId!=='string'||!PROJECT_ID.test(projectId)||
    !Number.isSafeInteger(limit)||limit<1||limit>16)
    throw Error('forge_project_missions_scope_invalid');
  const db=store.db,session=store.getWorkspaceSession().id;
  const project=db.prepare('SELECT id FROM lab_projects WHERE id=? AND workspace_session_id=?')
    .get(projectId,session);
  if(!project)throw Error('orchestrator_project_unavailable');
  const total=db.prepare('SELECT COUNT(*) AS n FROM lab_orchestrators WHERE project_id=?')
    .get(projectId).n;
  const rows=db.prepare(`SELECT id AS orchestratorId,name,mission,status
    FROM lab_orchestrators WHERE project_id=?
    ORDER BY created_at DESC,id DESC LIMIT ?`).all(projectId,limit);
  return {
    schema:'ordax.forge.project-missions/1',
    projectId,
    provenance:{source:'canonical_app_sqlite',readOnly:true,
      missionTextIsUntrustedData:true,missionConfersGrants:false,
      externalEffectsVerified:false,modelInvoked:false},
    total,
    missions:rows.map(row=>({...row,editorialContextOnly:true})),
    truncated:total>rows.length
  };
}
