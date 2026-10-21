// Electron-builder post-pack attestation of the *actual* ASAR payload.
// No profile, cookies, SQLite, installation, provider traffic or code signing.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const {createHash} = require('node:crypto');
const asar = require('@electron/asar');

function hashFile(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function sourceCommitFromGit(productRoot) {
  const repo=cp.execFileSync('git',['-C',productRoot,'rev-parse','--show-toplevel'],
    {encoding:'utf8',timeout:10000}).trim();
  const source=cp.execFileSync('git',['-C',repo,'rev-parse','HEAD'],
    {encoding:'utf8',timeout:10000}).trim();
  if(!/^[0-9a-f]{40}$/.test(source))throw Error('packaged_build_commit_invalid');
  const status=cp.execFileSync('git',['-C',repo,'status','--porcelain','--untracked-files=all'],
    {encoding:'utf8',timeout:15000}).trim();
  if(status)throw Error('packaged_build_source_dirty');
  return source;
}
async function attestPackagedAsar({archive,sourceCommit}) {
  if(!path.isAbsolute(archive) || !fs.statSync(archive).isFile())
    throw Error('packaged_asar_missing');
  const {makeRuntimeManifest,verifyRuntimeManifest} =
    await import('../src/runtime-build-identity.mjs');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-lab-asar-proof-'));
  const originalBackup=archive+'.ordax-pre-attestation';
  let replaced=false;
  try{
    const extracted=path.join(temp,'extracted');
    fs.mkdirSync(extracted);
    asar.extractAll(archive,extracted);
    const pkg=JSON.parse(fs.readFileSync(path.join(extracted,'package.json'),'utf8'));
    if(pkg.main!=='desktop/bootstrap.mjs')
      throw Error('packaged_entrypoint_not_bootstrap');
    const manifest=makeRuntimeManifest(extracted,sourceCommit);
    if(!manifest.files.some(f=>f.path==='desktop/bootstrap.mjs') ||
       !manifest.files.some(f=>f.path==='desktop/main.mjs') ||
       !manifest.files.some(f=>f.path==='src/runtime-build-identity.mjs'))
      throw Error('packaged_runtime_incomplete');
    fs.writeFileSync(path.join(extracted,'runtime-build.json'),
      JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
    const reconstructed=path.join(temp,'sealed.asar');
    await asar.createPackage(extracted,reconstructed);
    const checked=path.join(temp,'checked');
    fs.mkdirSync(checked);
    asar.extractAll(reconstructed,checked);
    const proof=verifyRuntimeManifest(checked);
    if(!proof.verified || proof.sourceCommit!==sourceCommit ||
       proof.contentDigest!==manifest.contentDigest ||
       proof.fileCount!==manifest.files.length)
      throw Error('packaged_manifest_verification_failed');
    if(fs.existsSync(originalBackup))throw Error('packaged_previous_backup_exists');
    fs.renameSync(archive,originalBackup);
    try{
      fs.renameSync(reconstructed,archive);
      replaced=true;
    }catch(e){
      fs.renameSync(originalBackup,archive);
      throw e;
    }
    // A second check of bytes on the final output is required.
    const finalCheck=path.join(temp,'final-check');
    fs.mkdirSync(finalCheck);
    // @electron/asar can cache archive headers by PATH. The old app.asar was
    // read before replacement, so reopen final bytes under a fresh filename.
    const reopenedArchive=path.join(temp,'reopened-final.asar');
    fs.copyFileSync(archive,reopenedArchive,fs.constants.COPYFILE_EXCL);
    asar.extractAll(reopenedArchive,finalCheck);
    const finalProof=verifyRuntimeManifest(finalCheck);
    if(!finalProof.verified || finalProof.contentDigest!==manifest.contentDigest)
      throw Error('packaged_final_verification_failed:'+String(finalProof.reason||'digest'));
    fs.rmSync(originalBackup);
    return {schema:'ordax.lab.packaged-runtime-proof.v1',status:'verified',
      sourceCommit,contentDigest:finalProof.contentDigest,
      packageVersion:finalProof.packageVersion,fileCount:finalProof.fileCount,
      asarSha256:hashFile(archive),profileCopied:false,providerMessagesSent:0};
  }catch(e){
    if(replaced && fs.existsSync(originalBackup)){
      fs.rmSync(archive,{force:true});
      fs.renameSync(originalBackup,archive);
    }
    throw e;
  }finally{
    fs.rmSync(temp,{force:true,recursive:true});
  }
}
exports.attestPackagedAsar=attestPackagedAsar;
exports.default=async function afterPack(context) {
  if(context.electronPlatformName!=='win32')throw Error('packaged_windows_only');
  const productRoot=path.resolve(__dirname,'..');
  const sourceCommit=sourceCommitFromGit(productRoot);
  const archive=path.join(context.appOutDir,'resources','app.asar');
  const proof=await attestPackagedAsar({archive,sourceCommit});
  const receipt=path.join(context.outDir,'orchestrator-packaged-proof.json');
  fs.writeFileSync(receipt,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({schema:proof.schema,status:proof.status,
    sourceCommit:proof.sourceCommit,contentDigest:proof.contentDigest,
    fileCount:proof.fileCount,asarSha256:proof.asarSha256}));
};
