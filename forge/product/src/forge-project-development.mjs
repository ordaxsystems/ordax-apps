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
  status(projectId,{taskId=null}={}){
    const scope=this.workspaces.status(projectId);
    const bound=scope.configured===true&&scope.verified===true;
    const session=this.store.getWorkspaceSession();
    const approved=bound&&this.ownerTrust.isAppTrusted()&&Boolean(
      this.db.prepare('SELECT 1 FROM forge_project_development_approvals WHERE project_id=? AND workspace_session_id=? AND scope_hash=?')
        .get(projectId,session.id,this.ownerTrust.scopeHash(projectId)));
    let worktree=null;
    if(taskId!==null)worktree=this.workspaces.taskWorktree(projectId,taskId);
    return {schema:'ordax.forge.project-development/1',projectId,
      ...(taskId?{taskId}:{}),
      available:approved,ownerBoundWorkspace:bound,
      ownerApproved:approved,permission:approved?'full_windows_user':'not_authorized',
      nativeProcessExecution:approved,workspaceIsSandbox:false,
      effectReceipts:'canonical_app_sqlite',rootPathExposed:false,
      taskWorkspace:taskId?worktree?.status==='active'
        ?{active:true,kind:'git_worktree',branchName:worktree.branchName,
          baseHeadSha:worktree.baseHeadSha,rootPathExposed:false}
        :{active:false,kind:'project_root'}:null,
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
  requiresTaskScope(projectId){
    return this.workspaces.hasActiveTaskWorktrees(projectId);
  }
  async prepareWorktree(projectId,taskId){
    if(!this.status(projectId,{taskId}).available)
      throw Error('forge_development_owner_approval_required');
    const existing=this.workspaces.taskWorktree(projectId,taskId);
    if(existing?.status==='active')return {
      projectId,taskId,status:'active',branchName:existing.branchName,
      baseHeadSha:existing.baseHeadSha,workspaceScope:'task_worktree',
      rootPathExposed:false,alreadyPrepared:true
    };
    if(existing)throw Error('forge_worktree_state_invalid');
    const root=this.workspaces.mainRootForProject(projectId);
    if(!root)throw Error('forge_workspace_binding_required');
    const git=async command=>{
      const result=await this.run({projectId,command,timeoutMs:30000});
      if(result.exitCode!==0)throw Error('forge_worktree_git_command_failed');
      return result.stdout.trim();
    };
    const top=path.resolve(await git('git rev-parse --show-toplevel'));
    if((process.platform==='win32'?top.toLowerCase():top)!==
       (process.platform==='win32'?path.resolve(root).toLowerCase():path.resolve(root)))
      throw Error('forge_worktree_repository_root_mismatch');
    const commonRaw=await git('git rev-parse --git-common-dir');
    const common=path.resolve(root,commonRaw),expectedCommon=path.join(path.resolve(root),'.git');
    const sameCommon=process.platform==='win32'
      ?common.toLowerCase()===expectedCommon.toLowerCase():common===expectedCommon;
    if(!sameCommon)throw Error('forge_worktree_git_metadata_invalid');
    const commonInfo=fs.lstatSync(common);
    if(!commonInfo.isDirectory()||commonInfo.isSymbolicLink())
      throw Error('forge_worktree_git_metadata_invalid');
    const dirty=await git('git status --porcelain=v1 --untracked-files=all');
    if(dirty)throw Error('forge_worktree_main_dirty');
    const baseHeadSha=await git('git rev-parse HEAD');
    if(!/^[a-f0-9]{40}$/.test(baseHeadSha))throw Error('forge_worktree_head_invalid');
    const branchName='forge/'+taskId;
    const branchProbe=await this.run({projectId,
      command:'git show-ref --verify --quiet refs/heads/'+branchName,timeoutMs:15000});
    if(branchProbe.exitCode===0)throw Error('forge_worktree_branch_exists');
    if(branchProbe.exitCode!==1)throw Error('forge_worktree_git_command_failed');
    const info=path.join(common,'info');fs.mkdirSync(info,{recursive:true});
    const exclude=path.join(info,'exclude');
    let excludeText='';
    try{excludeText=fs.readFileSync(exclude,'utf8');}catch(error){
      if(error?.code!=='ENOENT')throw error;
    }
    if(!excludeText.split(/\r?\n/).map(line=>line.trim()).includes('.forge-worktrees/'))
      fs.appendFileSync(exclude,(excludeText&&!excludeText.endsWith('\n')?'\n':'')+'.forge-worktrees/\n','utf8');
    const relative='.forge-worktrees/'+taskId;
    let physicalCreated=false;
    try {
      const created=await this.run({projectId,
        command:'git worktree add -b '+branchName+' '+relative+' HEAD',timeoutMs:60000});
      if(created.exitCode!==0)throw Error('forge_worktree_create_failed');
      physicalCreated=true;
      const childTop=path.resolve(await git('git -C '+relative+' rev-parse --show-toplevel'));
      const expected=path.resolve(this.workspaces.expectedTaskWorktreeRoot(projectId,taskId));
      if((process.platform==='win32'?childTop.toLowerCase():childTop)!==
         (process.platform==='win32'?expected.toLowerCase():expected))
        throw Error('forge_worktree_verification_failed');
      const childBranch=await git('git -C '+relative+' branch --show-current');
      const childHead=await git('git -C '+relative+' rev-parse HEAD');
      if(childBranch!==branchName||childHead!==baseHeadSha)
        throw Error('forge_worktree_verification_failed');
      const recorded=this.workspaces.recordTaskWorktree(projectId,taskId,{branchName,baseHeadSha});
      return {projectId,taskId,status:'active',branchName:recorded.branchName,
        baseHeadSha:recorded.baseHeadSha,workspaceScope:'task_worktree',
        rootPathExposed:false,alreadyPrepared:false};
    } catch(error) {
      if(physicalCreated){
        try{await this.run({projectId,command:'git worktree remove --force '+relative,timeoutMs:30000});}catch{}
        try{await this.run({projectId,command:'git branch -D '+branchName,timeoutMs:30000});}catch{}
      }
      throw error;
    }
  }
  async run({projectId,taskId=null,command,workingDirectory:relative='',timeoutMs=DEFAULT_TIMEOUT_MS}={}){
    if(typeof command!=='string'||!command.trim()||command.length>8000||command.includes('\0')||
       !Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>MAX_TIMEOUT_MS)
      throw Error('forge_development_command_invalid');
    if(!this.status(projectId,{taskId}).available)
      throw Error('forge_development_owner_approval_required');
    const original=this.workspaces.status(projectId);
    const executionRoot=this.workspaces.rootForProject(projectId,taskId);
    if(!executionRoot)throw Error('forge_workspace_binding_required');
    const cwd=checkedDirectory(executionRoot,relative);
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
          if(!this.status(projectId,{taskId}).available||
             this.workspaces.status(projectId).path!==original.path||
             this.workspaces.rootForProject(projectId,taskId)!==executionRoot){
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
        if(!this.status(projectId,{taskId}).available||after.path!==original.path||
           this.workspaces.rootForProject(projectId,taskId)!==executionRoot)
          return reject(Error('forge_development_scope_changed'));
        resolve({projectId,...(taskId?{taskId}:{}),exitCode:code,signal:signal??null,
          stdout:stdout.toString('utf8'),stderr:stderr.toString('utf8'),
          stdoutTruncated:outTruncated,stderrTruncated:errTruncated,
          completed:true,commandOutcome:code===0?'exit_zero':'nonzero_exit',
          workingDirectory:relative||'.',
          workspaceScope:taskId&&this.workspaces.taskWorktree(projectId,taskId)?.status==='active'
            ?'task_worktree':'project_root',
          workspaceIsSandbox:false,externalEffectsVerified:false});
      };
      child.once('error',error=>finish(error,null,null));
      child.once('close',(code,signal)=>finish(null,code,signal));
    });
  }
}
