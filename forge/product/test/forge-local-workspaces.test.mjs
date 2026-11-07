import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {ForgeProjectFiles} from '../src/forge-project-files.mjs';
import {ForgeLocalWorkspaces,resolveForgeWorkspaceDocumentsDirectory} from '../src/forge-local-workspaces.mjs';

test('staged candidate projects never resolve into the owner Windows Documents folder',()=>{
  const userRoot=path.join(os.tmpdir(),'candidate-userdata-v1.0.0-alpha.42','OrdaX','Forge');
  const windowsDocuments=path.join(os.tmpdir(),'owner-real-Documents');
  assert.equal(resolveForgeWorkspaceDocumentsDirectory({staged:false,userRoot,windowsDocuments}),
    path.resolve(windowsDocuments));
  assert.equal(resolveForgeWorkspaceDocumentsDirectory({staged:true,userRoot,windowsDocuments}),
    path.join(path.dirname(userRoot),'staged-documents'));
  assert.notEqual(resolveForgeWorkspaceDocumentsDirectory({staged:true,userRoot,windowsDocuments}),
    path.resolve(windowsDocuments));
  assert.throws(()=>resolveForgeWorkspaceDocumentsDirectory({staged:true,userRoot:'relative',windowsDocuments}),
    /documents_root_invalid/);
});

function fixture(t){
  // CI's Windows temporary directory may be reached through a junction.
  // Build fixtures under the real physical root: production refuses reparse aliases.
  const temp=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'forge-owner-roots-')));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const store=new Store(':memory:');
  t.after(()=>store.close());
  const context={actorId:'owner',clientId:'desktop',
    workspaceSessionId:store.getWorkspaceSession().id};
  const privateRoot=path.join(temp,'AppData','private-files');
  const roots=new ForgeLocalWorkspaces({store,documentsDirectory:path.join(temp,'Documents'),
    legacyRoot:privateRoot,forbiddenRoots:[path.join(temp,'AppData')]});
  const files=new ForgeProjectFiles({root:privateRoot,
    workspaceLookup:projectId=>roots.rootForProject(projectId),requireOwnerBinding:true});
  const service=new OrchestratorService({store,fileBroker:files,
    authorize:({context:who})=>who===context});
  const project=async(name)=> (await service.invoke(context,'project_create',{
    name,objective:'',requestId:'create_'+name.replace(/[^a-z0-9]/gi,'_')
  })).result.projectId;
  return {temp,store,context,roots,files,service,project,privateRoot};
}

test('new Forge projects have one persistent owner-bound Documents folder, verified file receipts and no project crossover',async t=>{
  const f=fixture(t);
  const id=await f.project('Cafeteria');
  const first=f.roots.createDefault(id);
  assert.equal(first.verified,true);
  assert.equal(first.kind,'default');
  assert.equal(first.path,path.join(f.temp,'Documents','Forge','Cafeteria'));
  assert.ok(fs.statSync(first.path).isDirectory());
  assert.equal(f.files.status(id).mode,'forge_project_workspace');
  const fromService=await f.service.invoke(f.context,'forge_discover',{projectId:id});
  assert.equal(fromService.workspace.externalFolderAuthorized,true);
  assert.equal(fromService.workspace.projectFileWriteAvailable,true);
  assert.equal(fromService.workspace.externalFolderWriteAvailable,true);
  assert.equal(fromService.workspace.boundProject.rootKind,'forge_owner_bound_folder');
  assert.ok(!JSON.stringify(fromService).includes(first.path),
    'MCP discovery should not reveal the physical folder by accident');
  const written=await f.service.invoke(f.context,'project_file_write',{
    projectId:id,path:'src/index.html',content:'<main>Cafe real</main>',
    requestId:'workspace_write_1'
  });
  assert.equal(written.status,'succeeded');
  assert.equal(written.result.source,'forge_owner_bound_workspace');
  assert.equal(fs.readFileSync(path.join(first.path,'src','index.html'),'utf8'),
    '<main>Cafe real</main>');
  assert.equal(f.roots.createDefault(id).path,first.path);
  const reloaded=new ForgeLocalWorkspaces({store:f.store,
    documentsDirectory:path.join(f.temp,'Documents'),legacyRoot:f.privateRoot});
  assert.equal(reloaded.status(id).path,first.path);
  const second=await f.project('Outro');
  const secondBinding=f.roots.createDefault(second);
  assert.notEqual(secondBinding.path,first.path);
  assert.equal(f.files.list(second).entries.length,0);
  assert.throws(()=>f.roots.bindSelected(second,first.path),
    /already_bound/);
  assert.throws(()=>f.files.read(second,'src/index.html'),/not_found/);
  const status=await f.service.invoke(f.context,'project_files_status',{projectId:id});
  assert.equal(status.externalFolderAuthorized,true);
});

