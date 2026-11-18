// GitHub identity verification only. Repository access, Git evidence and
// permissions remain exclusively with the authorized Forge Core.
const TOKEN=/^[\x21-\x7e]{8,512}$/;
const LOGIN=/^[A-Za-z0-9-]{1,39}$/;

export async function verifyGithubIdentity({credential,fetchImpl=fetch}={}){
  if(typeof credential!=='string'||!TOKEN.test(credential))
    throw Error('forge_git_github_credential_required');
  if(typeof fetchImpl!=='function')
    throw Error('forge_git_github_fetch_unavailable');
  const response=await fetchImpl('https://api.github.com/user',{
    method:'GET',redirect:'error',cache:'no-store',
    headers:{
      Authorization:'Bearer '+credential,
      Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28'
    },
    signal:AbortSignal.timeout(15000)
  });
  if(response.status!==200)
    throw Error('forge_git_github_identity_http_'+response.status);
  const raw=await response.text();
  if(raw.length>10000)throw Error('forge_git_github_identity_invalid');
  let who;
  try{who=JSON.parse(raw);}catch{throw Error('forge_git_github_identity_invalid');}
  if(!LOGIN.test(who?.login||'')||
     !Number.isSafeInteger(who?.id)||who.id<1)
    throw Error('forge_git_github_identity_invalid');
  return Object.freeze({login:who.login,id:who.id,
    identityVerified:true,repositoryAccessVerified:false});
}
