import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {
  collectRuntimeFiles,forgeGitDirectory,forgeProductDirectory,repositoryRoot,
  resolveSharedElectron
} from './runtime.mjs';

// One Electron installation, owned by forge/product; no second Core,
// scheduler or provider implementation is installed by Forge Git.
try{
  const bundle=path.join(forgeProductDirectory,'desktop','worker-preload.bundle.cjs');
  if(!existsSync(bundle))throw Error(
    'forge_git_shared_preload_missing: npm run build:worker-preload --prefix forge/product');
  collectRuntimeFiles(repositoryRoot);
  const executable=resolveSharedElectron();
  const env={...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(executable,[forgeGitDirectory,...process.argv.slice(2)],{
    cwd:forgeGitDirectory,env,stdio:'inherit',windowsHide:false
  });
  child.once('error',error=>{console.error('Forge Git Electron:',error);process.exitCode=1;});
  child.once('exit',(code,signal)=>{
    process.exitCode=code??(signal?1:0);
  });
  for(const signal of ['SIGINT','SIGTERM']){
    process.on(signal,()=>{if(!child.killed)child.kill(signal);});
  }
}catch(error){
  console.error('Forge Git startup:',error.message);
  process.exitCode=1;
}
