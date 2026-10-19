import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assertDerivedIdentity } from '../lib/derive.mjs';
import { readProductVersion } from '../lib/version-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const checkScript = "import fs from 'node:fs';\nimport path from 'node:path';\nimport { spawnSync } from 'node:child_process';\nconst failures=[];\nfor(const root of ['desktop','src','supervisor','scripts','test']){\n if(!fs.existsSync(root))continue;\n const stack=[root];\n while(stack.length){\n  const dir=stack.pop();\n  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){\n   const file=path.join(dir,ent.name);\n   if(ent.isDirectory())stack.push(file);\n   else if(ent.isFile() && /\\.(?:mjs|cjs|js)$/.test(ent.name)){\n    const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});\n    if(r.status!==0) failures.push({file,error:(r.stderr||'').slice(0,400)});\n   }\n  }\n }\n}\nif(failures.length){console.error(JSON.stringify(failures,null,2));process.exitCode=1;}\nelse console.log('Lab-owned source syntax OK');\n";

function walk(directory, prefix = '') {
  if (!fs.existsSync(directory)) return [];
  const found=[];
  for (const ent of fs.readdirSync(directory, {withFileTypes:true})) {
    const rel = prefix ? prefix + '/' + ent.name : ent.name;
    if (ent.isSymbolicLink()) throw Error('source_symlink_forbidden:' + rel);
    if (ent.isDirectory()) found.push(...walk(path.join(directory,ent.name),rel));
    else if (ent.isFile()) found.push(rel);
    else throw Error('nonfile_in_derived_source:' + rel);
  }
  return found.sort();
}
function selectRuntime(rel) {
  return rel.startsWith('desktop/') || rel.startsWith('supervisor/') ||
    /^src\/[^/]+\.mjs$/.test(rel) || rel === 'build/icon.png';
}
function selectScript(rel) {
  return /^scripts\/(?:e2e-lock|live-ui-(?:text|stream|image|continuity|restart|history|typing|stage)-smoke|read-benchmark|benchmark-suite|set-observer-mode)\.(?:cjs|mjs)$/.test(rel);
}
function selectTest(rel, bytes) {
  return /^test\/[^/]+\.test\.mjs$/.test(rel) &&
    !/(?:src\/relay\/|apps\/flow-(?:hub|client)\/|sql\/flow-|FLOW-(?:CLIENT|HUB)|flow-hub)/i.test(bytes.toString('utf8'));
}

