import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const read=relative=>fs.readFileSync(fileURLToPath(new URL(relative,import.meta.url)),'utf8');

test('only native Owner picker may create or revoke a local repository root',()=>{
  const main=read('../desktop/main.mjs');
  const preload=read('../desktop/preload.cjs');
  const ui=read('../desktop/orchestrator-ui.mjs');
  const host=read('../host/host-application.mjs');
  assert.match(main,/new ForgeLocalRepositoryOwnerBindings\(/);
  const remote=read('../src/forge-remote-mcp-owner.mjs');
  const gateway=read('../src/forge-remote-gateway-client.mjs');
  assert.match(main,/onOwnerIdentityBound:\(\)=>\{if\(!stagedProfile\)refreshLocalRepositoryOwnerPort\(\);\}/);
  assert.match(remote,/ownerTrust\.bindRemoteOwnerIdentity\(value\);[\s\S]*?onOwnerIdentityBound\(\)/);
  assert.match(gateway,/this\.bindOwnerIdentity\(\{subjectId:account\.subjectId,issuer:account\.issuer\}\)/);

  // Reuse the existing remote and loopback Owner ports; tool publication
  // must be recalculated after physical approval and revocation.
  assert.match(main,/allowedOperations:\(\)=>dedicatedForgeMcpOperations\(store,allowedOperations,\{/);
  assert.match(main,/repositoryReadPortAvailable:Boolean\(orchestratorService\.repositoryReadPort\)/);
  assert.match(main,/repositoryWritePortAvailable:Boolean\(orchestratorService\.repositoryWritePort\)/);

  assert.match(main,/readDedicatedForgeProject\(store\)/);
  assert.match(main,/requireTrustedSupervisorRenderer\(event\)/);
  assert.match(main,/dialog\.showOpenDialog\(win,/);
  assert.match(main,/confirmInActiveUi\(\{/);
  assert.match(main,/forgeLocalRepositoryOwners\.bindSelected\(\{\s*projectId,repository,selectedRoot:chosen\.filePaths\[0\]/);
  assert.match(main,/forgeLocalRepositoryOwners\.revoke\(\{projectId,repository\}\)/);
  assert.match(preload,/forgeRepositoryOwnerChoose: repo => ipcRenderer\.invoke\('ordax:forge:repository-owner:choose',repo\)/);
  assert.match(preload,/forgeRepositoryOwnerRevoke: repo => ipcRenderer\.invoke\('ordax:forge:repository-owner:revoke',repo\)/);
  assert.doesNotMatch(preload,/forgeRepositoryOwnerChoose:[^\n]*selectedRoot|forgeRepositoryOwnerChoose:[^\n]*path/);
  assert.match(ui,/limit!==Infinity\|\|fdView!=='repositories'/);
  assert.match(ui,/api\.forgeRepositoryOwnerChoose\(repo\)|act\(api\.forgeRepositoryOwnerChoose\)/);
  assert.match(host,/localRoots\.hasApprovedRoot\(readDedicatedForgeProject\(store\)\?\.projectId\)/);
  assert.match(host,/resolveOwnerBinding:scope=>localRoots\.resolve\(scope\)/);
  assert.match(main,/forgeLocalRepositoryOwners\.approveWrite\(\{projectId,repository\}\)/);
  assert.match(main,/forgeLocalRepositoryOwners\.revokeWrite\(\{projectId,repository\}\)/);
  assert.match(main,/title:'Autorizar escrita local pelo Forge MCP'/);
  assert.match(preload,/forgeRepositoryOwnerApproveWrite: repo => ipcRenderer\.invoke\('ordax:forge:repository-owner:write-approve',repo\)/);
  assert.match(preload,/forgeRepositoryOwnerRevokeWrite: repo => ipcRenderer\.invoke\('ordax:forge:repository-owner:write-revoke',repo\)/);
  assert.match(ui,/writeGranted\?api\.forgeRepositoryOwnerRevokeWrite/);
  assert.match(host,/service\.repositoryWritePort=new ForgeRepositoryOwnerWritePort/);
});
test('local permissions remain distinct from remote Runtime attestation',()=>{
  const reader=read('../src/forge-repository-owner-read-port.mjs');
  const local=read('../src/forge-local-repository-owner-bindings.mjs');
  assert.match(reader,/proof\?\.source==='forge_native_local_owner'/);
  assert.match(reader,/proof\?\.source==='forge_platform_runtime'/);
  assert.match(local,/source:'forge_native_local_owner'/);
  assert.match(local,/localHostVerified:true,deviceBindingAttested:false/);
  assert.match(local,/canonicalOrdaxRepositoryRemote/);
  assert.match(local,/forge_local_repository_owner_oauth_required/);
  assert.match(local,/readDedicatedForgeProject\(this.store\)/);
});
