import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {createHash} from 'node:crypto';

const REMOTE='https://github.com/ordaxsystems/ordax-os.git';
const SOURCE='docs/contracts/repository-ownership.json';
const MAX_BYTES=128_000;
const GITHUB=/^ordaxsystems\/[a-z0-9][a-z0-9-]{1,100}$/;
/**
 * Read-only projection of the OrdaX OS canonical ownership contract.
 * This grants NO repository, filesystem, Runtime, OAuth or Git authority.
 * It never copies or caches the owner manifest in another Store.
 */
export function createForgeOrdaxRepositoryCatalog({documentsDirectory,
    gitOrigin=null,readSource=fs.readFileSync}={}){
  if(typeof documentsDirectory!=='string'||!path.isAbsolute(documentsDirectory))
    throw Error('forge_ordax_catalog_documents_required');
  const checkout=path.resolve(documentsDirectory,'GitHub','ordax-os');
  return Object.freeze({
    read(){
      try{
        const root=fs.realpathSync.native(checkout);
        const equals=(a,b)=>process.platform==='win32'
          ?a.toLowerCase()===b.toLowerCase():a===b;
        if(!equals(root,checkout))throw Error('checkout_reparse');
        const origin=gitOrigin?gitOrigin(root):execFileSync('git',
          ['-C',root,'remote','get-url','origin'],
          {encoding:'utf8',timeout:3000,maxBuffer:1000,windowsHide:true}).trim();
        if(origin!==REMOTE&&origin!==REMOTE.slice(0,-4))
          throw Error('origin_mismatch');
        // Without an authenticated origin proof, the catalogue is not promoted
        // as verified provenance, even though its local content is readable.
        const file=path.join(root,...SOURCE.split('/'));
        const stat=fs.lstatSync(file);
        if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_BYTES)
          throw Error('manifest_invalid');
        const bytes=readSource(file);
        if(!Buffer.isBuffer(bytes)||bytes.length>MAX_BYTES)
          throw Error('manifest_invalid');
        const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
        if(payload?.status!=='canonical'||!payload.repositories||
          typeof payload.repositories!=='object'||Array.isArray(payload.repositories))
          throw Error('manifest_invalid');
        const repos=[],seen=new Set();
        for(const [role,entry] of Object.entries(payload.repositories)){
          const repo=entry?.repo;
          if(!/^[a-z][a-z_]{1,30}$/.test(role)||typeof repo!=='string'||
            !GITHUB.test(repo)||seen.has(repo))throw Error('manifest_invalid');
          seen.add(repo);
          repos.push({role,repo,displayName:repo.split('/')[1],
            capability:'catalog_only',ownerVerified:false,
            repositoryAccessGranted:false,localGitReadGranted:false});
        }
        if(!repos.some(item=>item.repo==='ordaxsystems/ordax-os')||
          repos.length<1||repos.length>24)throw Error('manifest_invalid');
        return Object.freeze({
          schema:'ordax.forge.repository-catalog/1',available:true,
          source:'local_ordax_os_canonical_ownership_contract',
          sourceFile:SOURCE,sha256:createHash('sha256').update(bytes).digest('hex'),
          checkedOrigin:origin===REMOTE||origin===REMOTE.slice(0,-4),
          mainCommitVerified:false,externalGrantsVerified:false,
          executionAuthorized:false,repositories:repos
        });
      }catch{
        return Object.freeze({schema:'ordax.forge.repository-catalog/1',
          available:false,reason:'ordax_ownership_contract_unavailable',
          externalGrantsVerified:false,executionAuthorized:false,repositories:[]});
      }
    }
  });
}
