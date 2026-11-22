// Explicit LOCAL Owner-selected roots for the independent Forge MCP.
// No new database, no Runtime device grant and no automatic path selection.
// bindSelected may be called ONLY from a trusted native Owner folder picker.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {FORGE_NATIVE_OAUTH_CLIENT_ID} from './forge-product-session.mjs';
import {canonicalOrdaxRepositoryRemote} from './forge-ordax-repository-proof.mjs';
import {readDedicatedForgeProject} from './forge-dedicated-project.mjs';

const PROJECT=/^project_[A-Za-z0-9-]{1,100}$/;
const REPO=/^ordaxsystems\/ordax-[a-z0-9-]{2,101}$/;
const SHA=/^[a-f0-9]{40}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const within=(parent,child)=>{
  const relative=path.relative(parent,child);
  return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));
};
const identityOf=root=>{
  const stat=fs.statSync(root,{bigint:true});
  return stat.dev.toString()+':'+stat.ino.toString();
};

export class ForgeLocalRepositoryOwnerBindings {
  constructor({store,ownerTrust,repositoryCatalog,session,
    forbiddenRoots=[],git=execFileSync,clock=Date.now}={}){
    if(!store?.db||typeof store.getWorkspaceSession!=='function'||
      typeof ownerTrust?.isAppTrusted!=='function'||
      typeof ownerTrust?.remoteOwnerIdentity!=='function'||
      typeof repositoryCatalog?.read!=='function'||
      typeof session?.status!=='function'||
      !Array.isArray(forbiddenRoots)||typeof git!=='function'||
      typeof clock!=='function')
      throw Error('forge_local_repository_owner_ports_required');
    this.store=store;
    this.db=store.db;
    this.trust=ownerTrust;
    this.catalog=repositoryCatalog;
    this.session=session;
    this.git=git;
    this.clock=clock;
    this.forbidden=forbiddenRoots.filter(p=>typeof p==='string'&&path.isAbsolute(p))
      .map(p=>path.resolve(p));
    this.db.exec('CREATE TABLE IF NOT EXISTS forge_local_repository_roots (project_id TEXT NOT NULL REFERENCES lab_projects(id) ON DELETE CASCADE, workspace_session_id TEXT NOT NULL REFERENCES workspace_sessions(id), repository TEXT NOT NULL, canonical_root TEXT NOT NULL COLLATE NOCASE UNIQUE, physical_identity TEXT NOT NULL, owner_subject_id TEXT NOT NULL, approved_at TEXT NOT NULL, PRIMARY KEY(project_id,repository))');
    // Same consent table. Existing READ grants remain READ-ONLY.
    if(!this.db.prepare('PRAGMA table_info(forge_local_repository_roots)').all()
      .some(column=>column.name==='write_approved_at'))
      this.db.exec('ALTER TABLE forge_local_repository_roots ADD COLUMN write_approved_at TEXT');
  }
  owner(projectId,repository){
    const ws=this.store.getWorkspaceSession();
    if(ws?.status!=='active'||!PROJECT.test(projectId)||!REPO.test(repository)||
       readDedicatedForgeProject(this.store)?.projectId!==projectId)
      throw Error('forge_local_repository_project_scope_denied');
    const catalog=this.catalog.read();
    if(catalog?.available!==true||catalog.checkedOrigin!==true||
       !catalog.repositories?.some(x=>x.repo===repository))
      throw Error('forge_local_repository_catalog_unverified');
    const state=this.session.status();
    if(!this.trust.isAppTrusted()||state?.connected!==true||
       state.mode!=='oauth'||state.clientId!==FORGE_NATIVE_OAUTH_CLIENT_ID)
      throw Error('forge_local_repository_owner_oauth_required');
    const owner=this.trust.remoteOwnerIdentity();
    if(!owner||!UUID.test(owner.subjectId)||
       owner.issuer!=='https://jhfphsjptrpmtnzkpwud.supabase.co/auth/v1')
      throw Error('forge_local_repository_owner_identity_required');
    return {sessionId:ws.id,ownerSubjectId:owner.subjectId.toLowerCase()};
  }
  verifiedRoot(repository,selectedRoot){
    if(typeof selectedRoot!=='string'||!path.isAbsolute(selectedRoot)||
       selectedRoot.includes('\0'))throw Error('forge_local_repository_root_invalid');
    const root=path.resolve(selectedRoot),stat=fs.lstatSync(root);
    if(!stat.isDirectory()||stat.isSymbolicLink()||
       !same(fs.realpathSync.native(root),root)||
       same(root,path.parse(root).root)||
       this.forbidden.some(blocked=>within(blocked,root)||within(root,blocked)))
      throw Error('forge_local_repository_root_denied');
    const git=args=>String(this.git('git',['-C',root,...args],{
      encoding:'utf8',timeout:4000,maxBuffer:4096,windowsHide:true
    })).trim();
    const top=git(['rev-parse','--show-toplevel']);
    if(!path.isAbsolute(top)||!same(path.resolve(top),root))
      throw Error('forge_local_repository_root_not_checkout');
    if(canonicalOrdaxRepositoryRemote(git(['remote','get-url','origin']))!==repository)
      throw Error('forge_local_repository_origin_mismatch');
    const head=git(['rev-parse','--verify','HEAD']);
    if(!SHA.test(head))throw Error('forge_local_repository_head_invalid');
    return {root,identity:identityOf(root),head};
  }
  status({projectId,repository}={}){
    try{
      const owner=this.owner(projectId,repository);
      const row=this.db.prepare('SELECT canonical_root AS root,physical_identity AS identity,write_approved_at AS writeApprovedAt FROM forge_local_repository_roots WHERE project_id=? AND workspace_session_id=? AND repository=? AND owner_subject_id=?')
        .get(projectId,owner.sessionId,repository,owner.ownerSubjectId);
      if(!row)return {projectId,repository,configured:false,verified:false,
        reason:'forge_local_repository_owner_binding_required'};
      try{
        const current=this.verifiedRoot(repository,row.root);
        if(current.identity!==row.identity)throw Error('forge_local_repository_physical_identity_changed');
        return {projectId,repository,configured:true,verified:true,readGranted:true,
          writeGranted:typeof row.writeApprovedAt==='string'&&
            Number.isFinite(Date.parse(row.writeApprovedAt))&&
            Date.parse(row.writeApprovedAt)<=this.clock(),headSha:current.head};
      }catch{
        return {projectId,repository,configured:true,verified:false,
          readGranted:false,writeGranted:false,
          reason:'forge_local_repository_grant_not_verified'};
      }
    }catch{
      return {projectId,repository,configured:false,verified:false,
        readGranted:false,writeGranted:false,reason:'forge_local_repository_owner_authorization_required'};
    }
  }
  // Trusted native Owner UI only; the OS picker supplies selectedRoot.
  bindSelected({projectId,repository,selectedRoot}={}){
    const owner=this.owner(projectId,repository);
    const proof=this.verifiedRoot(repository,selectedRoot);
    if(this.db.prepare('SELECT 1 FROM forge_local_repository_roots WHERE project_id=? AND repository=?')
      .get(projectId,repository))throw Error('forge_local_repository_already_bound');
    const conflicting=this.db.prepare('SELECT canonical_root AS root FROM forge_local_repository_roots')
      .all().some(row=>within(row.root,proof.root)||within(proof.root,row.root));
    if(conflicting)throw Error('forge_local_repository_overlap_denied');
    this.db.prepare('INSERT INTO forge_local_repository_roots (project_id,workspace_session_id,repository,canonical_root,physical_identity,owner_subject_id,approved_at) VALUES(?,?,?,?,?,?,?)')
      .run(projectId,owner.sessionId,repository,proof.root,proof.identity,
        owner.ownerSubjectId,new Date(this.clock()).toISOString());
    return {schema:'ordax.forge.local-owner-repository/1',
      projectId,repository,configured:true,originVerified:true,
      rootIdentityVerified:true,readGranted:true,writeGranted:false,
      headSha:proof.head};
  }
  // Native Owner UI calls this only after a separate, explicit WRITE
  // confirmation. A prior read/root approval never escalates automatically.
  approveWrite({projectId,repository}={}) {
    const owner=this.owner(projectId,repository);
    const row=this.db.prepare('SELECT canonical_root AS root,physical_identity AS identity,write_approved_at AS approvedAt FROM forge_local_repository_roots WHERE project_id=? AND workspace_session_id=? AND repository=? AND owner_subject_id=?')
      .get(projectId,owner.sessionId,repository,owner.ownerSubjectId);
    if(!row)throw Error('forge_local_repository_owner_binding_required');
    const current=this.verifiedRoot(repository,row.root);
    if(current.identity!==row.identity)
      throw Error('forge_local_repository_physical_identity_changed');
    if(row.approvedAt)return {projectId,repository,writeGranted:true,unchanged:true};
    const changed=this.db.prepare('UPDATE forge_local_repository_roots SET write_approved_at=? WHERE project_id=? AND workspace_session_id=? AND repository=? AND owner_subject_id=? AND physical_identity=? AND write_approved_at IS NULL')
      .run(new Date(this.clock()).toISOString(),projectId,owner.sessionId,
        repository,owner.ownerSubjectId,row.identity).changes;
    if(changed!==1)throw Error('forge_local_repository_write_authorization_conflict');
    return {projectId,repository,writeGranted:true,headSha:current.head};
  }
  revokeWrite({projectId,repository}={}) {
    const owner=this.owner(projectId,repository);
    const changed=this.db.prepare('UPDATE forge_local_repository_roots SET write_approved_at=NULL WHERE project_id=? AND workspace_session_id=? AND repository=? AND owner_subject_id=? AND write_approved_at IS NOT NULL')
      .run(projectId,owner.sessionId,repository,owner.ownerSubjectId).changes;
    return {projectId,repository,writeRevoked:changed===1};
  }
  revoke({projectId,repository}={}){
    const owner=this.owner(projectId,repository);
    const changed=this.db.prepare('DELETE FROM forge_local_repository_roots WHERE project_id=? AND workspace_session_id=? AND repository=? AND owner_subject_id=?')
      .run(projectId,owner.sessionId,repository,owner.ownerSubjectId).changes;
    return {projectId,repository,revoked:changed===1};
  }
  // Evaluate at native Host startup. A port is not advertised merely because
  // a database table or OAuth login exists; at least one live root must pass
  // the exact local Owner identity, origin and physical identity checks.
  hasApprovedRoot(projectId,{access='read'}={}){
    if(!['read','write'].includes(access))return false;
    try {
      const ws=this.store.getWorkspaceSession();
      if(ws?.status!=='active')return false;
      const rows=this.db.prepare(
        'SELECT repository,canonical_root AS root,physical_identity AS identity,owner_subject_id AS ownerSubjectId,write_approved_at AS writeApprovedAt FROM forge_local_repository_roots WHERE project_id=? AND workspace_session_id=?'
      ).all(projectId,ws.id);
      for(const row of rows){
        if(access==='write'&&(!Number.isFinite(Date.parse(row.writeApprovedAt||''))||
          Date.parse(row.writeApprovedAt)>this.clock()))continue;
        try{
          const verified=this.owner(projectId,row.repository);
          if(verified.ownerSubjectId!==row.ownerSubjectId)continue;
          const current=this.verifiedRoot(row.repository,row.root);
          if(current.identity===row.identity)return true;
        }catch{}
      }
      return false;
    }catch{return false;}
  }
  async resolve({projectId,taskId,repository,access}={}){
    if(!['read','write'].includes(access))throw Error('forge_local_repository_access_denied');
    const owner=this.owner(projectId,repository);
    const row=this.db.prepare('SELECT canonical_root AS root,physical_identity AS identity,write_approved_at AS writeApprovedAt FROM forge_local_repository_roots WHERE project_id=? AND workspace_session_id=? AND repository=? AND owner_subject_id=?')
      .get(projectId,owner.sessionId,repository,owner.ownerSubjectId);
    if(!row)throw Error('forge_local_repository_owner_binding_required');
    if(access==='write'&&(!Number.isFinite(Date.parse(row.writeApprovedAt||''))||
       Date.parse(row.writeApprovedAt)>this.clock()))
      throw Error('forge_local_repository_write_approval_required');
    const current=this.verifiedRoot(repository,row.root);
    if(current.identity!==row.identity)throw Error('forge_local_repository_physical_identity_changed');
    const now=this.clock();
    return {projectId,taskId,repository,authority:'forge_native_owner',
      ownerApproved:true,readAuthorized:access==='read',
      writeAuthorized:access==='write',root:current.root,
      rootIdentity:current.identity,validUntil:new Date(now+60_000).toISOString(),
      attestation:{
        schema:access==='write'?'ordax.forge.owner-repository-write-attestation/1':
          'ordax.forge.owner-repository-read-attestation/1',
        source:'forge_native_local_owner',forgeClientId:FORGE_NATIVE_OAUTH_CLIENT_ID,
        projectId,taskId,repository,ownerConfirmed:true,ownerIdentityBound:true,
        ownerSubjectId:owner.ownerSubjectId,
        localHostVerified:true,deviceBindingAttested:false,
        repositoryReadGranted:access==='read',
        repositoryWriteGranted:access==='write',
        verifiedAt:new Date(now).toISOString()
      }};
  }
}
