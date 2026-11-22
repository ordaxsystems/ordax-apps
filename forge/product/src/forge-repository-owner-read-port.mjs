// Forge-native, per-repository READ port. It does not call the OrdaX MCP,
// choose a device/path, mint a grant, or create another Store or file broker.
// The trusted Owner/Runtime adapter must supply a fresh approved binding.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ForgeProjectFiles} from './forge-project-files.mjs';
import {FORGE_NATIVE_OAUTH_CLIENT_ID} from './forge-product-session.mjs';
import {canonicalOrdaxRepositoryRemote} from './forge-ordax-repository-proof.mjs';

const PROJECT=/^project_[A-Za-z0-9-]{1,100}$/;
const TASK=/^task_[A-Za-z0-9-]{1,120}$/;
const REPO=/^ordaxsystems\/ordax-[a-z0-9-]{2,101}$/;
const SHA=/^[0-9a-f]{40}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ATTESTATION='ordax.forge.owner-repository-read-attestation/1';
const MAX_ATTESTATION_AGE_MS=120_000;
const MAX_GRANT_FUTURE_MS=5*60_000;
const physicalIdentity=folder=>{const stat=fs.statSync(folder,{bigint:true});
  return stat.dev.toString()+':'+stat.ino.toString();};
const same=(a,b)=>process.platform==='win32'
  ?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase()
  :path.resolve(a)===path.resolve(b);

