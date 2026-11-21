// The same workspace scope is used by the Electron Core and Node Core.
// A saved project approval remains valid only for the exact verified
// Windows folder physical identity; no missing/moved folder becomes trusted.
export function forgeOwnerWorkspaceScope(workspaces,projectId){
  const binding=workspaces.binding(projectId);
  if(!binding)return 'app-private:'+projectId;
  if(!workspaces.status(projectId).verified)
    throw Error('forge_mcp_trust_workspace_unverified');
  return 'owner-bound:'+binding.root+':'+binding.identity;
}
