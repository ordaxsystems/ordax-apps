import {createOrchestratorMcp} from './orchestrator-mcp.mjs';
import {ForgeRemoteGatewayClient} from './forge-remote-gateway-client.mjs';
import {FORGE_APP_MCP_OPERATIONS} from './forge-loopback-mcp.mjs';
import {observeMcpToolCall} from './forge-mcp-observation.mjs';
import {dedicatedForgeMcpOperations} from './forge-dedicated-project.mjs';

/**
 * One ingress for the canonical Forge MCP gateway, composable by either
 * Electron Core or the independent Node Core. It never opens a database,
 * creates a credential store, or grants Owner consent. The process that owns
 * Store supplies a verified, private credential port.
 */
export function createForgeRemoteMcpOwner({
  store,service,getContext,ownerTrust,session,version,
  allowedOperations=FORGE_APP_MCP_OPERATIONS,
  authorizeFileRead=()=>false,onMutation=({output})=>output,
  onOwnerIdentityBound=()=>{},fetchImpl=globalThis.fetch
}={}) {
  if(!store?.db||typeof service?.invoke!=='function'||
     typeof getContext!=='function'||typeof ownerTrust?.isAppTrusted!=='function'||
     typeof ownerTrust?.bindRemoteOwnerIdentity!=='function'||
     typeof session?.status!=='function'||typeof session?.accessToken!=='function'||
     typeof onMutation!=='function'||typeof authorizeFileRead!=='function'||
     typeof onOwnerIdentityBound!=='function'||
     !Array.isArray(allowedOperations)||
     allowedOperations.some(op=>!FORGE_APP_MCP_OPERATIONS.includes(op)))
    throw Error('forge_remote_mcp_owner_ports_required');

  const mcp=createOrchestratorMcp({
    service,getContext,version,
    // Keep the existing public MCP tool input schemas (projectId required).
    // The installed Forge connector still supplies projectId; narrowing the
    // JSON schema would reject those tools at the gateway before they reach
    // the canonical dedicated-project access guard in OrchestratorService.
    allowedOperations:()=>dedicatedForgeMcpOperations(store,allowedOperations,
      {repositoryReadPortAvailable:Boolean(service.repositoryReadPort),
       repositoryWritePortAvailable:Boolean(service.repositoryWritePort),
       repositoryProcessPortAvailable:Boolean(service.repositoryProcessPort)}),authorizeFileRead,
    afterToolInvoke:({operation,args,output,transportReceipt})=>{
      try {
        observeMcpToolCall({store,operation,output,ingress:'remote_gateway',
          transportReceipt});
      }catch{}
      return onMutation({operation,args,output,transportReceipt});
    }
  });
  let sequence=10_000;
  const initialized=(async()=>{
    const result=await mcp.handle({
      jsonrpc:'2.0',id:++sequence,method:'initialize',
      params:{protocolVersion:'2025-11-25',capabilities:{},
        clientInfo:{name:'ordax-forge-remote-gateway',version}}
    });
    if(!result?.result?.protocolVersion)
      throw Error('forge_remote_mcp_initialize_failed');
    await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
    return true;
  })();
  // A rejected init must not be an unhandled promise before a user-initiated
  // session/Owner grant starts the transport.
  void initialized.catch(()=>{});
  async function invoke(method,params={},receipt=null){
    await initialized;
    if(!ownerTrust.isAppTrusted())throw Error('forge_mcp_app_untrusted');
    const result=await mcp.handle({
      jsonrpc:'2.0',id:++sequence,method,params
    },receipt);
    if(!result||result.error)throw Error('forge_remote_local_mcp_error');
    return result;
  }
  const gateway=new ForgeRemoteGatewayClient({
    store,session,appVersion:version,fetchImpl,
    catalogProvider:async()=>(await invoke('tools/list',{})).result.tools,
    toolInvoker:(name,args,receipt)=>invoke('tools/call',
      {name,arguments:args},receipt),
    bindOwnerIdentity:value=>{
      ownerTrust.bindRemoteOwnerIdentity(value);
      // After remote registration resolves the actual Owner identity, native
      // ports may be restored from EXISTING SQLite consent. Never mint a grant.
      onOwnerIdentityBound();
    }
  });
  const start=async()=>{
    if(!ownerTrust.isAppTrusted())throw Error('forge_mcp_app_untrusted');
    if(session.status().connected!==true)
      throw Error('forge_product_session_unavailable');
    return gateway.start();
  };
  return Object.freeze({gateway,invoke,start,stop:()=>gateway.stop()});
}

/**
 * Explicit Node surface: only SQLite-backed Task/project/claim/memory tools.
 * Browser DOM, workspace, filesystem, terminal and Git verification belong
 * to ports unavailable in a plain Node Host and are NOT advertised remotely.
 */
const NODE_SQLITE_OPERATIONS=new Set([
  'status','projects_list','forge_discover','project_context','project_repositories','ordax_devices','ordax_native_session_open','ordax_repository_probe','ordax_execution_preflight',
  'project_memory','project_memory_propose','project_administrator_snapshot',
  'project_handoff','project_activity','project_preflight',
  'mission_create','project_rename',
  'orchestrators_list','orchestrator_create','orchestrator_pause',
  'continuity_status','work_claim','work_progress','work_memory_set',
  'work_create','work_batch_create','work_draft_set','work_dependency_set',
  'work_list','work_plan','work_get','work_messages','work_repositories','work_repositories_set','conversation_rotate',
  'work_failover_prepare','proposals_list','command_get'
]);
const NODE_NATIVE_OPERATIONS=new Set([
  'repository_inspect','repository_files_list','repository_file_read',
  'repository_git_status','repository_git_diff',
  'repository_git_log','repository_git_branches','repository_file_write',
  'repository_process_start','repository_process_status',
  'repository_process_logs','repository_process_list','repository_process_stop',
  'project_files_status','project_files_list','project_file_read','project_file_write',
  'project_development_status','project_command_run',
  'project_worktree_prepare','project_worktree_review',
  'project_worktree_verify','project_worktree_integrate'
]);
// A Node Host without native Owner ports must never advertise the above tools.
// Even with ports, every read/command/worktree checks the exact physical
// workspace identity, durable native approval and Task lease where required.
export const FORGE_NODE_REMOTE_MCP_OPERATIONS=Object.freeze(
  FORGE_APP_MCP_OPERATIONS.filter(op=>NODE_SQLITE_OPERATIONS.has(op)));
export const FORGE_NODE_NATIVE_REMOTE_MCP_OPERATIONS=Object.freeze(
  FORGE_APP_MCP_OPERATIONS.filter(op=>NODE_SQLITE_OPERATIONS.has(op)||
    NODE_NATIVE_OPERATIONS.has(op)));
