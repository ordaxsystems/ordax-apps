import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';

// One atomic Task claim per work, in the existing Forge SQLite.
// A claim records ownership intent; it never dispatches GPT or certifies an effect.
const LEASE_MS=30*60_000;
const digest=value=>createHash('sha256').update(value).digest('hex');
const validToken=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const safeEqual=(stored,token)=>typeof stored==='string'&&/^[a-f0-9]{64}$/.test(stored)&&
  validToken(token)&&timingSafeEqual(Buffer.from(stored,'hex'),Buffer.from(digest(token),'hex'));

export class ForgeWorkClaims {
  constructor(store){
    this.store=store;
    this.db=store.db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lab_work_claims (
        task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES lab_projects(id) ON DELETE CASCADE,
        workspace_session_id TEXT NOT NULL REFERENCES workspace_sessions(id),
        actor_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        chat_label TEXT NOT NULL,
        claim_hash TEXT NOT NULL,
        generation INTEGER NOT NULL CHECK(generation>0),
        status TEXT NOT NULL CHECK(status IN ('active','released')),
        lease_until TEXT NOT NULL,
        last_progress TEXT,
        acquired_at TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lab_work_claims_project
        ON lab_work_claims(project_id,status,lease_until);
    `);
  }
  row(projectId,taskId,workspaceSessionId){
    return this.db.prepare('SELECT * FROM lab_work_claims WHERE project_id=? AND task_id=? AND workspace_session_id=?')
      .get(projectId,taskId,workspaceSessionId)||null;
  }
  snapshot(projectId,taskId,workspaceSessionId){
    const row=this.row(projectId,taskId,workspaceSessionId);
    if(!row)return null;
    const expired=row.status==='active'&&Date.parse(row.lease_until)<=Date.now();
    return {taskId:row.task_id,chatLabel:row.chat_label,
      state:row.status==='released'?'released':expired?'expired':'occupied',
      generation:row.generation,acquiredAt:row.acquired_at,
      heartbeatAt:row.heartbeat_at,leaseUntil:row.lease_until,
      updatedAt:row.updated_at,lastProgress:row.last_progress,
      leaseExpired:expired,externalEffectVerified:false,
      chatIdentityVerified:false,source:'canonical_sqlite_task_claim'};
  }
  blockers(projectId,taskId){
    const live=this.db.prepare("SELECT 1 FROM runs WHERE task_id=? AND status='running' LIMIT 1").get(taskId);
    // The existing scoped receipt view is the authority for effects whose
    // completion is uncertain, even after the claimant's heartbeat expires.
    const unresolved=this.db.prepare(`SELECT 1 FROM lab_command_receipt_scope
      WHERE project_id=? AND status IN ('running','uncertain')
      AND (task_id=? OR task_id IS NULL OR unknown_work_target=1)
      AND operation NOT IN ('work_claim','work_progress','work_memory_set')
      LIMIT 1`).get(projectId,taskId);
    return Boolean(live||unresolved);
  }
  authorized(row,input,{requireActive=true}={}){
    if(!row||!safeEqual(row.claim_hash,input.claimToken)||
      row.generation!==input.generation||
      (requireActive&&row.status!=='active'))throw Error('forge_work_claim_not_owned');
    return row;
  }
  assertTaskMutation(context,input){
    if(!input?.taskId)return;
    const row=this.row(input.projectId,input.taskId,context.workspaceSessionId);
    if(!row||row.status==='released')return;
    this.authorized(row,{claimToken:input.claimToken,generation:input.claimGeneration});
    if(Date.parse(row.lease_until)<=Date.now())
      throw Error('forge_work_claim_renew_required');
  }
  // Strict for native repository reads: a released, absent or expired lease
  // must NEVER authorize observing another chat's assigned physical files.
  // Unlike assertTaskMutation, historical unclaimed Tasks do not pass.
  assertActiveTaskLease(context,input){
    const row=this.row(input.projectId,input.taskId,context.workspaceSessionId);
    this.authorized(row,{claimToken:input.claimToken,generation:input.claimGeneration});
    if(Date.parse(row.lease_until)<=Date.now())
      throw Error('forge_work_claim_renew_required');
    return true;
  }
  claim(context,input){
    const now=this.store.now();
    const previous=this.row(input.projectId,input.taskId,context.workspaceSessionId);
    if(input.action==='acquire'){
      const chatLabel=String(input.chatLabel||'').trim();
      if(!chatLabel||chatLabel.length>100)throw Error('forge_work_chat_label_required');
      if(previous?.status==='active'&&Date.parse(previous.lease_until)>Date.now())
        return {status:'occupied',acquired:false,claim:this.snapshot(input.projectId,input.taskId,context.workspaceSessionId)};
      if(this.blockers(input.projectId,input.taskId))
        return {status:'blocked_unreconciled_effects',acquired:false,
          claim:this.snapshot(input.projectId,input.taskId,context.workspaceSessionId)};
      const token=randomBytes(32).toString('base64url'),generation=(previous?.generation||0)+1;
      const leaseUntil=new Date(Date.now()+LEASE_MS).toISOString();
      this.db.prepare(`INSERT INTO lab_work_claims
        (task_id,project_id,workspace_session_id,actor_id,client_id,chat_label,claim_hash,
          generation,status,lease_until,last_progress,acquired_at,heartbeat_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(task_id) DO UPDATE SET
          actor_id=excluded.actor_id,client_id=excluded.client_id,
          chat_label=excluded.chat_label,claim_hash=excluded.claim_hash,
          generation=excluded.generation,status=excluded.status,
          lease_until=excluded.lease_until,acquired_at=excluded.acquired_at,
          heartbeat_at=excluded.heartbeat_at,updated_at=excluded.updated_at`)
        .run(input.taskId,input.projectId,context.workspaceSessionId,
          context.actorId,context.clientId,chatLabel,digest(token),generation,'active',
          leaseUntil,previous?.last_progress||null,now,now,now);
      this.store.event(input.taskId,'forge.work_claim.acquired',
        {projectId:input.projectId,chatLabel,generation,leaseUntil,previousExpired:Boolean(previous)});
      return {status:'acquired',acquired:true,claimToken:token,
        claim:this.snapshot(input.projectId,input.taskId,context.workspaceSessionId)};
    }
    const row=this.authorized(previous,input);
    if(input.action==='renew'){
      const leaseUntil=new Date(Date.now()+LEASE_MS).toISOString();
      this.db.prepare("UPDATE lab_work_claims SET lease_until=?,heartbeat_at=?,updated_at=? WHERE task_id=?")
        .run(leaseUntil,now,now,input.taskId);
      this.store.event(input.taskId,'forge.work_claim.heartbeat',
        {projectId:input.projectId,generation:row.generation,leaseUntil});
      return {status:'renewed',claim:this.snapshot(input.projectId,input.taskId,context.workspaceSessionId)};
    }
    if(input.action==='release'){
      if(this.blockers(input.projectId,input.taskId))
        throw Error('forge_work_claim_effects_unreconciled');
      this.db.prepare("UPDATE lab_work_claims SET status='released',heartbeat_at=?,updated_at=? WHERE task_id=?")
        .run(now,now,input.taskId);
      this.store.event(input.taskId,'forge.work_claim.released',
        {projectId:input.projectId,generation:row.generation});
      return {status:'released',claim:this.snapshot(input.projectId,input.taskId,context.workspaceSessionId)};
    }
    throw Error('forge_work_claim_action_invalid');
  }
  progress(context,input){
    const row=this.authorized(this.row(input.projectId,input.taskId,context.workspaceSessionId),input);
    if(Date.parse(row.lease_until)<=Date.now())throw Error('forge_work_claim_renew_required');
    const summary=input.summary.trim(),now=this.store.now();
    this.db.prepare('UPDATE lab_work_claims SET last_progress=?,heartbeat_at=?,updated_at=? WHERE task_id=?')
      .run(summary,now,now,input.taskId);
    this.store.event(input.taskId,'forge.work_progress.recorded',
      {projectId:input.projectId,generation:row.generation,kind:input.kind,
        summary,externalEffectVerified:false});
    return {status:'recorded',kind:input.kind,
      claim:this.snapshot(input.projectId,input.taskId,context.workspaceSessionId),
      externalEffectVerified:false,providerMessagesSent:0};
  }
  memory(context,input){
    const row=this.authorized(this.row(input.projectId,input.taskId,context.workspaceSessionId),input);
    if(Date.parse(row.lease_until)<=Date.now())throw Error('forge_work_claim_renew_required');
    const item=this.store.upsertProjectMemory(input.taskId,{
      category:input.category,key:input.key,content:input.content,
      source_type:'import',source_ref:'forge-mcp-claim:'+row.generation
    });
    return {status:'recorded',memoryId:item.id,taskId:input.taskId,
      source:'gpt_tool_submission',acceptedAsExternalProof:false,
      externalEffectVerified:false,providerMessagesSent:0};
  }
}