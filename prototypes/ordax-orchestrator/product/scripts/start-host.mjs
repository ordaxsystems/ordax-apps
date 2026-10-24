import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHostApplication} from '../host/host-application.mjs';
import {acquireHostProfileLock} from '../host/host-profile-lock.mjs';

const [major,minor]=process.versions.node.split('.').map(Number);
if(major<22||(major===22&&minor<13))throw Error('node_22_13_or_newer_required');
if(process.versions.electron)throw Error('node_host_must_not_run_inside_electron');
const productRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataRoot=path.join(productRoot,'.host-profile');
const releaseLock=await acquireHostProfileLock(dataRoot);
let application;
let server;
let stopping=null;
const shutdown=()=>{
  if(stopping)return stopping;
  stopping=(async()=>{
    await server?.close();
    application?.close();
    await releaseLock();
  })();
  return stopping;
};
try {
  application=createHostApplication({productRoot,dataRoot});
  server=application.createServer({onShutdown:()=>{void shutdown();}});
  const {url}=await server.listen();
  process.stdout.write(`ORDAX_HOST_BROWSER_URL=${url}\n`);
  process.stdout.write('OrdaX Orchestrator Node host iniciado. Perfil de desenvolvimento isolado; ChatGPT executor não conectado.\n');
  process.once('SIGINT',()=>{void shutdown().finally(()=>process.exit(0));});
  process.once('SIGTERM',()=>{void shutdown().finally(()=>process.exit(0));});
} catch(error) {
  await shutdown().catch(()=>{});
  throw error;
}
