import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const APP_OWNER='ordaxsystems/ordax-apps';
const RELEASE_MANIFEST='app.json';

function git(...args) {
  return execFileSync('git',['-C',repoRoot,...args],{
    encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true,
  }).trim();
}

export function productSourceAppId(relative) {
  if (typeof relative!=='string') return null;
  const match=/^apps\/([a-z][a-z0-9-]{0,63})\/(.+)$/.exec(relative);
  if(!match) return null;
  const inner=match[2];
  if(inner.split('/').includes('..') || inner.split('/').includes('.') ||
      inner.includes('\\') || inner.includes('\0')) return null;
  if (inner===RELEASE_MANIFEST) return match[1];
  if (/(^|\/)(?:tests?|fixtures|__tests__)\/|(?:^|\/)(?:README\.md|CHANGELOG\.md|\.gitignore)$/.test(inner)) return null;
  if (/\.(?:md|mdx|txt|map)$/.test(inner)) return null;
  return match[1];
}

export function productSourcePrototypeId(relative) {
  if (typeof relative!=='string') return null;
  const match=/^prototypes\/([a-z][a-z0-9-]{0,63})\/(.+)$/.exec(relative);
  if (!match) return null;
  const inner=match[2];
  if (inner.split('/').includes('..') || inner.includes('\\') || inner.includes('\0')) return null;
  if (/(^|\/)(?:tests?|fixtures|__tests__)\/|(?:^|\/)(?:README\.md|CHANGELOG\.md|\.gitignore)$/.test(inner)) return null;
  if (/\.(?:md|mdx|txt|map)$/.test(inner)) return null;
  return match[1];
}

export function validatePrototypeVersion({meta,bootstrap=null,previous=null,changedRuntime=false,policy}){
  if (!meta || typeof meta!=='object' || typeof meta.version!=='string' ||
      meta.distributionEnabled!==false || meta.releaseDate!==null) {
    throw new Error('Experimental product must declare non-distributed canonical version');
  }
  const channel=policy.productVersionChannel(meta.version);
  if(meta.channel!==channel)throw new Error('Prototype version channel mismatch');
  if(bootstrap && (bootstrap.version!==meta.version || bootstrap.private!==true)) {
    throw new Error('Prototype bootstrap version must project canonical version and be private');
  }
  if(previous){
    const prevChannel=policy.productVersionChannel(previous.version);
    if(prevChannel!==previous.channel)throw new Error('Previous prototype version invalid');
    const order=policy.compareComponentVersions(meta.version,previous.version);
    if(order<0)throw new Error('Prototype version regression forbidden');
    if(changedRuntime && order===0)throw new Error('Prototype source changed without version advance');
  }
  return {version:meta.version,channel};
}

export function assertVersionOwnerForChangedApp({appId,hasManifest,changedRuntime}){
  if(changedRuntime && !hasManifest) {
    throw new Error('App source changed without a version owner: apps/'+appId+
      ' (define an authorized app.json in this owner; cataloguing is not publication)');
  }
}

export function validateAppVersionTransition({
  previous=null,current,runtimeChanged=false,policy,
}){
  if (!policy || typeof policy.productVersionChannel!=='function' ||
      typeof policy.compareComponentVersions!=='function' ||
      typeof policy.defineComponentManifest!=='function') {
    throw new TypeError('OS version-policy contract required');
  }
  if (!current || current.schema!=='ordax.component-manifest/1' ||
      current.kind!=='app' || current.owner!==APP_OWNER) {
    throw new Error('First-party app must have canonical app.json identity and owner');
  }
  policy.defineComponentManifest(current);
  policy.productVersionChannel(current.version);
  if (!previous) return {version:current.version,changedRuntime:runtimeChanged,created:true};
  if (previous.id!==current.id || previous.owner!==current.owner) {
    throw new Error('App identity and owner must not be reassigned by a version bump');
  }
  policy.productVersionChannel(previous.version);
  const order=policy.compareComponentVersions(current.version,previous.version);
  if (order<0) throw new Error('App version regression forbidden: '+current.id);
  if (runtimeChanged && order===0) {
    throw new Error('App source modified without version advance: '+current.id);
  }
  if(current.version!==previous.version && order!==1){
    throw new Error('App version must increase monotonically: '+current.id);
  }
  return {version:current.version,previousVersion:previous.version,changedRuntime:runtimeChanged};
}

