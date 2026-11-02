import {OrchestratorService} from './orchestrator-service.mjs';
import {createOrchestratorMcp} from './orchestrator-mcp.mjs';

/**
 * Creates the single app-owned Orchestrator domain instance used by the
 * Electron shell and the Node host. The caller owns Store and process
 * lifecycle; this module never opens a second database or executor.
 */
export function createOrchestratorKernel({
  store,
  actorId='lab-owner',
  clientId='lab-ui',
  authorize,
  provider=null,
  coordinator=null,
  confirmProposal=null,
  confirmProposalSend=null,
  workspacePort=null,
  repositoryPort=null,
  version='development'
}={}) {
  if(!store?.getWorkspaceSession||typeof authorize!=='function')
    throw Error('orchestrator_kernel_ports_required');
  const context=Object.freeze({actorId,clientId,workspaceSessionId:store.getWorkspaceSession().id});
  const service=new OrchestratorService({
    store,authorize,provider,coordinator,confirmProposal,confirmProposalSend,workspacePort,repositoryPort
  });
  const mcp=createOrchestratorMcp({service,getContext:()=>context,version});
  return Object.freeze({context,service,mcp});
}
