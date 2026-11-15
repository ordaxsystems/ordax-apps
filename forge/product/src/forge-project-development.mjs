// Native development on the authorized project's existing Windows workspace.
// This is NOT a sandbox: commands inherit the logged-in Windows user's power.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

const DEFAULT_TIMEOUT_MS=120_000;
const MAX_TIMEOUT_MS=1_800_000;
const MAX_OUTPUT_BYTES=48*1024;
const ENVIRONMENT_KEYS=['PATH','Path','PATHEXT','SystemRoot','SYSTEMROOT','WINDIR',
  'COMSPEC','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH',
  'APPDATA','LOCALAPPDATA','PROGRAMFILES','PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS','LANG','HOME'];
const childEnvironment=()=>Object.fromEntries(
  ENVIRONMENT_KEYS.filter(key=>typeof process.env[key]==='string').map(key=>[key,process.env[key]]));

function checkedDirectory(root,relative='') {
  if(typeof relative!=='string'||relative.length>1000||relative.includes('\0')||
      relative.includes('\\')||relative.startsWith('/')||
      relative.split('/').some(part=>part==='..'||part==='.') )
    throw Error('forge_development_directory_invalid');
  const selected=path.resolve(root,...(relative?relative.split('/'):[]));
  const rel=path.relative(root,selected);
  if(rel.startsWith('..'+path.sep)||rel==='..'||path.isAbsolute(rel))
    throw Error('forge_development_directory_invalid');
  let cursor=root;
  for(const part of rel.split(path.sep).filter(Boolean)){
    cursor=path.join(cursor,part);
    const info=fs.lstatSync(cursor);
    if(!info.isDirectory()||info.isSymbolicLink()||
       path.resolve(fs.realpathSync.native(cursor))!==path.resolve(cursor))
      throw Error('forge_development_directory_invalid');
  }
  return selected;
}
function appendBounded(buffer,chunk){
  if(buffer.length>=MAX_OUTPUT_BYTES)return {buffer,truncated:true};
  const next=Buffer.concat([buffer,chunk]);
  return next.length>MAX_OUTPUT_BYTES
    ?{buffer:next.subarray(0,MAX_OUTPUT_BYTES),truncated:true}
    :{buffer:next,truncated:false};
}

