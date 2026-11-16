import {createHash} from 'node:crypto';
import {LabNextProposal} from './lab-next-proposal.mjs';

const DEFAULT_PERIODIC_REVIEW_MINUTES=60;
const MIN_PERIODIC_REVIEW_MINUTES=5;
const MAX_PERIODIC_REVIEW_MINUTES=1440;

// Durable, opt-in continuation of completed work into coordinator analysis.
// No chat submission, provider retry, second queue service or implicit consent.
export class LabContinuation {
  constructor({store,service,context,notify=()=>{}}) {
    if(!store?.db||!service||typeof notify!=='function')
      throw Error('continuation_ports_required');
    this.store=store;this.db=store.db;this.service=service;
    this.context=context;this.notify=notify;this.inFlight=false;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lab_continuation_policies (
        orchestrator_id TEXT PRIMARY KEY REFERENCES lab_orchestrators(id),
        project_id TEXT NOT NULL REFERENCES lab_projects(id),
        enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
        enabled_at TEXT NOT NULL,
        start_run_rowid INTEGER NOT NULL,
        review_interval_minutes INTEGER NOT NULL DEFAULT 60 CHECK(review_interval_minutes BETWEEN 5 AND 1440),
        last_periodic_review_at TEXT,
        last_periodic_state_hash TEXT
      );
      CREATE TABLE IF NOT EXISTS lab_continuation_reviews (
        run_id TEXT PRIMARY KEY REFERENCES runs(id),
        project_id TEXT NOT NULL,orchestrator_id TEXT NOT NULL,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        state TEXT NOT NULL CHECK(state IN ('queued','analyzing','analyzed','reconciliation_required')),
        command_id TEXT,reason TEXT,updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lab_continuation_queue ON lab_continuation_reviews(state,updated_at);
    `);
    const policyColumns=this.db.prepare('PRAGMA table_info(lab_continuation_policies)').all();
    if(!policyColumns.some(column=>column.name==='review_interval_minutes'))
      this.db.exec('ALTER TABLE lab_continuation_policies ADD COLUMN review_interval_minutes INTEGER NOT NULL DEFAULT 60 CHECK(review_interval_minutes BETWEEN 5 AND 1440)');
    if(!policyColumns.some(column=>column.name==='last_periodic_review_at'))
      this.db.exec('ALTER TABLE lab_continuation_policies ADD COLUMN last_periodic_review_at TEXT');
    if(!policyColumns.some(column=>column.name==='last_periodic_state_hash'))
      this.db.exec('ALTER TABLE lab_continuation_policies ADD COLUMN last_periodic_state_hash TEXT');
    this.nextProposal=new LabNextProposal({store,service});
    // Crash after reserving API review has an unknown outcome: NEVER replay.
    this.db.prepare("UPDATE lab_continuation_reviews SET state='reconciliation_required',reason='interrupted_review',updated_at=? WHERE state='analyzing'")
      .run(this.store.now());
  }
  projectStateFingerprint(projectId,orchestratorId) {
    const project=this.db.prepare(`SELECT name,objective,repository_url
      FROM lab_projects WHERE id=?`).get(projectId)||null;
    const works=this.db.prepare(`SELECT t.id,t.title,t.status,t.updated_at,t.draft_revision,
      (SELECT COUNT(*) FROM messages m WHERE m.task_id=t.id) message_count,
      (SELECT r.id FROM runs r WHERE r.task_id=t.id ORDER BY r.rowid DESC LIMIT 1) latest_run_id,
      (SELECT r.status FROM runs r WHERE r.task_id=t.id ORDER BY r.rowid DESC LIMIT 1) latest_run_status,
      (SELECT r.heartbeat_at FROM runs r WHERE r.task_id=t.id ORDER BY r.rowid DESC LIMIT 1) latest_heartbeat_at
      FROM tasks t JOIN lab_task_bindings b ON b.task_id=t.id
      WHERE b.project_id=? AND b.orchestrator_id=? AND b.kind='work'
      ORDER BY t.id LIMIT 256`).all(projectId,orchestratorId);
    const receipts=this.db.prepare(`SELECT id,operation,status,updated_at,
      CASE WHEN operation='project_file_write' AND json_valid(result)
        THEN json_extract(result,'$.path') END artifact_path,
      CASE WHEN operation='project_file_write' AND json_valid(result)
        THEN json_extract(result,'$.sha256') END artifact_sha256,
      CASE WHEN operation='project_command_run' AND json_valid(result)
        THEN json_extract(result,'$.exitCode') END command_exit_code
      FROM lab_command_receipts WHERE project_id=?
        AND operation IN ('project_file_write','project_command_run','work_send',
          'proposal_send','forjador_send','work_parallel_launch','repository_observe')
      ORDER BY rowid DESC LIMIT 64`).all(projectId);
    const repository=this.db.prepare(`SELECT repository_id,default_branch,head_sha,observed_at
      FROM lab_repository_head_evidence WHERE project_id=? ORDER BY recorded_at DESC LIMIT 1`)
      .get(projectId)||null;
    let files={available:false,entries:[],truncated:false};
    if(this.service.files)try{
      const queue=[''],entries=[];let truncated=false;
      while(queue.length&&entries.length<64){
        const directory=queue.shift();
        const page=this.service.files.list(projectId,directory);
        for(const entry of page.entries||[]){
          if(entries.length>=64){truncated=true;break;}
          const relative=directory?directory+'/'+entry.name:entry.name;
          if(entry.kind==='directory'){queue.push(relative);entries.push({path:relative,kind:'directory'});}
          else if(entry.kind==='file'){
            const proof=this.service.files.read(projectId,relative);
            entries.push({path:relative,kind:'file',bytes:proof.bytes,sha256:proof.sha256});
          } else entries.push({path:relative,kind:entry.kind});
        }
        truncated=truncated||page.truncated===true;
      }
      if(queue.length)truncated=true;
      files={available:true,entries,truncated};
    }catch(error){files={available:false,entries:[],truncated:false,
      reason:String(error?.message||'workspace_unavailable').slice(0,80)};}
    const payload={project,works,receipts,repository,files};
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
  configure(projectId,orchestratorId,enabled,{reviewIntervalMinutes=null}={}) {
    if(typeof enabled!=='boolean')throw Error('continuation_invalid_setting');
    if(reviewIntervalMinutes!==null&&(!Number.isSafeInteger(reviewIntervalMinutes)||
      reviewIntervalMinutes<MIN_PERIODIC_REVIEW_MINUTES||
      reviewIntervalMinutes>MAX_PERIODIC_REVIEW_MINUTES))
      throw Error('continuation_review_interval_invalid');
    const now=this.store.now();
    const current=this.db.prepare(`SELECT enabled,review_interval_minutes
      FROM lab_continuation_policies WHERE project_id=? AND orchestrator_id=?`)
      .get(projectId,orchestratorId);
    const interval=reviewIntervalMinutes??current?.review_interval_minutes??DEFAULT_PERIODIC_REVIEW_MINUTES;
    const baseline=this.db.prepare('SELECT COALESCE(MAX(rowid),0) AS id FROM runs').get().id;
    this.db.prepare(`INSERT INTO lab_continuation_policies
      (project_id,orchestrator_id,enabled,enabled_at,start_run_rowid,review_interval_minutes)
      VALUES(?,?,?,?,?,?) ON CONFLICT(orchestrator_id) DO UPDATE SET
      enabled=excluded.enabled,review_interval_minutes=excluded.review_interval_minutes,
      enabled_at=CASE WHEN excluded.enabled=1 AND lab_continuation_policies.enabled=0
        THEN excluded.enabled_at ELSE lab_continuation_policies.enabled_at END,
      start_run_rowid=CASE WHEN excluded.enabled=1 AND lab_continuation_policies.enabled=0
        THEN excluded.start_run_rowid ELSE lab_continuation_policies.start_run_rowid END`)
      .run(projectId,orchestratorId,enabled?1:0,now,baseline,interval);
    if(enabled&&current?.enabled!==1){
      const fingerprint=this.projectStateFingerprint(projectId,orchestratorId);
      this.db.prepare(`UPDATE lab_continuation_policies
        SET last_periodic_review_at=?,last_periodic_state_hash=?
        WHERE project_id=? AND orchestrator_id=?`)
        .run(now,fingerprint,projectId,orchestratorId);
    }
    if(!enabled) {
      // Persist the stop decision before any in-flight analysis completes.
      // Its external outcome is not retried or promoted to a confirmed review.
      this.quarantineInFlight(projectId,orchestratorId,'policy_disabled');
      this.nextProposal.configure(projectId,orchestratorId,false);
    }
    return this.status(projectId,orchestratorId);
  }
  configureProposals(projectId,orchestratorId,enabled) {
    if(enabled&&this.db.prepare('SELECT enabled FROM lab_continuation_policies WHERE project_id=? AND orchestrator_id=?')
      .get(projectId,orchestratorId)?.enabled!==1)throw Error('continuation_analysis_required');
    return this.nextProposal.configure(projectId,orchestratorId,enabled);
  }
  quarantineInFlight(projectId,orchestratorId,reason) {
    if(!['policy_disabled','orchestrator_paused'].includes(reason))
      throw Error('continuation_invalid_interruption');
    this.db.prepare(`UPDATE lab_continuation_reviews
      SET state='reconciliation_required',reason=?,updated_at=?
      WHERE project_id=? AND orchestrator_id=? AND state='analyzing'`)
      .run(reason,this.store.now(),projectId,orchestratorId);
    this.nextProposal.quarantineInFlight(projectId,orchestratorId,reason);
  }
  status(projectId,orchestratorId) {
    const policy=this.db.prepare(`SELECT enabled,start_run_rowid,review_interval_minutes,
      last_periodic_review_at,last_periodic_state_hash FROM lab_continuation_policies
      WHERE project_id=? AND orchestrator_id=?`).get(projectId,orchestratorId);
    // Status is scoped to the current opt-in activation. Historical queued,
    // analyzed or quarantined reviews remain durable, never active again.
    const baseline=policy?.start_run_rowid??Number.MAX_SAFE_INTEGER;
    const rows=this.db.prepare(`SELECT q.state,COUNT(*) AS count
      FROM lab_continuation_reviews q JOIN runs r ON r.id=q.run_id
      WHERE q.project_id=? AND q.orchestrator_id=? AND r.rowid>?
      GROUP BY q.state`).all(projectId,orchestratorId,baseline);
    const counts=Object.fromEntries(rows.map(row=>[row.state,row.count]));
    const latest=this.db.prepare(`SELECT q.run_id,q.state,q.reason,q.command_id,q.updated_at
      FROM lab_continuation_reviews q JOIN runs r ON r.id=q.run_id
      WHERE q.project_id=? AND q.orchestrator_id=? AND r.rowid>?
      ORDER BY q.updated_at DESC,q.run_id DESC LIMIT 1`)
      .get(projectId,orchestratorId,baseline)||null;
    let reviewDecision=null;
    if(latest?.state==='analyzed'&&latest.command_id) {
      const receipt=this.db.prepare('SELECT status,result FROM lab_command_receipts WHERE id=?')
        .get(latest.command_id);
      if(receipt?.status==='succeeded') {
        try{reviewDecision=JSON.parse(receipt.result||'{}').reviewDecision||null;}catch{}
      }
    }
    const followupPrepared=Boolean(latest&&this.db.prepare(`SELECT 1 FROM events
      WHERE kind='orchestrator.followup.prepared'
        AND json_extract(payload,'$.source_run_id')=? LIMIT 1`).get(latest.run_id));
    const enabled=policy?.enabled===1;
    const interval=policy?.review_interval_minutes??DEFAULT_PERIODIC_REVIEW_MINUTES;
    const lastMs=Date.parse(policy?.last_periodic_review_at||'');
    const nextDueAt=enabled&&Number.isFinite(lastMs)
      ?new Date(lastMs+interval*60_000).toISOString():null;
    const periodicReview={intervalMinutes:interval,lastCheckedAt:policy?.last_periodic_review_at||null,
      nextDueAt,state:!enabled?'disabled':!nextDueAt||Date.parse(nextDueAt)<=Date.now()?'due':'scheduled',
      stateFingerprintRecorded:typeof policy?.last_periodic_state_hash==='string'&&
        /^[a-f0-9]{64}$/.test(policy.last_periodic_state_hash)};
    return {enabled,mode:'automatic_analysis_and_optional_proposals',automaticGPTSends:false,
      nextProposals:this.nextProposal.status(projectId,orchestratorId),periodicReview,
      state:!enabled?'disabled':counts.reconciliation_required?'reconciliation_required':
        counts.queued||counts.analyzing?'pending':'observing',
      counts,latest:latest?{...latest,reviewDecision,followupPrepared}:null};
  }
  scan() {
    // Only the active workspace may enqueue work, even if an old workspace
    // still has enabled policies or previously confirmed Runs in this SQLite.
    const session=this.store.getWorkspaceSession();
    if(session?.status!=='active')return 0;
    // Exactly one review per confirmed Run; a failed or provisional answer is never eligible.
    const now=this.store.now();
    const result=this.db.prepare(`INSERT OR IGNORE INTO lab_continuation_reviews
      (run_id,project_id,orchestrator_id,task_id,state,updated_at)
      SELECT r.id,b.project_id,b.orchestrator_id,r.task_id,'queued',?
      FROM runs r JOIN tasks t ON t.id=r.task_id
      JOIN lab_task_bindings b ON b.task_id=r.task_id AND b.kind='work'
      JOIN lab_projects project ON project.id=b.project_id
      JOIN lab_continuation_policies p ON p.orchestrator_id=b.orchestrator_id AND p.project_id=b.project_id
      JOIN lab_orchestrators o ON o.id=b.orchestrator_id AND o.project_id=b.project_id
      WHERE p.enabled=1 AND o.status='ready' AND r.status='succeeded'
      AND project.workspace_session_id=? AND t.workspace_session_id=?
      AND r.rowid>p.start_run_rowid
      -- Deduplicate BEFORE LIMIT. INSERT OR IGNORE alone would repeatedly
      -- pick the oldest 100 reviewed Runs and permanently starve newer work.
      AND NOT EXISTS (SELECT 1 FROM lab_continuation_reviews reviewed
        WHERE reviewed.run_id=r.id)
      -- A technical autonomous mission owns its own receipt-backed local
      -- reviews. Replaying the same Run into the generic continuation queue
      -- would duplicate model analysis and could propose a conflicting task.
      AND NOT EXISTS (SELECT 1 FROM lab_autonomous_dialogues mission
        WHERE mission.strategy='semantic'
          AND (mission.task_a_id=r.task_id OR mission.task_b_id=r.task_id))
      ORDER BY r.completed_at,r.id LIMIT 100`).run(now,session.id,session.id);
    return result.changes;
  }
  async tickPeriodic(context) {
    const session=this.store.getWorkspaceSession();
    if(session?.status!=='active'||context?.workspaceSessionId!==session.id)
      return {state:'blocked_workspace'};
    const policies=this.db.prepare(`SELECT p.project_id,p.orchestrator_id,
      p.review_interval_minutes,p.last_periodic_review_at,p.last_periodic_state_hash
      FROM lab_continuation_policies p
      JOIN lab_orchestrators o ON o.id=p.orchestrator_id AND o.project_id=p.project_id
      JOIN lab_projects project ON project.id=p.project_id AND project.workspace_session_id=?
      WHERE p.enabled=1 AND o.status='ready'
      ORDER BY COALESCE(p.last_periodic_review_at,'') ASC,p.orchestrator_id LIMIT 64`)
      .all(session.id);
    const nowMs=Date.now();
    const policy=policies.find(row=>{
      const last=Date.parse(row.last_periodic_review_at||'');
      return !Number.isFinite(last)||last+row.review_interval_minutes*60_000<=nowMs;
    });
    if(!policy)return {state:'idle'};
    const fingerprint=this.projectStateFingerprint(policy.project_id,policy.orchestrator_id);
    const now=this.store.now();
    if(fingerprint===policy.last_periodic_state_hash){
      this.db.prepare(`UPDATE lab_continuation_policies SET last_periodic_review_at=?
        WHERE project_id=? AND orchestrator_id=? AND enabled=1`)
        .run(now,policy.project_id,policy.orchestrator_id);
      return {state:'periodic_unchanged',projectId:policy.project_id,
        orchestratorId:policy.orchestrator_id};
    }
    const requestId='periodic_'+createHash('sha256')
      .update(policy.project_id+'\0'+policy.orchestrator_id+'\0'+fingerprint)
      .digest('hex').slice(0,48);
    let receipt=null;
    try{
      receipt=await this.service.invoke(context,'orchestrator_analyze',{
        projectId:policy.project_id,orchestratorId:policy.orchestrator_id,requestId});
    }catch{}
    // The fingerprint is consumed even when local analysis fails: retrying the
    // same state blindly would violate Forge's no-uncertain-replay rule.
    this.db.prepare(`UPDATE lab_continuation_policies
      SET last_periodic_review_at=?,last_periodic_state_hash=?
      WHERE project_id=? AND orchestrator_id=? AND enabled=1`)
      .run(now,fingerprint,policy.project_id,policy.orchestrator_id);
    this.notify();
    const confirmed=receipt?.status==='succeeded'&&receipt?.result?.analysisObserved===true;
    return {state:confirmed?'periodic_analyzed':'reconciliation_required',
      projectId:policy.project_id,orchestratorId:policy.orchestrator_id,
      commandId:receipt?.commandId||null};
  }
  async tick(context=this.context) {
    if(!context)throw Error('continuation_context_required');
    const session=this.store.getWorkspaceSession();
    if(session?.status!=='active'||context.workspaceSessionId!==session.id)
      return {state:'blocked_workspace'};
    if(this.inFlight)return {state:'busy'};
    this.inFlight=true;
    try {
      this.scan();
      const choice=this.service.selectContinuationCandidate(this.db.prepare(`SELECT q.*,
        EXISTS(SELECT 1 FROM lab_command_receipt_scope c
          WHERE c.status='uncertain' AND c.operation IN ('work_send','proposal_send')
            AND (c.task_id=q.task_id OR
              (c.project_id=q.project_id AND c.unknown_work_target=1))) AS transport_uncertain
        FROM lab_continuation_reviews q
        JOIN runs r ON r.id=q.run_id
        JOIN lab_continuation_policies p ON p.orchestrator_id=q.orchestrator_id AND p.project_id=q.project_id
        JOIN lab_orchestrators o ON o.id=q.orchestrator_id AND o.project_id=q.project_id
        JOIN lab_projects project ON project.id=q.project_id AND project.workspace_session_id=?
        JOIN tasks t ON t.id=q.task_id AND t.workspace_session_id=?
        WHERE q.state='queued' AND p.enabled=1 AND o.status='ready'
          AND r.rowid>p.start_run_rowid
        ORDER BY transport_uncertain ASC,q.updated_at,q.run_id`).iterate(session.id,session.id));
      if(!choice.row) {
        // A queued analysis with no available coordinator must not suppress an
        // independent project's already analyzed, reviewable next proposal.
        // A blocked analysis stays queued; proposal policy/receipt gates apply.
        const next=await this.nextProposal.tick(context);
        if(next.state!=='idle')return next;
        // Periodic review reuses this same continuation tick/Store. It is a
        // local state review, never another scheduler, provider send or retry.
        const periodic=await this.tickPeriodic(context);
        return periodic.state==='idle'?{state:choice.state}:periodic;
      }
      const row=choice.row;
      if(row.transport_uncertain)return {state:'reconciliation_required'};
      const claimed=this.db.prepare("UPDATE lab_continuation_reviews SET state='analyzing',updated_at=? WHERE run_id=? AND state='queued'")
        .run(this.store.now(),row.run_id).changes;
      if(claimed!==1)return {state:'race'};
      try {
        const requestId='review_'+row.run_id.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,110);
        // Only a real, latest, completed GPT response with immutable submission
        // provenance receives the focused semantic review. Synthetic/historical
        // unproven Runs retain the existing generic advisory path.
        const source=this.service.reviewableGPTResult(row.project_id,row.orchestrator_id,row.run_id);
        const receipt=await this.service.invoke(context,'orchestrator_analyze',{
          projectId:row.project_id,orchestratorId:row.orchestrator_id,requestId,
          ...(source?{reviewRunId:row.run_id}:{})
        });
        // The coordinator call is asynchronous: a workspace switch while it
        // is in flight must not certify an old session's queued review.
        const current=this.store.getWorkspaceSession();
        const sameWorkspace=current?.status==='active'&&current.id===session.id;
        const confirmed=sameWorkspace&&receipt?.status==='succeeded'&&receipt?.result?.analysisObserved===true&&
          (!source||(receipt.result.reviewDecision?.sourceRunId===row.run_id&&
            receipt.result.reviewDecision?.automaticGPTSendAuthorized===false));
        const finalized=this.db.prepare(`UPDATE lab_continuation_reviews
          SET state=?,command_id=?,reason=?,updated_at=?
          WHERE run_id=? AND state='analyzing'`)
          .run(confirmed?'analyzed':'reconciliation_required',receipt?.commandId||null,
            confirmed?null:sameWorkspace?'analysis_unconfirmed':'workspace_changed',this.store.now(),row.run_id).changes;
        // A policy disable/pause may have quarantined the row during await.
        // Never overwrite that authoritative stop, even after rapid re-enable.
        this.notify();
        return {state:confirmed&&finalized===1?'analyzed':'reconciliation_required',runId:row.run_id};
      }catch {
        // A coordinator request might have been accepted before the error.
        this.db.prepare(`UPDATE lab_continuation_reviews
          SET state='reconciliation_required',reason='analysis_unconfirmed',updated_at=?
          WHERE run_id=? AND state='analyzing'`)
          .run(this.store.now(),row.run_id);
        this.notify();
        return {state:'reconciliation_required',runId:row.run_id};
      }
    } finally {this.inFlight=false;}
  }
}
