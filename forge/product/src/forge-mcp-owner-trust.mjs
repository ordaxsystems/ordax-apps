// Owner consent is durable, scope-bound metadata, never an MCP bearer token.
import {createHash} from 'node:crypto';
// This table belongs to the existing Forge SQLite; no extra profile/database.
const PROJECT=/^project_[a-zA-Z0-9-]{1,100}$/;

export class ForgeMcpOwnerTrust {
  constructor({store,scopeSignature,appIdentity=null}={}){
    if(typeof scopeSignature!=='function')throw Error('forge_mcp_trust_scope_required');
    this.scopeSignature=scopeSignature;
    if(!store?.db||typeof store.getWorkspaceSession!=='function')
      throw Error('forge_mcp_trust_store_required');
    this.store=store;
    this.db=store.db;
    this.appIdentity=appIdentity;
    if(appIdentity!==null&&(typeof appIdentity!=='string'||!appIdentity||appIdentity.length>4096))
      throw Error('forge_mcp_app_identity_invalid');
    // One app approval, independent of the number of current/future projects.
    // Old project approvals never silently become an app-wide grant.
    this.db.exec(`CREATE TABLE IF NOT EXISTS forge_mcp_app_owner_approval(
      workspace_session_id TEXT PRIMARY KEY REFERENCES workspace_sessions(id) ON DELETE CASCADE,
      scope_hash TEXT NOT NULL,
      approved_at TEXT NOT NULL
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS forge_mcp_owner_approvals(
      project_id TEXT PRIMARY KEY REFERENCES lab_projects(id) ON DELETE CASCADE,
      workspace_session_id TEXT NOT NULL REFERENCES workspace_sessions(id),
      scope_hash TEXT NOT NULL,
      approved_at TEXT NOT NULL
    )`);
  }
  appScopeHash(){
    const session=this.currentSession();
    if(!this.appIdentity)throw Error('forge_mcp_app_identity_unavailable');
    return createHash('sha256').update('forge-app-mcp/1\\n'+session.id+'\\n'+this.appIdentity).digest('hex');
  }
  isAppTrusted(){
    const session=this.currentSession();
    return Boolean(this.db.prepare('SELECT 1 FROM forge_mcp_app_owner_approval WHERE workspace_session_id=? AND scope_hash=?')
      .get(session.id,this.appScopeHash()));
  }
  trustApp({expectedScopeHash=null}={}){
    const session=this.currentSession();
    const scopeHash=this.appScopeHash();
    if(expectedScopeHash!==null&&expectedScopeHash!==scopeHash)
      throw Error('forge_mcp_consent_scope_changed');
    this.db.prepare(`INSERT INTO forge_mcp_app_owner_approval
      (workspace_session_id,scope_hash,approved_at) VALUES(?,?,?)
      ON CONFLICT(workspace_session_id) DO UPDATE SET scope_hash=excluded.scope_hash,
      approved_at=excluded.approved_at`).run(session.id,scopeHash,this.store.now());
    return {appTrusted:true,credentialsPersisted:false};
  }
  revokeApp(){
    const session=this.currentSession();
    const result=this.db.prepare('DELETE FROM forge_mcp_app_owner_approval WHERE workspace_session_id=?')
      .run(session.id);
    return {appTrusted:false,trustRevoked:result.changes===1};
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
  trust(projectId,{expectedScopeHash=null}={}){
    const session=this.project(projectId);
    const currentScopeHash=this.scopeHash(projectId);
    // The Owner approved the scope shown BEFORE a native confirmation.
    // A moved/rebound workspace must not inherit consent mid-dialog.
    if(expectedScopeHash!==null&&expectedScopeHash!==currentScopeHash)
      throw Error('forge_mcp_consent_scope_changed');
    this.db.prepare(`INSERT INTO forge_mcp_owner_approvals
      (project_id,workspace_session_id,scope_hash,approved_at)
      VALUES(?,?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET
        workspace_session_id=excluded.workspace_session_id,
        scope_hash=excluded.scope_hash,
        approved_at=excluded.approved_at`
    ).run(projectId,session.id,currentScopeHash,this.store.now());
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
