// One persistent, owner-selected physical folder per Forge project.
// Reuses the application's SQLite. This is not a Runtime/Platform grant,
// a second repository, or permission for a model to select a computer path.
import fs from 'node:fs';
import path from 'node:path';

const PROJECT=/^project_[A-Za-z0-9-]{1,100}$/;
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
  rootForProject(projectId){
    const binding=this.binding(projectId);
    if(!binding)return null;
    if(!this.status(projectId).verified)throw Error('forge_workspace_missing_or_moved');
    return binding.root;
  }
  status(projectId) {
    const binding=this.binding(projectId);
    if(!binding)return {...unbound,projectId,defaultParent:this.base};
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
