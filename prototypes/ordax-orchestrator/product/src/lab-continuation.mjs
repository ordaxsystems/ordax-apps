import {LabNextProposal} from './lab-next-proposal.mjs';

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
        start_run_rowid INTEGER NOT NULL
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
    this.nextProposal=new LabNextProposal({store,service});
    // Crash after reserving API review has an unknown outcome: NEVER replay.
    this.db.prepare("UPDATE lab_continuation_reviews SET state='reconciliation_required',reason='interrupted_review',updated_at=? WHERE state='analyzing'")
      .run(this.store.now());
  }
  configure(projectId,orchestratorId,enabled) {
    if(typeof enabled!=='boolean')throw Error('continuation_invalid_setting');
    const now=this.store.now();
    const baseline=this.db.prepare('SELECT COALESCE(MAX(rowid),0) AS id FROM runs').get().id;
    this.db.prepare(`INSERT INTO lab_continuation_policies (project_id,orchestrator_id,enabled,enabled_at,start_run_rowid)
      VALUES(?,?,?,?,?) ON CONFLICT(orchestrator_id) DO UPDATE SET
      enabled=excluded.enabled,enabled_at=CASE WHEN excluded.enabled=1 AND lab_continuation_policies.enabled=0
        THEN excluded.enabled_at ELSE lab_continuation_policies.enabled_at END,
      start_run_rowid=CASE WHEN excluded.enabled=1 AND lab_continuation_policies.enabled=0
        THEN excluded.start_run_rowid ELSE lab_continuation_policies.start_run_rowid END`)
      .run(projectId,orchestratorId,enabled?1:0,now,baseline);
    if(!enabled) {
      // Persist the stop decision before an in-flight Groq reply returns.
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
    const policy=this.db.prepare(`SELECT enabled,start_run_rowid FROM lab_continuation_policies
      WHERE project_id=? AND orchestrator_id=?`).get(projectId,orchestratorId);
    // Status is scoped to the current opt-in activation. Historical queued,
    // analyzed or quarantined reviews remain durable, never active again.
    const baseline=policy?.start_run_rowid??Number.MAX_SAFE_INTEGER;
    const rows=this.db.prepare(`SELECT q.state,COUNT(*) AS count
      FROM lab_continuation_reviews q JOIN runs r ON r.id=q.run_id
      WHERE q.project_id=? AND q.orchestrator_id=? AND r.rowid>?
      GROUP BY q.state`).all(projectId,orchestratorId,baseline);
    const counts=Object.fromEntries(rows.map(row=>[row.state,row.count]));
    const latest=this.db.prepare(`SELECT q.run_id,q.state,q.reason,q.updated_at
      FROM lab_continuation_reviews q JOIN runs r ON r.id=q.run_id
      WHERE q.project_id=? AND q.orchestrator_id=? AND r.rowid>?
      ORDER BY q.updated_at DESC,q.run_id DESC LIMIT 1`)
      .get(projectId,orchestratorId,baseline)||null;
    const enabled=policy?.enabled===1;
    return {enabled,mode:'automatic_analysis_and_optional_proposals',automaticGPTSends:false,
      nextProposals:this.nextProposal.status(projectId,orchestratorId),
      state:!enabled?'disabled':this.service.coordinator?.available?.(projectId,orchestratorId)!==true
        ?'blocked_coordinator':counts.reconciliation_required?'reconciliation_required':
          counts.queued||counts.analyzing?'pending':'observing',
      counts,latest};
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
      ORDER BY r.completed_at,r.id LIMIT 100`).run(now,session.id,session.id);
    return result.changes;
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
        return next.state==='idle'?{state:choice.state}:next;
      }
      const row=choice.row;
      if(row.transport_uncertain)return {state:'reconciliation_required'};
      const claimed=this.db.prepare("UPDATE lab_continuation_reviews SET state='analyzing',updated_at=? WHERE run_id=? AND state='queued'")
        .run(this.store.now(),row.run_id).changes;
      if(claimed!==1)return {state:'race'};
      try {
        const requestId='review_'+row.run_id.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,110);
        const receipt=await this.service.invoke(context,'orchestrator_analyze',{
          projectId:row.project_id,orchestratorId:row.orchestrator_id,requestId
        });
        // The coordinator call is asynchronous: a workspace switch while it
        // is in flight must not certify an old session's queued review.
        const current=this.store.getWorkspaceSession();
        const sameWorkspace=current?.status==='active'&&current.id===session.id;
        const confirmed=sameWorkspace&&receipt?.status==='succeeded'&&receipt?.result?.responseObserved===true;
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
