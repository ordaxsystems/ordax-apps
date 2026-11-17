// Forge Git is a provider transport, never an executor scheduler.
// Only the Forjador may submit a conversational request through the
// explicitly selected Forge MCP. Work Tasks are dispatched by Forge Core.
export function assertForgeGitTransport({agentId,autoContinue=false,continuation=false}={}) {
  if(agentId!=='forjador')throw Error('forge_core_owns_work_dispatch');
  if(autoContinue===true||continuation===true)
    throw Error('forge_core_owns_continuity');
  return Object.freeze({role:'forjador',requiresMcp:true,
    ownsProjectState:false,ownsWorkRuns:false,ownsGit:false});
}
