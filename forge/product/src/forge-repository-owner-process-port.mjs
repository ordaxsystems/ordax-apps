// Forge-native process supervision uses the existing Store and Task authority.
// Local process output is evidence from a child, never attested task completion.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {ForgeRepositoryOwnerReadPort} from './forge-repository-owner-read-port.mjs';
import {forgeExternalProcessEnvironment} from './forge-external-process-environment.mjs';

const MAX_RUNNING=2,MAX_LOG=48*1024,MAX_TIMEOUT=21_600_000;
const PROCESS=/^process_[a-f0-9-]{36}$/;
const iso=()=>new Date().toISOString();
const same=(a,b)=>process.platform==='win32'
  ?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase()
  :path.resolve(a)===path.resolve(b);
function checkedInput(input){
  const argv=input.argv,relative=input.workingDirectory??'';
  const timeoutMs=input.timeoutMs??1_800_000;
  if(!Array.isArray(argv)||argv.length<1||argv.length>24||
    argv.some(v=>typeof v!=='string'||!v||v.length>2048||v.includes('\0'))||
    argv.reduce((n,v)=>n+v.length,0)>8192)
    throw Error('forge_repository_process_argv_invalid');
  if(typeof relative!=='string'||relative.length>400||
     relative.includes('\0')||relative.includes('\\')||
     relative.startsWith('/')||relative.includes(':')||
     relative.split('/').some(v=>v==='.'||v==='..'))
    throw Error('forge_repository_process_directory_invalid');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>MAX_TIMEOUT)
    throw Error('forge_repository_process_timeout_invalid');
  return {argv,relative,timeoutMs};
}
function safeCwd(root,relative){
  let cwd=root;
  for(const part of relative.split('/').filter(Boolean)){
    cwd=path.join(cwd,part);
    const stat=fs.lstatSync(cwd);
    if(!stat.isDirectory()||stat.isSymbolicLink()||
       !same(fs.realpathSync.native(cwd),cwd))
      throw Error('forge_repository_process_directory_invalid');
  }
  return cwd;
}
function boundedAppend(text,chunk){
  const remaining=MAX_LOG-Buffer.byteLength(text,'utf8');
  if(remaining<=0)return {text,truncated:true};
  const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
  return {text:text+bytes.subarray(0,remaining).toString('utf8'),
    truncated:bytes.length>remaining};
}
function checkpoint(stdout){
  const lines=stdout.split(/\r?\n/u);
  for(let i=lines.length-2;i>=0;i--){
    const s=lines[i].trim(),marker='FORGE_PROCESS_CHECKPOINT|';
    if(!s.startsWith(marker)||s.length>2200)continue;
    try{
      const o=JSON.parse(s.slice(marker.length));
      if(!Number.isInteger(o.step)||o.step<0||
        !Number.isInteger(o.total)||o.total<1||o.total>100000||
        o.step>o.total||typeof o.stage!=='string'||
        !/^[a-z0-9_-]{1,45}$/.test(o.stage))continue;
      return {step:o.step,total:o.total,stage:o.stage,
        summary:typeof o.summary==='string'?o.summary.slice(0,200):null,
        source:'unverified_child_stdout'};
    }catch{}
  }
  return null;
}