export class ForgeRepositoryOwnerReadPort {
  constructor({store,repositoryCatalog,resolveOwnerBinding,git=execFileSync,clock=Date.now}={}){
    if(!store?.db||typeof store.getWorkspaceSession!=='function'||
       typeof repositoryCatalog?.read!=='function'||
       typeof resolveOwnerBinding!=='function'||
       typeof git!=='function'||typeof clock!=='function')
      throw Error('forge_repository_owner_ports_required');
    this.store=store;
    this.catalog=repositoryCatalog;
    this.resolveOwnerBinding=resolveOwnerBinding;
    this.git=git;
    this.clock=clock;
  }
  async authorize({projectId,taskId,repository}={}){
    if(!PROJECT.test(projectId)||!TASK.test(taskId)||!REPO.test(repository))
      throw Error('forge_repository_read_scope_invalid');
    const session=this.store.getWorkspaceSession();
    if(session?.status!=='active')throw Error('forge_repository_session_unavailable');
    const binding=this.store.db.prepare(`SELECT 1 FROM lab_task_bindings b
      JOIN tasks t ON t.id=b.task_id
      JOIN forge_work_repository_scope r ON r.project_id=b.project_id AND r.task_id=b.task_id
      WHERE b.project_id=? AND b.task_id=? AND b.kind='work'
        AND t.workspace_session_id=? AND r.repository=?`)
      .get(projectId,taskId,session.id,repository);
    if(!binding)throw Error('forge_task_repository_scope_not_assigned');
    const catalog=this.catalog.read();
    if(catalog?.available!==true||catalog.checkedOrigin!==true||
      !catalog.repositories?.some(row=>row.repo===repository))
      throw Error('forge_repository_ownership_contract_unavailable');
    // This is a trusted local Owner port, NOT an MCP argument or manifest field.
    // A trusted Owner/Runtime adapter must recheck its signed Forge OAuth
    // device binding and repository-specific grant for EACH call. It may
    // perform network I/O. We never infer or cache permission from SQLite.
    const grant=await this.resolveOwnerBinding({projectId,taskId,repository,access:'read'});
    const now=this.clock(),proof=grant?.attestation;
    // Independent local Owner approval is a physical Windows/Node authority,
    // not a claimed Runtime device attestation. Remote Runtime proof remains
    // a distinct, stricter branch; neither can impersonate the other.
    const localOwner=(proof?.source==='forge_native_local_owner'&&
      proof.localHostVerified===true&&proof.deviceBindingAttested===false&&
      proof.ownerIdentityBound===true&&
      typeof proof.ownerSubjectId==='string'&&UUID.test(proof.ownerSubjectId));
    const runtimeOwner=(proof?.source==='forge_platform_runtime'&&
      proof.deviceBindingAttested===true&&
      typeof proof.deviceId==='string'&&UUID.test(proof.deviceId));
    const issuedAt=Date.parse(proof?.verifiedAt||'');
    const expiry=Date.parse(grant?.validUntil||'');
    if(!grant||grant.projectId!==projectId||grant.taskId!==taskId||
       grant.repository!==repository||grant.ownerApproved!==true||
       grant.readAuthorized!==true||grant.authority!=='forge_native_owner'||
       !Number.isFinite(expiry)||expiry<=now||expiry>now+MAX_GRANT_FUTURE_MS||
       typeof grant.root!=='string'||!path.isAbsolute(grant.root)||
       typeof grant.rootIdentity!=='string'||!/^\d+:\d+$/.test(grant.rootIdentity)||
       proof?.schema!==ATTESTATION||(!localOwner&&!runtimeOwner)||
       proof.forgeClientId!==FORGE_NATIVE_OAUTH_CLIENT_ID||
       proof.projectId!==projectId||proof.taskId!==taskId||
       proof.repository!==repository||proof.ownerConfirmed!==true||
       proof.repositoryReadGranted!==true||
       !Number.isFinite(issuedAt)||issuedAt>now||
       now-issuedAt>MAX_ATTESTATION_AGE_MS)
      throw Error('forge_repository_owner_port_and_grant_required');
    const root=path.resolve(grant.root);
    const stat=fs.lstatSync(root);
    if(!stat.isDirectory()||stat.isSymbolicLink()||
       !same(fs.realpathSync.native(root),root)||
       physicalIdentity(root)!==grant.rootIdentity)
      throw Error('forge_repository_root_reparse_denied');
    const cmd=args=>String(this.git('git',['-C',root,...args],{
      encoding:'utf8',timeout:4000,maxBuffer:2048,windowsHide:true
    })).trim();
    const top=cmd(['rev-parse','--show-toplevel']);
    if(!path.isAbsolute(top)||!same(top,root))
      throw Error('forge_repository_root_identity_mismatch');
    if(canonicalOrdaxRepositoryRemote(cmd(['remote','get-url','origin']))!==repository)
      throw Error('forge_repository_origin_mismatch');
    const head=cmd(['rev-parse','--verify','HEAD']);
    if(!SHA.test(head))throw Error('forge_repository_head_invalid');
    return {projectId,taskId,repository,root,head};
  }
  async inspect(args){
    const verified=await this.authorize(args);
    return {schema:'ordax.forge.repository-read-proof/1',
      projectId:verified.projectId,taskId:verified.taskId,
      repository:verified.repository,headSha:verified.head,
      originVerified:true,ownerGrantVerified:true,
      readAvailable:true,writeAuthorized:false,rootPathExposed:false,
      source:'forge_native_owner_read_port'};
  }
  async read({...args}){
    const scope=await this.authorize(args);
    const broker=new ForgeProjectFiles({root:scope.root,
      workspaceLookup:()=>scope.root,requireOwnerBinding:true});
    const result=broker.read(scope.projectId,args.path,scope.taskId);
    // Verify the original binding and Git identity again after file I/O.
    const after=await this.authorize(args);
    if(!same(after.root,scope.root)||after.head!==scope.head)
      throw Error('forge_repository_read_scope_changed');
    return {schema:'ordax.forge.repository-file-read/1',
      repository:scope.repository,taskId:scope.taskId,
      path:result.path,content:result.content,bytes:result.bytes,
      sha256:result.sha256,gitHeadSha:scope.head,
      source:'forge_native_owner_read_port',ownerGrantVerified:true,
      externalEffectVerified:false,rootPathExposed:false};
  }
  async list({...args}){
    const scope=await this.authorize(args);
    const broker=new ForgeProjectFiles({root:scope.root,
      workspaceLookup:()=>scope.root,requireOwnerBinding:true});
    const result=broker.list(scope.projectId,args.directory||'',scope.taskId);
    const after=await this.authorize(args);
    if(!same(after.root,scope.root)||after.head!==scope.head)
      throw Error('forge_repository_read_scope_changed');
    return {schema:'ordax.forge.repository-file-list/1',
      repository:scope.repository,taskId:scope.taskId,
      directory:result.directory,exists:result.exists,
      entries:result.entries,truncated:result.truncated,
      gitHeadSha:scope.head,ownerGrantVerified:true,
      rootPathExposed:false,source:'forge_native_owner_read_port'};
  }
}