test('only native owner selection can bind an existing folder, never two projects or an application data root',async t=>{
  const f=fixture(t);
  const a=await f.project('Alpha');
  const b=await f.project('Beta');
  const selected=path.join(f.temp,'ExternalProject');
  fs.mkdirSync(selected);
  fs.writeFileSync(path.join(selected,'existing.txt'),'old source');
  const bound=f.roots.bindSelected(a,selected);
  assert.equal(bound.kind,'selected');
  assert.equal(f.files.read(a,'existing.txt').content,'old source');
  assert.throws(()=>f.roots.bindSelected(a,path.join(f.temp,'Documents')),
    /already_bound/);
  assert.throws(()=>f.roots.bindSelected(b,selected),/overlap_denied/);
  const nested=path.join(selected,'nested');fs.mkdirSync(nested);
  assert.throws(()=>f.roots.bindSelected(b,nested),/overlap_denied/);
  fs.mkdirSync(path.join(f.temp,'Documents'),{recursive:true});
  assert.throws(()=>f.roots.bindSelected(b,path.join(f.temp,'Documents')),/root_too_broad/);
  assert.throws(()=>f.roots.bindSelected(b,path.join(f.temp,'AppData')),
    /ENOENT|reserved_location/);
  assert.throws(()=>f.roots.bindSelected(b,path.parse(selected).root),
    /root_denied/);
  assert.equal(f.roots.status(b).configured,false);
  assert.throws(()=>f.files.write(a,'../escape.txt','no'),/path_invalid/);
  fs.renameSync(selected,selected+'-moved');
  assert.equal(f.roots.status(a).verified,false);
  assert.equal(f.files.status(a).writeAvailable,false);
  assert.throws(()=>f.files.write(a,'fresh.txt','no'),/missing_or_moved/);
  // A new folder with the SAME path is not the originally approved folder.
  fs.mkdirSync(selected);
  assert.equal(f.roots.status(a).verified,false);
  assert.equal(f.files.status(a).writeAvailable,false);
  assert.throws(()=>f.files.write(a,'fresh.txt','no'),/missing_or_moved/);
  assert.equal(fs.existsSync(path.join(selected+'-moved','fresh.txt')),false);
});

test('historical private files block silent rebinding; deleting project metadata does not delete user workspace',async t=>{
  const f=fixture(t);
  const old=await f.project('OldProject');
  assert.throws(()=>f.files.write(old,'should-not-exist.txt','blocked'),/binding_required/);
  const privateFolder=path.join(f.privateRoot,old);
  fs.mkdirSync(privateFolder,{recursive:true});
  fs.writeFileSync(path.join(privateFolder,'kept.txt'),'historical');
  assert.throws(()=>f.roots.createDefault(old),/migration_required/);
  assert.equal(f.roots.status(old).configured,false);
  assert.equal(f.files.read(old,'kept.txt').content,'historical');
  const modern=await f.project('Modern');
  const root=f.roots.createDefault(modern).path;
  f.files.write(modern,'code.txt','kept');
  const receipt=await f.service.invoke(f.context,'project_delete',{
    projectId:modern,confirmName:'Modern',requestId:'delete_modern'
  });
  assert.equal(receipt.status,'succeeded');
  assert.equal(fs.readFileSync(path.join(root,'code.txt'),'utf8'),'kept');
  assert.equal(f.store.db.prepare(
    'SELECT COUNT(*) AS n FROM forge_local_project_roots WHERE project_id=?'
  ).get(modern).n,0);
  assert.equal(f.files.read(old,'kept.txt').content,'historical');
});