export class ForgeRepositoryOwnerProcessPort extends ForgeRepositoryOwnerReadPort {
  constructor(options={}){
    super(options);
    this.db=this.store.db;
    this.live=new Map();
    // Process receipts are a projection in the EXISTING Forge SQLite, linked
    // to the canonical Task and command receipt. They are not another Task DB.
    this.db.exec(`CREATE TABLE IF NOT EXISTS forge_repository_process_runs (
      id TEXT PRIMARY KEY,workspace_session_id TEXT NOT NULL,
      project_id TEXT NOT NULL,task_id TEXT NOT NULL,
      repository TEXT NOT NULL,command_id TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL,pid INTEGER,
      stdout TEXT NOT NULL DEFAULT '',stderr TEXT NOT NULL DEFAULT '',
      stdout_truncated INTEGER NOT NULL DEFAULT 0,
      stderr_truncated INTEGER NOT NULL DEFAULT 0,
      checkpoint TEXT,exit_code INTEGER,reason TEXT,
      started_at TEXT NOT NULL,ended_at TEXT)`);
    this.db.exec('CREATE INDEX IF NOT EXISTS forge_repo_process_task_idx ON forge_repository_process_runs(workspace_session_id,project_id,task_id,repository,started_at)');
  }
  row(input){
    if(!PROCESS.test(input.processId??''))
      throw Error('forge_repository_process_id_invalid');
    const session=this.store.getWorkspaceSession();
    const row=this.db.prepare(`SELECT * FROM forge_repository_process_runs
      WHERE id=? AND workspace_session_id=? AND project_id=?
        AND task_id=? AND repository=?`)
      .get(input.processId,session?.id,input.projectId,input.taskId,input.repository);
    if(!row)throw Error('forge_repository_process_not_found');
    return row;
  }
  view(row,includeLogs=false){
    const live=this.live.get(row.id);
    const state=!live&&['starting','running'].includes(row.state)
      ?'uncertain':row.state;
    let cp=null;try{cp=row.checkpoint?JSON.parse(row.checkpoint):null;}catch{}
    return {schema:'ordax.forge.repository-process/1',processId:row.id,
      projectId:row.project_id,taskId:row.task_id,repository:row.repository,
      commandId:row.command_id,state,exitCode:row.exit_code,
      reason:state==='uncertain'?'forge_process_unverified_after_restart':row.reason,
      startedAt:row.started_at,endedAt:row.ended_at,
      checkpoint:cp,checkpointVerified:false,
      stdoutTruncated:row.stdout_truncated===1,
      stderrTruncated:row.stderr_truncated===1,
      ...(includeLogs?{stdout:row.stdout,stderr:row.stderr}:{}),
      rootPathExposed:false,externalEffectsVerified:false,
      source:'forge_native_owner_process_port'};
  }
  flush(live){
    if(!live?.dirty)return;
    live.dirty=false;
    const cp=checkpoint(live.stdout);
    try{
      this.db.prepare(`UPDATE forge_repository_process_runs SET stdout=?,
        stderr=?,stdout_truncated=?,stderr_truncated=?,checkpoint=? WHERE id=?`)
        .run(live.stdout,live.stderr,Number(live.outTruncated),
          Number(live.errTruncated),cp?JSON.stringify(cp):null,live.id);
    }catch{ /* SQLite may be closed: outcome is uncertain, never success. */ }
  }
  terminate(live,reason){
    if(live.stopReason)return;
    live.stopReason=reason;
    if(process.platform==='win32'&&Number.isInteger(live.child.pid)){
      try{
        const killer=spawn('taskkill.exe',
          ['/PID',String(live.child.pid),'/T','/F'],
          {stdio:'ignore',windowsHide:true,env:forgeExternalProcessEnvironment()});
        killer.on('error',()=>{try{live.child.kill();}catch{}});
        killer.unref();
      }catch{try{live.child.kill();}catch{}}
    }else{try{live.child.kill('SIGTERM');}catch{}}
  }
  finalize(live,code,error=null){
    if(live.finished)return;
    live.finished=true;
    clearTimeout(live.timer);clearInterval(live.monitor);
    this.flush(live);
    const state=live.stopReason==='timeout'?'timed_out':
      live.stopReason?'stopped':error?'failed':'exited';
    try{
      this.db.prepare(`UPDATE forge_repository_process_runs SET
        state=?,exit_code=?,reason=?,ended_at=? WHERE id=?`)
        .run(state,Number.isInteger(code)?code:null,
          live.stopReason||error,iso(),live.id);
    }catch{}
    this.live.delete(live.id);
  }
  async start(input,commandId,assertLease=()=>{}){
    const {argv,relative,timeoutMs}=checkedInput(input);
    if(!/^command_[a-f0-9-]{36}$/.test(commandId??''))
      throw Error('forge_repository_process_command_invalid');
    if(this.live.size>=MAX_RUNNING)
      throw Error('forge_repository_process_limit_reached');
    assertLease();
    const first=await this.authorize(input,'process');
    if(input.expectedHeadSha!==first.head)
      throw Error('forge_repository_head_version_conflict');
    const cwd=safeCwd(first.root,relative);
    const second=await this.authorize(input,'process');
    assertLease();
    if(!same(second.root,first.root)||second.head!==first.head)
      throw Error('forge_repository_process_scope_changed');
    // A different Task may have started while the Owner grants were checked.
    if(this.live.size>=MAX_RUNNING)
      throw Error('forge_repository_process_limit_reached');
    const id='process_'+randomUUID(),session=this.store.getWorkspaceSession();
    this.db.prepare(`INSERT INTO forge_repository_process_runs
      (id,workspace_session_id,project_id,task_id,repository,command_id,state,started_at)
      VALUES(?,?,?,?,?,?,'starting',?)`)
      .run(id,session.id,input.projectId,input.taskId,input.repository,commandId,iso());
    let child;
    try{
      child=spawn(argv[0],argv.slice(1),{
        cwd,env:forgeExternalProcessEnvironment(),
        shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    }catch(error){
      this.db.prepare(`UPDATE forge_repository_process_runs
        SET state='failed',reason=?,ended_at=? WHERE id=?`)
        .run('forge_process_spawn_failed',iso(),id);
      throw error;
    }
    const live={id,child,projectId:input.projectId,repository:input.repository,
      stdout:'',stderr:'',outTruncated:false,
      errTruncated:false,dirty:false,finished:false,stopReason:null,
      timer:null,monitor:null,checking:false};
    this.live.set(id,live);
    this.db.prepare(`UPDATE forge_repository_process_runs SET
      state='running',pid=? WHERE id=?`)
      .run(Number.isInteger(child.pid)?child.pid:null,id);
    const capture=(key,flag,chunk)=>{
      const result=boundedAppend(live[key],chunk);
      live[key]=result.text;live[flag] ||= result.truncated;live.dirty=true;
    };
    child.stdout?.on('data',data=>capture('stdout','outTruncated',data));
    child.stderr?.on('data',data=>capture('stderr','errTruncated',data));
    child.once('error',()=>this.finalize(live,null,'forge_process_spawn_failed'));
    child.once('close',code=>this.finalize(live,code));
    // Node spawn() can return before an ENOENT/error event; do not issue a
    // successful start receipt until the OS reports an actual spawn.
    await new Promise((resolve,reject)=>{
      const launched=()=>{child.off('error',failed);resolve();};
      const failed=()=>{child.off('spawn',launched);
        reject(Error('forge_repository_process_spawn_failed'));};
      child.once('spawn',launched);child.once('error',failed);
    });
    live.timer=setTimeout(()=>this.terminate(live,'timeout'),timeoutMs);
    live.timer.unref?.();
    live.monitor=setInterval(async()=>{
      if(live.finished||live.checking)return;
      live.checking=true;
      try{
        // The Task claim authorizes launch and later control; its expiry
        // must NOT kill a legitimate long-running process between chats.
        // Owner approval, project scope and physical Git identity remain live gates.
        const grant=await this.authorize(input,'process');
        if(!same(grant.root,first.root))
          throw Error('forge_repository_process_scope_changed');
        this.flush(live);
      }catch{this.terminate(live,'owner_or_repository_revoked');}
      finally{live.checking=false;}
    },5000);
    live.monitor.unref?.();
    return {schema:'ordax.forge.repository-process-start/1',
      processId:id,commandId,taskId:input.taskId,repository:input.repository,
      state:'running',gitHeadSha:first.head,
      ownerProcessGrantVerified:true,processExecutionAccepted:true,
      commandOutcomeVerified:false,rootPathExposed:false,
      externalEffectsVerified:false};
  }
  stopForRepository(projectId,repository){
    let stopped=0;
    for(const live of this.live.values()){
      if(live.projectId!==projectId||live.repository!==repository)continue;
      this.terminate(live,'owner_process_revoked');stopped++;
    }
    return stopped;
  }
  async status(input){
    await this.authorize(input,'process');
    const row=this.row(input);
    this.flush(this.live.get(row.id));
    const result=this.view(this.row(input));
    await this.authorize(input,'process');
    return result;
  }
  async logs(input){
    await this.authorize(input,'process');
    const row=this.row(input);
    this.flush(this.live.get(row.id));
    const result=this.view(this.row(input),true);
    await this.authorize(input,'process');
    return result;
  }
  async list(input){
    await this.authorize(input,'process');
    const session=this.store.getWorkspaceSession();
    const rows=this.db.prepare(`SELECT * FROM forge_repository_process_runs
      WHERE workspace_session_id=? AND project_id=? AND task_id=?
        AND repository=? ORDER BY started_at DESC LIMIT 21`)
      .all(session.id,input.projectId,input.taskId,input.repository);
    const processes=rows.slice(0,20).map(row=>{
      this.flush(this.live.get(row.id));return this.view(this.row({...input,processId:row.id}));
    });
    await this.authorize(input,'process');
    return {schema:'ordax.forge.repository-process-list/1',taskId:input.taskId,
      repository:input.repository,processes,truncated:rows.length>20,
      rootPathExposed:false};
  }
  async stop(input){
    await this.authorize(input,'process');
    const row=this.row(input),live=this.live.get(row.id);
    if(!live){
      if(['starting','running'].includes(row.state))
        throw Error('forge_repository_process_unowned_uncertain');
      return {processId:row.id,state:row.state,stopRequested:false,
        externalEffectsVerified:false};
    }
    this.terminate(live,'owner_requested_stop');
    return {processId:row.id,state:'stop_requested',stopRequested:true,
      externalEffectsVerified:false};
  }
}
