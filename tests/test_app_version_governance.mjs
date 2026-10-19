import assert from 'node:assert/strict';
import test from 'node:test';
import { productSourceAppId, validateAppVersionTransition, productSourcePrototypeId, validatePrototypeVersion, assertVersionOwnerForChangedApp } from '../tools/verify_app_version_governance.mjs';

const base=Object.freeze({
  schema:'ordax.component-manifest/1',id:'studio',title:'OrdaX Studio',
  kind:'app',version:'0.15.9',releaseMode:'component-slot',
  criticality:'optional',failureDomain:'app',restartScope:'component',
  healthMode:'runtime',owner:'ordaxsystems/ordax-apps',dependencies:[],
});
const policy={
  productVersionChannel(version) {
    if(!/^\d+\.\d+\.\d+(?:-(alpha|beta|rc)\.\d+)?$/.test(version)) throw new TypeError('bad version');
    return version.includes('-') ? version.split('-')[1].split('.')[0] : 'unqualified';
  },
  compareComponentVersions(a,b){
    const x=a.split(/[-.]/).slice(0,3).map(Number);
    const y=b.split(/[-.]/).slice(0,3).map(Number);
    for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;
    if(a===b)return 0;
    if(!a.includes('-'))return 1;
    if(!b.includes('-'))return -1;
    return a>b?1:-1;
  },
  defineComponentManifest(value){
    if(value.schema!=='ordax.component-manifest/1')throw new TypeError('bad manifest');
    return value;
  },
};

test('any app runtime or manifest modification must advance own product version',()=>{
  assert.throws(()=>validateAppVersionTransition({
    previous:base,current:base,runtimeChanged:true,policy,
  }),/without version advance/);
  assert.deepEqual(validateAppVersionTransition({
    previous:base,current:{...base,version:'0.15.10-alpha.1'},runtimeChanged:true,policy,
  }),{previousVersion:'0.15.9',version:'0.15.10-alpha.1',changedRuntime:true});
});

test('docs-only PR does not invent new app version, but downgrades are forbidden',()=>{
  assert.equal(validateAppVersionTransition({
    previous:base,current:base,runtimeChanged:false,policy,
  }).version,'0.15.9');
  assert.throws(()=>validateAppVersionTransition({
    previous:base,current:{...base,version:'0.15.8'},runtimeChanged:false,policy,
  }),/regression/);
});

test('owner and app identity cannot migrate by raising version only',()=>{
  assert.throws(()=>validateAppVersionTransition({
    previous:base,current:{...base,owner:'somebody/else',version:'0.16.0'},policy,
  }),/canonical app.json identity and owner/);
  assert.throws(()=>validateAppVersionTransition({
    previous:base,current:{...base,id:'other',version:'0.16.0'},policy,
  }),/identity and owner/);
});

test('new app gets independent SemVer only when actual app manifest exists',()=>{
  assert.equal(validateAppVersionTransition({
    current:{...base,id:'new-app',version:'0.1.0-alpha.1'},policy,
  }).created,true);
  assert.throws(()=>validateAppVersionTransition({
    current:{...base,id:'new-app',version:'0.1.0-preview.1'},policy,
  }),/bad version/);
});

test('detects source changes but excludes test and documentation-only edits',()=>{
  assert.equal(productSourceAppId('apps/studio/src/editor.mjs'),'studio');
  assert.equal(productSourceAppId('apps/studio/ai/manifest.json'),'studio');
  assert.equal(productSourceAppId('apps/notes/app.json'),'notes');
  assert.equal(productSourceAppId('apps/studio/tests/editor.test.mjs'),null);
  assert.equal(productSourceAppId('apps/studio/README.md'),null);
  assert.equal(productSourceAppId('apps/clock/assets/clock.png'),'clock');
  assert.equal(productSourceAppId('tools/verify_workspace.py'),null);
  assert.equal(productSourceAppId('apps/studio/../../../evil'),null);
});


test('experimental product gets alpha version through one metadata owner, not its source baseline',()=>{
  const meta={version:'0.2.0-alpha.2',channel:'alpha',distributionEnabled:false,releaseDate:null};
  const bootstrap={version:'0.2.0-alpha.2',private:true};
  assert.deepEqual(validatePrototypeVersion({meta,bootstrap,policy}),{version:'0.2.0-alpha.2',channel:'alpha'});
  assert.throws(()=>validatePrototypeVersion({meta:{...meta,channel:'stable'},bootstrap,policy}),/channel mismatch/);
  assert.throws(()=>validatePrototypeVersion({meta:{...meta,distributionEnabled:true},bootstrap,policy}),/non-distributed/);
  assert.throws(()=>validatePrototypeVersion({meta,bootstrap:{...bootstrap,version:'0.4.12'},policy}),/bootstrap version/);
});

test('experimental runtime improvement must increase alpha number',()=>{
  const prev={version:'0.2.0-alpha.1',channel:'alpha',distributionEnabled:false,releaseDate:null};
  const next={...prev,version:'0.2.0-alpha.2'};
  assert.deepEqual(validatePrototypeVersion({meta:next,previous:prev,changedRuntime:true,policy}),{
    version:'0.2.0-alpha.2',channel:'alpha',
  });
  assert.throws(()=>validatePrototypeVersion({
    meta:prev,previous:prev,changedRuntime:true,policy,
  }),/without version advance/);
  assert.equal(productSourcePrototypeId('prototypes/ordax-orchestrator/supervisor/coordinator.mjs'),'ordax-orchestrator');
  assert.equal(productSourcePrototypeId('prototypes/ordax-orchestrator/tests/version.test.mjs'),null);
  assert.equal(productSourcePrototypeId('prototypes/ordax-orchestrator/README.md'),null);
  assert.equal(productSourcePrototypeId('prototypes/ordax-orchestrator/product-version.json'),'ordax-orchestrator');
});


test('source-only app candidates cannot silently evolve without structural version owner',()=>{
  assert.throws(()=>assertVersionOwnerForChangedApp({
    appId:'finance',hasManifest:false,changedRuntime:true,
  }),/source changed without a version owner/);
  assert.doesNotThrow(()=>assertVersionOwnerForChangedApp({
    appId:'finance',hasManifest:false,changedRuntime:false,
  }));
  assert.doesNotThrow(()=>assertVersionOwnerForChangedApp({
    appId:'clock',hasManifest:true,changedRuntime:true,
  }));
});
