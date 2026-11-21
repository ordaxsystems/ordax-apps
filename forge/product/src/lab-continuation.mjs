import {LabNextProposal} from './lab-next-proposal.mjs';

const DEFAULT_PERIODIC_REVIEW_MINUTES=60;

// Read-only compatibility projection for historical continuation records.
// It never schedules analysis, proposals, GPT work or periodic review.
export class LabContinuation {
  constructor({store,service}) {
    if(!store?.db||!service)throw Error('continuation_ports_required');
    this.store=store;this.db=store.db;this.service=service;
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
    const historicalEnabled=policy?.enabled===1;
    const enabled=false;
    const interval=policy?.review_interval_minutes??DEFAULT_PERIODIC_REVIEW_MINUTES;
    const lastMs=Date.parse(policy?.last_periodic_review_at||'');
    const nextDueAt=enabled&&Number.isFinite(lastMs)
      ?new Date(lastMs+interval*60_000).toISOString():null;
    const periodicReview={intervalMinutes:interval,lastCheckedAt:policy?.last_periodic_review_at||null,
      nextDueAt,state:!enabled?'disabled':!nextDueAt||Date.parse(nextDueAt)<=Date.now()?'due':'scheduled',
      stateFingerprintRecorded:typeof policy?.last_periodic_state_hash==='string'&&
        /^[a-f0-9]{64}$/.test(policy.last_periodic_state_hash)};
    return {enabled:false,historicalEnabled,legacyRecordOnly:true,mode:'legacy_record_only',automaticGPTSends:false,
      nextProposals:this.nextProposal.status(projectId,orchestratorId),periodicReview,
      state:!enabled?'disabled':counts.reconciliation_required?'reconciliation_required':
        counts.queued||counts.analyzing?'pending':'observing',
      counts,latest:latest?{...latest,reviewDecision,followupPrepared}:null};
  }
}
