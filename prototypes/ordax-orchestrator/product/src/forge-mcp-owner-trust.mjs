// Owner consent is durable, scope-bound metadata, never an MCP bearer token.
import {createHash} from 'node:crypto';
// This table belongs to the existing Forge SQLite; no extra profile/database.
const PROJECT=/^project_[a-zA-Z0-9-]{1,100}$/;

export class ForgeMcpOwnerTrust {
  constructor({store,scopeSignature}={}){
    if(typeof scopeSignature!=='function')throw Error('forge_mcp_trust_scope_required');
    this.scopeSignature=scopeSignature;
    if(!store?.db||typeof store.getWorkspaceSession!=='function')
      throw Error('forge_mcp_trust_store_required');
    this.store=store;
    this.db=store.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS forge_mcp_owner_approvals(
      project_id TEXT PRIMARY KEY REFERENCES lab_projects(id) ON DELETE CASCADE,
      workspace_session_id TEXT NOT NULL REFERENCES workspace_sessions(id),
      scope_hash TEXT NOT NULL,
      approved_at TEXT NOT NULL
    )`);
  }
  currentSession(){
    const session=this.store.getWorkspaceSession();
    if(!session||session.status!=='active')throw Error('forge_mcp_trust_session_unavailable');
    return session;
  }
  project(projectId){
    if(typeof projectId!=='string'||!PROJECT.test(projectId))
      throw Error('forge_mcp_trust_project_invalid');
    const session=this.currentSession();
    const project=this.db.prepare(
      'SELECT id FROM lab_projects WHERE id=? AND workspace_session_id=?'
    ).get(projectId,session.id);
    if(!project)throw Error('forge_mcp_trust_project_unavailable');
    return session;
  }
  scopeHash(projectId){
    const scope=this.scopeSignature(projectId);
    if(typeof scope!=='string'||!scope||scope.length>4096)
      throw Error('forge_mcp_trust_scope_invalid');
    return createHash('sha256').update(projectId+'\\n'+scope).digest('hex');
  }
  isTrusted(projectId){
    const session=this.project(projectId);
    return Boolean(this.db.prepare(
      'SELECT 1 FROM forge_mcp_owner_approvals WHERE project_id=? AND workspace_session_id=? AND scope_hash=?'
    ).get(projectId,session.id,this.scopeHash(projectId)));
  }
  trust(projectId){
    const session=this.project(projectId);
    this.db.prepare(`INSERT INTO forge_mcp_owner_approvals
      (project_id,workspace_session_id,scope_hash,approved_at)
      VALUES(?,?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET
        workspace_session_id=excluded.workspace_session_id,
        scope_hash=excluded.scope_hash,
        approved_at=excluded.approved_at`
    ).run(projectId,session.id,this.scopeHash(projectId),this.store.now());
    return {projectId,trusted:true,credentialsPersisted:false};
  }
  revoke(projectId){
    const session=this.currentSession();
    if(typeof projectId!=='string'||!PROJECT.test(projectId))
      throw Error('forge_mcp_trust_project_invalid');
    const result=this.db.prepare(
      'DELETE FROM forge_mcp_owner_approvals WHERE project_id=? AND workspace_session_id=?'
    ).run(projectId,session.id);
    return {projectId,trustRevoked:result.changes===1};
  }
  trustedProjects(){
    const session=this.currentSession();
    return this.db.prepare(`SELECT a.project_id AS id,a.scope_hash AS scopeHash FROM forge_mcp_owner_approvals a
      JOIN lab_projects p ON p.id=a.project_id
      WHERE a.workspace_session_id=? AND p.workspace_session_id=?
      ORDER BY a.project_id`
    ).all(session.id,session.id).filter(row=>{
      try{return this.scopeHash(row.id)===row.scopeHash;}catch{return false;}
    }).map(row=>row.id);
  }
}