export class ForgeProjectDevelopment {
  constructor({store,workspaces,ownerTrust}={}){
    if(!store?.db||typeof workspaces?.status!=='function'||
       typeof ownerTrust?.isTrusted!=='function')
      throw Error('forge_development_owner_ports_required');
    this.store=store;this.db=store.db;
    this.workspaces=workspaces;this.ownerTrust=ownerTrust;
    // Separate from historical MCP read-only approvals; old grants must
    // NEVER silently become full Windows command execution.
    this.db.exec('CREATE TABLE IF NOT EXISTS forge_project_development_approvals('+
      'project_id TEXT PRIMARY KEY REFERENCES lab_projects(id) ON DELETE CASCADE,'+
      'workspace_session_id TEXT NOT NULL REFERENCES workspace_sessions(id),'+
      'scope_hash TEXT NOT NULL,approved_at TEXT NOT NULL)');
  }
  status(projectId){
    const scope=this.workspaces.status(projectId);
    const bound=scope.configured===true&&scope.verified===true;
    const session=this.store.getWorkspaceSession();
    const approved=bound&&this.ownerTrust.isAppTrusted()&&Boolean(
      this.db.prepare('SELECT 1 FROM forge_project_development_approvals WHERE project_id=? AND workspace_session_id=? AND scope_hash=?')
        .get(projectId,session.id,this.ownerTrust.scopeHash(projectId)));

    return {schema:'ordax.forge.project-development/1',projectId,
      available:approved,ownerBoundWorkspace:bound,
      ownerApproved:approved,permission:approved?'full_windows_user':'not_authorized',
      nativeProcessExecution:approved,workspaceIsSandbox:false,
      effectReceipts:'canonical_app_sqlite',rootPathExposed:false,
      reason:!bound?'owner_workspace_not_verified':!approved?'owner_development_approval_required':null};
  }
  approve(projectId,{expectedScopeHash=null}={}){
    const scope=this.workspaces.status(projectId);
    if(!scope.configured||!scope.verified||!this.ownerTrust.isAppTrusted())
      throw Error('forge_development_owner_approval_required');
    const currentHash=this.ownerTrust.scopeHash(projectId);
    if(expectedScopeHash!==null&&currentHash!==expectedScopeHash)
      throw Error('forge_development_scope_changed');
    const session=this.store.getWorkspaceSession();
    this.db.prepare('INSERT INTO forge_project_development_approvals(project_id,workspace_session_id,scope_hash,approved_at) VALUES(?,?,?,?) '+
      'ON CONFLICT(project_id) DO UPDATE SET workspace_session_id=excluded.workspace_session_id,scope_hash=excluded.scope_hash,approved_at=excluded.approved_at')
      .run(projectId,session.id,currentHash,this.store.now());
    return this.status(projectId);
  }
  revoke(projectId){
    this.workspaces.status(projectId);
    this.db.prepare('DELETE FROM forge_project_development_approvals WHERE project_id=? AND workspace_session_id=?')
      .run(projectId,this.store.getWorkspaceSession().id);
    return this.status(projectId);
  }
  async run({projectId,command,workingDirectory:relative='',timeoutMs=DEFAULT_TIMEOUT_MS}={}){
    if(typeof command!=='string'||!command.trim()||command.length>8000||command.includes('\0')||
       !Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>MAX_TIMEOUT_MS)
      throw Error('forge_development_command_invalid');
    if(!this.status(projectId).available)
      throw Error('forge_development_owner_approval_required');
    const original=this.workspaces.status(projectId);
    const cwd=checkedDirectory(original.path,relative);
    const windows=process.platform==='win32';
    const executable=windows?(process.env.ComSpec||'cmd.exe'):'/bin/sh';
    const args=windows?['/d','/s','/c',command]:['-c',command];
    return await new Promise((resolve,reject)=>{
      let child;
      try{child=spawn(executable,args,{cwd,env:childEnvironment(),
        windowsHide:true,stdio:['ignore','pipe','pipe']});}
      catch(error){reject(error);return;}
      let stdout=Buffer.alloc(0),stderr=Buffer.alloc(0),outTruncated=false,errTruncated=false;
      let timedOut=false,settled=false,scopeRevoked=false;
      const terminate=()=>{
        if(windows){
          try{const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],
            {windowsHide:true,stdio:'ignore'});killer.unref();}catch{}
        }
        try{child.kill('SIGKILL');}catch{}
      };
      const timeout=setTimeout(()=>{timedOut=true;terminate();},timeoutMs);
      timeout.unref?.();
      // Revocation is effective during a command, not only on the next call.
      const monitor=setInterval(()=>{
        try {
          if(!this.status(projectId).available||
             this.workspaces.status(projectId).path!==original.path){
            scopeRevoked=true;terminate();
          }
        }catch{scopeRevoked=true;terminate();}
      },350);
      monitor.unref?.();
      child.stdout?.on('data',chunk=>{
        const result=appendBounded(stdout,chunk);stdout=result.buffer;
        outTruncated=outTruncated||result.truncated;
      });
      child.stderr?.on('data',chunk=>{
        const result=appendBounded(stderr,chunk);stderr=result.buffer;
        errTruncated=errTruncated||result.truncated;
      });
      const finish=(error,code,signal)=>{
        if(settled)return;settled=true;clearTimeout(timeout);clearInterval(monitor);
        if(scopeRevoked)return reject(Error('forge_development_scope_changed'));
        if(error)return reject(error);
        if(timedOut)return reject(Error('forge_development_command_outcome_uncertain'));
        const after=this.workspaces.status(projectId);
        if(!this.status(projectId).available||after.path!==original.path)
          return reject(Error('forge_development_scope_changed'));
        resolve({projectId,exitCode:code,signal:signal??null,
          stdout:stdout.toString('utf8'),stderr:stderr.toString('utf8'),
          stdoutTruncated:outTruncated,stderrTruncated:errTruncated,
          completed:true,commandOutcome:code===0?'exit_zero':'nonzero_exit',
          workingDirectory:relative||'.',workspaceIsSandbox:false,
          externalEffectsVerified:false});
      };
      child.once('error',error=>finish(error,null,null));
      child.once('close',(code,signal)=>finish(null,code,signal));
    });
  }
}
