import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {
  forgeGitDirectory,forgeProductDirectory,productRequire,repositoryRoot,
  stageForgeGit,temporaryStagePrefix
} from './runtime.mjs';

// No separate npm install, copied application source or second Core.
// The same Forge product owns the Electron toolchain.
if(process.platform!=='win32'){
  console.error('forge_git_windows_build_requires_windows');
  process.exit(1);
}
const preloadBuild=spawnSync(process.execPath,
  [path.join(forgeProductDirectory,'scripts','build-worker-preload.mjs')],{
    cwd:repositoryRoot,stdio:'inherit',windowsHide:true
  });
if(preloadBuild.error||preloadBuild.status!==0)
  throw Error('forge_git_shared_preload_build_failed');

const stage=mkdtempSync(temporaryStagePrefix);
try{
  const staged=stageForgeGit({stageDirectory:stage});
  const electronVersion=productRequire('electron/package.json').version;
  const output=path.join(forgeGitDirectory,'dist');
  mkdirSync(output,{recursive:true});
  const sharedIcon=path.join(forgeProductDirectory,'build','icon.png');
  const builder=productRequire('electron-builder');
  const artifacts=await builder.build({
    projectDir:stage,
    targets:builder.Platform.WINDOWS.createTarget(['portable'],builder.Arch.x64),
    config:{
      appId:'br.com.ordax.forge.git',
      productName:'OrdaX Forge Git',
      electronVersion,
      asar:true,
      npmRebuild:false,
      compression:'normal',
      files:['package.json','forge-git/**/*','forge/product/**/*'],
      directories:{output},
      win:{
        target:[{target:'portable',arch:['x64']}],
        artifactName:['OrdaX-Forge-Git-','$','{version}.','$','{ext}'].join(''),
        executableName:'OrdaX Forge Git',
        ...(existsSync(sharedIcon)?{icon:sharedIcon}:{})
      }
    }
  });
  console.log(JSON.stringify({
    schema:'ordax.forge-git.local-build/1',
    version:staged.version,
    runtimeFiles:staged.files.length,
    output,
    artifacts
  },null,2));
}finally{
  rmSync(stage,{recursive:true,force:true});
}
