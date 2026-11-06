import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const MAX_BYTES=65536;
const PROJECT=/^project_[A-Za-z0-9-]{1,100}$/;
const SEGMENT=/^[A-Za-z0-9][A-Za-z0-9._ -]{0,79}$/;
const RESERVED=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const compare=(a,b)=>process.platform==='win32'
  ?a.toLowerCase()===b.toLowerCase():a===b;

function components(value,{allowEmpty=false}={}) {
  if(typeof value!=='string'||value.length>240||value.includes('\\')||
    value.includes(String.fromCharCode(0))||value.startsWith('/')||value.endsWith('/'))
    throw Error('forge_file_path_invalid');
  if(value===''&&allowEmpty)return [];
  const parts=value.split('/');
  if(parts.length>12||parts.some(part=>!SEGMENT.test(part)||part==='.'||
    part==='..'||part.endsWith('.')||part.endsWith(' ')||RESERVED.test(part)))
    throw Error('forge_file_path_invalid');
  return parts;
}
function checkedDirectory(folder) {
  const info=fs.lstatSync(folder);
  if(info.isSymbolicLink()||!info.isDirectory())throw Error('forge_file_reparse_denied');
}
function existingFile(file) {
  const info=fs.lstatSync(file);
  if(info.isSymbolicLink()||!info.isFile())throw Error('forge_file_reparse_denied');
  if(info.size>MAX_BYTES)throw Error('forge_file_size_limit');
  return info;
}
const missing=error=>error?.code==='ENOENT';

export class ForgeProjectFiles {
  constructor({root}={}) {
    if(typeof root!=='string'||!path.isAbsolute(root))throw Error('forge_file_root_invalid');
    this.root=path.resolve(root);
  }
  // App-owned, non-shared root; project IDs are opaque, never prompts-as-paths.
  projectRoot(projectId,{create=false}={}) {
    if(!PROJECT.test(projectId))throw Error('forge_file_project_invalid');
    if(create)fs.mkdirSync(this.root,{recursive:true});
    try{checkedDirectory(this.root);}catch(e){if(missing(e)&&!create)return null;throw e;}
    if(!compare(fs.realpathSync(this.root),this.root))throw Error('forge_file_reparse_denied');
    const root=path.join(this.root,projectId);
    if(create) {
      try{fs.mkdirSync(root);}catch(e){if(e.code!=='EEXIST')throw e;}
    }
    try{checkedDirectory(root);}catch(e){if(missing(e)&&!create)return null;throw e;}
    if(!compare(fs.realpathSync(root),root))throw Error('forge_file_reparse_denied');
    return root;
  }
  resolve(projectId,relative,{createParents=false,allowEmpty=false}={}) {
    const parts=components(relative,{allowEmpty});
    const root=this.projectRoot(projectId,{create:createParents});
    if(!root)return {root:null,target:null,parts};
    let cursor=root;
    for(const part of parts.slice(0,-1)){
      cursor=path.join(cursor,part);
      if(createParents){
        try{fs.mkdirSync(cursor);}catch(e){if(e.code!=='EEXIST')throw e;}
      }
      checkedDirectory(cursor);
      if(!compare(fs.realpathSync(cursor),cursor))throw Error('forge_file_reparse_denied');
    }
    const target=parts.length?path.join(cursor,parts.at(-1)):cursor;
    return {root,target,parts};
  }
  status(projectId) {
    const root=this.projectRoot(projectId);
    return {projectId,mode:'app_isolated_workspace',exists:Boolean(root),
      rootKind:'forge_app_private',externalFolderAuthorized:false,
      maxFileBytes:MAX_BYTES,readAvailable:true,writeAvailable:true};
  }
  list(projectId,directory='') {
    const checked=this.resolve(projectId,directory,{allowEmpty:true});
    if(!checked.root)return {projectId,directory,exists:false,entries:[],truncated:false};
    const dir=checked.target;
    try{checkedDirectory(dir);}catch(e){if(missing(e))return {projectId,directory,exists:false,entries:[],truncated:false};throw e;}
    if(!compare(fs.realpathSync(dir),dir))throw Error('forge_file_reparse_denied');
    const names=fs.readdirSync(dir).sort((a,b)=>a.localeCompare(b,'en'));
    const entries=names.slice(0,100).map(name=>{
      const stat=fs.lstatSync(path.join(dir,name));
      return {name,kind:stat.isSymbolicLink()?'blocked_reparse':
        stat.isDirectory()?'directory':stat.isFile()?'file':'unsupported',
        ...(stat.isFile()?{bytes:stat.size}:{})};
    });
    return {projectId,directory,exists:true,entries,truncated:names.length>entries.length};
  }
  read(projectId,relative) {
    const {target}=this.resolve(projectId,relative);
    if(!target)throw Error('forge_file_not_found');
    try{existingFile(target);}catch(e){if(missing(e))throw Error('forge_file_not_found');throw e;}
    if(!compare(fs.realpathSync(target),target))throw Error('forge_file_reparse_denied');
    const flag=fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0);
    const fd=fs.openSync(target,flag);
    try{
      const info=fs.fstatSync(fd);
      if(!info.isFile()||info.size>MAX_BYTES)throw Error('forge_file_size_limit');
      const bytes=fs.readFileSync(fd);
      if(bytes.length>MAX_BYTES)throw Error('forge_file_size_limit');
      const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      return {projectId,path:relative,content:text,bytes:bytes.length,
        sha256:sha256(bytes),verified:'local_readback',externalEffectVerified:false};
    }finally{fs.closeSync(fd);}
  }
  write(projectId,relative,content,expectedSha256=null) {
    if(typeof content!=='string'||content.includes(String.fromCharCode(0)))throw Error('forge_file_content_invalid');
    const bytes=Buffer.from(content,'utf8');
    if(bytes.length>MAX_BYTES)throw Error('forge_file_size_limit');
    if(expectedSha256!==null&&
      (typeof expectedSha256!=='string'||!/^[a-f0-9]{64}$/.test(expectedSha256)))
      throw Error('forge_file_expected_hash_invalid');
    const {target,parts}=this.resolve(projectId,relative,{createParents:true});
    if(!parts.length)throw Error('forge_file_path_invalid');
    let exists=false;
    try{
      const previous=this.read(projectId,relative);
      exists=true;
      if(expectedSha256===null||previous.sha256!==expectedSha256)
        throw Error('forge_file_version_conflict');
    }catch(e){if(e.message!=='forge_file_not_found')throw e;
      if(expectedSha256!==null)throw Error('forge_file_version_conflict');}
    const temp=path.join(path.dirname(target),'.ordax-write-'+randomUUID()+'.tmp');
    let created=false;
    try{
      const fd=fs.openSync(temp,'wx',0o600);
      try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      // Recheck parent/reparse and the target version before final rename.
      const again=this.resolve(projectId,relative);
      if(again.target!==target)throw Error('forge_file_path_changed');
      const nowExists=fs.existsSync(target);
      if(nowExists!==exists)throw Error('forge_file_version_conflict');
      if(exists&&this.read(projectId,relative).sha256!==expectedSha256)
        throw Error('forge_file_version_conflict');
      fs.renameSync(temp,target);
      created=true;
      const proof=this.read(projectId,relative);
      if(proof.sha256!==sha256(bytes))throw Error('forge_file_readback_mismatch');
      return {projectId,path:relative,bytes:proof.bytes,sha256:proof.sha256,
        created:!exists,verified:true,verification:'sha256_readback',
        source:'forge_app_private_workspace'};
    }finally{if(!created)try{fs.unlinkSync(temp);}catch{}}
  }
}
