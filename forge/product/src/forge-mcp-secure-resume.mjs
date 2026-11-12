// Optional Owner-initiated reconnect of the SAME Forge MCP listener.
// Credentials are sealed with Windows DPAPI by Electron.safeStorage.
// No plain bearer in SQLite, logs, environment, argv or a second app.
const TOKEN=/^[A-Za-z0-9_-]{40,128}$/;
const PROJECT=/^project_[a-zA-Z0-9-]{1,100}$/;
function validPort(port){return Number.isInteger(port)&&port>=1024&&port<=65535;}
export class ForgeMcpSecureResume {
  constructor({store,ownerTrust,secureStorage,platform=process.platform}={}){
    this.platform=platform;
    if(!store?.db||!ownerTrust||!secureStorage||
       typeof secureStorage.isEncryptionAvailable!=='function'||
       typeof secureStorage.encryptString!=='function'||
       typeof secureStorage.decryptString!=='function')
      throw Error('forge_mcp_resume_ports_required');
    this.db=store.db;
    this.store=store;
    this.ownerTrust=ownerTrust;
    this.secureStorage=secureStorage;
    this.db.exec(`CREATE TABLE IF NOT EXISTS forge_mcp_secure_resume(
      project_id TEXT PRIMARY KEY REFERENCES forge_mcp_owner_approvals(project_id) ON DELETE CASCADE,
      scope_hash TEXT NOT NULL,
      sealed_bearer BLOB NOT NULL,
      port INTEGER NOT NULL CHECK(port BETWEEN 1024 AND 65535)
    )`);
  }
  // One Windows-sealed token for the app, never one token per project.
  appSession(){return this.store.getWorkspaceSession().id;}
  appResumeRow(){
    this.db.exec(`CREATE TABLE IF NOT EXISTS forge_mcp_app_secure_resume(
      workspace_session_id TEXT PRIMARY KEY REFERENCES forge_mcp_app_owner_approval(workspace_session_id) ON DELETE CASCADE,
      scope_hash TEXT NOT NULL,sealed_bearer BLOB NOT NULL,
      port INTEGER NOT NULL CHECK(port BETWEEN 1024 AND 65535)
    )`);
    return this.db.prepare('SELECT scope_hash,sealed_bearer,port FROM forge_mcp_app_secure_resume WHERE workspace_session_id=?')
      .get(this.appSession());
  }
  enabledApp(){
    if(!this.supported()||!this.ownerTrust.isAppTrusted())return false;
    const row=this.appResumeRow();
    return Boolean(row&&row.scope_hash===this.ownerTrust.appScopeHash()&&validPort(row.port));
  }
  enableApp({projectId,token,port}={}){
    if(!this.supported())throw Error('forge_mcp_resume_windows_protection_unavailable');
    if(projectId!=='forge_app'||!this.ownerTrust.isAppTrusted())
      throw Error('forge_mcp_resume_app_trust_required');
    if(typeof token!=='string'||!TOKEN.test(token)||!validPort(port))
      throw Error('forge_mcp_resume_grant_invalid');
    const bytes=this.secureStorage.encryptString(token);
    if(!Buffer.isBuffer(bytes)||bytes.length<32||bytes.equals(Buffer.from(token)))
      throw Error('forge_mcp_resume_seal_failed');
    this.appResumeRow(); // Prepare schema without introducing another storage service.
    this.db.prepare(`INSERT INTO forge_mcp_app_secure_resume
      (workspace_session_id,scope_hash,sealed_bearer,port) VALUES(?,?,?,?)
      ON CONFLICT(workspace_session_id) DO UPDATE SET scope_hash=excluded.scope_hash,
      sealed_bearer=excluded.sealed_bearer,port=excluded.port`)
      .run(this.appSession(),this.ownerTrust.appScopeHash(),bytes,port);
    return {autoResume:true,secretEncrypted:true};
  }
  disableApp(){
    this.appResumeRow();
    return {autoResume:false,removed:this.db.prepare('DELETE FROM forge_mcp_app_secure_resume WHERE workspace_session_id=?')
      .run(this.appSession()).changes};
  }
  recoverApp(){
    if(!this.enabledApp())return null;
    const row=this.appResumeRow();
    try{
      if(!(row.sealed_bearer instanceof Uint8Array))return null;
      const token=this.secureStorage.decryptString(Buffer.from(row.sealed_bearer));
      if(!TOKEN.test(token))return null;
      return {projectId:'forge_app',token,port:row.port};
    }catch{return null;}
  }
  supported(){return this.platform==='win32'&&this.secureStorage.isEncryptionAvailable();}
  enabledProjects(){
    const approved=new Set(this.ownerTrust.trustedProjects());
    return this.db.prepare('SELECT project_id,scope_hash FROM forge_mcp_secure_resume ORDER BY project_id')
      .all().filter(row=>approved.has(row.project_id)&&
        row.scope_hash===this.ownerTrust.scopeHash(row.project_id))
      .map(row=>row.project_id);
  }
  enable({projectId,token,port}={}){
    if(!this.supported())throw Error('forge_mcp_resume_windows_protection_unavailable');
    if(typeof projectId!=='string'||!PROJECT.test(projectId)||
       !this.ownerTrust.isTrusted(projectId))throw Error('forge_mcp_resume_owner_trust_required');
    if(typeof token!=='string'||!TOKEN.test(token)||!validPort(port))
      throw Error('forge_mcp_resume_grant_invalid');
    const existing=this.db.prepare('SELECT DISTINCT port FROM forge_mcp_secure_resume').all();
    if(existing.some(row=>row.port!==port))
      throw Error('forge_mcp_resume_port_mismatch');
    const protectedBytes=this.secureStorage.encryptString(token);
    if(!Buffer.isBuffer(protectedBytes)||protectedBytes.length<32||
        protectedBytes.equals(Buffer.from(token)))
      throw Error('forge_mcp_resume_seal_failed');
    this.db.prepare(`INSERT INTO forge_mcp_secure_resume
      (project_id,scope_hash,sealed_bearer,port) VALUES(?,?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET scope_hash=excluded.scope_hash,
        sealed_bearer=excluded.sealed_bearer,port=excluded.port`
    ).run(projectId,this.ownerTrust.scopeHash(projectId),protectedBytes,port);
    return {projectId,autoResume:true,secretEncrypted:true};
  }
  disableAll(){
    const removed=this.db.prepare('DELETE FROM forge_mcp_secure_resume').run();
    return {autoResume:false,removed:removed.changes+this.disableApp().removed};
  }
  disable(projectId){
    if(typeof projectId!=='string'||!PROJECT.test(projectId))
      throw Error('forge_mcp_resume_project_invalid');
    const result=this.db.prepare('DELETE FROM forge_mcp_secure_resume WHERE project_id=?').run(projectId);
    return {projectId,autoResume:false,removed:result.changes===1};
  }
  recover(){
    if(!this.supported())return [];
    const approved=new Set(this.ownerTrust.trustedProjects());
    const rows=this.db.prepare('SELECT project_id,scope_hash,sealed_bearer,port FROM forge_mcp_secure_resume ORDER BY project_id').all();
    const output=[];
    for(const row of rows){
      if(!approved.has(row.project_id)||!validPort(row.port))continue;
      try{
        if(this.ownerTrust.scopeHash(row.project_id)!==row.scope_hash)continue;
        if(!(row.sealed_bearer instanceof Uint8Array))continue;
        const token=this.secureStorage.decryptString(Buffer.from(row.sealed_bearer));
        if(!TOKEN.test(token))continue;
        if(output.length&&row.port!==output[0].port)return [];
        output.push({projectId:row.project_id,token,port:row.port});
        if(output.length>=8)break;
      }catch{continue;} // Corrupt/stale DPAPI blob never enables access.
    }
    return output;
  }
}
