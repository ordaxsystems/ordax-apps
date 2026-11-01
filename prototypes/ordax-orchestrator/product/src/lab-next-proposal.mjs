// Bounded opt-in second step: one advisory proposal after a confirmed
// post-run analysis. Uses the canonical Lab proposal/approval ledger.
// It deliberately never creates a Task or sends to the GPT provider.
export class LabNextProposal {
  constructor({store,service}) {
    if(!store?.db||!service)throw Error('continuation_ports_required');
    this.store=store;this.db=store.db;this.service=service;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lab_next_proposal_policy (
        orchestrator_id TEXT PRIMARY KEY REFERENCES lab_orchestrators(id),
        project_id TEXT NOT NULL REFERENCES lab_projects(id),
        enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
        start_review_rowid INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS lab_next_proposals (
        review_run_id TEXT PRIMARY KEY REFERENCES lab_continuation_reviews(run_id),
        project_id TEXT NOT NULL,orchestrator_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('planning','proposed','reconciliation_required')),
        command_id TEXT,reason TEXT,updated_at TEXT NOT NULL
      );
    `);
    // A model response might have arrived just before a crash. Never retry it.
    this.db.prepare("UPDATE lab_next_proposals SET status='reconciliation_required',reason='interrupted_plan',updated_at=? WHERE status='planning'")
      .run(store.now());
  }
  configure(projectId,orchestratorId,enabled) {
    if(typeof enabled!=='boolean')throw Error('continuation_invalid_setting');
    const baseline=this.db.prepare('SELECT COALESCE(MAX(rowid),0) AS n FROM lab_continuation_reviews').get().n;
    this.db.prepare(`INSERT INTO lab_next_proposal_policy
      (orchestrator_id,project_id,enabled,start_review_rowid) VALUES(?,?,?,?)
      ON CONFLICT(orchestrator_id) DO UPDATE SET enabled=excluded.enabled,
      start_review_rowid=CASE WHEN excluded.enabled=1 AND lab_next_proposal_policy.enabled=0
        THEN excluded.start_review_rowid ELSE lab_next_proposal_policy.start_review_rowid END`)
      .run(orchestratorId,projectId,enabled?1:0,baseline);
    return this.status(projectId,orchestratorId);
  }
  status(projectId,orchestratorId) {
    const policy=this.db.prepare('SELECT enabled,start_review_rowid FROM lab_next_proposal_policy WHERE project_id=? AND orchestrator_id=?')
      .get(projectId,orchestratorId);
    const proposed=Number(this.db.prepare(`SELECT COUNT(*) n FROM lab_next_proposals p
      JOIN lab_continuation_reviews r ON r.run_id=p.review_run_id
      WHERE p.project_id=? AND p.orchestrator_id=? AND r.rowid>?`)
      .get(projectId,orchestratorId,policy?.start_review_rowid??Number.MAX_SAFE_INTEGER).n);
    return {enabled:policy?.enabled===1,proposed,maximum:2,
      remaining:Math.max(0,2-proposed),automaticGPTSends:false};
  }
  async tick(context) {
    const session=this.store.getWorkspaceSession();
    if(session?.status!=='active'||context?.workspaceSessionId!==session.id)
      return {state:'blocked_workspace'};
    const row=this.db.prepare(`SELECT r.run_id,r.project_id,r.orchestrator_id,r.task_id
      FROM lab_continuation_reviews r
      JOIN lab_next_proposal_policy p ON p.project_id=r.project_id AND p.orchestrator_id=r.orchestrator_id
      JOIN lab_continuation_policies base ON base.project_id=r.project_id AND base.orchestrator_id=r.orchestrator_id
      JOIN lab_orchestrators o ON o.id=r.orchestrator_id AND o.project_id=r.project_id
      JOIN lab_projects project ON project.id=r.project_id AND project.workspace_session_id=?
      JOIN tasks t ON t.id=r.task_id AND t.workspace_session_id=?
      WHERE r.state='analyzed' AND p.enabled=1 AND base.enabled=1 AND o.status='ready'
      AND r.rowid>p.start_review_rowid
      AND NOT EXISTS (SELECT 1 FROM lab_next_proposals n WHERE n.review_run_id=r.run_id)
      AND (SELECT COUNT(*) FROM lab_next_proposals n JOIN lab_continuation_reviews q
          ON q.run_id=n.review_run_id WHERE n.orchestrator_id=r.orchestrator_id
          AND q.rowid>p.start_review_rowid)<2
      ORDER BY r.updated_at,r.run_id LIMIT 1`).get(session.id,session.id);
    if(!row)return {state:'idle'};
    if(this.service.coordinator?.available?.(row.project_id,row.orchestrator_id)!==true)return {state:'blocked_coordinator'};
    if(this.db.prepare("SELECT 1 FROM runs WHERE status='running' LIMIT 1").get() ||
       this.db.prepare("SELECT 1 FROM lab_command_receipts WHERE status='running' LIMIT 1").get() ||
       this.service.provider?.busy?.())return {state:'executor_busy'};
    if(this.db.prepare(`SELECT 1 FROM action_ledger a JOIN lab_orchestrators o ON o.chat_task_id=a.task_id
      WHERE o.id=? AND a.action_type='orchestrator.work-proposal' AND a.status='pending' LIMIT 1`)
      .get(row.orchestrator_id))return {state:'waiting_proposal_review'};
    if(this.db.prepare(`SELECT 1 FROM lab_command_receipts
      WHERE status='uncertain' AND json_extract(result,'$.taskId')=? LIMIT 1`).get(row.task_id))
      return {state:'reconciliation_required'};
    const claimed=this.db.prepare(`INSERT OR IGNORE INTO lab_next_proposals
      (review_run_id,project_id,orchestrator_id,status,updated_at) VALUES(?,?,?,'planning',?)`)
      .run(row.run_id,row.project_id,row.orchestrator_id,this.store.now()).changes;
    if(claimed!==1)return {state:'race'};
    try {
      const receipt=await this.service.invoke(context,'orchestrator_prepare',{
        projectId:row.project_id,orchestratorId:row.orchestrator_id,
        requestId:'next_'+row.run_id.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,110),
        content:'Revise o progresso confirmado e proponha apenas UMA nova frente curta, verificável e necessária à missão. Não afirme que o trabalho já foi executado.'
      });
      // Model calls may finish after the active workspace changes. Keep
      // the uncertain receipt, but never certify the old session's proposal.
      const current=this.store.getWorkspaceSession();
      const sameWorkspace=current?.status==='active'&&current.id===session.id;
      const ok=sameWorkspace&&receipt?.status==='succeeded'&&typeof receipt?.result?.proposalActionId==='string';
      this.db.prepare('UPDATE lab_next_proposals SET status=?,command_id=?,reason=?,updated_at=? WHERE review_run_id=?')
        .run(ok?'proposed':'reconciliation_required',receipt?.commandId||null,
          ok?null:sameWorkspace?'proposal_unconfirmed':'workspace_changed',this.store.now(),row.run_id);
      return {state:ok?'proposed':'reconciliation_required',runId:row.run_id};
    }catch{
      this.db.prepare("UPDATE lab_next_proposals SET status='reconciliation_required',reason='proposal_unconfirmed',updated_at=? WHERE review_run_id=?")
        .run(this.store.now(),row.run_id);
      return {state:'reconciliation_required',runId:row.run_id};
    }
  }
}