export function prepareOwnedSource({ workspace, output, base = root }) {
  const lock = JSON.parse(fs.readFileSync(path.join(base,'source-lock.json'),'utf8'));
  const version = readProductVersion(base);
  const provenance = JSON.parse(fs.readFileSync(path.join(workspace,'DERIVATION.json'),'utf8'));
  if (provenance.fromCommit !== lock.commit || provenance.sourceVersion !== lock.sourceVersion ||
      provenance.productVersion !== version.version || provenance.appId !== lock.targetIdentity.appId ||
      provenance.channel !== version.channel) throw Error('pinned_source_provenance_mismatch');
  const key = ['package.json','package-lock.json','desktop/main.mjs','desktop/embedded-worker.mjs',
    'desktop/ui.html','desktop/ui.js','src/store.mjs','supervisor/coordinator.mjs','supervisor/groq-planner.mjs'];
  for(const f of key) if(!fs.existsSync(path.join(workspace,f)))throw Error('required_derived_file_missing:'+f);
  assertDerivedIdentity(Object.fromEntries(
    ['package.json','desktop/main.mjs','desktop/embedded-worker.mjs','desktop/ui.html']
      .map(f=>[f,fs.readFileSync(path.join(workspace,f))])),
    {...lock,productVersion:version});
  if(fs.existsSync(output))throw Error('owned_product_exists_refuse_overwrite');
  fs.mkdirSync(path.dirname(output),{recursive:true});
  const stage=fs.mkdtempSync(path.join(path.dirname(output),'.owned-staging-'));
  const files=[];
  let testCount=0;
  try {
    for(const rel of walk(workspace)) {
      if(rel.includes('..') || rel.includes('\\'))throw Error('unsafe_source_path');
      const bytes = fs.readFileSync(path.join(workspace,rel));
      if(!selectRuntime(rel) && !selectScript(rel) && !selectTest(rel,bytes))continue;
      if(rel.startsWith('test/'))testCount++;
      const dest=path.join(stage,rel);
      fs.mkdirSync(path.dirname(dest),{recursive:true});
      fs.writeFileSync(dest,bytes,{flag:'wx'});
      files.push({path:rel,sha256:sha(bytes)});
    }
    if(testCount<5)throw Error('insufficient_owned_tests:'+testCount);
    const pkg=JSON.parse(fs.readFileSync(path.join(workspace,'package.json'),'utf8'));
    pkg.scripts={
      check:'node scripts/check-source.mjs',
      test:'node --test test/*.test.mjs',
      validate:'npm run check && npm test',
      start:'electron .',
      'build:win':'electron-builder --win portable',
      'test:live:text':'node scripts/live-ui-text-smoke.cjs',
      'test:live:continuity':'node scripts/live-ui-continuity-smoke.cjs',
      'test:live:restart':'node scripts/live-ui-restart-smoke.cjs',
      'test:live:image':'node scripts/live-ui-image-smoke.cjs',
      'test:live:history':'node scripts/live-ui-history-smoke.cjs',
      'test:live:stream':'node scripts/live-ui-stream-smoke.cjs'
    };
    pkg.build.files=['desktop/**/*','src/*.mjs','supervisor/**/*','package.json'];
    fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify(pkg,null,2)+'\n');
    fs.writeFileSync(path.join(stage,'scripts','check-source.mjs'),checkScript);
    const npmLock=JSON.parse(fs.readFileSync(path.join(workspace,'package-lock.json'),'utf8'));
    if(npmLock.packages?.['']?.name!==pkg.name || npmLock.version!==pkg.version)
      throw Error('derived_lock_identity_mismatch');
    fs.copyFileSync(path.join(workspace,'package-lock.json'),path.join(stage,'package-lock.json'));
    files.push({path:'package.json',sha256:sha(fs.readFileSync(path.join(stage,'package.json'))),reason:'script-boundary'});
    files.push({path:'package-lock.json',sha256:sha(fs.readFileSync(path.join(stage,'package-lock.json')))});
    files.push({path:'scripts/check-source.mjs',sha256:sha(Buffer.from(checkScript)),reason:'lab-owned'});
    const report={
      schema:'ordax.orchestrator-owned-source-provenance/1',
      source:{repository:lock.repository,commit:lock.commit,version:lock.sourceVersion},
      product:{version:version.version,appId:lock.targetIdentity.appId},
      count:files.length,tests:testCount,
      exclusions:['src/relay','apps/flow-client','apps/flow-hub','sql'],
      policy:'one-time copy; no synchronization back to Gratis',
      files:files.sort((a,b)=>a.path.localeCompare(b.path))
    };
    fs.writeFileSync(path.join(stage,'OWNED-SOURCE.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    fs.renameSync(stage,output);
    return {count:files.length,tests:testCount,sha256:sha(Buffer.from(JSON.stringify(report)))};
  } finally {
    if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});
  }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {
    const a=process.argv.slice(2);
    if(a.length!==4||a[0]!=='--workspace'||a[2]!=='--output')
      throw Error('usage: node scripts/promote-owned-source.mjs --workspace PATH --output PATH');
    const workspace=path.resolve(a[1]),output=path.resolve(a[3]);
    if(!workspace.startsWith(root+path.sep)||!output.startsWith(root+path.sep))
      throw Error('paths_must_be_inside_lab');
    console.log(JSON.stringify(prepareOwnedSource({workspace,output}),null,2));
  } catch(e) {console.error(e.message);process.exitCode=1;}
}
