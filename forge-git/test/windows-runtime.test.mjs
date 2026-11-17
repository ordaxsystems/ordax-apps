import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {collectRuntimeFiles,stageForgeGit} from '../scripts/runtime.mjs';

function fixture(t){
  const root=mkdtempSync(path.join(os.tmpdir(),'forge-git-stage-test-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const put=(relative,content)=>{
    const name=path.join(root,relative);
    mkdirSync(path.dirname(name),{recursive:true});
    writeFileSync(name,content);
  };
  put('forge-git/package.json','{"name":"forge-git-test","version":"0.1.0"}');
  put('forge-git/main.mjs',
    "import {BrowserWindow} from 'electron'; import {Worker} from '../forge/product/desktop/embedded-worker.mjs';\n");
  put('forge-git/preload.cjs',"const fs=require('node:fs');\n");
  put('forge-git/renderer.mjs',"import './ui.mjs';\n");
  put('forge-git/ui.mjs',"export const value=1;\n");
  put('forge-git/index.html','<script type="module" src="./renderer.mjs"></script>');
  put('forge/product/desktop/embedded-worker.mjs',
    "import {resolve} from '../src/conversation-policy.mjs'; export class Worker{}\n");
  put('forge/product/src/conversation-policy.mjs','export const resolve=()=>true;\n');
  put('forge/product/desktop/worker-preload.bundle.cjs',"(()=>{})();\n");
  return {root,put};
}

test('portable runtime stages only canonical dependency closure and provenance',t=>{
  const {root,put}=fixture(t);
  put('forge-git/test/never-package.test.mjs',"throw Error('not runtime');");
  put('forge-git/.env','SECRET=not-an-asset');
  const files=collectRuntimeFiles(root);
  assert(files.includes('forge/product/desktop/embedded-worker.mjs'));
  assert(files.includes('forge/product/src/conversation-policy.mjs'));
  assert(files.includes('forge-git/ui.mjs'));
  assert(!files.some(name=>name.includes('.env')||name.includes('/test/')));
  const stage=path.join(root,'out');
  const result=stageForgeGit({sourceRoot:root,stageDirectory:stage});
  assert.equal(result.files.length,files.length);
  assert.equal(JSON.parse(readFileSync(path.join(stage,'package.json'))).main,
    'forge-git/main.mjs');
  assert.equal(JSON.parse(readFileSync(path.join(stage,'forge-git/runtime-source.json')))
    .files.length,files.length);
  assert(existsSync(path.join(stage,'forge/product/desktop/worker-preload.bundle.cjs')));
  assert(!existsSync(path.join(stage,'forge-git/.env')));
});

test('runtime missing preload and escaping imports fail closed',t=>{
  const {root,put}=fixture(t);
  put('forge-git/main.mjs',"import '../../outside.mjs';");
  assert.throws(()=>collectRuntimeFiles(root),/forge_git_runtime_import_unresolved/);
  put('forge-git/main.mjs',"import 'unowned-executor';");
  assert.throws(()=>collectRuntimeFiles(root),/forge_git_runtime_external_dependency/);
});

test('stage never writes over canonical repo root',t=>{
  const {root}=fixture(t);
  assert.throws(()=>stageForgeGit({sourceRoot:root,stageDirectory:root}),
    /forge_git_stage_directory_required/);
});
