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
  quarantineInFlight(projectId,orchestratorId,reason) {
    if(!['policy_disabled','proposal_policy_disabled','orchestrator_paused'].includes(reason))
      throw Error('continuation_invalid_interruption');
    this.db.prepare(`UPDATE lab_next_proposals
      SET status='reconciliation_required',reason=?,updated_at=?
      WHERE project_id=? AND orchestrator_id=? AND status='planning'`)
      .run(reason,this.store.now(),projectId,orchestratorId);
  }
  status(projectId,orchestratorId) {
    const policy=this.db.prepare('SELECT enabled,start_review_rowid FROM lab_next_proposal_policy WHERE project_id=? AND orchestrator_id=?')
      .get(projectId,orchestratorId);
    const proposed=Number(this.db.prepare(`SELECT COUNT(*) n FROM lab_next_proposals p
      JOIN lab_continuation_reviews r ON r.run_id=p.review_run_id
      WHERE p.project_id=? AND p.orchestrator_id=? AND r.rowid>?`)
      .get(projectId,orchestratorId,policy?.start_review_rowid??Number.MAX_SAFE_INTEGER).n);
    return {enabled:false,historicalEnabled:policy?.enabled===1,legacyRecordOnly:true,
      proposed,maximum:2,remaining:Math.max(0,2-proposed),automaticGPTSends:false};
  }
}
