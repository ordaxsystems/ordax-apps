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
    if(!enabled)this.nextProposal.configure(projectId,orchestratorId,false);
    return this.status(projectId,orchestratorId);
  }
  configureProposals(projectId,orchestratorId,enabled) {
    if(enabled&&this.db.prepare('SELECT enabled FROM lab_continuation_policies WHERE project_id=? AND orchestrator_id=?')
      .get(projectId,orchestratorId)?.enabled!==1)throw Error('continuation_analysis_required');
    return this.nextProposal.configure(projectId,orchestratorId,enabled);
  }
  status(projectId,orchestratorId) {
    const policy=this.db.prepare('SELECT enabled FROM lab_continuation_policies WHERE project_id=? AND orchestrator_id=?')
      .get(projectId,orchestratorId);
    const rows=this.db.prepare(`SELECT state,COUNT(*) AS count FROM lab_continuation_reviews
      WHERE project_id=? AND orchestrator_id=? GROUP BY state`).all(projectId,orchestratorId);
    const counts=Object.fromEntries(rows.map(row=>[row.state,row.count]));
    const latest=this.db.prepare(`SELECT run_id,state,reason,updated_at FROM lab_continuation_reviews
      WHERE project_id=? AND orchestrator_id=? ORDER BY updated_at DESC,run_id DESC LIMIT 1`)
      .get(projectId,orchestratorId)||null;
    const enabled=policy?.enabled===1;
    return {enabled,mode:'automatic_analysis_and_optional_proposals',automaticGPTSends:false,
      nextProposals:this.nextProposal.status(projectId,orchestratorId),
      state:!enabled?'disabled':this.service.coordinator?.available?.()!==true
        ?'blocked_coordinator':counts.reconciliation_required?'reconciliation_required':
          counts.queued||counts.analyzing?'pending':'observing',
      counts,latest};
  }
  scan() {
    // Exactly one review per confirmed Run; a failed or provisional answer is never eligible.
    const now=this.store.now();
    const result=this.db.prepare(`INSERT OR IGNORE INTO lab_continuation_reviews
      (run_id,project_id,orchestrator_id,task_id,state,updated_at)
      SELECT r.id,b.project_id,b.orchestrator_id,r.task_id,'queued',?
      FROM runs r JOIN lab_task_bindings b ON b.task_id=r.task_id AND b.kind='work'
      JOIN lab_continuation_policies p ON p.orchestrator_id=b.orchestrator_id AND p.project_id=b.project_id
      JOIN lab_orchestrators o ON o.id=b.orchestrator_id
      WHERE p.enabled=1 AND o.status='ready' AND r.status='succeeded'
      AND r.rowid>p.start_run_rowid
      ORDER BY r.completed_at,r.id LIMIT 100`).run(now);
    return result.changes;
  }
  async tick(context=this.context) {
    if(!context)throw Error('continuation_context_required');
    if(this.inFlight)return {state:'busy'};
    this.inFlight=true;
    try {
      this.scan();
      const row=this.db.prepare(`SELECT q.*,
        EXISTS(SELECT 1 FROM lab_command_receipts c
          WHERE c.status='uncertain' AND json_extract(c.result,'$.taskId')=q.task_id) AS transport_uncertain
        FROM lab_continuation_reviews q
        JOIN lab_continuation_policies p ON p.orchestrator_id=q.orchestrator_id
        JOIN lab_orchestrators o ON o.id=q.orchestrator_id
        WHERE q.state='queued' AND p.enabled=1 AND o.status='ready'
        ORDER BY transport_uncertain ASC,q.updated_at,q.run_id LIMIT 1`).get();
      if(!row)return await this.nextProposal.tick(context);
      if(this.service.coordinator?.available?.()!==true)return {state:'blocked_coordinator'};
      if(row.transport_uncertain)return {state:'reconciliation_required'};
      if(this.service.provider?.busy?.()||this.db.prepare("SELECT 1 FROM runs WHERE status='running' LIMIT 1").get()||
        this.db.prepare("SELECT 1 FROM lab_command_receipts WHERE status='running' LIMIT 1").get())
        return {state:'executor_busy'};
      const claimed=this.db.prepare("UPDATE lab_continuation_reviews SET state='analyzing',updated_at=? WHERE run_id=? AND state='queued'")
        .run(this.store.now(),row.run_id).changes;
      if(claimed!==1)return {state:'race'};
      try {
        const requestId='review_'+row.run_id.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,110);
        const receipt=await this.service.invoke(context,'orchestrator_analyze',{
          projectId:row.project_id,orchestratorId:row.orchestrator_id,requestId
        });
        const confirmed=receipt?.status==='succeeded'&&receipt?.result?.responseObserved===true;
        this.db.prepare("UPDATE lab_continuation_reviews SET state=?,command_id=?,reason=?,updated_at=? WHERE run_id=?")
          .run(confirmed?'analyzed':'reconciliation_required',receipt?.commandId||null,
            confirmed?null:'analysis_unconfirmed',this.store.now(),row.run_id);
        this.notify();
        return {state:confirmed?'analyzed':'reconciliation_required',runId:row.run_id};
      }catch {
        // A coordinator request might have been accepted before the error.
        this.db.prepare("UPDATE lab_continuation_reviews SET state='reconciliation_required',reason='analysis_unconfirmed',updated_at=? WHERE run_id=?")
          .run(this.store.now(),row.run_id);
        this.notify();
        return {state:'reconciliation_required',runId:row.run_id};
      }
    } finally {this.inFlight=false;}
  }
}