async function policyAt(platformRoot) {
  const pin=JSON.parse(fs.readFileSync(path.join(repoRoot,'contracts/version-governance.lock.json'),'utf8'));
  if(pin.$schema!=='ordax.version-governance-consumer-lock/1' ||
      pin.policyOwner!=='ordaxsystems/ordax-os' ||
      !/^[a-f0-9]{40}$/.test(pin.policyCommit) ||
      pin.policyModule!=='system/contracts/product-version-governance.mjs' ||
      pin.manifestModule!=='system/contracts/component-manifest.mjs' ||
      pin.authority!=='none') throw new Error('Invalid canonical OS version contract pin');
  const os=path.resolve(platformRoot);
  const actual=execFileSync('git',['-C',os,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  if(actual!==pin.policyCommit)throw new Error('Platform version contract checkout does not match pinned SHA');
  const [version,manifest]=await Promise.all([
    import(pathToFileURL(path.join(os,pin.policyModule)).href),
    import(pathToFileURL(path.join(os,pin.manifestModule)).href),
  ]);
  if(version.versionGovernancePolicy().schema!=='ordax.product-version-governance/1') {
    throw new Error('Canonical OS policy schema mismatch');
  }
  return {
    productVersionChannel:version.productVersionChannel,
    compareComponentVersions:manifest.compareComponentVersions,
    defineComponentManifest:manifest.defineComponentManifest,
  };
}

export async function verifyAppCatalog({platformRoot,base=null}){
  const policy=await policyAt(platformRoot);
  const root=path.join(repoRoot,'apps');
  const dirs=fs.readdirSync(root,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name).sort();
  let count=0;
  let unversionedCandidates=0;
  const versioned=new Map();
  for(const id of dirs){
    const file=path.join(root,id,RELEASE_MANIFEST);
    if(!fs.existsSync(file)) {unversionedCandidates++;continue;} // explicitly uncovered, no invented version
    const current=JSON.parse(fs.readFileSync(file,'utf8'));
    if(current.id!==id)throw new Error('App id does not match its canonical directory: '+id);
    validateAppVersionTransition({current,policy});
    versioned.set(id,current);
    count++;
  }
  let changed=0;
  if(base){
    if(!/^[a-f0-9]{40}$/.test(base))throw new Error('A specific PR base SHA is required');
    const paths=git('diff','--name-only',base+'...HEAD','--','apps').split('\n').filter(Boolean);
    for(const id of new Set(paths.map(productSourceAppId).filter(Boolean))){
      const current=versioned.get(id);
      const oldPath='apps/'+id+'/'+RELEASE_MANIFEST;
      let previous=null;
      try{
        previous=JSON.parse(git('show',base+':'+oldPath));
      }catch(error){
        // New app is allowed only with its canonical manifest, not fake catalog presence.
        const missingOldManifest=/does not exist|exists on disk, but not in|path .* does not exist/i.test(String(error.stderr||error.message));
        if(!missingOldManifest)throw error;
      }
      if(!current){
        if(previous) throw new Error('Existing app manifest removed without ownership/cutover proof: '+id);
        assertVersionOwnerForChangedApp({appId:id,hasManifest:false,changedRuntime:true});
        continue;
      }
      const runtimeChanged=paths.some(file=>productSourceAppId(file)===id && file!==oldPath);
      const sourceManifestChanged=paths.includes(oldPath);
      // Manifest-only change (metadata, dependencies, identity) is a material
      // product change; require version advance if it already existed.
      validateAppVersionTransition({
        previous,current,
        runtimeChanged:runtimeChanged || sourceManifestChanged,
        policy,
      });
      changed++;
    }
  }
  let prototypeProducts=0;
  let changedPrototypeProducts=0;
  const prototypeRoot=path.join(repoRoot,'prototypes');
  if(fs.existsSync(prototypeRoot)){
    const prototypes=fs.readdirSync(prototypeRoot,{withFileTypes:true})
      .filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort();
    const changedPaths=base
      ?git('diff','--name-only',base,'HEAD','--','prototypes').split('\n').filter(Boolean)
      :[];
    for(const id of prototypes){
      const root=path.join(prototypeRoot,id);
      const versionFile=path.join(root,'product-version.json');
      if(!fs.existsSync(versionFile))continue; // do not mint a version for unrelated experiments
      const meta=JSON.parse(fs.readFileSync(versionFile,'utf8'));
      const bootstrapFile=path.join(root,'package.json');
      const bootstrap=fs.existsSync(bootstrapFile)
        ?JSON.parse(fs.readFileSync(bootstrapFile,'utf8')) :null;
      let previous=null;
      if(base){
        try{previous=JSON.parse(git('show',base+':prototypes/'+id+'/product-version.json'));}
        catch(error){
          const notFound=/does not exist|exists on disk, but not in|path .* does not exist/i.test(String(error.stderr||error.message));
          if(!notFound)throw error;
        }
      }
      const productionChanged=changedPaths.some(path=>productSourcePrototypeId(path)===id);
      validatePrototypeVersion({
        meta,bootstrap,previous,changedRuntime:productionChanged,policy,
      });
      prototypeProducts++;
      if(productionChanged)changedPrototypeProducts++;
    }
  }
  return {
    schema:'ordax.first-party-version-gate/1',cataloguedApps:count,
    unversionedCandidates,
    changedVersionedApps:changed,prototypeProducts,changedPrototypeProducts,
    baseline:base||null,
  };
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  const rootIndex=args.indexOf('--platform-root');
  const baseIndex=args.indexOf('--base');
  if(rootIndex<0 || !args[rootIndex+1])throw new Error('usage: --platform-root PINNED_OS [--base PR_BASE_SHA]');
  verifyAppCatalog({platformRoot:args[rootIndex+1],base:baseIndex<0?null:args[baseIndex+1]})
    .then(result=>process.stdout.write('ORDAX_APPS_VERSION_GOVERNANCE=PASS '+JSON.stringify(result)+'\n'))
    .catch(error=>{process.stderr.write('ORDAX_APPS_VERSION_GOVERNANCE=FAIL '+error.message+'\n');process.exitCode=1;});
}
