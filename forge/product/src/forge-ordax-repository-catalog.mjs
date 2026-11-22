import fs from 'node:fs';
import {execFile,execFileSync} from 'node:child_process';
import path from 'node:path';
import {createHash} from 'node:crypto';

const REMOTE='https://github.com/ordaxsystems/ordax-os.git';
const SOURCE='docs/contracts/repository-ownership.json';
const REF='refs/remotes/origin/main';
const MAX_BYTES=128_000;
const INTERVAL_MS=5*60_000;
const GITHUB=/^ordaxsystems\/[a-z0-9][a-z0-9-]{1,100}$/;
const SHA=/^[a-f0-9]{40}$/;
const unavailable=()=>Object.freeze({
  schema:'ordax.forge.repository-catalog/1',available:false,
  reason:'ordax_ownership_contract_unavailable',checkedOrigin:false,
  mainCommitVerified:false,externalGrantsVerified:false,
  executionAuthorized:false,repositories:[]
});

/**
 * A repository is the consent unit. Multiple OS modules can have the same
 * canonical repository; the ownership manifest remains the only mapping.
 *
 * Always read a Git object from the tracked origin/main, never the current
 * checkout working tree (which may be old or on a feature branch). Refresh
 * only this remote tracking ref on demand; never mutate HEAD or user files.
 */
export function createForgeOrdaxRepositoryCatalog({
  documentsDirectory,gitOrigin=null,git=execFileSync,fetchMain=null,
  clock=Date.now,refreshIntervalMs=INTERVAL_MS,onUpdate=()=>{}
}={}){
  if(typeof documentsDirectory!=='string'||!path.isAbsolute(documentsDirectory)||
     (gitOrigin!==null&&typeof gitOrigin!=='function')||
     typeof git!=='function'||(fetchMain!==null&&typeof fetchMain!=='function')||
     typeof clock!=='function'||typeof onUpdate!=='function'||
     !Number.isSafeInteger(refreshIntervalMs)||refreshIntervalMs<1000)
    throw Error('forge_ordax_catalog_documents_required');

  const checkout=path.resolve(documentsDirectory,'GitHub','ordax-os');
  const same=(a,b)=>process.platform==='win32'
    ?a.toLowerCase()===b.toLowerCase():a===b;
  const command=(root,args,options={})=>git('git',['-C',root,...args],{
    timeout:7000,maxBuffer:MAX_BYTES+4096,windowsHide:true,...options
  });
  function checkedRoot(){
    const root=fs.realpathSync.native(checkout);
    if(!same(root,checkout))throw Error('checkout_reparse');
    const origin=gitOrigin?gitOrigin(root):
      String(command(root,['remote','get-url','origin'],{encoding:'utf8'})).trim();
    if(origin!==REMOTE&&origin!==REMOTE.slice(0,-4))
      throw Error('origin_mismatch');
    return root;
  }

  let lastAttemptAt=-Infinity,lastVerifiedAt=null,lastVerifiedCommit=null;
  let inFlight=null;
  function snapshot(){
    try{
      const root=checkedRoot();
      const sourceCommit=String(command(root,['rev-parse','--verify',REF],
        {encoding:'utf8'})).trim();
      if(!SHA.test(sourceCommit))throw Error('git_ref_invalid');
      const bytes=command(root,['show',REF+':'+SOURCE],{encoding:null});
      if(!Buffer.isBuffer(bytes)||bytes.length===0||bytes.length>MAX_BYTES)
        throw Error('manifest_invalid');
      const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      if(payload?.status!=='canonical'||!payload.repositories||
         typeof payload.repositories!=='object'||Array.isArray(payload.repositories))
        throw Error('manifest_invalid');
      const groups=new Map();
      for(const [role,entry] of Object.entries(payload.repositories)){
        const repo=entry?.repo;
        if(!/^[a-z][a-z_]{1,30}$/.test(role)||typeof repo!=='string'||
           !GITHUB.test(repo))throw Error('manifest_invalid');
        if(!groups.has(repo))groups.set(repo,{
          role,roles:[],repo,displayName:repo.split('/')[1],
          capability:'catalog_only',ownerVerified:false,
          repositoryAccessGranted:false,localGitReadGranted:false
        });
        groups.get(repo).roles.push(role);
      }
      const repositories=[...groups.values()];
      if(!groups.has('ordaxsystems/ordax-os')||
         repositories.length===0||repositories.length>24)
        throw Error('manifest_invalid');
      const fresh=lastVerifiedCommit===sourceCommit&&lastVerifiedAt!==null;
      return Object.freeze({
        schema:'ordax.forge.repository-catalog/1',available:true,
        source:'local_git_origin_main_tracking',sourceFile:SOURCE,
        sourceRef:REF,sourceCommit,
        sha256:createHash('sha256').update(bytes).digest('hex'),
        checkedOrigin:true,mainCommitVerified:fresh,
        ...(fresh?{lastRemoteFetchAt:lastVerifiedAt}:{}),
        externalGrantsVerified:false,executionAuthorized:false,repositories
      });
    }catch{return unavailable();}
  }

  function defaultFetch(root){
    return new Promise((resolve,reject)=>{
      execFile('git',['-C',root,'fetch','--quiet','--no-tags','origin',
        '+refs/heads/main:'+REF],{
        timeout:30_000,maxBuffer:4096,windowsHide:true,
        env:{...process.env,GIT_TERMINAL_PROMPT:'0'}
      },error=>error?reject(error):resolve());
    });
  }

  async function refresh({force=false}={}){
    if(inFlight)return inFlight;
    const now=clock();
    if(!force&&now-lastAttemptAt<refreshIntervalMs)
      return {refreshed:false,reason:'interval_not_elapsed'};
    lastAttemptAt=now;
    inFlight=(async()=>{
      const root=checkedRoot(),before=snapshot();
      await (fetchMain||defaultFetch)(root);
      const after=snapshot();
      if(after.available!==true)throw Error('ordax_remote_catalog_invalid');
      lastVerifiedCommit=after.sourceCommit;
      lastVerifiedAt=new Date(clock()).toISOString();
      if(before.sourceCommit!==after.sourceCommit)onUpdate();
      return {refreshed:true,sourceCommit:after.sourceCommit,
        repositoryCount:after.repositories.length};
    })();
    try{return await inFlight;}
    finally{inFlight=null;}
  }
  return Object.freeze({
    read(){
      const result=snapshot();
      if(result.available===true&&!inFlight&&
         clock()-lastAttemptAt>=refreshIntervalMs)
        void refresh().catch(()=>{});
      return result;
    },
    refresh
  });
}
