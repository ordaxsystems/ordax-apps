// Attest the actual, already-packaged Electron ASAR without modifying it.
// Electron embeds the ASAR digest in its executable before afterPack.
// Therefore the digest-bound archive must NEVER be rewritten by this hook.
'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const {createHash}=require('node:crypto');
const asar=require('@electron/asar');
let buildSourceCommit=null;

function hashFile(file){return createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function sourceCommitFromGit(root){
  const repo=cp.execFileSync('git',['-C',root,'rev-parse','--show-toplevel'],
    {encoding:'utf8',timeout:10000}).trim();
  const commit=cp.execFileSync('git',['-C',repo,'rev-parse','HEAD'],
    {encoding:'utf8',timeout:10000}).trim();
  if(!/^[a-f0-9]{40}$/.test(commit))throw Error('packaged_build_commit_invalid');
  const status=cp.execFileSync('git',['-C',repo,'status','--porcelain','--untracked-files=all'],
    {encoding:'utf8',timeout:15000}).trim();
  if(status){
    const summary=status.split(/\r?\n/).slice(0,5)
      .map(line=>line.replace(/[^\w./\\ -]/g,'?').slice(0,120)).join('|');
    throw Error('packaged_build_source_dirty:'+summary);
  }
  return commit;
}
exports.sourceCommitFromGit=sourceCommitFromGit;
async function attestPackagedAsar({archive,sourceCommit,
  manifestPath=path.join(path.dirname(archive),'runtime-build.json')}){
  if(!path.isAbsolute(archive) || !fs.existsSync(archive) ||
     !fs.lstatSync(archive).isFile())
    throw Error('packaged_asar_missing');
  if(!path.isAbsolute(manifestPath) || fs.existsSync(manifestPath))
    throw Error('packaged_manifest_target_unsafe');
  if(!/^[a-f0-9]{40}$/.test(sourceCommit||''))
    throw Error('packaged_commit_invalid');
  const initialSha=hashFile(archive);
  const {makeRuntimeManifest,verifyRuntimeManifest}=
    await import('../src/runtime-build-identity.mjs');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-lab-asar-proof-'));
  let created=false;
  try{
    const extracted=path.join(temp,'packaged-content');
    fs.mkdirSync(extracted);
    asar.extractAll(archive,extracted);
    const pkg=JSON.parse(fs.readFileSync(path.join(extracted,'package.json'),'utf8'));
    if(pkg.main!=='desktop/bootstrap.mjs')
      throw Error('packaged_entrypoint_not_bootstrap');
    const manifest=makeRuntimeManifest(extracted,sourceCommit);
    if(!['desktop/bootstrap.mjs','desktop/main.mjs','src/runtime-build-identity.mjs']
      .every(name=>manifest.files.some(file=>file.path===name)))
      throw Error('packaged_runtime_incomplete');
    // The file lives beside app.asar in resources/, not INSIDE app.asar.
    // Do not invalidate the Electron executable's recorded ASAR checksum.
    fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n',
      {flag:'wx',mode:0o600});
    created=true;
    const proof=verifyRuntimeManifest(extracted,{manifestPath});
    if(!proof.verified || proof.sourceCommit!==sourceCommit ||
       proof.contentDigest!==manifest.contentDigest ||
       proof.fileCount!==manifest.files.length)
      throw Error('packaged_manifest_verification_failed');
    if(hashFile(archive)!==initialSha)throw Error('packaged_asar_mutated');
    return {schema:'ordax.lab.packaged-runtime-proof.v1',status:'verified',
      sourceCommit,contentDigest:proof.contentDigest,
      packageVersion:proof.packageVersion,fileCount:proof.fileCount,
      asarSha256:initialSha,profileCopied:false,providerMessagesSent:0};
  }catch(e){
    if(created)fs.rmSync(manifestPath,{force:true});
    throw e;
  }finally{fs.rmSync(temp,{force:true,recursive:true});}
}
exports.attestPackagedAsar=attestPackagedAsar;
exports.beforePack=async function beforePack(){
  const productRoot=path.resolve(__dirname,'..');
  const sourceCommit=sourceCommitFromGit(productRoot);
  if(buildSourceCommit!==null && buildSourceCommit!==sourceCommit)
    throw Error('packaged_build_source_changed');
  buildSourceCommit=sourceCommit;
};
async function afterPack(context){
  if(context.electronPlatformName!=='win32')throw Error('packaged_windows_only');
  const productRoot=path.resolve(__dirname,'..');
  const sourceCommit=buildSourceCommit;
  if(!sourceCommit)throw Error('packaged_build_source_not_attested');
  const head=cp.execFileSync('git',['-C',productRoot,'rev-parse','--verify','HEAD'],
    {encoding:'utf8',timeout:10000}).trim();
  if(head!==buildSourceCommit)throw Error('packaged_build_source_changed');
  const trackedChanges=cp.spawnSync('git',['-C',productRoot,'diff','--quiet','HEAD','--'],
    {encoding:'utf8',timeout:10000});
  if(trackedChanges.error || trackedChanges.status!==0)
    throw Error('packaged_build_source_changed');
  const resources=path.join(context.appOutDir,'resources');
  const archive=path.join(resources,'app.asar');
  const manifestPath=path.join(resources,'runtime-build.json');
  const proof=await attestPackagedAsar({archive,sourceCommit,manifestPath});
  const receipt=path.join(context.outDir,'orchestrator-packaged-proof.json');
  fs.writeFileSync(receipt,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({schema:proof.schema,status:proof.status,
    sourceCommit:proof.sourceCommit,contentDigest:proof.contentDigest,
    fileCount:proof.fileCount,asarSha256:proof.asarSha256}));
}
exports.afterPack=afterPack;
exports.default=afterPack;
