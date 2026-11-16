// One persistent, owner-selected physical folder per Forge project.
// Reuses the application's SQLite. This is not a Runtime/Platform grant,
// a second repository, or permission for a model to select a computer path.
import fs from 'node:fs';
import path from 'node:path';
import {moveForgeLegacyWorkspace} from './forge-legacy-workspace-migration.mjs';

const PROJECT=/^project_[A-Za-z0-9-]{1,100}$/;
const TASK=/^task_[A-Za-z0-9-]{1,120}$/;
const BRANCH=/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,139}$/;
const SHA=/^[a-f0-9]{40}$/;
const RESERVED=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const same=(a,b)=>process.platform==='win32'
  ?a.toLowerCase()===b.toLowerCase():a===b;
const unbound={configured:false,kind:'unbound',path:null};

function liveDirectory(input) {
  if(typeof input!=='string'||!path.isAbsolute(input)||input.includes('\0'))
    throw Error('forge_workspace_path_invalid');
  const requested=path.resolve(input);
  if(same(requested,path.parse(requested).root))throw Error('forge_workspace_root_denied');
  const stat=fs.lstatSync(requested);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('forge_workspace_reparse_denied');
  const physical=fs.realpathSync.native(requested);
  const final=fs.lstatSync(physical);
  if(!final.isDirectory()||final.isSymbolicLink())throw Error('forge_workspace_reparse_denied');
  return path.resolve(physical);
}
function physicalIdentity(folder){
  const stat=fs.statSync(folder,{bigint:true});
  if(!stat.isDirectory())throw Error('forge_workspace_identity_invalid');
  return stat.dev.toString()+':'+stat.ino.toString();
}
function slug(name) {
  const clean=String(name||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^A-Za-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48);
  return !clean||RESERVED.test(clean)?'Projeto':clean;
}
function within(parent,child) {
  const relative=path.relative(parent,child);
  return !relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));
}

// DEV candidate profiles must never resolve their project folders into the
// owner's real Windows Documents. Use the same isolated candidate tree as
// the staged SQLite, but outside its userData directory.
export function resolveForgeWorkspaceDocumentsDirectory({staged=false,userRoot,windowsDocuments}={}){
  if(typeof userRoot!=='string'||!path.isAbsolute(userRoot)||
     typeof windowsDocuments!=='string'||!path.isAbsolute(windowsDocuments))
    throw Error('forge_workspace_documents_root_invalid');
  return staged?path.resolve(path.dirname(userRoot),'staged-documents')
    :path.resolve(windowsDocuments);
}

