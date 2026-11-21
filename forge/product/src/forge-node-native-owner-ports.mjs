import path from 'node:path';
import {ForgeLocalWorkspaces} from './forge-local-workspaces.mjs';
import {ForgeProjectFiles} from './forge-project-files.mjs';
import {ForgeProjectDevelopment} from './forge-project-development.mjs';
import {ForgeMcpOwnerTrust} from './forge-mcp-owner-trust.mjs';
import {forgeOwnerWorkspaceScope} from './forge-owner-workspace-scope.mjs';

/**
 * The Node Host reuses the existing native Owner classes; it never invents a
 * separate permission source, interpreter, filesystem broker or worktree
 * implementation. Only the explicitly selected Owner process may compose it.
 */
export function createForgeNodeNativeOwnerPorts({
  store,dataRoot,userRoot,documentsDirectory,environment=process.env
}={}){
  if(!store?.db||typeof userRoot!=='string'||typeof dataRoot!=='string'||
    typeof documentsDirectory!=='string'||!path.isAbsolute(userRoot)||
    !path.isAbsolute(dataRoot)||!path.isAbsolute(documentsDirectory))
    throw Error('forge_node_native_owner_ports_required');
  const same=(a,b)=>process.platform==='win32'
    ?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase()
    :path.resolve(a)===path.resolve(b);
  if(!same(dataRoot,path.join(userRoot,'data')))
    throw Error('forge_node_native_owner_profile_mismatch');
  // The Node Core may inspect only the recorded project workspace and
  // optional exact Task worktree; every native effect requires existing
  // Owner scope approval and the canonical Task claim/receipt.
  const workspaces=new ForgeLocalWorkspaces({
    store,documentsDirectory,legacyRoot:path.join(dataRoot,'project-files'),
    forbiddenRoots:[userRoot,path.dirname(process.execPath),
      environment.SystemRoot,environment.ProgramFiles,environment.ProgramData,
      environment['ProgramFiles(x86)']]
      .filter(x=>typeof x==='string'&&path.isAbsolute(x))
  });
  const files=new ForgeProjectFiles({
    root:path.join(dataRoot,'project-files'),
    workspaceLookup:(projectId,taskId=null)=>workspaces.rootForProject(projectId,taskId),
    requireOwnerBinding:true
  });
  const ownerTrust=new ForgeMcpOwnerTrust({
    store,appIdentity:userRoot,
    scopeSignature:projectId=>forgeOwnerWorkspaceScope(workspaces,projectId)
  });
  const development=new ForgeProjectDevelopment({
    store,workspaces,ownerTrust,devAutonomy:false
  });
  return Object.freeze({workspaces,files,ownerTrust,development,
    authorizeFileRead:projectId=>{
      try{return workspaces.status(projectId).verified===true;}
      catch{return false;}
    }});
}