test('owner-confirmed migration physically moves a legacy tree once and preserves SQLite project identity',async t=>{
  const f=fixture(t);
  const id=await f.project('Legado Café');
  const old=path.join(f.privateRoot,id);
  fs.mkdirSync(path.join(old,'src'),{recursive:true});
  fs.writeFileSync(path.join(old,'src','index.html'),'<h1>Antes</h1>');
  fs.mkdirSync(path.join(old,'empty'),{recursive:true});
  const original=f.roots.status(id);
  assert.equal(original.legacyMigrationRequired,true);
  assert.equal(f.files.status(id).writeAvailable,false);
  const result=f.roots.migrateLegacy(id);
  assert.equal(result.migrated,true);
  assert.equal(result.filesMoved,1);
  assert.equal(result.sourceRemoved,true);
  assert.equal(result.verified,true);
  assert.equal(fs.existsSync(old),false);
  assert.equal(fs.readFileSync(path.join(result.path,'src','index.html'),'utf8'),'<h1>Antes</h1>');
  assert.equal(fs.statSync(path.join(result.path,'empty')).isDirectory(),true);
  assert.equal(f.files.read(id,'src/index.html').content,'<h1>Antes</h1>');
  const updated=f.files.write(id,'src/index.html','<h1>Depois</h1>',
    f.files.read(id,'src/index.html').sha256);
  assert.equal(updated.source,'forge_owner_bound_workspace');
  assert.equal(fs.readFileSync(path.join(result.path,'src','index.html'),'utf8'),'<h1>Depois</h1>');
  assert.equal(f.roots.status(id).path,result.path);
  const reload=new ForgeLocalWorkspaces({store:f.store,
    documentsDirectory:path.join(f.temp,'Documents'),legacyRoot:f.privateRoot});
  assert.equal(reload.status(id).verified,true);
  assert.throws(()=>f.roots.migrateLegacy(id),/already_bound/);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_projects WHERE id=?').get(id).n,1);
});

test('migration refuses active work and existing destinations, retaining old files until safe',async t=>{
  const f=fixture(t);
  const id=await f.project('Existing');
  const old=path.join(f.privateRoot,id);
  fs.mkdirSync(old,{recursive:true});
  fs.writeFileSync(path.join(old,'file.txt'),'original');
  const defaultFolder=path.join(f.temp,'Documents','Forge','Existing');
  fs.mkdirSync(defaultFolder,{recursive:true});
  fs.writeFileSync(path.join(defaultFolder,'do-not-touch.txt'),'human file');
  f.store.db.prepare('UPDATE lab_projects SET observation_requested=1 WHERE id=?').run(id);
  assert.throws(()=>f.roots.migrateLegacy(id),/observation_active/);
  assert.equal(fs.readFileSync(path.join(old,'file.txt'),'utf8'),'original');
  f.store.db.prepare('UPDATE lab_projects SET observation_requested=0 WHERE id=?').run(id);
  const moved=f.roots.migrateLegacy(id);
  assert.notEqual(moved.path,defaultFolder);
  assert.equal(fs.readFileSync(path.join(defaultFolder,'do-not-touch.txt'),'utf8'),'human file');
  assert.equal(fs.readFileSync(path.join(moved.path,'file.txt'),'utf8'),'original');
  assert.equal(fs.existsSync(old),false);
});
