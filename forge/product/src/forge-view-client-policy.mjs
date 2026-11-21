// Explicit DEV composition: Electron presents the existing Node Host UI,
// while the Node process exclusively owns Store/Core. No second SQLite owner.
const ORIGIN=/^http:\/\/127\.0\.0\.1:([1-9][0-9]{3,4})$/;
export function parseForgeViewClientArgs(argv=process.argv){
  if(!Array.isArray(argv))throw Error('forge_view_args_required');
  if(!argv.includes('--forge-view-only'))return null;
  const origins=argv.filter(value=>typeof value==='string'&&value.startsWith('--forge-core-origin='));
  if(argv.filter(value=>value==='--forge-view-only').length!==1||
    argv.filter(value=>value==='--forge-view-approved').length!==1||
    origins.length!==1)throw Error('forge_view_explicit_owner_approval_required');
  const origin=origins[0].slice('--forge-core-origin='.length);
  const match=ORIGIN.exec(origin);
  if(!match||Number(match[1])>65535||Number(match[1])<1024)
    throw Error('forge_view_loopback_origin_required');
  return Object.freeze({origin,port:Number(match[1])});
}
export function forgeViewNavigationAllowed(url,origin){
  if(typeof url!=='string'||typeof origin!=='string')return false;
  try{
    const parsed=new URL(url);
    return parsed.origin===origin&&parsed.protocol==='http:'&&parsed.hostname==='127.0.0.1'&&
      !parsed.username&&!parsed.password;
  }catch{return false;}
}
