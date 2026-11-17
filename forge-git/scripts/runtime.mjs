import {copyFileSync,existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {builtinModules,createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeForgeGitRuntimeManifest,verifyForgeGitRuntimeManifest} from '../runtime-integrity.mjs';

export const repositoryRoot=fileURLToPath(new URL('../../',import.meta.url));
export const forgeGitDirectory=path.join(repositoryRoot,'forge-git');
export const forgeProductDirectory=path.join(repositoryRoot,'forge','product');
export const productRequire=createRequire(path.join(forgeProductDirectory,'package.json'));

const ENTRYPOINTS=Object.freeze([
  'forge-git/bootstrap.mjs',
  'forge-git/main.mjs',
  'forge-git/preload.cjs',
  'forge-git/renderer.mjs',
  'forge-git/index.html',
  'forge/product/desktop/worker-preload.bundle.cjs'
]);
const JS_FILE=/\.(?:mjs|cjs|js)$/;
const IMPORTS=/\b(?:import|export)\s+(?:[^'";\n]*?\s+from\s*)?['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const BUILTINS=new Set([...builtinModules,...builtinModules.map(name=>'node:'+name),'electron']);

function safeFile(root,relative){
  if(!relative||path.isAbsolute(relative)||relative==='..'||relative.startsWith('../')||
     relative.split('/').includes('..'))
    throw Error('forge_git_runtime_path_outside_repository');
  const file=path.join(root,...relative.split('/'));
  if(!existsSync(file)||!lstatSync(file).isFile())
    throw Error('forge_git_runtime_source_missing:'+relative);
  return file;
}

export function collectRuntimeFiles(root=repositoryRoot){
  const discovered=new Set();
  function visit(relative){
    if(discovered.has(relative))return;
    const file=safeFile(root,relative);
    discovered.add(relative);
    if(!JS_FILE.test(relative)||relative.endsWith('.bundle.cjs'))return;
    const source=readFileSync(file,'utf8');
    for(const match of source.matchAll(IMPORTS)){
      const spec=match[1]||match[2]||match[3];
      if(spec.startsWith('.')){
        const absolute=path.resolve(path.dirname(file),spec);
        const base=path.relative(root,absolute).split(path.sep).join('/');
        const candidates=[base,base+'.mjs',base+'.cjs',base+'.js',base+'.json'];
        const target=candidates.find(candidate=>{
          try{safeFile(root,candidate);return true;}catch{return false;}
        });
        if(!target)throw Error('forge_git_runtime_import_unresolved:'+relative+':'+spec);
        visit(target);
      }else if(!BUILTINS.has(spec)){
        // Portable Forge Git does not silently copy or install dependencies:
        // shared provider logic must stay in the canonical Forge product.
        throw Error('forge_git_runtime_external_dependency:'+relative+':'+spec);
      }
    }
  }
  for(const entry of ENTRYPOINTS)visit(entry);
  return [...discovered].sort();
}

export function stageForgeGit({sourceRoot=repositoryRoot,stageDirectory}){
  if(!stageDirectory||path.resolve(stageDirectory)===path.resolve(sourceRoot))
    throw Error('forge_git_stage_directory_required');
  const stage=path.resolve(stageDirectory);
  const files=collectRuntimeFiles(sourceRoot);
  const original=JSON.parse(readFileSync(path.join(sourceRoot,'forge-git','package.json'),'utf8'));
  // Copy the closure once, then hash the actual staged bytes using the
  // same verifier the packaged bootstrap executes.
  for(const relative of files){
    const target=path.join(stage,...relative.split('/'));
    mkdirSync(path.dirname(target),{recursive:true});
    copyFileSync(safeFile(sourceRoot,relative),target);
  }
  const manifest=makeForgeGitRuntimeManifest(stage,files);
  writeFileSync(path.join(stage,'package.json'),JSON.stringify({
    name:'ordax-forge-git-runtime',version:original.version,
    private:true,type:'module',main:'forge-git/bootstrap.mjs'
  },null,2)+'\n');
  writeFileSync(path.join(stage,'forge-git','runtime-source.json'),
    JSON.stringify(manifest,null,2)+'\n');
  const check=verifyForgeGitRuntimeManifest(stage);
  if(!check.verified||check.fileCount!==files.length)
    throw Error('forge_git_stage_integrity_failed');
  return {stage,version:original.version,files,manifest};
}

export function resolveSharedElectron(requireImpl=productRequire){
  const binary=requireImpl('electron');
  if(typeof binary!=='string'||!existsSync(binary))
    throw Error('forge_git_shared_electron_not_installed');
  return binary;
}

export const temporaryStagePrefix=path.join(os.tmpdir(),'ordax-forge-git-');