export class ForgeLocalWorkspaces {
  constructor({store,documentsDirectory,legacyRoot=null,forbiddenRoots=[]}={}) {
    if(!store?.db||typeof documentsDirectory!=='string'||!path.isAbsolute(documentsDirectory))
      throw Error('forge_workspace_owner_ports_required');
    this.store=store;this.db=store.db;
    this.base=path.resolve(documentsDirectory,'Forge');
    this.legacyRoot=legacyRoot?path.resolve(legacyRoot):null;
    this.forbiddenRoots=forbiddenRoots.map(item=>path.resolve(item));
    this.initialized=false;
  }
  schema(){
    if(this.initialized)return;
    if(!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='lab_projects'").get())
      throw Error('forge_workspace_project_store_unavailable');
    this.db.exec(`CREATE TABLE IF NOT EXISTS forge_local_project_roots(
      project_id TEXT PRIMARY KEY REFERENCES lab_projects(id) ON DELETE CASCADE,
      workspace_session_id TEXT NOT NULL REFERENCES workspace_sessions(id),
      canonical_root TEXT NOT NULL COLLATE NOCASE UNIQUE,
      physical_identity TEXT NOT NULL,
      binding_kind TEXT NOT NULL CHECK(binding_kind IN ('default','selected')),
      created_at TEXT NOT NULL
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS forge_task_worktrees(
      task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES lab_projects(id) ON DELETE CASCADE,
      workspace_session_id TEXT NOT NULL REFERENCES workspace_sessions(id),
      worktree_root TEXT NOT NULL COLLATE NOCASE UNIQUE,
      physical_identity TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      base_head_sha TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active','integrated','blocked')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_forge_task_worktrees_project ON forge_task_worktrees(project_id,status)');
    this.initialized=true;
  }
  projectRow(projectId){
    this.schema();
    if(typeof projectId!=='string'||!PROJECT.test(projectId))throw Error('forge_workspace_project_invalid');
    const session=this.store.getWorkspaceSession();
    const row=this.db.prepare('SELECT id,name FROM lab_projects WHERE id=? AND workspace_session_id=?')
      .get(projectId,session?.id);
    if(!row||session?.status!=='active')throw Error('forge_workspace_project_unavailable');
    return row;
  }
  binding(projectId){
    this.projectRow(projectId);
    return this.db.prepare('SELECT canonical_root AS root,physical_identity AS identity,binding_kind AS kind FROM forge_local_project_roots WHERE project_id=?')
      .get(projectId)||null;
  }
  mainRootForProject(projectId){
    const binding=this.binding(projectId);
    if(!binding)return null;
    if(!this.status(projectId).verified)throw Error('forge_workspace_missing_or_moved');
    return binding.root;
  }
  taskRow(projectId,taskId){
    this.projectRow(projectId);
    if(typeof taskId!=='string'||!TASK.test(taskId))throw Error('forge_worktree_task_invalid');
    const row=this.db.prepare(`SELECT b.task_id,b.kind FROM lab_task_bindings b
      WHERE b.project_id=? AND b.task_id=?`).get(projectId,taskId);
    if(!row||row.kind!=='work')throw Error('forge_worktree_task_unavailable');
    return row;
  }
  expectedTaskWorktreeRoot(projectId,taskId){
    this.taskRow(projectId,taskId);
    const root=this.mainRootForProject(projectId);
    if(!root)throw Error('forge_workspace_binding_required');
    return path.join(root,'.forge-worktrees',taskId);
  }
  taskWorktree(projectId,taskId){
    this.taskRow(projectId,taskId);
    const row=this.db.prepare(`SELECT task_id AS taskId,project_id AS projectId,
      worktree_root AS root,physical_identity AS identity,branch_name AS branchName,
      base_head_sha AS baseHeadSha,status,created_at AS createdAt,updated_at AS updatedAt
      FROM forge_task_worktrees WHERE project_id=? AND task_id=?`).get(projectId,taskId);
    if(!row)return null;
    const expected=this.expectedTaskWorktreeRoot(projectId,taskId);
    if(!same(row.root,expected)||!BRANCH.test(row.branchName)||!SHA.test(row.baseHeadSha))
      throw Error('forge_worktree_record_invalid');
    if(row.status!=='active')return row;
    const live=liveDirectory(row.root);
    if(!same(live,row.root)||physicalIdentity(live)!==row.identity)
      throw Error('forge_worktree_missing_or_moved');
    const gitMarker=path.join(live,'.git');
    const marker=fs.lstatSync(gitMarker);
    if(marker.isSymbolicLink()||(!marker.isFile()&&!marker.isDirectory()))
      throw Error('forge_worktree_git_marker_invalid');
    return row;
  }
  rootForProject(projectId,taskId=null){
    const root=this.mainRootForProject(projectId);
    if(taskId===null||taskId===undefined)return root;
    const worktree=this.taskWorktree(projectId,taskId);
    if(!worktree||worktree.status!=='active')throw Error('forge_worktree_task_unprepared');
    return worktree.root;
  }
  hasActiveTaskWorktrees(projectId){
    this.projectRow(projectId);
    return Boolean(this.db.prepare(`SELECT 1 FROM forge_task_worktrees
      WHERE project_id=? AND status='active' LIMIT 1`).get(projectId));
  }
  recordTaskWorktree(projectId,taskId,{branchName,baseHeadSha}={}){
    this.taskRow(projectId,taskId);
    if(typeof branchName!=='string'||!BRANCH.test(branchName)||
       branchName.includes('..')||branchName.startsWith('/')||branchName.endsWith('/')||
       typeof baseHeadSha!=='string'||!SHA.test(baseHeadSha))
      throw Error('forge_worktree_metadata_invalid');
    const root=this.expectedTaskWorktreeRoot(projectId,taskId);
    const live=liveDirectory(root);
    if(!same(live,root))throw Error('forge_worktree_root_changed');
    const identity=physicalIdentity(live),session=this.store.getWorkspaceSession();
    const existing=this.db.prepare('SELECT task_id FROM forge_task_worktrees WHERE task_id=?').get(taskId);
    if(existing)throw Error('forge_worktree_already_recorded');
    const now=this.store.now();
    this.db.prepare(`INSERT INTO forge_task_worktrees
      (task_id,project_id,workspace_session_id,worktree_root,physical_identity,
       branch_name,base_head_sha,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'active',?,?)`).run(taskId,projectId,session.id,
        root,identity,branchName,baseHeadSha,now,now);
    return this.taskWorktree(projectId,taskId);
  }
  legacyStatus(projectId){
    if(!this.legacyRoot)return {legacyMigrationRequired:false};
    const root=path.join(this.legacyRoot,projectId);
    if(!fs.existsSync(root))return {legacyMigrationRequired:false};
    try{
      if(!same(liveDirectory(root),root))throw Error('forge_workspace_legacy_reparse_denied');
      return {legacyMigrationRequired:fs.readdirSync(root).length>0};
    }catch{return {legacyMigrationRequired:false,legacyWorkspaceBlocked:true};}
  }
  status(projectId) {
    const binding=this.binding(projectId);
    if(!binding)return {...unbound,projectId,defaultParent:this.base,
      ...this.legacyStatus(projectId)};
    try {
      const live=liveDirectory(binding.root);
      if(!same(live,binding.root)||physicalIdentity(live)!==binding.identity)
        throw Error('forge_workspace_root_changed');
      return {projectId,configured:true,kind:binding.kind,path:binding.root,verified:true};
    }catch{
      return {projectId,configured:true,kind:binding.kind,path:binding.root,
        verified:false,reason:'workspace_missing_or_moved'};
    }
  }
  assertNoLegacyFiles(projectId){
    if(!this.legacyRoot)return;
    const old=path.join(this.legacyRoot,projectId);
    if(!fs.existsSync(old))return;
    if(!same(liveDirectory(old),old))throw Error('forge_workspace_legacy_reparse_denied');
    if(fs.readdirSync(old).length)
      throw Error('forge_workspace_migration_required');
  }
  record(projectId,folder,kind){
    this.projectRow(projectId);
    const existing=this.binding(projectId);
    if(existing){
      if(!same(existing.root,folder))throw Error('forge_workspace_already_bound');
      return this.status(projectId);
    }
    this.assertNoLegacyFiles(projectId);
    const root=liveDirectory(folder);
    if(within(root,this.base))throw Error('forge_workspace_root_too_broad');
    if(this.legacyRoot&&within(this.legacyRoot,root))throw Error('forge_workspace_appdata_denied');
    const otherRoots=this.db.prepare(
      'SELECT canonical_root AS root FROM forge_local_project_roots WHERE project_id<>?'
    ).all(projectId);
    if(otherRoots.some(other=>within(other.root,root)||within(root,other.root)))
      throw Error('forge_workspace_overlap_denied');
    for(const forbidden of this.forbiddenRoots)
      if(within(forbidden,root)||within(root,forbidden))
        throw Error('forge_workspace_reserved_location');
    this.db.prepare(`INSERT INTO forge_local_project_roots
      (project_id,workspace_session_id,canonical_root,physical_identity,binding_kind,created_at)
      VALUES(?,?,?,?,?,?)`).run(projectId,this.store.getWorkspaceSession().id,
        root,physicalIdentity(root),kind,this.store.now());
    return this.status(projectId);
  }
  // Call ONLY after a native owner folder picker, never from MCP/tool input.
  bindSelected(projectId,folder){
    const current=this.binding(projectId);
    if(current)throw Error('forge_workspace_already_bound');
    return this.record(projectId,folder,'selected');
  }
  assertMigrationIdle(projectId){
    const project=this.projectRow(projectId);
    const observed=this.db.prepare('SELECT observation_requested FROM lab_projects WHERE id=?')
      .get(projectId);
    if(observed?.observation_requested===1)throw Error('forge_workspace_migration_observation_active');
    if(this.db.prepare("SELECT 1 FROM lab_command_receipts WHERE project_id=? AND status IN ('running','uncertain') LIMIT 1")
      .get(projectId))throw Error('forge_workspace_migration_command_unresolved');
    if(this.db.prepare("SELECT 1 FROM runs r JOIN lab_task_bindings b ON b.task_id=r.task_id WHERE b.project_id=? AND r.status='running' LIMIT 1")
      .get(projectId))throw Error('forge_workspace_migration_run_active');
    return project;
  }
  // Requires a fresh explicit native Owner confirmation. Moves the previous
  // Forge-private folder; it does not copy, delete, or overwrite user files.
  migrateLegacy(projectId){
    const project=this.assertMigrationIdle(projectId);
    if(this.binding(projectId))throw Error('forge_workspace_already_bound');
    if(!this.legacyStatus(projectId).legacyMigrationRequired)
      throw Error('forge_workspace_migration_source_unavailable');
    fs.mkdirSync(this.base,{recursive:true});
    if(!same(liveDirectory(this.base),this.base))
      throw Error('forge_workspace_default_root_changed');
    const source=path.join(this.legacyRoot,projectId);
    const proposed=slug(project.name);
    for(let i=0;i<32;i++){
      const folder=path.join(this.base,i===0?proposed:proposed+'-'+projectId.slice(-8)+(i===1?'':'-'+i));
      if(fs.existsSync(folder))continue;
      // Atomic rename on the same drive; cross-drive migration is blocked to
      // avoid an unverified second copy. The broker blocks private writes.
      return moveForgeLegacyWorkspace({source,target:folder,bind:target=>{
        this.assertMigrationIdle(projectId);
        try{
          const verified=this.record(projectId,target,'default');
          if(!verified.verified)throw Error('forge_workspace_migration_binding_unverified');
          return verified;
        }catch(error){
          // Keep the DB unbound if we must roll the physical move back.
          this.db.prepare('DELETE FROM forge_local_project_roots WHERE project_id=? AND canonical_root=?')
            .run(projectId,target);
          throw error;
        }
      }});
    }
    throw Error('forge_workspace_default_collision_limit');
  }
  // Owner creates a new project; new default workspaces never take over an
  // existing unrelated folder. No automatic deletion if a project is removed.
  createDefault(projectId) {
    const project=this.projectRow(projectId);
    const existing=this.binding(projectId);
    if(existing)return this.status(projectId);
    this.assertNoLegacyFiles(projectId);
    fs.mkdirSync(this.base,{recursive:true});
    if(!same(liveDirectory(this.base),this.base))
      throw Error('forge_workspace_default_root_changed');
    const proposed=slug(project.name);
    for(let i=0;i<32;i++){
      const name=i===0?proposed:proposed+'-'+projectId.slice(-8)+(i===1?'':'-'+i);
      const folder=path.join(this.base,name);
      try{fs.mkdirSync(folder);}catch(error){
        if(error?.code==='EEXIST')continue;
        throw error;
      }
      try{return this.record(projectId,folder,'default');}
      catch(error){
        // Only undo a just-created, still-empty directory on DB failure.
        try{fs.rmdirSync(folder);}catch{}
        throw error;
      }
    }
    throw Error('forge_workspace_default_collision_limit');
  }
}
