// Stage content-addressed application code into a NEW isolated directory.
// Does not install, restart, migrate userData or send any provider message.
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const repo=cp.execFileSync('git',['-C',root,'rev-parse','--show-toplevel'],
  {encoding:'utf8',timeout:10000}).trim();
 const source=cp.execFileSync('git',['-C',repo,'rev-parse','HEAD'],
  {encoding:'utf8',timeout:10000}).trim();
 if(cp.execFileSync('git',['-C',repo,'status','--porcelain','--untracked-files=all'],
  {encoding:'utf8',timeout:15000}).trim())throw Error('candidate_source_not_clean');
 const targetArg=process.argv[2];
 if(typeof targetArg!=='string'||!path.isAbsolute(targetArg))
   throw Error('candidate_path_not_absolute');
 const target=path.resolve(targetArg);
 if(!/^candidate-app-v\d+\.\d+\.\d+-alpha\.\d+$/.test(path.basename(target)))
   throw Error('candidate_path_invalid');
 const contains=(a,b)=>b===a || b.startsWith(a+path.sep);
 if(contains(target,root)||contains(root,target)||contains(repo,target))
   throw Error('candidate_path_overlaps_checkout');
 if(fs.existsSync(target))throw Error('candidate_refuse_existing');
 const parent=path.dirname(target);
 if(!fs.existsSync(parent)||!fs.statSync(parent).isDirectory())
   throw Error('candidate_parent_missing');
 const {makeRuntimeManifest,verifyRuntimeManifest}=await import('../src/runtime-build-identity.mjs');
 // Validate the actual checkout BEFORE staging. Never follow symlinks.
 const manifest=makeRuntimeManifest(root,source);
 let created=false;
 try{
   fs.mkdirSync(target,{recursive:false,mode:0o700});created=true;
   for(const file of manifest.files){
     const out=path.join(target,...file.path.split('/'));
     fs.mkdirSync(path.dirname(out),{recursive:true,mode:0o700});
     fs.copyFileSync(path.join(root,...file.path.split('/')),out,fs.constants.COPYFILE_EXCL);
   }
   fs.writeFileSync(path.join(target,'runtime-build.json'),
     JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
   const check=verifyRuntimeManifest(target);
   if(!check.verified || check.contentDigest!==manifest.contentDigest)
     throw Error('candidate_verification_failed');
   console.log(JSON.stringify({schema:'ordax.lab.runtime-candidate.v1',
     status:'verified',candidatePath:target,
     sourceCommit:check.sourceCommit,contentDigest:check.contentDigest,
     fileCount:check.fileCount,profileCopied:false,
     providerMessagesSent:0,cutoverPerformed:false,rollbackPerformed:false}));
 } catch(err) {
   if(created)try{fs.rmSync(target,{recursive:true,force:true})}catch{}
   throw err;
 }
})().catch(e=>{
 const allowed=new Set(['candidate_source_not_clean','candidate_path_not_absolute',
 'candidate_path_invalid','candidate_path_overlaps_checkout','candidate_refuse_existing',
 'candidate_parent_missing','candidate_verification_failed']);
 console.error(JSON.stringify({schema:'ordax.lab.runtime-candidate.v1',ok:false,
   reason:allowed.has(e?.message)?e.message:'candidate_stage_failed'}));
 process.exitCode=2;
});