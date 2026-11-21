import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHostApplication} from '../host/host-application.mjs';
import {PRODUCT_NAME} from '../src/product-brand.mjs';
import {acquireHostProfileLock} from '../host/host-profile-lock.mjs';
import {resolveForgeNodeHostMode,resolveForgeNodeOwnerDocumentsDirectory} from '../host/host-owner-mode.mjs';
import {createForgeWindowsSafeStorage} from '../src/forge-windows-safe-storage.mjs';
import {createForgeProductSession,FORGE_NATIVE_OAUTH_CLIENT_ID} from '../src/forge-product-session.mjs';

const [major,minor]=process.versions.node.split('.').map(Number);
if(major<22||(major===22&&minor<13))throw Error('node_22_13_or_newer_required');
if(process.versions.electron)throw Error('node_host_must_not_run_inside_electron');
const productRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mode=resolveForgeNodeHostMode({productRoot});
const {dataRoot}=mode;
// The Node Core reads the SAME Windows Chromium DPAPI profile as Electron;
// no bearer passes through environment, argv, UI IPC or a second credential DB.
const remoteSession=mode.owner?createForgeProductSession({
  userRoot:mode.userRoot,
  safeStorage:createForgeWindowsSafeStorage({userRoot:mode.userRoot})
}):null;
if(mode.owner){
  const state=remoteSession.status();
  if(state.connected!==true||state.mode!=='oauth'||
      state.clientId!==FORGE_NATIVE_OAUTH_CLIENT_ID)
    throw Error('forge_node_owner_secure_session_unavailable');
}
// Acquire the single on-disk profile lock BEFORE creating the SQLite Store.
const releaseLock=await acquireHostProfileLock(dataRoot);
let application;
let server;
let stopping=null;
const shutdown=()=>{
  if(stopping)return stopping;
  stopping=(async()=>{
    await server?.close();
    // When this Node process becomes the authenticated gateway owner, stop
    // remote claiming/reporting BEFORE closing the unique SQLite Core.
    await application?.stopRemoteGateway();
    application?.close();
    await releaseLock();
  })();
  return stopping;
};
try {
  application=createHostApplication({productRoot,dataRoot,remoteSession,
    nativeOwner:mode.owner?{userRoot:mode.userRoot,dedicatedProject:true,
      documentsDirectory:resolveForgeNodeOwnerDocumentsDirectory()}:null});
  if(mode.owner)await application.startRemoteGateway();
  server=application.createServer({onShutdown:()=>{void shutdown();}});
  const {url}=await server.listen();
  process.stdout.write(`ORDAX_HOST_BROWSER_URL=${url}\n`);
  process.stdout.write(`${PRODUCT_NAME} Node host iniciado. Core único; gateway remoto: ${mode.owner?'autorizado':'desativado'}. Nenhum executor GPT no App.\n`);
  process.once('SIGINT',()=>{void shutdown().finally(()=>process.exit(0));});
  process.once('SIGTERM',()=>{void shutdown().finally(()=>process.exit(0));});
} catch(error) {
  await shutdown().catch(()=>{});
  throw error;
}
