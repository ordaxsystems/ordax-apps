import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProductVersion, assertBootstrapVersion } from '../lib/version-policy.mjs';
import { deriveSourceFile, assertDerivedIdentity } from '../lib/derive.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version=JSON.parse(fs.readFileSync(path.join(root,'product-version.json'),'utf8'));
const source=JSON.parse(fs.readFileSync(path.join(root,'source-lock.json'),'utf8'));
const bootstrap=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const lock={...source,productVersion:validateProductVersion(version)};

test('one canonical version matches bootstrap but not frozen Flow baseline',()=>{
  assert.equal(validateProductVersion(version).channel,'alpha');
  assert.equal(assertBootstrapVersion(root,bootstrap).version,version.version);
  assert.equal(lock.sourceVersion,'0.4.12');
  assert.notEqual(version.version,lock.sourceVersion);
  assert.equal(version.distributionEnabled,false);
  assert.equal(version.releaseDate,null);
});

test('SemVer channel is explicit and invalid versions fail closed',()=>{
  for(const invalid of ['0.2.0','0.2.0-beta.1','v0.2.0-alpha.1','0.02.0-alpha.1','0.2.0-alpha.01']){
    assert.throws(()=>validateProductVersion({...version,version:invalid}));
  }
  assert.throws(()=>validateProductVersion({...version,distributionEnabled:true}));
  assert.throws(()=>validateProductVersion({...version,unexpected:'x'}));
  assert.throws(()=>assertBootstrapVersion(root,{...bootstrap,version:'0.1.0'}));
});

test('derived package and npm lock versions match SSOT without altering original',()=>{
  const pkg={
    name:'ordax-gratis',version:source.sourceVersion,
    build:{appId:'br.com.ordax.gratis',productName:'OrdaX Gratis',
      files:['desktop/**/*','src/*.mjs','package.json'],
      win:{executableName:'OrdaX Gratis'}}
  };
  const locked={
    name:'ordax-gratis',version:source.sourceVersion,
    lockfileVersion:3,
    packages:{'':{name:'ordax-gratis',version:source.sourceVersion}}
  };
  const out=JSON.parse(deriveSourceFile('package.json',JSON.stringify(pkg),lock).toString('utf8'));
  const outLock=JSON.parse(deriveSourceFile('package-lock.json',JSON.stringify(locked),lock).toString('utf8'));
  assert.equal(out.version,version.version);
  assert.equal(outLock.version,version.version);
  assert.equal(outLock.packages[''].version,version.version);
  assert.equal(out.name,'ordax-orchestrator-lab');
  assert.equal(outLock.name,'ordax-orchestrator-lab');
  assert.equal(pkg.version,source.sourceVersion);
  assert.equal(locked.version,source.sourceVersion);
  assert.throws(()=>deriveSourceFile('package-lock.json',JSON.stringify({
    ...locked,packages:{'':{...locked.packages[''],version:'0.4.13'}}
  }),lock),/pinned_flow_lock_root_version_mismatch/);
  assert.throws(()=>deriveSourceFile('package.json',JSON.stringify({...pkg,version:'0.4.13'}),lock));
});

test('runtime app version mismatch prevents promotion even if identity is valid',()=>{
  const pkg=Buffer.from(JSON.stringify({
    name:source.targetIdentity.name,version:'0.1.0',
    build:{appId:source.targetIdentity.appId,productName:source.targetIdentity.productName,
      files:['desktop/**/*','src/*.mjs','supervisor/**/*','package.json']}
  }));
  const main=Buffer.from("const userRoot = path.join(localAppData, 'OrdaX', 'OrchestratorLab');\nnew Store(path.join(dataRoot, 'ordax-orchestrator-lab.sqlite'))");
  const worker=Buffer.from("const partition='persist:ordax-orchestrator-lab-chatgpt';");
  const html=Buffer.from('<title>OrdaX Orchestrator Lab</title>');
  assert.throws(()=>assertDerivedIdentity({
    'package.json':pkg,'desktop/main.mjs':main,
    'desktop/embedded-worker.mjs':worker,'desktop/ui.html':html
  },lock),/derived_app_version_mismatch/);
});
