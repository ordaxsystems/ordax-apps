import { cp, mkdir, readFile, readdir, rename, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Official Electron folder distribution. No global install, account data or project files.
const host = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(host, '../..');
if (process.platform !== 'win32') throw new Error('Gere esta distribuição no Windows.');
const info = JSON.parse(await readFile(path.join(host, 'package.json'), 'utf8'));
const studioInfo = JSON.parse(await readFile(path.join(repository, 'apps/studio/app.json'), 'utf8'));
if (studioInfo.id !== 'studio' || studioInfo.version !== info.version) throw new Error('A identidade/versão do host deve coincidir com o source Studio.');
const runtime = path.join(host, 'node_modules/electron/dist');
await stat(path.join(runtime, 'electron.exe'));
const output = path.join(host, '.data/portable', `ORDAX-Studio-${info.version}-win-${process.arch}-${randomUUID().slice(0, 8)}`);
const appRoot = path.join(output, 'resources/app');
await mkdir(output, { recursive: true });
await cp(runtime, output, { recursive: true });
await rename(path.join(output, 'electron.exe'), path.join(output, 'ORDAX Studio.exe'));
await mkdir(appRoot, { recursive: true });
for (const folder of ['src', 'assets']) {
  await cp(path.join(repository, 'apps/studio/conversation', folder), path.join(appRoot, 'apps/studio/conversation', folder), { recursive: true });
  await cp(path.join(repository, 'apps/studio', folder), path.join(appRoot, 'apps/studio', folder), { recursive: true });
}
for (const file of ['app.json', 'README.md']) await cp(path.join(repository, 'apps/studio', file), path.join(appRoot, 'apps/studio', file));
for (const folder of ['ai', 'actions']) await cp(path.join(repository, 'apps/studio', folder), path.join(appRoot, 'apps/studio', folder), { recursive: true });
await cp(path.join(host, 'native'), path.join(appRoot, 'tools/assistant-host/native'), { recursive: true });
for (const file of ['storage.mjs', 'web-server.mjs', 'package.json']) await cp(path.join(host, file), path.join(appRoot, 'tools/assistant-host', file));
await writeFile(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'ordax-studio', productName: 'ORDAX Studio', version: info.version, private: true, main: 'tools/assistant-host/native/main.cjs' }, null, 2));
await writeFile(path.join(output,'candidate-dependencies.json'),JSON.stringify({product:'ORDAX Studio',version:info.version,candidate:true,presentationRuntime:{name:'Electron/Chromium',electronVersion:info.dependencies.electron,bundled:true,separateChromeNodeNpmInstallRequiredForApp:false},projectRuntime:{owner:'ordaxsystems/ordax-runtime',bundled:false,automaticEnvironmentPreparation:false,automaticPreviewServerStart:false,productPreviewURLDiscovery:false,requirements:'depend-on-project'},installation:{artifact:'unsigned-portable-folder',officialWindowsInstallerVerified:false,ordaxOSAdapterVerified:false,bundlesSecondRuntimeIntoOrdaxOS:false}},null,2));
await writeFile(path.join(output, 'LEIA-ME.txt'), `ORDAX Studio ${info.version}\r\n\r\nAbra ORDAX Studio.exe. Mantenha esta pasta inteira: ela contém o runtime.\r\nNode.js, npm, Codex e Work não são necessários para abrir a versão portátil.\r\nO login é concluído manualmente no ChatGPT Web dentro do app. O uso segue os limites do ChatGPT Web.\r\nO perfil e o histórico ficam em %LOCALAPPDATA%/OrdaX/Assistant-web.\r\nNão há importação da sessão do navegador externo.\r\nEsta é uma compilação local sem assinatura digital ou instalador.\r\nLicenças do runtime: LICENSE e LICENSES.chromium.html.\r\n`);
const hashes = [];
async function inventory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await inventory(file);
    else { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); hashes.push({ path: path.relative(output, file).replaceAll('\\', '/'), sha256: hash.digest('hex') }); }
  }
}
await inventory(output);
await writeFile(path.join(output, 'build-manifest.json'), JSON.stringify({ app: 'ORDAX Studio', version: info.version, candidate: true, sourceRepository: 'ordaxsystems/ordax-apps', sourcePath: 'apps/studio', entrypoint: 'apps/studio/conversation/src/index.html', advancedWorkspaceEntrypoint: 'apps/studio/src/index.html', host: 'local-development', officialWindowsHostOwner: 'ordaxsystems/ordax-runtime', electron: info.dependencies.electron, platform: process.platform, arch: process.arch, createdAt: new Date().toISOString(), files: hashes }, null, 2));
await writeFile(path.join(host, '.data/portable/latest-build.json'), JSON.stringify({ directory: output, executable: path.join(output, 'ORDAX Studio.exe') }, null, 2));
console.log(`Distribuição portátil gerada: ${path.join(output, 'ORDAX Studio.exe')}`);
console.log(`${hashes.length} arquivos verificados; nenhum perfil, histórico ou dependência do Codex incluído.`);
