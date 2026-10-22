// Project-scoped, read-only workspace binding projection. The Runtime/Platform
// issue grants and resolve resource IDs. This file never uses fs, paths or shell.
import {randomUUID} from 'node:crypto';

const IDENTIFIER=/^[A-Za-z0-9_-]{1,180}$/;
const RESOURCE=/^resource_[A-Za-z0-9_-]{8,160}$/;
const PROJECT_STATES=new Set(['connected','offline','denied','revoked','moved','unavailable']);
const string=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);
function identity(context,projectId) {
  if(!context||!IDENTIFIER.test(projectId)||!string(context.actorId,180)||
    !string(context.clientId,180)||!string(context.workspaceSessionId,180))
    throw Error('workspace_invalid_context');
  return {actorId:context.actorId,clientId:context.clientId,
    workspaceSessionId:context.workspaceSessionId,projectId};
}
function verifiedProof(proof,context,projectId,deviceId,resourceId) {
  const who=identity(context,projectId);
  if(proof?.authorized!==true||proof?.deviceId!==deviceId||
    proof?.resourceId!==resourceId||proof?.projectId!==projectId||
    proof?.actorId!==who.actorId||proof?.clientId!==who.clientId||
    proof?.workspaceSessionId!==who.workspaceSessionId)
    throw Error('workspace_grant_unverified');
}
function cleanSnapshot(result,deviceId,resourceId) {
  if(result?.authorized!==true||result.deviceId!==deviceId||
    result.resourceId!==resourceId)
    throw Error('workspace_snapshot_unverified');
  if(!PROJECT_STATES.has(result.state))throw Error('workspace_snapshot_invalid');
  if(result.state!=='connected')return {state:result.state,verified:false};
  const revision=result.revision,observedAt=result.observedAt;
  if(!string(revision,128)||!/^[A-Za-z0-9_.:-]+$/.test(revision)||
    !string(observedAt,40)||!Number.isFinite(Date.parse(observedAt))||
    !Number.isSafeInteger(result.fileCount)||result.fileCount<0||result.fileCount>100000000||
    !Number.isSafeInteger(result.changedCount)||result.changedCount<0||result.changedCount>100000000||
    !result.git||typeof result.git!=='object'||Array.isArray(result.git))
    throw Error('workspace_snapshot_invalid');
  const {git}=result;
  if(typeof git.isRepository!=='boolean'||(git.isRepository&&(!string(git.branch,140)||
    !/^[A-Za-z0-9_.\/-]+$/.test(git.branch)||!string(git.head,64)||
    !/^[a-fA-F0-9]{7,64}$/.test(git.head))))
    throw Error('workspace_snapshot_invalid');
  return {state:'connected',verified:true,revision,observedAt,
    fileCount:result.fileCount,changedCount:result.changedCount,
    git:git.isRepository?{isRepository:true,branch:git.branch,head:git.head}:{isRepository:false}};
}
export class ProjectWorkspace {
  constructor({store,port=null}={}) {
    if(!store?.db)throw Error('workspace_store_required');
    this.store=store;this.db=store.db;this.port=port;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lab_project_workspaces (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES lab_projects(id),
        workspace_session_id TEXT NOT NULL REFERENCES workspace_sessions(id),
        device_id TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(project_id,device_id,resource_id)
      );
      CREATE INDEX IF NOT EXISTS idx_lab_project_workspaces
        ON lab_project_workspaces(project_id,workspace_session_id);
    `);
  }
  available() {
    return typeof this.port?.verifyBinding==='function'&&
      typeof this.port?.snapshot==='function';
  }
  rows(context,projectId) {
    identity(context,projectId);
    return this.db.prepare(`SELECT id,device_id AS deviceId,resource_id AS resourceId,created_at AS createdAt
      FROM lab_project_workspaces WHERE project_id=? AND workspace_session_id=?
      AND actor_id=? AND client_id=? ORDER BY created_at,id LIMIT 50`)
      .all(projectId,context.workspaceSessionId,context.actorId,context.clientId);
  }
  status(context,projectId) {
    const items=this.rows(context,projectId);
    return {available:this.available(),mode:'read_only',
      state:!this.available()?'capability_unavailable':items.length?'bound':'not_bound',
      bindings:items.map(item=>({bindingId:item.id,deviceId:item.deviceId,createdAt:item.createdAt,
        state:this.available()?'requires_snapshot':'capability_unavailable'})),
      filesRead:0,filesWritten:0,providerMessagesSent:0};
  }
  async authorizeBinding(context,{projectId,deviceId,resourceId},recheckAccess) {
    identity(context,projectId);
    if(!IDENTIFIER.test(deviceId)||!RESOURCE.test(resourceId))
      throw Error('workspace_invalid_binding');
    if(!this.available())throw Error('workspace_capability_unavailable');
    // This proof must originate in Runtime, not from model/UI parameters.
    const proof=await this.port.verifyBinding({context:identity(context,projectId),deviceId,resourceId});
    verifiedProof(proof,context,projectId,deviceId,resourceId);
    // Authorization can change during a remote call.
    if(typeof recheckAccess==='function')recheckAccess();
    return {projectId,deviceId,resourceId};
  }
  bindVerified(context,{projectId,deviceId,resourceId}) {
    identity(context,projectId);
    const old=this.db.prepare(`SELECT id FROM lab_project_workspaces
      WHERE project_id=? AND workspace_session_id=? AND actor_id=? AND client_id=?
      AND device_id=? AND resource_id=?`)
      .get(projectId,context.workspaceSessionId,context.actorId,context.clientId,deviceId,resourceId);
    if(old)return {bindingId:old.id,created:false,filesRead:0,filesWritten:0};
    const bindingId='binding_'+randomUUID();
    this.db.prepare(`INSERT INTO lab_project_workspaces VALUES(?,?,?,?,?,?,?,?)`)
      .run(bindingId,projectId,context.workspaceSessionId,deviceId,resourceId,
        context.actorId,context.clientId,this.store.now());
    return {bindingId,created:true,filesRead:0,filesWritten:0};
  }
  async snapshot(context,{projectId,bindingId},recheckAccess) {
    identity(context,projectId);
    if(!IDENTIFIER.test(bindingId))throw Error('workspace_invalid_binding');
    const binding=this.db.prepare(`SELECT device_id AS deviceId,resource_id AS resourceId
      FROM lab_project_workspaces WHERE id=? AND project_id=? AND workspace_session_id=?
      AND actor_id=? AND client_id=?`)
      .get(bindingId,projectId,context.workspaceSessionId,context.actorId,context.clientId);
    if(!binding)throw Error('workspace_binding_unavailable');
    if(!this.available())return {bindingId,state:'capability_unavailable',verified:false};
    // Revalidating the grant prevents treating an old binding as authority.
    const who=identity(context,projectId);
    const proof=await this.port.verifyBinding({context:who,...binding});
    verifiedProof(proof,context,projectId,binding.deviceId,binding.resourceId);
    const result=await this.port.snapshot({context:who,...binding});
    if(typeof recheckAccess==='function')recheckAccess();
    return {bindingId,...cleanSnapshot(result,binding.deviceId,binding.resourceId)};
  }
}
