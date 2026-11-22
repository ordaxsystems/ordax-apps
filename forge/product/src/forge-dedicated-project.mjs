// Dedicated deployment scope stored in the SAME Forge workspace-session
// metadata as every other process-local product setting. No second Store,
// per-repository project records or parallel coordination DB.
export const ORDAX_FORGE_PROJECT_KEY='ordax-os';
export const ORDAX_FORGE_PROJECT_NAME='OrdaX OS';
const SCHEMA='ordax.forge.dedicated-project/1';
const FORBIDDEN=new Set([
  'project_create','project_quick_create','mission_create',
  'project_delete','project_rename','project_auto_title',
  'project_repository_set','project_observation_set'
]);
// The original Forge native development port is scoped to exactly one
// project root. It CANNOT claim the eight independent OrdaX repository
// owners merely because they share a single project/Task coordinator.
// Execution stays with authorized OrdaX MCP tools until a per-repository
// owner-verified port and receipt contract exists. Do not route a Task to
// whichever unrelated Git root happens to be selected in the native UI.
const SINGLE_REPOSITORY_PORTS=new Set([
  'project_files_list','project_file_read','project_file_write',
  'project_worktree_prepare','project_worktree_review',
  'project_worktree_verify','project_worktree_integrate',
  'project_command_run','work_accept','repository_observe'
]);
export function readDedicatedForgeProject(store){
  const session=store?.getWorkspaceSession?.();
  const state=session?.metadata?.forgeDedicatedProject;
  if(state===undefined)return null;
  if(!state||state.schema!==SCHEMA||state.key!==ORDAX_FORGE_PROJECT_KEY||
     typeof state.projectId!=='string'||!/^project_[A-Za-z0-9-]{1,100}$/.test(state.projectId))
    throw Error('forge_dedicated_project_metadata_invalid');
  const row=store.db.prepare(
    'SELECT id,name FROM lab_projects WHERE id=? AND workspace_session_id=?'
  ).get(state.projectId,session.id);
  if(!row||row.name!==ORDAX_FORGE_PROJECT_NAME)
    throw Error('forge_dedicated_project_binding_invalid');
  return Object.freeze({schema:SCHEMA,key:state.key,mode:'dedicated',
    projectId:state.projectId,name:row.name,repositoryAuthority:'ordax_os_ownership_contract'});
}
export function activateDedicatedForgeProject(service){
  const store=service?.store;
  if(!store?.db||typeof service.transaction!=='function'||typeof service.createProjectRecord!=='function')
    throw Error('forge_dedicated_project_owner_required');
  return service.transaction(()=>{
    // Only Task→repository membership is stored here. Names, owners, repo
    // URLs and capabilities remain defined exclusively by the OS manifest.
    store.db.exec(`CREATE TABLE IF NOT EXISTS forge_work_repository_scope(
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES lab_projects(id) ON DELETE CASCADE,
      repository TEXT NOT NULL,
      PRIMARY KEY(task_id,repository)
    )`);
    const existing=readDedicatedForgeProject(store);
    if(existing)return existing;
    // The Owner opts this *installation* into the new format. Historical
    // projects, Tasks, claims, receipts and assets remain unchanged on disk;
    // they are not promoted as current development work.
    const projectId=service.createProjectRecord(ORDAX_FORGE_PROJECT_NAME,
      'Evolução integrada do OrdaX OS e seus repositórios canônicos, com SSOT, claims, evidências e MCP-First.',
      null,store.now());
    // Reuse the existing canonical coordinator creation mechanics. No
    // speculative GPT message, Work Task, provider send or remote operation.
    service.mutate('orchestrator_create',{
      projectId,name:'Administrador OrdaX OS',
      mission:'Coordenar o desenvolvimento dos repositórios OrdaX por Tasks, claims e evidências; não inferir permissões ou concluir efeitos sem recibo.'
    });
    store.updateWorkspaceMetadata({forgeDedicatedProject:{
      schema:SCHEMA,key:ORDAX_FORGE_PROJECT_KEY,projectId
    }});
    return readDedicatedForgeProject(store);
  });
}
export function enforceDedicatedForgeProject(store,operation,input){
  const scope=readDedicatedForgeProject(store);
  if(!scope)return null;
  if(FORBIDDEN.has(operation))
    throw Error('forge_dedicated_project_operation_unavailable');
  if(SINGLE_REPOSITORY_PORTS.has(operation))
    throw Error('forge_dedicated_repository_executor_required');
  if(input?.projectId!=null&&input.projectId!==scope.projectId)
    throw Error('forge_dedicated_project_scope_denied');
  return scope;
}
const REPOSITORY_READ_PORTS=new Set(['repository_inspect','repository_files_list','repository_file_read']);
const REPOSITORY_WRITE_PORTS=new Set(['repository_file_write']);
export function dedicatedForgeMcpOperations(store,operations,
  {repositoryReadPortAvailable=false,repositoryWritePortAvailable=false}={}){
  const scope=readDedicatedForgeProject(store);
  // New tools cannot be discovered merely because they have JSON schemas.
  // They require a real, trusted Forge-native Owner port in this process.
  return operations.filter(op=>
    (scope?(!FORBIDDEN.has(op)&&!SINGLE_REPOSITORY_PORTS.has(op)):true)&&
    (!REPOSITORY_READ_PORTS.has(op)||
      (scope!==null&&repositoryReadPortAvailable===true))&&
    (!REPOSITORY_WRITE_PORTS.has(op)||
      (scope!==null&&repositoryWritePortAvailable===true)));
}
