import {randomUUID,createHash} from 'node:crypto';
import {ORCHESTRATOR_CONTRACT,ORCHESTRATOR_TOOLS,validateOrchestratorInput,validateNativeCommandReviewInput} from './forge-contract.mjs';
import {assertTaskHasNoUncertainTransport,listTaskUncertainTransportRuns} from './provider-uncertain-run-policy.mjs';
import {redactOrchestratorAnalysisText} from './orchestrator-analysis-text.mjs';
import {validateWorkProposal} from './orchestrator-proposal.mjs';
import {findProviderSubmissionProvenance} from './provider-submission-provenance.mjs';
import {LabContinuation} from './lab-continuation.mjs';
import {AutonomousDialogue} from './autonomous-dialogue.mjs';
import {ProjectWorkspace} from './project-workspace.mjs';
import {forgeProjectContext,forgeMcpDiscovery} from './forge-executor-context.mjs';
import {forgeProjectMemoryView} from './forge-project-memory-view.mjs';
import {forgeProjectAdministratorView} from './forge-project-administrator-view.mjs';
import {forgeProjectHandoffView} from './forge-project-handoff-view.mjs';
import {forgeProjectActivityView} from './forge-project-activity-view.mjs';
import {forgeContinuationDecision} from './forge-continuation-decision.mjs';
import {forgeProjectMissionsView} from './forge-project-missions-view.mjs';
import {UNTITLED_FORGE_PROJECT,suggestForgeProjectTitle} from './project-auto-title.mjs';
import {deleteProjectRecords} from './project-deletion.mjs';
import {ProjectRepository} from './project-repository.mjs';
import {workExecutionSummary} from './work-execution-summary.mjs';
import {projectWorkPlan} from './work-plan-read-model.mjs';
import {forgeVerifiedWorkAcceptances} from './forge-work-acceptance-evidence.mjs';
import {forgeMcpWorkObservation} from './forge-mcp-observation.mjs';
import {ForgeWorkClaims} from './forge-work-claims.mjs';
import {normalizeGitHubRepositoryUrl} from './remote-repository-context.mjs';
import {readDedicatedForgeProject,enforceDedicatedForgeProject,dedicatedForgeMcpOperations} from './forge-dedicated-project.mjs';
import {runForgeOrdaxRepositoryProbe} from './forge-ordax-repository-service.mjs';

function missionProjectName(mission) {
  const firstLine=String(mission||'').trim().split(/\r?\n/u,1)[0].trim();
  const firstSentence=firstLine.split(/(?<=[.!?])\s+/u,1)[0].trim();
  return Array.from(firstSentence).slice(0,140).join('')||'Novo projeto';
}

// App-owned domain only. Reuses Store/Task/Run/messages; no second SQLite,
// provider worker, device executor, identity, grants or global Memory service.
export class OrchestratorService {
  constructor({store,authorize,workspacePort=null,fileBroker=null,development=null,repositoryPort=null,repositoryReadPort=null,verifyLocalArtifact=null}={}) {
    if(!store?.db || typeof authorize!=='function')throw Error('orchestrator_ports_required');
    this.store=store; this.db=store.db; this.authorize=authorize;
    // Optional native Forge MCP projection of the separately owned Forge Git checkpoint.
    this.forgeGitMemoryPort=null;
    this.repositoryCatalogPort=null;
    // Optional Forge-native, owner-approved per-repository reader. No default
    // binding, no path selected by MCP or derived from the ownership catalog.
    this.repositoryReadPort=repositoryReadPort;
    // Native renderer proof is an optional App-owned read-only port. It is
    // never used as project authorization or as evidence of publication.
    this.viewPort=null;
    // Optional App-owned, read-only local proof port. No filesystem authority
    // is inferred from a persisted model answer, asset path or remote URL.
    this.verifyLocalArtifact=typeof verifyLocalArtifact==='function'?verifyLocalArtifact:null;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lab_projects (
        id TEXT PRIMARY KEY, workspace_session_id TEXT NOT NULL REFERENCES workspace_sessions(id),
        name TEXT NOT NULL, objective TEXT NOT NULL, created_at TEXT NOT NULL,
        repository_url TEXT,
        observation_requested INTEGER NOT NULL DEFAULT 0 CHECK(observation_requested IN (0,1))
      );
      CREATE INDEX IF NOT EXISTS idx_lab_project_session ON lab_projects(workspace_session_id);
      -- One bounded historical HEAD per project, NOT a current grant or
      -- authoritative remote state. Auth decisions and bearer tokens never
      -- enter the local App Store.
      CREATE TABLE IF NOT EXISTS lab_repository_head_evidence (
        project_id TEXT PRIMARY KEY REFERENCES lab_projects(id) ON DELETE CASCADE,
        repository_url TEXT NOT NULL,
        repository_id INTEGER NOT NULL CHECK(repository_id>0),
        default_branch TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS lab_orchestrators (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES lab_projects(id),
        name TEXT NOT NULL, mission TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('ready','paused')),
        chat_task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id), created_at TEXT NOT NULL,
        UNIQUE(id,project_id)
      );
      CREATE TABLE IF NOT EXISTS lab_task_bindings (
        task_id TEXT PRIMARY KEY REFERENCES tasks(id),
        project_id TEXT NOT NULL REFERENCES lab_projects(id), orchestrator_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('work','orchestrator')),
        FOREIGN KEY(orchestrator_id,project_id) REFERENCES lab_orchestrators(id,project_id)
      );
      CREATE INDEX IF NOT EXISTS idx_lab_binding_project ON lab_task_bindings(project_id,kind);
      CREATE TABLE IF NOT EXISTS lab_work_dependencies (
        project_id TEXT NOT NULL REFERENCES lab_projects(id),
        task_id TEXT NOT NULL REFERENCES tasks(id),
        prerequisite_id TEXT NOT NULL REFERENCES tasks(id),
        PRIMARY KEY(task_id,prerequisite_id),
        FOREIGN KEY(task_id) REFERENCES lab_task_bindings(task_id),
        FOREIGN KEY(prerequisite_id) REFERENCES lab_task_bindings(task_id),
        CHECK(task_id<>prerequisite_id)
      );
      CREATE INDEX IF NOT EXISTS idx_lab_work_dependencies_project ON lab_work_dependencies(project_id);
      -- Idempotency receipts for App commands, including project creation
      -- before a Task exists. NOT a provider queue or replacement action ledger.
      CREATE TABLE IF NOT EXISTS lab_command_receipts (
        id TEXT PRIMARY KEY, workspace_session_id TEXT NOT NULL REFERENCES workspace_sessions(id),
        actor_id TEXT NOT NULL, client_id TEXT NOT NULL, request_id TEXT NOT NULL,
        project_id TEXT REFERENCES lab_projects(id), operation TEXT NOT NULL,
        input_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','uncertain')),
        result TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(workspace_session_id,actor_id,client_id,request_id)
      );
    `);
    this.workClaims=new ForgeWorkClaims(store);
    const receiptSchema=this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='lab_command_receipts'").get()?.sql||'';
    // Legacy table migration renames the referenced table. Drop only its
    // derived VIEW before that migration so SQLite cannot retain a dangling
    // reference to the old table name. Recreate after migration below.
    if(!receiptSchema.includes("'failed'")){
      this.db.exec('DROP VIEW IF EXISTS lab_command_receipt_scope');
      // SQLite rewrites dependent VIEW targets on ALTER TABLE RENAME.
      // Drop this derived view BEFORE renaming the old receipt table.
      this.db.exec('DROP VIEW IF EXISTS lab_command_active_unresolved');
      this.transaction(()=>{
      this.db.exec('ALTER TABLE lab_command_receipts RENAME TO lab_command_receipts_legacy');
      this.db.exec(`CREATE TABLE lab_command_receipts (
        id TEXT PRIMARY KEY, workspace_session_id TEXT NOT NULL REFERENCES workspace_sessions(id),
        actor_id TEXT NOT NULL, client_id TEXT NOT NULL, request_id TEXT NOT NULL,
        project_id TEXT REFERENCES lab_projects(id), operation TEXT NOT NULL,
        input_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','uncertain')),
        result TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(workspace_session_id,actor_id,client_id,request_id)
      )`);
      this.db.exec(`INSERT INTO lab_command_receipts
        (id,workspace_session_id,actor_id,client_id,request_id,project_id,operation,input_hash,status,result,created_at,updated_at)
        SELECT id,workspace_session_id,actor_id,client_id,request_id,project_id,operation,input_hash,status,result,created_at,updated_at
        FROM lab_command_receipts_legacy`);
      this.db.exec('DROP TABLE lab_command_receipts_legacy');
      });
    }
    if(!this.db.prepare('PRAGMA table_info(lab_projects)').all().some(column=>column.name==='repository_url'))
      this.db.exec('ALTER TABLE lab_projects ADD COLUMN repository_url TEXT');
    if(!this.db.prepare('PRAGMA table_info(lab_projects)').all().some(column=>column.name==='observation_requested'))
      this.db.exec('ALTER TABLE lab_projects ADD COLUMN observation_requested INTEGER NOT NULL DEFAULT 0 CHECK(observation_requested IN (0,1))');
    // Read-only projection over the ONE durable receipt ledger. SQLite JSON
    // extraction is never attempted on invalid/truncated result data. A work
    // receipt with an unresolvable Task quarantines its OWN project only.
    // Effective unresolved commands are a read-only projection of the same
    // append-only receipt ledger. An Owner acknowledgement is a NEW receipt:
    // the original command stays uncertain, is never replayed, and never
    // becomes evidence of success or of external effects.
    this.db.exec('DROP VIEW IF EXISTS lab_command_active_unresolved');
    this.db.exec(`CREATE VIEW lab_command_active_unresolved AS
      SELECT c.* FROM lab_command_receipts c
      WHERE c.status IN ('running','uncertain') AND (
        c.status='running' OR c.operation NOT IN ('project_command_run','work_accept') OR
        NOT EXISTS(SELECT 1 FROM lab_command_receipts a
          WHERE a.operation='command_close_unverified' AND a.status='succeeded'
            AND a.project_id=c.project_id
            AND a.workspace_session_id=c.workspace_session_id
            AND CASE WHEN json_valid(a.result) THEN
              json_extract(a.result,'$.targetCommandId')=c.id
              AND json_extract(a.result,'$.originalInputHash')=c.input_hash
              AND json_extract(a.result,'$.disposition')='abandon_unverified'
              AND json_extract(a.result,'$.acknowledgedUnknownEffects')=1
              AND json_extract(a.result,'$.externalEffectsVerified')=0
            ELSE 0 END
        )
      )`);
    // Recreate only this derived VIEW; its stored source remains unchanged.
    this.db.exec('DROP VIEW IF EXISTS lab_command_receipt_scope');
    this.db.exec(`CREATE VIEW lab_command_receipt_scope AS
      SELECT c.rowid AS receipt_rowid,c.id,c.project_id,c.operation,c.status,
        b.task_id AS task_id,
        CASE WHEN c.operation IN ('work_send','proposal_send')
          AND c.status IN ('running','uncertain') AND b.task_id IS NULL
          THEN 1 ELSE 0 END AS unknown_work_target
      FROM lab_command_receipts c
      LEFT JOIN lab_task_bindings b ON b.project_id=c.project_id
        AND b.task_id=CASE WHEN json_valid(c.result) THEN
          CASE WHEN json_type(c.result,'$.taskId')='text'
            THEN json_extract(c.result,'$.taskId') END END
      WHERE c.status NOT IN ('running','uncertain') OR
        EXISTS(SELECT 1 FROM lab_command_active_unresolved u WHERE u.id=c.id)`);
    this.continuation=new LabContinuation({store,service:this});
    this.autonomous=new AutonomousDialogue({store,service:this});
    this.workspace=new ProjectWorkspace({store,port:workspacePort});
    this.files=fileBroker;
    this.development=development;
    this.repository=new ProjectRepository({port:repositoryPort});
    this.ordaxProductMcp=null;
  }

  transaction(operation) {
    this.db.exec('BEGIN IMMEDIATE');
    try {const result=operation();this.db.exec('COMMIT');return result;}
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }

  createProjectRecord(name,objective,repositoryUrl,now) {
    const projectId='project_'+randomUUID();
    this.db.prepare(`INSERT INTO lab_projects
      (id,workspace_session_id,name,objective,created_at,repository_url) VALUES(?,?,?,?,?,?)`).run(projectId,
      this.store.getWorkspaceSession().id,name,objective,now,repositoryUrl||null);
    return projectId;
  }

  // Call exactly once by the App at startup, never when a client connects.
  recoverInterruptedCommands() {
    return this.transaction(()=>{
      const rows=this.db.prepare(`SELECT id,project_id,result FROM lab_command_receipts
        WHERE status='running' AND operation='proposal_send'`).all();
      for(const row of rows) {
        // A command receipt can be incomplete or corrupted after a crash.
        // Never use its JSON alone to change a different action or Task.
        let result=null;
        try {result=row.result?JSON.parse(row.result):null;} catch {}
        if(typeof result?.sendActionId!=='string'||typeof result?.taskId!=='string')continue;
        const action=this.db.prepare(`SELECT a.id FROM action_ledger a
          JOIN lab_task_bindings b ON b.task_id=a.task_id
          WHERE a.id=? AND a.task_id=? AND a.resource_key=?
            AND a.action_type='orchestrator.proposal-send' AND a.status='dispatching'
            AND b.project_id=? AND b.kind='work'`)
          .get(result.sendActionId,result.taskId,row.id,row.project_id);
        if(action)this.store.finishAction(result.taskId,action.id,'indeterminate',
          {reason:'process_interrupted',providerMessagesSent:null});
      }
      return Number(this.db.prepare("UPDATE lab_command_receipts SET status='uncertain',updated_at=? WHERE status='running'")
        .run(this.store.now()).changes);
    });
  }

  requireAccess(context,operation,projectId=null) {
    const session=this.store.getWorkspaceSession();
    if(!context || typeof context.actorId!=='string' || !context.actorId ||
      typeof context.clientId!=='string'||!context.clientId ||
      context.workspaceSessionId!==session?.id || session?.status!=='active' ||
      this.authorize({context,operation,projectId})!==true)
      throw Error('orchestrator_access_denied');
    if(projectId && !this.db.prepare('SELECT 1 FROM lab_projects WHERE id=? AND workspace_session_id=?')
      .get(projectId,session.id))throw Error('orchestrator_project_unavailable');
  }

  orchestrator(projectId,id) {
    const row=this.db.prepare('SELECT * FROM lab_orchestrators WHERE id=? AND project_id=?').get(id,projectId);
    if(!row)throw Error('orchestrator_unavailable');
    return row;
  }

  task(projectId,taskId,kind=null) {
    const row=this.db.prepare(`SELECT t.id,t.title,t.status,t.chat_url,t.updated_at,b.kind,b.orchestrator_id
      FROM tasks t JOIN lab_task_bindings b ON b.task_id=t.id
      WHERE t.id=? AND b.project_id=? AND t.workspace_session_id=?`)
      .get(taskId,projectId,this.store.getWorkspaceSession().id);
    if(!row || (kind&&row.kind!==kind))throw Error('orchestrator_work_unavailable');
    return row;
  }

  // Read-only projection from the same canonical receipts used to reserve a
  // Run-specific app-owned review. Priority is fail-closed: an uncertain or active
  // earlier request must not disappear behind a later failed model reply.
  runReviewReceipt(context,projectId,runId) {
    const receipt=this.db.prepare(`SELECT status,updated_at
      FROM lab_command_receipts
      WHERE workspace_session_id=? AND project_id=? AND operation='orchestrator_analyze'
        AND CASE WHEN json_valid(result) THEN
          COALESCE(json_extract(result,'$.reviewRunId'),
            json_extract(result,'$.reviewDecision.sourceRunId')) END=?
      ORDER BY CASE status
        WHEN 'uncertain' THEN 0 WHEN 'running' THEN 1
        WHEN 'succeeded' THEN 2 ELSE 3 END,updated_at DESC,id DESC
      LIMIT 1`).get(context.workspaceSessionId,projectId,runId);
    return {runId,status:receipt?.status||'not_requested',
      updatedAt:receipt?.updated_at||null};
  }

  historicalRepositoryHead(projectId,repositoryUrl) {
    const row=this.db.prepare(`SELECT repository_url,repository_id,default_branch,head_sha,observed_at,recorded_at
      FROM lab_repository_head_evidence WHERE project_id=? AND repository_url=?`)
      .get(projectId,repositoryUrl);
    if(!row)return null;
    // Corrupt or displaced local metadata is never elevated to a live GitHub
    // claim. Its source was validated at write time by the trusted port.
    if(!Number.isSafeInteger(row.repository_id)||row.repository_id<=0||
      !/^[a-f0-9]{40}$/.test(row.head_sha)||
      typeof row.default_branch!=='string'||row.default_branch.length>140||
      !/^[A-Za-z0-9_.\\/-]+$/.test(row.default_branch)||
      row.default_branch.includes('..')||row.default_branch.startsWith('/')||
      row.default_branch.endsWith('/')||
      !Number.isFinite(Date.parse(row.observed_at))||
      !Number.isFinite(Date.parse(row.recorded_at)))
      return null;
    return {repositoryId:row.repository_id,defaultBranch:row.default_branch,
      headSha:row.head_sha,observedAt:row.observed_at,recordedAt:row.recorded_at,
      provenance:{source:'github_rest_authenticated',historical:true,
        currentAccessVerified:false,grantRecheckedAtObservation:true,
        contentsRead:false,prsRead:false,checksRead:false}};
  }

  projectRepositoryUrl(projectId) {
    const row=this.db.prepare(`SELECT repository_url FROM lab_projects
      WHERE id=? AND workspace_session_id=?`).get(projectId,this.store.getWorkspaceSession().id);
    if(!row)throw Error('orchestrator_project_unavailable');
    return normalizeGitHubRepositoryUrl(row.repository_url);
  }

  // Conservatively quarantine an unknown provider target at PROJECT scope,
  // because a truncated receipt cannot prove which work was submitted.
  // Valid references are matched to the same project by the read-only view.
  hasUnresolvedWorkReceipt(projectId,taskId,{includeRunning=false}={}) {
    const status=includeRunning?"IN ('running','uncertain')":"='uncertain'";
    return Boolean(this.db.prepare(`SELECT 1 FROM lab_command_receipt_scope
      WHERE status ${status} AND operation IN ('work_send','proposal_send')
      AND (task_id=? OR (project_id=? AND unknown_work_target=1)) LIMIT 1`)
      .get(taskId,projectId));
  }

  reconcileRecoveredWorkReceipt(taskId,runId,{alreadyInTransaction=false}={}) {
    const apply=()=>{
      const binding=this.db.prepare(`SELECT project_id,kind FROM lab_task_bindings
        WHERE task_id=?`).get(taskId);
      if(!binding||binding.kind!=='work')
        return {reconciled:false,reason:'recovered_work_binding_unavailable'};
      const run=this.db.prepare(`SELECT rowid,id,status,started_at FROM runs
        WHERE id=? AND task_id=?`).get(runId,taskId);
      const latest=this.db.prepare(`SELECT id FROM runs WHERE task_id=?
        ORDER BY rowid DESC LIMIT 1`).get(taskId);
      const evidence=this.db.prepare(`SELECT 1 FROM events WHERE task_id=?
        AND kind='provider.response.reconciled'
        AND json_extract(payload,'$.run_id')=? LIMIT 1`).get(taskId,runId);
      if(!run||run.status!=='succeeded'||latest?.id!==runId||!evidence)
        return {reconciled:false,reason:'recovered_work_run_unverified'};
      const previous=this.db.prepare(`SELECT completed_at FROM runs
        WHERE task_id=? AND rowid<? ORDER BY rowid DESC LIMIT 1`).get(taskId,run.rowid);
      const receipts=this.db.prepare(`SELECT c.id,c.result,c.created_at
        FROM lab_command_receipts c JOIN lab_command_receipt_scope s
          ON s.receipt_rowid=c.rowid
        WHERE s.project_id=? AND s.task_id=? AND s.operation='work_send'
          AND s.status='uncertain' ORDER BY c.created_at,c.id`)
        .all(binding.project_id,taskId);
      if(receipts.length===0)return {reconciled:false,reason:'recovered_work_receipt_absent'};
      if(receipts.length!==1)throw Error('orchestrator_recovered_work_receipt_ambiguous');
      const receipt=receipts[0];
      let prior=null;
      try{prior=receipt.result?JSON.parse(receipt.result):null;}catch{}
      const receiptAt=Date.parse(receipt.created_at),runAt=Date.parse(run.started_at);
      const previousAt=previous?.completed_at?Date.parse(previous.completed_at):null;
      if(!prior||prior.taskId!==taskId||
         (prior.runId!==undefined&&prior.runId!==null&&prior.runId!==runId)||
         !Number.isFinite(receiptAt)||!Number.isFinite(runAt)||receiptAt>runAt||
         (previousAt!==null&&(!Number.isFinite(previousAt)||receiptAt<=previousAt)))
        throw Error('orchestrator_recovered_work_receipt_mismatch');
      const result={...prior,taskId,runId,responseObserved:true,effectVerified:false,
        provider:'chatgpt_web',recovered:true,reconciled:true};
      const changed=this.db.prepare(`UPDATE lab_command_receipts
        SET status='succeeded',result=?,updated_at=?
        WHERE id=? AND status='uncertain'`)
        .run(JSON.stringify(result),this.store.now(),receipt.id).changes;
      if(changed!==1)throw Error('orchestrator_recovered_work_receipt_state_changed');
      this.store.event(taskId,'provider.command.reconciled',{
        run_id:runId,command_id:receipt.id,operation:'work_send',
        response_observed:true,effect_verified:false
      });
      return {reconciled:true,commandId:receipt.id,runId};
    };
    return alreadyInTransaction?apply():this.transaction(apply);
  }

  assertProviderTaskAvailable(taskId,{allowCoordinator=false}={}) {
    const binding=this.db.prepare(`SELECT b.kind,b.project_id,o.status FROM lab_task_bindings b
      JOIN lab_orchestrators o ON o.id=b.orchestrator_id WHERE b.task_id=?`).get(taskId);
    if(binding?.kind==='orchestrator'&&!allowCoordinator)throw Error('orchestrator_coordinator_channel_required');
    if(allowCoordinator&&binding?.kind!=='orchestrator')throw Error('orchestrator_coordinator_task_required');
    if(binding?.status==='paused')throw Error('orchestrator_paused');
    if(binding?.kind==='work'&&this.db.prepare("SELECT status FROM tasks WHERE id=?")
      .get(taskId)?.status==='completed')throw Error('orchestrator_work_already_accepted');
    // A normal GPT Task need not belong to a Forge project. It has no
    // project-level receipts to query; passing undefined into SQLite here
    // blocked every ordinary unbound Task before a Run could be recorded.
    // Task-level uncertain delivery remains guarded by the caller.
    if(!binding)return;
    const uncertain=binding.kind==='work'
      ?this.hasUnresolvedWorkReceipt(binding.project_id,taskId)
      :Boolean(this.db.prepare(`SELECT 1 FROM lab_command_receipts
        WHERE project_id=? AND operation='forjador_send' AND status='uncertain'
        LIMIT 1`).get(binding?.project_id));
    if(uncertain)throw Error('orchestrator_reconciliation_required');
  }

  receipt(row) {
    let result=null;
    try {result=row.result?JSON.parse(row.result):null;}
    catch {
      // Preserve the raw SQLite evidence; never interpret or replay it.
      if(row.status!=='uncertain')throw Error('orchestrator_receipt_result_invalid');
      result={reason:'receipt_result_unreadable'};
    }
    const outstanding=row.status==='uncertain'
      ?Boolean(this.db.prepare('SELECT 1 FROM lab_command_active_unresolved WHERE id=?')
        .get(row.id)):false;
    return {commandId:row.id,operation:row.operation,status:row.status,
      requiresReconciliation:outstanding,
      ...(row.status==='uncertain'&&!outstanding?{
        reviewedUnknownOutcome:true,externalEffectsVerified:false,replayAllowed:false
      }:{}),
      result,updatedAt:row.updated_at};
  }

  getReceipt(context,id) {
    const row=this.db.prepare(`SELECT * FROM lab_command_receipts WHERE id=? AND
      workspace_session_id=? AND actor_id=? AND client_id=?`)
      .get(id,context.workspaceSessionId,context.actorId,context.clientId);
    if(!row)throw Error('orchestrator_command_unavailable');
    this.requireAccess(context,row.operation,row.project_id);
    return this.receipt(row);
  }

  // This is a native-Owner-only, append-only review. It never changes the
  // original uncertain receipt, never replays its command and never certifies
  // historical external effects. A later success only proves current health.
  closeUnverifiedCommand(context,raw,{nativeOwnerConfirmed=false}={}) {
    const input=validateNativeCommandReviewInput(raw);
    if(nativeOwnerConfirmed!==true)
      throw Error('forge_command_review_native_owner_required');
    this.requireAccess(context,'command_close_unverified',input.projectId);
    if(input.acknowledgeUnknownEffects!==true)
      throw Error('forge_command_review_acknowledgement_required');
    const grant=this.development?.status?.(input.projectId);
    if(grant?.ownerApproved!==true||grant.available!==true)
      throw Error('forge_command_review_owner_grant_required');
    return this.transaction(()=>{
      this.requireAccess(context,'command_close_unverified',input.projectId);
      // Resolve idempotency before checking the now-closed original receipt.
      const existing=this.db.prepare(`SELECT id FROM lab_command_receipts WHERE
        workspace_session_id=? AND actor_id=? AND client_id=? AND request_id=?`)
        .get(context.workspaceSessionId,context.actorId,context.clientId,input.requestId);
      if(existing)return this.reserve(context,'command_close_unverified',input).existing;
      const source=this.db.prepare(`SELECT * FROM lab_command_receipts
        WHERE id=? AND project_id=? AND workspace_session_id=?`).get(input.commandId,
          input.projectId,context.workspaceSessionId);
      if(!source||!['project_command_run','work_accept'].includes(source.operation)||
         source.status!=='uncertain')
        throw Error('forge_command_review_scope_or_status_invalid');
      // Only two bounded native paths are reviewable: a terminal command whose
      // outcome was already classified unknown, or a work acceptance interrupted
      // while running its fresh integrated-main test. Provider sends and all
      // other effects remain non-reviewable here.
      let sourceResult;
      try{sourceResult=JSON.parse(source.result||'null');}catch{}
      const terminalUnknown=source.operation==='project_command_run'&&
        sourceResult?.reason==='forge_development_command_outcome_uncertain'&&
        sourceResult.externalEffectsVerified===false;
      const acceptanceUnknown=source.operation==='work_accept'&&
        sourceResult?.phase==='testing_integrated_main'&&
        typeof sourceResult?.taskId==='string';
      if(!terminalUnknown&&!acceptanceUnknown)
        throw Error('forge_command_review_effect_unverified');
      if(acceptanceUnknown) {
        const task=this.task(input.projectId,sourceResult.taskId,'work');
        if(task.status==='completed')throw Error('forge_command_review_effect_unverified');
      }
      if(!this.db.prepare('SELECT 1 FROM lab_command_active_unresolved WHERE id=?')
        .get(source.id))throw Error('forge_command_review_already_closed');
      const candidates=this.db.prepare(`SELECT id,result,updated_at
        FROM lab_command_receipts WHERE project_id=? AND workspace_session_id=?
          AND operation='project_command_run' AND status='succeeded'
          AND updated_at>=? ORDER BY rowid DESC LIMIT 40`).all(input.projectId,
          context.workspaceSessionId,source.updated_at);
      const proof=candidates.find(row=>{
        let value;
        try{value=JSON.parse(row.result||'null');}catch{return false;}
        return value?.completed===true&&value.exitCode===0&&
          value.commandOutcome==='exit_zero'&&value.workspaceScope==='project_root'&&
          value.projectId===input.projectId;
      });
      if(!proof)throw Error('forge_command_review_independent_evidence_missing');
      const reserved=this.reserve(context,'command_close_unverified',input);
      if(reserved.existing)return reserved.existing;
      return this.finish(reserved.commandId,{
        schema:'ordax.forge.unknown-command-acknowledgement/1',
        targetCommandId:source.id,originalStatus:'uncertain',
        originalOperation:source.operation,
        originalInputHash:source.input_hash,disposition:'abandon_unverified',
        acknowledgedUnknownEffects:true,externalEffectsVerified:false,
        originalReceiptPreserved:true,replayAllowed:false,
        evidenceCommandId:proof.id,note:input.note
      });
    });
  }

  reserve(context,operation,input) {
    const inputHash=createHash('sha256').update(JSON.stringify({operation,input})).digest('hex');
    const existing=this.db.prepare(`SELECT * FROM lab_command_receipts WHERE
      workspace_session_id=? AND actor_id=? AND client_id=? AND request_id=?`)
      .get(context.workspaceSessionId,context.actorId,context.clientId,input.requestId);
    if(existing) {
      if(existing.input_hash!==inputHash)throw Error('orchestrator_request_conflict');
      this.requireAccess(context,operation,existing.project_id);
      return {existing:this.receipt(existing)};
    }
    const commandId='command_'+randomUUID(),now=this.store.now();
    this.db.prepare(`INSERT INTO lab_command_receipts
      (id,workspace_session_id,actor_id,client_id,request_id,project_id,operation,input_hash,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,'running',?,?)`).run(commandId,context.workspaceSessionId,
      context.actorId,context.clientId,input.requestId,input.projectId||null,operation,inputHash,now,now);
    return {commandId};
  }

  finish(commandId,result,status='succeeded') {
    if(!['succeeded','failed','uncertain'].includes(status))throw Error('invalid_orchestrator_receipt_status');
    const changed=this.db.prepare("UPDATE lab_command_receipts SET status=?,result=?,updated_at=? WHERE id=? AND status='running'")
      .run(status,JSON.stringify(result),this.store.now(),commandId).changes;
    if(changed!==1)throw Error('orchestrator_command_state_conflict');
    return this.receipt(this.db.prepare('SELECT * FROM lab_command_receipts WHERE id=?').get(commandId));
  }

  async invoke(context,operation,raw={}) {
    const {tool,input}=validateOrchestratorInput(operation,raw);
    enforceDedicatedForgeProject(this.store,operation,input);
    // A completed delete has a projectless tombstone so the same requestId
    // can be inspected without restoring the deleted project's authority.
    if(operation==='project_delete') {
      const prior=this.db.prepare(`SELECT * FROM lab_command_receipts WHERE
        workspace_session_id=? AND actor_id=? AND client_id=? AND request_id=?`)
        .get(context.workspaceSessionId,context.actorId,context.clientId,input.requestId);
      if(prior?.operation==='project_delete'&&prior.project_id===null&&prior.status==='succeeded') {
        this.requireAccess(context,operation);
        const inputHash=createHash('sha256').update(JSON.stringify({operation,input})).digest('hex');
        if(prior.input_hash!==inputHash)throw Error('orchestrator_request_conflict');
        return this.receipt(prior);
      }
    }
    if(operation==='project_memory'&&input.projectId==='forge_git'){
      // Reserved owner-only resource, not a Forge SQLite project or grant.
      const port=this.forgeGitMemoryPort;
      if(port?.isOwnerContext?.(context)!==true||typeof port.read!=='function')
        throw Error('forge_git_owner_required');
      this.requireAccess(context,operation);
      const view=await port.read();
      this.requireAccess(context,operation);
      if(port.isOwnerContext(context)!==true)throw Error('forge_git_owner_required');
      return view;
    }
    this.requireAccess(context,operation,input.projectId||null);
    if(operation==='ordax_repository_probe')
      return runForgeOrdaxRepositoryProbe(this,context,input);
    if(operation==='ordax_native_session_open'){
      const dedicated=readDedicatedForgeProject(this.store);
      if(!dedicated||dedicated.projectId!==input.projectId)
        throw Error('forge_dedicated_project_required');
      // A session challenge may be queued but is NEVER a device grant or an
      // execution command. Only a Task claim holder may request it. The Core
      // owns the sealed OAuth token and private nonce; no App IPC can call it.
      const reserved=this.transaction(()=>{
        this.task(input.projectId,input.taskId,'work');
        this.workClaims.assertTaskMutation(context,input);
        return this.reserve(context,operation,input);
      });
      if(reserved.existing)return reserved.existing;
      let result;
      try{
        result=await this.ordaxProductMcp?.openNativeSession()??{
          schema:'ordax.forge.native-session/1',ready:false,
          reason:'forge_native_oauth_port_unavailable',
          executionAuthorized:false,actionDispatched:false
        };
      }catch{
        result={schema:'ordax.forge.native-session/1',ready:false,
          reason:'ordax_native_session_outcome_unconfirmed',
          outcomeUnconfirmed:true,executionAuthorized:false,
          actionDispatched:false};
      }
      if(result?.actionDispatched!==false||
         result?.executionAuthorized!==false||
         typeof result?.reason!=='string'){
        result={schema:'ordax.forge.native-session/1',ready:false,
          reason:'ordax_native_session_invalid_response',
          outcomeUnconfirmed:true,executionAuthorized:false,
          actionDispatched:false};
      }
      const status=result.outcomeUnconfirmed===true?'uncertain':
        result.ready===true?'succeeded':'failed';
      return this.transaction(()=>this.finish(reserved.commandId,result,status));
    }
    if(operation==='app_ui_inspect'){
      if(typeof this.viewPort?.ui!=='function')throw Error('forge_app_ui_unavailable');
      const result=await this.viewPort.ui(operation,input);
      this.requireAccess(context,operation);
      return result;
    }
    if(['app_ui_click','app_ui_fill','app_ui_scroll'].includes(operation)){
      if(typeof this.viewPort?.ui!=='function')throw Error('forge_app_ui_unavailable');
      const reserved=this.transaction(()=>this.reserve(context,operation,input));
      if(reserved.existing)return reserved.existing;
      let applied=false;
      try{
        this.requireAccess(context,operation);
        const result=await this.viewPort.ui(operation,input);
        applied=true;
        const action=operation.slice('app_ui_'.length);
        if(result?.schema!=='ordax.forge.app-ui-action/1'||
           result.source!=='active_forge_renderer'||
           result.action!==action||result.dispatched!==true||
           result.beforeRevision!==input.expectedRevision||
           !/^[a-f0-9]{64}$/.test(result.afterRevision||'')||
           typeof result.observableDomChanged!=='boolean'||
           result.inputValuesIncluded!==false||
           result.semanticEffectVerified!==false||
           result.externalEffectsVerified!==false||
           result.focusChanged!==false||
           (action==='scroll'?
             result.scrollIndex!==input.scrollIndex||
             result.deltaY!==input.deltaY:
             result.controlIndex!==input.controlIndex||
             result.expectedLabel!==input.expectedLabel)||
           (action==='fill'&&result.rendererValueVerified!==true))
          throw Error('forge_app_ui_receipt_invalid');
        this.requireAccess(context,operation);
        return this.transaction(()=>this.finish(reserved.commandId,result));
      }catch(error){
        const safeBeforeAction=!applied&&!error?.forgeAppUiActionSubmitted&&
          (error?.forgeAppUiActionNotSubmitted===true||
           ['forge_app_ui_stale','forge_app_ui_busy',
            'forge_app_ui_unavailable',
            'forge_app_ui_self_termination_blocked'].includes(error?.message));
        const code=safeBeforeAction?error?.message:'forge_app_ui_action_unconfirmed';
        this.transaction(()=>this.finish(reserved.commandId,
          {reason:code,actionVerified:false},
          safeBeforeAction?'failed':'uncertain'));
        this.requireAccess(context,operation);
        return this.getReceipt(context,reserved.commandId);
      }
    }
    if(operation==='app_view_status')return this.viewPort?.status()??{available:false,reason:'forge_native_view_unavailable'};
    if(['app_view_capture','project_view_capture','project_view_probe'].includes(operation)){
      if(typeof this.viewPort?.capture!=='function')throw Error('forge_native_view_unavailable');
      const image=await this.viewPort.capture(operation,input);
      this.requireAccess(context,operation,input.projectId||null);
      return image;
    }
    if(operation==='project_view_live_inspect'){
      if(typeof this.viewPort?.live!=='function')throw Error('forge_native_view_unavailable');
      const result=await this.viewPort.live(operation,input);
      this.requireAccess(context,operation,input.projectId);
      return result;
    }
    if(['project_view_live_click','project_view_live_fill'].includes(operation)){
      if(typeof this.viewPort?.live!=='function')throw Error('forge_native_view_unavailable');
      const reserved=this.transaction(()=>this.reserve(context,operation,input));
      if(reserved.existing)return reserved.existing;
      let applied=false;
      try{
        this.requireAccess(context,operation,input.projectId);
        const result=await this.viewPort.live(operation,input);
        // A resolved port call is not proof that a DOM click completed.
        // Mark it potentially applied before validating evidence, so a
        // malformed result is quarantined as uncertain and never replayed.
        applied=true;
        if(result?.schema!=='ordax.forge.live-view-action/1'||
           result.source!=='active_native_view'||
           result.projectId!==input.projectId||
           result.taskId!==input.taskId||result.assetId!==input.assetId||
           !/^[a-f0-9]{64}$/.test(result.sha256||'')||
           result.action!==(operation==='project_view_live_fill'?'fill':'click')||
           (operation==='project_view_live_fill'&&result.valueVerifiedAfterInput!==true)||
           result.dispatched!==true||
           result.controlIndex!==input.controlIndex||
           result.expectedLabel!==input.expectedLabel||
           result.beforeRevision!==input.expectedRevision||
           !/^[a-f0-9]{64}$/.test(result.afterRevision||'')||
           typeof result.observableDomChanged!=='boolean'||
           result.statePersistedInLiveView!==true||
           result.projectFilesModified!==false||
           result.externalEffectsVerified!==false||
           result.websitePublished!==false)
          throw Error('forge_view_live_receipt_invalid');
        this.requireAccess(context,operation,input.projectId);
        return this.transaction(()=>this.finish(reserved.commandId,result));
      }catch(error){
        const safeBeforeAction=!applied&&!error?.forgeLiveActionSubmitted&&
          (error?.forgeLiveActionNotSubmitted===true||
            ['forge_view_live_unavailable','forge_view_live_stale',
              'forge_view_live_busy','forge_view_live_dom_unavailable'].includes(error?.message));
        const code=safeBeforeAction?error.message:'forge_view_live_action_unconfirmed';
        this.transaction(()=>this.finish(reserved.commandId,
          {reason:code,actionVerified:false},
          safeBeforeAction?'failed':'uncertain'));
        this.requireAccess(context,operation,input.projectId);
        return this.getReceipt(context,reserved.commandId);
      }
    }
    if(operation==='autonomous_dialogue_status')return this.autonomous.status(context,input);
    if(operation==='repository_observe') {
      const repositoryUrl=this.projectRepositoryUrl(input.projectId);
      const recheck=()=>{
        this.requireAccess(context,operation,input.projectId);
        if(this.projectRepositoryUrl(input.projectId)!==repositoryUrl)
          throw Error('orchestrator_repository_changed_during_observation');
      };
      const snapshot=await this.repository.observe(context,{projectId:input.projectId,repositoryUrl},recheck);
      // No await between the final scoped grant check and this existing App
      // transaction. Revalidate the owner and binding again before saving.
      this.transaction(()=>{
        recheck();
        this.db.prepare(`INSERT INTO lab_repository_head_evidence
          (project_id,repository_url,repository_id,default_branch,head_sha,observed_at,recorded_at)
          VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET
          repository_url=excluded.repository_url,repository_id=excluded.repository_id,
          default_branch=excluded.default_branch,head_sha=excluded.head_sha,
          observed_at=excluded.observed_at,recorded_at=excluded.recorded_at`)
          .run(input.projectId,snapshot.repositoryUrl,snapshot.repositoryId,
            snapshot.defaultBranch,snapshot.headSha,snapshot.observedAt,this.store.now());
      });
      return snapshot;
    }
    if(operation==='workspace_snapshot')return this.workspace.snapshot(context,input,()=>this.requireAccess(context,operation,input.projectId));
    if(operation==='workspace_bind')return this.bindWorkspace(context,input);
    if(operation==='project_delete')return this.transaction(()=>{
      const reserved=this.reserve(context,operation,input);
      if(reserved.existing)return reserved.existing;
      const activeRun=this.db.prepare(`SELECT 1 FROM runs r
        JOIN lab_task_bindings b ON b.task_id=r.task_id
        WHERE b.project_id=? AND r.status='running' LIMIT 1`).get(input.projectId);
      const activeClaim=this.db.prepare(`SELECT 1 FROM lab_work_claims
        WHERE project_id=? AND status='active' AND lease_until>? LIMIT 1`)
        .get(input.projectId,this.store.now());
      const unresolved=this.db.prepare(`SELECT 1 FROM lab_command_receipts
        WHERE project_id=? AND id<>? AND status IN ('running','uncertain') LIMIT 1`)
        .get(input.projectId,reserved.commandId);
      if(activeRun||activeClaim||unresolved)
        throw Error('orchestrator_project_delete_work_active');
      // Detach ONLY the deletion receipt before removing all scoped history.
      this.db.prepare('UPDATE lab_command_receipts SET project_id=NULL WHERE id=?').run(reserved.commandId);
      const result=deleteProjectRecords(this.db,{projectId:input.projectId,
        workspaceSessionId:context.workspaceSessionId,confirmName:input.confirmName});
      return this.finish(reserved.commandId,result);
    });
    if(['work_claim','work_progress','work_memory_set'].includes(operation))return this.transaction(()=>{
      // The MCP command receipt and Task claim/memory update commit together.
      this.task(input.projectId,input.taskId,'work');
      const reserved=this.reserve(context,operation,input);
      if(reserved.existing)return reserved.existing;
      const result=operation==='work_claim'?this.workClaims.claim(context,input)
        :operation==='work_progress'?this.workClaims.progress(context,input)
        :this.workClaims.memory(context,input);
      return this.finish(reserved.commandId,result);
    });
    if(operation==='work_repositories_set')return this.transaction(()=>{
      const dedicated=readDedicatedForgeProject(this.store);
      if(!dedicated||dedicated.projectId!==input.projectId)
        throw Error('forge_dedicated_project_required');
      this.task(input.projectId,input.taskId,'work');
      const reserved=this.reserve(context,operation,input);
      if(reserved.existing)return reserved.existing;
      this.workClaims.assertTaskMutation(context,input);
      const catalog=this.repositoryCatalogPort?.read();
      if(catalog?.available!==true||catalog.checkedOrigin!==true)
        throw Error('forge_ordax_catalog_verified_origin_required');
      const members=new Set(catalog.repositories.map(item=>item.repo));
      const selected=[...new Set(input.repositories)].sort();
      if(selected.length!==input.repositories.length||selected.some(repo=>!members.has(repo)))
        throw Error('forge_task_repository_scope_invalid');
      const rows=this.db.prepare('SELECT repository FROM forge_work_repository_scope WHERE task_id=? ORDER BY repository')
        .all(input.taskId).map(row=>row.repository);
      if(rows.length){
        if(JSON.stringify(rows)!==JSON.stringify(selected))
          throw Error('forge_task_repository_scope_already_set');
        return this.finish(reserved.commandId,{
          projectId:input.projectId,taskId:input.taskId,repositories:rows,
          unchanged:true,executionAuthorized:false
        });
      }
      const effect=this.db.prepare(`SELECT 1 FROM lab_command_receipt_scope
        WHERE task_id=? AND operation IN (
          'project_file_write','project_command_run','project_worktree_prepare',
          'project_worktree_integrate','project_worktree_verify','work_accept'
        ) LIMIT 1`).get(input.taskId);
      if(effect)throw Error('forge_task_repository_scope_after_effect_denied');
      const insert=this.db.prepare('INSERT INTO forge_work_repository_scope (task_id,project_id,repository) VALUES(?,?,?)');
      for(const repo of selected)insert.run(input.taskId,input.projectId,repo);
      return this.finish(reserved.commandId,{
        projectId:input.projectId,taskId:input.taskId,repositories:selected,
        binding:'canonical_ownership_manifest',executionAuthorized:false,
        filesystemAccessGranted:false
      });
    });
    if(operation==='project_file_write')return this.writeProjectFile(context,input);
    if(operation==='project_development_status')
      return readDedicatedForgeProject(this.store)
        ?{projectId:input.projectId,available:false,nativeProcessExecution:false,
          reason:'dedicated_repository_owner_port_required'}
        :this.development?.status(input.projectId,{taskId:input.taskId??null})??
          {projectId:input.projectId,available:false,reason:'native_owner_port_unavailable'};
    if(operation==='project_worktree_prepare')return this.prepareProjectWorktree(context,input);
    if(operation==='project_worktree_review')return this.reviewProjectWorktree(context,input);
    if(operation==='project_worktree_verify')return this.verifyProjectWorktree(context,input);
    if(operation==='project_worktree_integrate')return this.integrateProjectWorktree(context,input);
    if(operation==='work_accept')return this.acceptIntegratedWork(context,input);
    if(operation==='project_command_run')return this.runProjectCommand(context,input);
    if(tool.readOnly)return this.read(context,operation,input);
    return this.transaction(()=>{
      const reserved=this.reserve(context,operation,input);
      if(reserved.existing)return reserved.existing;
      if(['work_draft_set','work_dependency_set','conversation_rotate',
          'work_failover_prepare','project_memory_propose'].includes(operation))
        this.workClaims.assertTaskMutation(context,input);
      const result=operation==='project_memory_propose'
        ?(this.task(input.projectId,input.taskId),this.store.memoryCandidates.proposeFromAssistant(input.taskId,input))
        :this.mutate(operation,input);
      if(['project_create','project_quick_create','mission_create'].includes(operation))this.db.prepare('UPDATE lab_command_receipts SET project_id=? WHERE id=?')
        .run(result.projectId,reserved.commandId);
      return this.finish(reserved.commandId,result);
    });
  }

  scopedTaskId(input){
    if(input.taskId!==undefined&&input.taskId!==null){
      this.task(input.projectId,input.taskId,'work');
      return input.taskId;
    }
    if(this.development?.requiresTaskScope?.(input.projectId))
      throw Error('forge_task_workspace_required');
    return null;
  }

  async prepareProjectWorktree(context,input){
    if(!this.development)throw Error('forge_development_unavailable');
    this.task(input.projectId,input.taskId,'work');
    this.workClaims.assertTaskMutation(context,input);
    const reserved=this.transaction(()=>this.reserve(context,'project_worktree_prepare',input));
    if(reserved.existing)return reserved.existing;
    try{
      this.requireAccess(context,'project_worktree_prepare',input.projectId);
      const result=await this.development.prepareWorktree(input.projectId,input.taskId);
      return this.transaction(()=>this.finish(reserved.commandId,result));
    }catch(error){
      const deterministic=new Set(['forge_development_owner_approval_required',
        'forge_workspace_binding_required','forge_workspace_missing_or_moved',
        'forge_workspace_project_unavailable','forge_worktree_task_invalid',
        'forge_worktree_task_unavailable','forge_worktree_main_dirty',
        'forge_worktree_branch_exists','forge_worktree_repository_root_mismatch',
        'forge_worktree_git_metadata_invalid','forge_worktree_state_invalid',
        'forge_worktree_record_invalid','forge_worktree_metadata_invalid']);
      try{this.transaction(()=>this.finish(reserved.commandId,{
        taskId:input.taskId,reason:deterministic.has(error?.message)
          ?error.message:'forge_worktree_effect_uncertain',verified:false},
        deterministic.has(error?.message)?'failed':'uncertain'));}catch{}
      throw error;
    }
  }


  async reviewProjectWorktree(context,input){
    if(!this.development)throw Error('forge_development_unavailable');
    this.task(input.projectId,input.taskId,'work');
    this.requireAccess(context,'project_worktree_review',input.projectId);
    return await this.development.reviewWorktree(input.projectId,input.taskId);
  }


  async verifyProjectWorktree(context,input){
    if(!this.development)throw Error('forge_development_unavailable');
    this.task(input.projectId,input.taskId,'work');
    this.workClaims.assertTaskMutation(context,input);
    const reserved=this.transaction(()=>this.reserve(context,'project_worktree_verify',input));
    if(reserved.existing)return reserved.existing;
    try{
      this.requireAccess(context,'project_worktree_verify',input.projectId);
      const result=await this.development.verifyWorktree(input.projectId,input.taskId,{
        command:input.command,timeoutMs:input.timeoutMs
      });
      return this.transaction(()=>this.finish(reserved.commandId,result,
        result.verified===true?'succeeded':'failed'));
    }catch(error){
      const deterministic=new Set([
        'forge_development_owner_approval_required','forge_development_command_invalid',
        'forge_workspace_binding_required','forge_workspace_missing_or_moved',
        'forge_workspace_project_unavailable','forge_worktree_task_invalid',
        'forge_worktree_task_unavailable','forge_worktree_task_unprepared',
        'forge_worktree_record_invalid','forge_worktree_main_dirty',
        'forge_worktree_task_dirty','forge_worktree_no_changes',
        'forge_worktree_history_diverged'
      ]);
      const definitive=deterministic.has(error?.message);
      try{this.transaction(()=>this.finish(reserved.commandId,{
        taskId:input.taskId,reason:definitive?error.message:'forge_worktree_verification_uncertain',
        verified:false,externalEffectsVerified:false
      },definitive?'failed':'uncertain'));}catch{}
      throw error;
    }
  }

  verificationReceiptsForIntegration(context,input){
    const ids=input.verificationReceiptIds||[];
    if(new Set(ids).size!==ids.length)throw Error('forge_worktree_verification_receipt_invalid');
    return ids.map(commandId=>{
      const row=this.db.prepare(`SELECT * FROM lab_command_receipts WHERE id=? AND
        workspace_session_id=? AND actor_id=? AND client_id=? AND project_id=? AND
        operation='project_worktree_verify' AND status='succeeded'`)
        .get(commandId,context.workspaceSessionId,context.actorId,context.clientId,input.projectId);
      if(!row)throw Error('forge_worktree_verification_receipt_invalid');
      const receipt=this.receipt(row),result=receipt.result;
      if(!result||result.taskId!==input.taskId||result.exitCode!==0||
         result.completed!==true||result.verified!==true||
         result.workspaceScope!=='task_worktree'||
         result.verifiedBranchHeadSha!==input.expectedBranchHeadSha)
        throw Error('forge_worktree_verification_receipt_invalid');
      return {commandId,verifiedBranchHeadSha:result.verifiedBranchHeadSha,updatedAt:receipt.updatedAt};
    });
  }

  async integrateProjectWorktree(context,input){
    if(!this.development)throw Error('forge_development_unavailable');
    this.task(input.projectId,input.taskId,'work');
    this.workClaims.assertTaskMutation(context,input);
    const reserved=this.transaction(()=>this.reserve(context,'project_worktree_integrate',input));
    if(reserved.existing)return reserved.existing;
    try{
      this.requireAccess(context,'project_worktree_integrate',input.projectId);
      const verifications=this.verificationReceiptsForIntegration(context,input);
      const result=await this.development.integrateWorktree(input.projectId,input.taskId,{
        expectedBranchHeadSha:input.expectedBranchHeadSha,
        expectedMainHeadSha:input.expectedMainHeadSha
      });
      return this.transaction(()=>this.finish(reserved.commandId,{
        ...result,verificationReceiptIds:verifications.map(item=>item.commandId)
      }));
    }catch(error){
      const deterministic=new Set([
        'forge_development_owner_approval_required','forge_workspace_binding_required',
        'forge_workspace_missing_or_moved','forge_workspace_project_unavailable',
        'forge_worktree_task_invalid','forge_worktree_task_unavailable',
        'forge_worktree_task_unprepared','forge_worktree_record_invalid',
        'forge_worktree_expected_head_invalid','forge_worktree_branch_changed',
        'forge_worktree_main_changed','forge_worktree_main_dirty',
        'forge_worktree_task_dirty','forge_worktree_no_changes',
        'forge_worktree_history_diverged','forge_worktree_merge_conflict',
        'forge_worktree_merge_failed','forge_worktree_verification_receipt_invalid'
      ]);
      const definitive=deterministic.has(error?.message);
      try{this.transaction(()=>this.finish(reserved.commandId,{
        taskId:input.taskId,reason:definitive?error.message:'forge_worktree_integration_uncertain',
        integrated:false,externalEffectsVerified:false
      },definitive?'failed':'uncertain'));}catch{}
      throw error;
    }
  }

  // One owner-authorized post-merge acceptance receipt for one Task. The
  // existing Git, SQLite, native terminal, and provider receipts own authority.
  // A command success alone, or the text "done" in ChatGPT, can never accept.
  async acceptIntegratedWork(context,input){
    if(!this.development)throw Error('forge_development_unavailable');
    this.task(input.projectId,input.taskId,'work');
    this.workClaims.assertTaskMutation(context,input);
    const session=context.workspaceSessionId;
    const latest=()=>this.db.prepare(
      'SELECT t.id,t.status AS taskStatus,'+
      '(SELECT id FROM runs WHERE task_id=t.id ORDER BY rowid DESC LIMIT 1) AS runId,'+
      '(SELECT status FROM runs WHERE task_id=t.id ORDER BY rowid DESC LIMIT 1) AS runStatus '+
      'FROM tasks t JOIN lab_task_bindings b ON b.task_id=t.id '+
      'WHERE b.project_id=? AND b.kind=\'work\' AND t.id=? AND t.workspace_session_id=?')
      .get(input.projectId,input.taskId,session);
    const before=()=> {
      const task=latest();
      if(!task||task.taskStatus==='completed'||task.runStatus!=='succeeded')
        throw Error('forge_work_accept_run_unverified');
      if(this.hasUnresolvedWorkReceipt(input.projectId,input.taskId,{includeRunning:true})||
         listTaskUncertainTransportRuns(this.store,input.taskId).length)
        throw Error('forge_work_accept_unresolved_provider');
      const admission=forgeProjectHandoffView(this.store,input.projectId,
        {taskId:input.taskId}).receiptAdmission;
      if(!admission||admission.blockingUnresolvedCommands!==0)
        throw Error('forge_work_accept_unresolved_effect');
      // The last observed Run must be attributable to one durable, confirmed
      // Forge provider send, not an invented/historical chat response.
      const sent=this.db.prepare(
        'SELECT id FROM lab_command_receipts WHERE project_id=? AND workspace_session_id=? '+
        "AND operation IN ('work_send','proposal_send') AND status='succeeded' "+
        "AND json_valid(result) AND json_extract(result,'$.taskId')=? "+
        "AND json_extract(result,'$.runId')=? "+
        "AND json_extract(result,'$.responseObserved')=1 LIMIT 1")
        .get(input.projectId,session,input.taskId,task.runId);
      if(!sent)throw Error('forge_work_accept_provider_receipt_missing');
      if(!this.development.status(input.projectId).available)
        throw Error('forge_development_owner_approval_required');
      const root=this.development.workspaces.taskWorktree(input.projectId,input.taskId);
      if(!root||root.status!=='integrated'||
        root.integratedHeadSha!==input.expectedIntegratedHeadSha)
        throw Error('forge_work_accept_integration_unverified');
      const integrated=this.db.prepare(
        'SELECT result FROM lab_command_receipts WHERE id=? AND project_id=? '+
        "AND workspace_session_id=? AND operation='project_worktree_integrate' "+
        "AND status='succeeded'")
        .get(input.integrationReceiptId,input.projectId,session);
      let item=null;
      try{item=JSON.parse(integrated?.result||'null');}catch{}
      if(item?.taskId!==input.taskId||item.status!=='integrated'||
        item.integratedHeadSha!==root.integratedHeadSha||
        !/^[a-f0-9]{40}$/.test(item.branchHeadSha||'')||
        !Array.isArray(item.verificationReceiptIds)||
        item.verificationReceiptIds.length<1||item.verificationReceiptIds.length>16||
        new Set(item.verificationReceiptIds).size!==item.verificationReceiptIds.length)
        throw Error('forge_work_accept_integration_unverified');
      for(const id of item.verificationReceiptIds){
        const row=this.db.prepare(
          'SELECT result FROM lab_command_receipts WHERE id=? AND project_id=? '+
          "AND workspace_session_id=? AND operation='project_worktree_verify' "+
          "AND status='succeeded'").get(id,input.projectId,session);
        let result=null;
        try{result=JSON.parse(row?.result||'null');}catch{}
        if(result?.taskId!==input.taskId||result.verified!==true||
          result.completed!==true||result.exitCode!==0||
          result.verifiedBranchHeadSha!==item.branchHeadSha)
          throw Error('forge_work_accept_verification_receipt_invalid');
      }
      const previous=this.db.prepare(
        'SELECT c.id FROM lab_command_receipts c WHERE c.project_id=? AND c.workspace_session_id=? '+
        "AND c.operation='work_accept' AND (c.status='succeeded' OR "+
        "EXISTS(SELECT 1 FROM lab_command_active_unresolved u WHERE u.id=c.id)) "+
        "AND json_valid(c.result) AND json_extract(c.result,'$.taskId')=? LIMIT 1")
        .get(input.projectId,session,input.taskId);
      if(previous)throw Error('forge_work_accept_already_requested');
      return {runId:task.runId,integratedHeadSha:root.integratedHeadSha};
    };
    const reserved=this.transaction(()=>{
      this.requireAccess(context,'work_accept',input.projectId);
      const prior=this.db.prepare(
        'SELECT id FROM lab_command_receipts WHERE workspace_session_id=? '+
        'AND actor_id=? AND client_id=? AND request_id=?')
        .get(session,context.actorId,context.clientId,input.requestId);
      if(prior)return this.reserve(context,'work_accept',input);
      const proof=before();
      const command=this.reserve(context,'work_accept',input);
      this.db.prepare(
        "UPDATE lab_command_receipts SET result=? WHERE id=? AND status='running'")
        .run(JSON.stringify({taskId:input.taskId,phase:'testing_integrated_main'}),
          command.commandId);
      return {...command,proof};
    });
    if(reserved.existing)return reserved.existing;
    try {
      const test=await this.development.verifyIntegratedWork(input.projectId,input);
      const accepted=test.verified===true;
      const evidence={...test,taskId:input.taskId,
        sourceRunId:reserved.proof.runId,accepted,
        integrationReceiptId:input.integrationReceiptId,
        testCommandSha256:createHash('sha256').update(input.testCommand).digest('hex'),
        providerMessagesSent:0};
      if(!accepted)return this.transaction(()=>this.finish(reserved.commandId,evidence,'failed'));
      return this.transaction(()=>{
        this.requireAccess(context,'work_accept',input.projectId);
        if(!this.development.status(input.projectId).available)
          throw Error('forge_development_owner_approval_required');
        const task=latest();
        if(task?.runId!==reserved.proof.runId||task.runStatus!=='succeeded'||
          task.taskStatus==='completed')
          throw Error('forge_work_accept_run_changed');
        const changed=this.db.prepare(
          "UPDATE tasks SET status='completed',updated_at=? WHERE id=? AND status!='completed'")
          .run(this.store.now(),input.taskId).changes;
        if(changed!==1)throw Error('forge_work_accept_state_changed');
        return this.finish(reserved.commandId,evidence);
      });
    }catch(error){
      const safe=new Set([
        'forge_work_accept_test_command_invalid',
        'forge_work_accept_head_invalid',
        'forge_work_accept_main_unverified',
        'forge_development_owner_approval_required',
        'forge_development_command_invalid'
      ]);
      try{this.transaction(()=>this.finish(reserved.commandId,{
        taskId:input.taskId,accepted:false,
        reason:safe.has(error?.message)?error.message:'forge_work_accept_outcome_unconfirmed',
        providerMessagesSent:0
      },safe.has(error?.message)?'failed':'uncertain'));}catch{}
      throw error;
    }
  }

  // Never repeat an uncertain terminal command: it may already have changed files.
  async runProjectCommand(context,input) {
    if(!this.development)throw Error('forge_development_unavailable');
    if(input.taskId!==undefined&&input.taskId!==null)this.task(input.projectId,input.taskId,'work');
    const reserved=this.transaction(()=>this.reserve(context,'project_command_run',input));
    if(reserved.existing)return reserved.existing;
    try {
      this.requireAccess(context,'project_command_run',input.projectId);
      this.workClaims.assertTaskMutation(context,input);
      const {claimToken,claimGeneration,...commandInput}=input;
      const result=await this.development.run(commandInput);
      return this.transaction(()=>this.finish(reserved.commandId,result));
    }catch(error) {
      const deterministic=new Set(['forge_development_owner_approval_required',
        'forge_development_command_invalid','forge_development_directory_invalid',
        'forge_workspace_missing_or_moved','forge_workspace_project_unavailable',
        'forge_worktree_task_unprepared','forge_work_claim_not_owned','forge_work_claim_renew_required']);
      try{this.transaction(()=>this.finish(reserved.commandId,{
        reason:deterministic.has(error?.message)?error.message:'forge_development_command_outcome_uncertain',
        externalEffectsVerified:false},deterministic.has(error?.message)?'failed':'uncertain'));}
      catch{}
      throw error;
    }
  }

  // A filesystem effect must reserve its durable command BEFORE writing.
  // A crash or uncertain readback leaves a non-replayable receipt; successful
  // SHA-256 readback is required before reporting completion.
  writeProjectFile(context,input) {
    if(!this.files)throw Error('forge_file_broker_unavailable');
    const reserved=this.transaction(()=>this.reserve(context,'project_file_write',input));
    if(reserved.existing)return reserved.existing;
    try {
      this.requireAccess(context,'project_file_write',input.projectId);
      const taskId=this.scopedTaskId(input);
      this.workClaims.assertTaskMutation(context,input);
      const proof=this.files.write(input.projectId,input.path,input.content,
        input.expectedSha256??null,taskId);
      return this.transaction(()=>this.finish(reserved.commandId,proof));
    }catch(error){
      const deterministic=new Set(['forge_file_path_invalid','forge_file_content_invalid',
        'forge_file_size_limit','forge_file_expected_hash_invalid',
        'forge_file_version_conflict','forge_file_not_found','forge_file_reparse_denied',
        'forge_file_internal_path_denied','forge_workspace_binding_required',
        'forge_worktree_task_unprepared','forge_task_workspace_required',
        'orchestrator_task_unavailable',
        'forge_work_claim_not_owned','forge_work_claim_renew_required']);
      const reason=deterministic.has(error?.message)?error.message:'forge_file_effect_uncertain';
      try{this.transaction(()=>this.finish(reserved.commandId,
        {reason,path:input.path,verified:false},
        deterministic.has(error?.message)?'failed':'uncertain'));}catch{}
      throw error;
    }
  }

  async bindWorkspace(context,input) {
    // Replaying a durable requestId reads its canonical receipt. A historical
    // binding is NOT a current grant: every new bind and every snapshot still
    // revalidates the Runtime authority independently.
    const existing=this.db.prepare(`SELECT id FROM lab_command_receipts WHERE workspace_session_id=?
      AND actor_id=? AND client_id=? AND request_id=?`)
      .get(context.workspaceSessionId,context.actorId,context.clientId,input.requestId);
    if(existing)return this.transaction(()=>{
      const reserved=this.reserve(context,'workspace_bind',input);
      if(!reserved.existing)throw Error('orchestrator_command_state_conflict');
      return reserved.existing;
    });
    await this.workspace.authorizeBinding(context,input,()=>this.requireAccess(context,'workspace_bind',input.projectId));
    return this.transaction(()=>{
      this.requireAccess(context,'workspace_bind',input.projectId);
      const reserved=this.reserve(context,'workspace_bind',input);
      if(reserved.existing)return reserved.existing;
      return this.finish(reserved.commandId,this.workspace.bindVerified(context,input));
    });
  }

  read(context,operation,input) {
    if(operation==='proposals_list') {
      const owner=this.orchestrator(input.projectId,input.orchestratorId);
      const proposals=[];
      const rows=this.db.prepare(`SELECT id,payload,status,result FROM action_ledger WHERE task_id=?
        AND action_type='orchestrator.work-proposal' AND status IN ('pending','succeeded') ORDER BY created_at DESC,id LIMIT 50`)
        .all(owner.chat_task_id);
      for(const row of rows) {
        // Keep historical action bytes intact, but never let one corrupted
        // proposal/result hide valid independent approvals in this read model.
        // No recovery, approval or task mutation happens during listing.
        let payload;
        try {payload=JSON.parse(row.payload);} catch {continue;}
        if(payload?.actorId!==context.actorId||payload?.clientId!==context.clientId||
          payload?.projectId!==input.projectId||payload?.orchestratorId!==input.orchestratorId)
          continue;
        let proposal;
        try {proposal=validateWorkProposal(payload.proposal);} catch {continue;}
        if(row.status==='pending') {
          if(!this.db.prepare(`SELECT 1 FROM approval_ledger WHERE action_id=? AND task_id=?
            AND status='pending' LIMIT 1`).get(row.id,owner.chat_task_id))continue;
          proposals.push({actionId:row.id,status:'pending',...proposal});
          continue;
        }
        let result;
        try {result=row.result?JSON.parse(row.result):null;} catch {continue;}
        if(result?.approved!==true||typeof result.taskId!=='string')continue;
        if(!this.db.prepare(`SELECT 1 FROM approval_ledger WHERE action_id=? AND task_id=?
          AND status='approved' LIMIT 1`).get(row.id,owner.chat_task_id))continue;
        const task=this.preparedTask(input.projectId,input.orchestratorId,result.taskId);
        if(!task||!task.draft.trim()||task.has_messages||task.has_runs||task.has_send)continue;
        proposals.push({actionId:row.id,status:'prepared',...proposal,
          taskId:task.id,title:task.title,content:task.draft,draftRevision:task.draft_revision});
      }
      return {proposals};
    }
    if(operation==='workspace_status')return this.workspace.status(context,input.projectId);
    if(operation==='forge_discover') {
      const contextView=this.read(context,'project_context',input);
      return forgeMcpDiscovery(contextView);
    }
    if(operation==='project_context') {
      // The existing session authorization has already checked projectId.
      // Project title/objective are DATA, never new tool instructions.
      const project=this.db.prepare('SELECT name,objective,repository_url FROM lab_projects WHERE id=? AND workspace_session_id=?')
        .get(input.projectId,context.workspaceSessionId);
      if(!project)throw Error('orchestrator_project_unavailable');
      const last=this.db.prepare(`SELECT r.status FROM runs r
        JOIN lab_task_bindings b ON b.task_id=r.task_id AND b.kind='work'
        WHERE b.project_id=? ORDER BY r.rowid DESC LIMIT 1`).get(input.projectId);
      const total=this.db.prepare(`SELECT COUNT(*) AS n FROM lab_task_bindings
        WHERE project_id=? AND kind='work'`).get(input.projectId).n;
      const dedicated=readDedicatedForgeProject(this.store)!==null;
      const view=forgeProjectContext({projectId:input.projectId,project,
        workspace:this.workspace.status(context,input.projectId),workCount:total,
        latestRunStatus:last?.status||null});
      return {...view,
        ...(dedicated?{limitations:{...view.limitations,
          physicalFileAccess:'forge_repository_owner_port_and_grant_required'}}:{}),
        projectMissions:forgeProjectMissionsView(this.store,input.projectId),
        development:dedicated?{projectId:input.projectId,available:false,
          nativeProcessExecution:false,
          reason:'dedicated_repository_owner_port_required'}:
          this.development?.status(input.projectId)??
            {available:false,reason:'native_owner_port_unavailable'},
        appPrivateFiles:dedicated?{available:false,verified:false,
          mode:'requires_repository_scoped_mcp',readAvailable:false,
          writeAvailable:false}:
          this.files?.status(input.projectId)||
            {available:false,mode:'capability_unavailable'}};
    }
    if(operation==='project_memory')return forgeProjectMemoryView(this.store,input.projectId);
    if(operation==='project_administrator_snapshot')return forgeProjectAdministratorView(this.store,input.projectId);
    if(operation==='project_activity')return forgeProjectActivityView(this.store,input.projectId);
    if(operation==='work_repositories'){
      const dedicated=readDedicatedForgeProject(this.store);
      if(!dedicated||dedicated.projectId!==input.projectId)
        throw Error('forge_dedicated_project_required');
      this.task(input.projectId,input.taskId,'work');
      return {schema:'ordax.forge.work-repositories/1',
        projectId:input.projectId,taskId:input.taskId,
        repositories:this.db.prepare(
          'SELECT repository FROM forge_work_repository_scope WHERE task_id=? ORDER BY repository'
        ).all(input.taskId).map(item=>item.repository),
        executionAuthorized:false,filesystemAccessGranted:false,
        multiRepositoryWorktreeExecutionAvailable:false};
    }
    if(operation==='ordax_execution_preflight'){
      const scope=readDedicatedForgeProject(this.store);
      if(!scope||scope.projectId!==input.projectId)
        throw Error('forge_dedicated_project_required');
      this.task(input.projectId,input.taskId,'work');
      // The immutable Task/repository assignment is the only Forge-local
      // authority for WHICH repository the Task may discuss. It cannot grant
      // Git access or select a physical Runtime target.
      const membership=this.db.prepare(
        'SELECT 1 FROM forge_work_repository_scope WHERE project_id=? AND task_id=? AND repository=? LIMIT 1'
      ).get(input.projectId,input.taskId,input.repository);
      if(!membership)throw Error('forge_task_repository_scope_not_assigned');
      const make=(reason,details={})=>({
        schema:'ordax.forge.execution-preflight/1',
        projectId:input.projectId,taskId:input.taskId,
        repository:input.repository,deviceId:input.deviceId,
        action:input.action,reason,
        deviceSelectionVerified:false,
        runtimeSessionAttested:false,
        delegatedTransportAvailable:false,
        grantVisible:false,executionAuthorized:false,
        actionDispatched:false,receiptCreated:false,...details
      });
      const catalog=this.repositoryCatalogPort?.read();
      if(catalog?.available!==true||catalog.checkedOrigin!==true||
        !catalog.repositories.some(r=>r.repo===input.repository))
        return make('canonical_repository_ownership_unavailable');
      const port=this.ordaxProductMcp;
      if(typeof port?.devices!=='function')
        return make('forge_native_oauth_port_unavailable');
      const grantField={
        repository_catalog:'repositoryCatalogReadGranted',
        terminal:'nativeTerminalGrantVisible',
        text_read:'nativeTextReadGrantVisible',
        text_write:'nativeTextWriteGrantVisible'
      }[input.action];
      const requiredProfile={
        repository_catalog:'repository-catalog-read',
        terminal:'device-native-terminal',
        text_read:'computer-text-edit',
        text_write:'computer-text-edit'
      }[input.action];
      return Promise.resolve(port.devices()).then(snapshot=>{
        if(snapshot?.available!==true)return make(
          snapshot?.reason||'ordax_product_mcp_unavailable',{requiredProfile});
        const device=snapshot.devices?.find(t=>t.deviceId===input.deviceId);
        if(!device)return make('device_not_visible_to_forge_oauth',{requiredProfile});
        const grantVisible=device[grantField]===true;
        return make(!device.reportedOnline?'device_reported_offline':
          !grantVisible?'owner_capability_grant_required':
          'native_forge_runtime_session_binding_required',{
            requiredProfile,grantVisible,reportedOnline:device.reportedOnline===true,
            ownerAction:!grantVisible?'authorize_in_ordax_owner_permissions':
              'native_runtime_session_attestation_required'
          });
      });
    }
    if(operation==='ordax_devices'){
      const scope=readDedicatedForgeProject(this.store);
      if(!scope||scope.projectId!==input.projectId)
        throw Error('forge_dedicated_project_required');
      return this.ordaxProductMcp?.devices()??{
        schema:'ordax.forge.native-product-mcp/1',available:false,
        reason:'forge_native_oauth_port_unavailable',
        executionAuthorized:false,deviceBindingCreated:false,
        requiredProfile:'repository-catalog-read',devices:[]
      };
    }
    if(operation==='repository_inspect'||operation==='repository_file_read'||operation==='repository_files_list'){
      if(!this.repositoryReadPort)
        throw Error('forge_repository_owner_port_and_grant_required');
      this.task(input.projectId,input.taskId,'work');
      this.workClaims.assertActiveTaskLease(context,input);
      const read=operation==='repository_inspect'
        ?this.repositoryReadPort.inspect(input)
        :operation==='repository_file_read'
          ?this.repositoryReadPort.read(input)
          :this.repositoryReadPort.list(input);
      // A grant check may be asynchronous. Revalidate the same claim before
      // revealing content, so a handoff/revocation during I/O never leaks it.
      return Promise.resolve(read).then(result=>{
        this.workClaims.assertActiveTaskLease(context,input);
        return result;
      });
    }
    if(operation==='project_repositories'){
      const scope=readDedicatedForgeProject(this.store);
      if(!scope||scope.projectId!==input.projectId)
        return {schema:'ordax.forge.repository-catalog/1',available:false,
          reason:'dedicated_ordax_project_required',repositories:[],executionAuthorized:false};
      return this.repositoryCatalogPort?.read()??{
        schema:'ordax.forge.repository-catalog/1',available:false,
        reason:'ordax_owner_repository_catalog_port_unavailable',
        repositories:[],executionAuthorized:false};
    }
    if(operation==='project_files_status'){
      if(readDedicatedForgeProject(this.store))return {
        projectId:input.projectId,available:false,
        reason:'dedicated_repository_owner_port_required',
        mode:'requires_repository_scoped_mcp'};
      const taskId=this.scopedTaskId(input);
      return this.files?.status(input.projectId,taskId)||{
        projectId:input.projectId,available:false,mode:'capability_unavailable'};
    }
    if(operation==='project_files_list'){
      if(!this.files)throw Error('forge_file_broker_unavailable');
      const taskId=this.scopedTaskId(input);
      return this.files.list(input.projectId,input.directory||'',taskId);
    }
    if(operation==='project_file_read'){
      if(!this.files)throw Error('forge_file_broker_unavailable');
      const taskId=this.scopedTaskId(input);
      return this.files.read(input.projectId,input.path,taskId);
    }
    if(operation==='project_handoff'){
      const handoff=forgeProjectHandoffView(this.store,input.projectId,{taskId:input.taskId||null});
      // One canonical read: history plus the live task dependency graph.
      // Neither a candidate nor a GPT response grants a provider send.
      let plan;
      try{plan=this.projectPlan(input.projectId,4);}
      catch(error){
        if(error?.message!=='orchestrator_work_plan_too_large')throw error;
        // Do not break read-only history for projects beyond planning bounds.
        // Never select a Task from a truncated graph.
        return {...handoff,workPlan:{projectId:input.projectId,available:false,
          reason:'orchestrator_work_plan_too_large',automaticDispatchAllowed:false},
          continuation:{schema:'ordax.forge.continuation-decision/1',
            projectId:input.projectId,taskId:input.taskId||null,
            blockedReasons:['work_plan_too_large'],automaticDispatchAllowed:false,
            taskLeaseGranted:false,providerMessagesSent:0,nextStep:'reconcile_blockers'}};
      }
      return {...handoff,workPlan:plan,
        continuation:forgeContinuationDecision({handoff,plan,taskId:input.taskId||null})};
    }
    if(operation==='continuity_status') {
      this.orchestrator(input.projectId,input.orchestratorId);
      return this.continuation.status(input.projectId,input.orchestratorId);
    }
    if(operation==='status'){
      // One bounded, read-only grouping from the existing receipt ledger. A
      // global session count must not be presented as this project's count.
      const uncertainRows=this.db.prepare(`SELECT project_id AS projectId,COUNT(*) AS count
        FROM lab_command_active_unresolved WHERE status='uncertain' AND
          workspace_session_id=? AND actor_id=? AND client_id=?
        GROUP BY project_id ORDER BY project_id`)
        .all(context.workspaceSessionId,context.actorId,context.clientId);
      const uncertainByProject=uncertainRows.filter(row=>{
        if(!row.projectId)return false;
        try{return this.authorize({context,operation:'projects_list',projectId:row.projectId})===true;}
        catch{return false;}
      }).map(row=>({projectId:row.projectId,count:Number(row.count)}));
      const activeScope=readDedicatedForgeProject(this.store);
      const visible=new Set(dedicatedForgeMcpOperations(
        this.store,ORCHESTRATOR_TOOLS.map(t=>t.operation)));
      return {
        contract:ORCHESTRATOR_CONTRACT,engine:'passive-app',
        tools:ORCHESTRATOR_TOOLS.filter(t=>visible.has(t.operation)).map(t=>t.name),
        ...(activeScope?{projectScope:activeScope}:{}),
        externalTransport:'forge_mcp_only',autonomousExecution:false,
        autonomousAnalysisAvailable:false,
        coordinatorDraftCommitAvailable:true,
        workspacePortAvailable:this.workspace.available(),
        repositoryPortAvailable:this.repository.available(),
        continuationEnabled:0,
        analysisAvailable:false,analysisMode:'gpt_via_forge_mcp',
        providerExecutionAvailable:false,
        activeRuns:Number(this.db.prepare("SELECT COUNT(*) n FROM runs WHERE status='running'").get().n),
        uncertainCommands:uncertainRows.reduce((total,row)=>total+Number(row.count),0),
        uncertainByProject
      };
    }
    if(operation==='projects_list'){
      const dedicated=readDedicatedForgeProject(this.store);
      return {projects:this.db.prepare(
        'SELECT id,name,objective,repository_url,created_at,observation_requested FROM lab_projects WHERE workspace_session_id=? ORDER BY created_at,id LIMIT 200')
        .all(context.workspaceSessionId)
        .filter(row=>(!dedicated||row.id===dedicated.projectId)&&
          this.authorize({context,operation,projectId:row.id})===true),
        ...(dedicated?{projectScope:dedicated}:{})};
    }
    if(operation==='project_preflight') {
      // Read-only, project-scoped projection of the canonical Store. A saved
      // repository URL is NOT authenticated GitHub access; an injected Runtime
      // port is NOT a project resource grant. Never claim either as verified.
      const owner=this.orchestrator(input.projectId,input.orchestratorId);
      const project=this.db.prepare('SELECT repository_url,observation_requested FROM lab_projects WHERE id=? AND workspace_session_id=?')
        .get(input.projectId,context.workspaceSessionId);
      const work=this.db.prepare(`SELECT COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN EXISTS(SELECT 1 FROM runs r WHERE r.task_id=t.id) THEN 1 ELSE 0 END),0) AS started
        FROM tasks t JOIN lab_task_bindings b ON b.task_id=t.id
        WHERE b.project_id=? AND b.orchestrator_id=? AND b.kind='work'
          AND t.workspace_session_id=?`)
        .get(input.projectId,input.orchestratorId,context.workspaceSessionId);
      // Project-scoped command receipts are the source of truth for whether
      // the local app-owned analysis was attempted. The result body is deliberately
      // excluded from this read model.
      const analysis=this.db.prepare(`SELECT COUNT(*) AS attempts,
        COALESCE(SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END),0) AS completed,
        (SELECT status FROM lab_command_receipts WHERE project_id=? AND operation='orchestrator_analyze'
          ORDER BY updated_at DESC,id DESC LIMIT 1) AS last_status,
        (SELECT updated_at FROM lab_command_receipts WHERE project_id=? AND operation='orchestrator_analyze'
          ORDER BY updated_at DESC,id DESC LIMIT 1) AS last_attempt_at
        FROM lab_command_receipts WHERE project_id=? AND operation='orchestrator_analyze'`)
        .get(input.projectId,input.projectId,input.projectId);
      // Any outstanding send in this project is relevant: parallel owners can
      // share a repo, and missing/invalid target receipts are fail-closed.
      const unresolved=this.db.prepare(`SELECT COUNT(*) AS total
        FROM lab_command_receipts
        WHERE project_id=? AND operation IN ('work_send','proposal_send')
          AND status IN ('running','uncertain')`).get(input.projectId);
      const blockers=[];
      if(owner.status!=='ready')blockers.push('orchestrator_paused');
      if(work.total===0)blockers.push('no_registered_work');
      if(unresolved.total>0)blockers.push('work_receipts_unresolved');
      return {
        schema:'ordax.orchestrator.project-preflight/2',
        projectId:input.projectId,orchestratorId:input.orchestratorId,
        observedAt:this.store.now(),
        provenance:{source:'app_sqlite',externalObservation:false},
        repository:{urlRegistered:Boolean(project?.repository_url),authenticatedRead:'unavailable',
          lastHistoricalHead:project?.repository_url
            ?this.historicalRepositoryHead(input.projectId,project.repository_url):null},
        observation:{requested:project.observation_requested===1,active:false,
          state:project.observation_requested===1?'awaiting_external_authority':'paused',
          automaticGptDispatchAllowed:false,backgroundSchedulerActive:false},
        runtime:{grantVerified:false},
        analysisEngine:{state:'mcp_only',available:false,mode:'gpt_via_forge_mcp',externalModelUsed:false},
        work:{registered:Number(work.total),started:Number(work.started),unresolvedSends:Number(unresolved.total)},
        analysis:{attempts:Number(analysis.attempts),completed:Number(analysis.completed),
          lastStatus:analysis.last_status,lastAttemptAt:analysis.last_attempt_at},
        gates:{recordedWorkAnalysisEligible:blockers.length===0,
          githubObservationVerified:false,automaticGptDispatchAllowed:false,headlessExecutionVerified:false},
        blockers
      };
    }
    if(operation==='orchestrators_list')return {orchestrators:this.db.prepare(
      'SELECT * FROM lab_orchestrators WHERE project_id=? ORDER BY created_at,id LIMIT 100').all(input.projectId)};
    if(operation==='work_plan')return {plan:this.projectPlan(input.projectId,input.maxParallel||4)};
    if(operation==='work_list'){
      const accepted=forgeVerifiedWorkAcceptances(this.db,input.projectId,context.workspaceSessionId);
      return {works:this.db.prepare(`SELECT t.id,t.title,t.status,t.updated_at,
      b.orchestrator_id,(SELECT COUNT(*) FROM task_conversations c WHERE c.task_id=t.id) provider_segments,
      (SELECT r.status FROM runs r WHERE r.task_id=t.id ORDER BY r.rowid DESC LIMIT 1) latest_run_status,
      (SELECT r.started_at FROM runs r WHERE r.task_id=t.id ORDER BY r.rowid DESC LIMIT 1) latest_started_at,
      (SELECT r.heartbeat_at FROM runs r WHERE r.task_id=t.id ORDER BY r.rowid DESC LIMIT 1) latest_heartbeat_at,
      (SELECT COUNT(*) FROM runs r WHERE r.task_id=t.id AND r.status='running') running_runs
      FROM tasks t JOIN lab_task_bindings b ON b.task_id=t.id
      WHERE b.project_id=? AND b.kind='work' AND (? IS NULL OR b.orchestrator_id=?)
      AND t.workspace_session_id=? ORDER BY t.updated_at DESC,t.id LIMIT 200`)
      .all(input.projectId,input.orchestratorId||null,input.orchestratorId||null,context.workspaceSessionId)
      .map(work=>{
        const claim=this.workClaims.snapshot(input.projectId,work.id,context.workspaceSessionId);
        const observed=claim?forgeMcpWorkObservation(this.db,{
          projectId:input.projectId,taskId:work.id,operation:'work_claim',
          claimGeneration:claim.generation
        }):null;
        const claimObservation=observed||{
          mcpToolCallObserved:false,mcpIngress:null,gatewayLeaseStartObserved:false,
          gatewayRequestId:null,gatewayAttemptId:null,gatewayAgentInstanceId:null,
          gptRunIdentityVerified:false,chatIdentityVerified:false
        };
        return {
          ...work,
          execution:workExecutionSummary([{...work,monitor:this.monitor(work,[{
            status:work.latest_run_status,started_at:work.latest_started_at,
            heartbeat_at:work.latest_heartbeat_at
          }],input.projectId)}])[0],
          dependsOn:this.db.prepare('SELECT prerequisite_id FROM lab_work_dependencies WHERE project_id=? AND task_id=? ORDER BY prerequisite_id')
            .all(input.projectId,work.id).map(row=>row.prerequisite_id),
          claim:claim?{...claim,...claimObservation}:null,
          acceptanceEvidence:accepted.get(work.id)||null,
          completionVerified:accepted.has(work.id)
        };
      })};
    }
    if(operation==='work_get') {
      const task=this.task(input.projectId,input.taskId);
      // Expose only revision/readiness, never the unsubmitted prompt. Agents
      // can prepare the next draft with CAS without racing the Electron editor.
      const draft=this.store.getTaskDraft(task.id);
      const draftState={revision:draft.draft_revision,
        prepared:typeof draft.draft==='string'&&Boolean(draft.draft.trim())};
      const runs=this.db.prepare(`SELECT id,status,started_at,completed_at,heartbeat_at
        FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 10`).all(task.id);
      return {...task,draftState,runs,
        claim:this.workClaims.snapshot(input.projectId,task.id,context.workspaceSessionId),
        latestRunReview:task.kind==='work'&&runs[0]?.status==='succeeded'
          ?this.runReviewReceipt(context,input.projectId,runs[0].id):null,
        conversations:this.store.listConversations(task.id).slice(-50),
        pendingApprovals:this.store.pendingApprovals(task.id).map(a=>({id:a.id,status:a.status,actionId:a.action_id})),
        monitor:this.monitor(task,runs,input.projectId)};
    }
    if(operation==='work_messages') {
      this.task(input.projectId,input.taskId);
      const page=this.store.messagesPage(input.taskId,{before:input.before||null,limit:input.limit||50});
      return {...page,messages:page.messages.map(m=>({id:m.id,role:m.role,content:m.content,created_at:m.created_at,author_source:m.author_source}))};
    }
    if(operation==='command_get')return this.getReceipt(context,input.commandId);
    throw Error('orchestrator_unknown_operation');
  }

  // An external GPT answer is not a delivered site. Only the verified
  // file attached to that exact completed Run can produce this one real
  // assistant message in the project conversation. Idempotent across
  // renderer redraws, recovery and repeated notifications.
  recordSiteDelivery({taskId,runId,verified=false,sha256=null}={}){
    if(typeof taskId!=='string'||typeof runId!=='string')return false;
    return this.transaction(()=>{
      const owner=this.db.prepare(`SELECT o.chat_task_id AS chatTaskId
        FROM lab_task_bindings b JOIN lab_orchestrators o
          ON o.id=b.orchestrator_id AND o.project_id=b.project_id
        JOIN runs r ON r.task_id=b.task_id AND r.status='succeeded'
        WHERE b.task_id=? AND b.kind='work' AND r.id=?
        AND o.chat_task_id<>b.task_id`).get(taskId,runId);
      if(!owner||!this.db.prepare('SELECT 1 FROM conversation_completed_runs WHERE task_id=? AND run_id=?')
        .get(taskId,runId))return false;
      if(this.db.prepare(`SELECT 1 FROM events WHERE task_id=? AND kind='orchestrator.site_delivery'
          AND json_extract(payload,'$.run_id')=? LIMIT 1`).get(owner.chatTaskId,runId))
        return false;
      const answer=this.db.prepare("SELECT id FROM messages WHERE task_id=? AND role='assistant' ORDER BY sequence DESC LIMIT 1")
        .get(taskId);
      const asset=answer&&this.db.prepare(`SELECT id,sha256 FROM message_assets
        WHERE task_id=? AND message_id=? AND kind='file'
        AND mime_type='text/html' ORDER BY rowid DESC LIMIT 1`).get(taskId,answer.id);
      const delivered=verified===true&&asset&&asset.sha256===sha256;
      const response=delivered
        ?'O site foi atualizado e o arquivo está verificado na área de resultados. Você já pode conferir a prévia à direita. Ainda não foi publicado.'
        :'Recebi a resposta do trabalho, mas ainda não consegui confirmar um novo arquivo para a prévia. Mantive a última versão verificada, sem publicar ou repetir o pedido.';
      this.store.appendMessage(owner.chatTaskId,'assistant',response);
      this.store.event(owner.chatTaskId,'orchestrator.site_delivery',{
        run_id:runId,task_id:taskId,artifact_verified:Boolean(delivered),
        ...(delivered?{asset_id:asset.id,sha256:asset.sha256}:{})
      });
      return Boolean(delivered);
    });
  }

  monitor(task,runs,projectId) {
    const command=this.db.prepare(`SELECT status FROM lab_command_receipt_scope
      WHERE task_id=? OR (project_id=? AND unknown_work_target=1)
      ORDER BY CASE WHEN status IN ('uncertain','running') THEN 0 ELSE 1 END,
        receipt_rowid DESC LIMIT 1`).get(task.id,projectId);
    if(command?.status==='uncertain')return {state:'reconciliation_required',mayAutomaticallySend:false};
    if(command?.status==='running')return {state:'running',mayAutomaticallySend:false};
    if(command?.status==='failed')return {state:'failed',retryAllowed:true,mayAutomaticallySend:false};
    const current=runs[0];
    if(current?.status==='running') {
      const lastHeartbeatAt=current.heartbeat_at||current.started_at;
      const age=Date.parse(this.store.now())-Date.parse(lastHeartbeatAt);
      return {state:!Number.isFinite(age)||age>30000?'execution_unresponsive':'running',
        lastHeartbeatAt,mayAutomaticallySend:false};
    }
    if(current?.status==='interrupted'||listTaskUncertainTransportRuns(this.store,task.id).length)
      return {state:'reconciliation_required',mayAutomaticallySend:false};
    if(current?.status==='failed')return {state:'failed',retryAllowed:true,mayAutomaticallySend:false};
    return {state:task.status==='completed'?'completed':'awaiting_instruction',mayAutomaticallySend:false};
  }

  projectPlan(projectId,maxParallel=4) {
      // Query all scoped works: dependencies can span several orchestrators of
      // the SAME project. Never silently omit dependencies through pagination.
      const works=this.db.prepare(`SELECT t.id,t.status,
        (SELECT r.status FROM runs r WHERE r.task_id=t.id ORDER BY r.rowid DESC LIMIT 1) latest_run_status,
        (SELECT r.started_at FROM runs r WHERE r.task_id=t.id ORDER BY r.rowid DESC LIMIT 1) latest_started_at,
        (SELECT r.heartbeat_at FROM runs r WHERE r.task_id=t.id ORDER BY r.rowid DESC LIMIT 1) latest_heartbeat_at,
        (SELECT COUNT(*) FROM runs r WHERE r.task_id=t.id AND r.status='running') running_runs
        FROM tasks t JOIN lab_task_bindings b ON b.task_id=t.id
        WHERE b.project_id=? AND b.kind='work' AND t.workspace_session_id=?
        -- Stable creation-order tie-breaker: random Task IDs must never
        -- change DAG readiness order when timestamps share a clock tick.
        ORDER BY t.created_at,t.rowid LIMIT 257`)
        .all(projectId,this.store.getWorkspaceSession().id);
      if(works.length>256)throw Error('orchestrator_work_plan_too_large');
      const edges=this.db.prepare(`SELECT project_id,task_id,prerequisite_id
        FROM lab_work_dependencies WHERE project_id=? ORDER BY task_id,prerequisite_id`)
        .all(projectId);
      const acceptances=forgeVerifiedWorkAcceptances(this.db,projectId,
        this.store.getWorkspaceSession().id);
      const planning=projectWorkPlan({
        projectId:projectId,maxParallel:maxParallel,edges,
        works:works.map(w=>({...w,acceptanceVerified:acceptances.has(w.id),
          monitor:this.monitor(w,[{
          status:w.latest_run_status,started_at:w.latest_started_at,
          heartbeat_at:w.latest_heartbeat_at
        }],projectId)}))
      });
      return Object.freeze({...planning,
        coordinationMode:'task_claims',
        claimCandidates:Object.freeze([...planning.candidates]),
        automaticDispatchAllowed:false
      });
  }

  // One response-specific snapshot from the existing Store. A simulated Run
  // without immutable provider provenance is not eligible for semantic review.
  reviewableGPTResult(projectId,orchestratorId,runId) {
    const session=this.store.getWorkspaceSession();
    const row=this.db.prepare(`SELECT r.id,r.task_id,r.status,t.title,t.chat_url
      FROM runs r JOIN tasks t ON t.id=r.task_id
      JOIN lab_task_bindings b ON b.task_id=t.id AND b.kind='work'
      WHERE r.id=? AND r.status='succeeded' AND t.workspace_session_id=?
        AND b.project_id=? AND b.orchestrator_id=?`)
      .get(runId,session?.id,projectId,orchestratorId);
    if(!row||!/^https:\/\/chatgpt\.com\/c\//.test(row.chat_url||''))return null;
    if(this.db.prepare('SELECT id FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 1')
      .get(row.task_id)?.id!==runId)return null;
    const confirmed=this.db.prepare('SELECT 1 FROM conversation_completed_runs WHERE run_id=? AND task_id=?')
      .get(runId,row.task_id);
    if(!confirmed)return null;
    const messages=this.db.prepare(`SELECT id,role,content FROM messages
      WHERE task_id=? AND role IN ('user','assistant') ORDER BY rowid DESC LIMIT 2`)
      .all(row.task_id).reverse();
    if(messages.length!==2||messages[0].role!=='user'||messages[1].role!=='assistant'||
       typeof messages[1].content!=='string'||messages[1].content.trim().length<20)return null;
    // Reuse the canonical, message-bound delivery receipt verifier. A bare
    // event of the same type is not trustworthy provenance for another turn.
    const provenance=findProviderSubmissionProvenance({
      store:this.store,taskId:row.task_id,chatUrl:row.chat_url,messageId:messages[0].id
    });
    if(provenance?.runId!==runId||provenance.evidenceKind!=='delivery_receipt')return null;
    const answer=messages[1].content;
    // Start and conclusion are provided separately so a long technical answer
    // cannot push the actual outcome beyond the model's bounded input window.
    const head=redactOrchestratorAnalysisText(answer.slice(0,1100),1100);
    const tail=answer.length>1900?redactOrchestratorAnalysisText(answer.slice(-950),950):'';
    const observedAnswer=head+(tail?'\n[trecho final da mesma resposta]\n'+tail:'');
    return {runId,taskId:row.task_id,title:redactOrchestratorAnalysisText(row.title,140),
      userText:redactOrchestratorAnalysisText(messages[0].content,1000),
      observedAnswer,head,tail,responseTruncated:answer.length>1900};
  }

  analysisContext(projectId,orchestratorId) {
    const owner=this.orchestrator(projectId,orchestratorId);
    const project=this.db.prepare(`SELECT name,objective,repository_url FROM lab_projects
      WHERE id=? AND workspace_session_id=?`).get(projectId,this.store.getWorkspaceSession().id);
    if(!project)throw Error('orchestrator_project_unavailable');

    // The same Store powers the UI, coordinator and authenticated executor.
    // Cover many work fronts without copying their full conversation histories.
    // Never expose the titles or IDs of another coordinator's private works.
    const totalWorkCount=this.db.prepare(`SELECT COUNT(*) n FROM tasks t
      JOIN lab_task_bindings b ON b.task_id=t.id
      WHERE b.project_id=? AND b.orchestrator_id=? AND b.kind='work'
      AND t.workspace_session_id=?`)
      .get(projectId,orchestratorId,this.store.getWorkspaceSession().id).n;
    const overviewRows=this.db.prepare(`SELECT t.id,t.title,t.status,t.updated_at,
      (SELECT COUNT(*) FROM task_conversations c WHERE c.task_id=t.id) provider_segments,
      (SELECT r.status FROM runs r WHERE r.task_id=t.id ORDER BY r.rowid DESC LIMIT 1) last_run_status
      FROM tasks t JOIN lab_task_bindings b ON b.task_id=t.id
      WHERE b.project_id=? AND b.orchestrator_id=? AND b.kind='work'
        AND t.workspace_session_id=? ORDER BY t.updated_at DESC,t.id LIMIT 257`)
      .all(projectId,orchestratorId,this.store.getWorkspaceSession().id);
    const ownerIds=new Set(overviewRows.map(row=>row.id));

    // The project DAG is advisory, never an authorization to submit messages.
    // Preserve project-wide dependencies internally but expose only THIS
    // project's scoped work to the app-owned analysis.
    let planning={state:'unavailable',automaticDispatchAllowed:false,qualityCertified:false};
    let plan=null;
    try {
      plan=this.projectPlan(projectId,4);
      const owned=plan.workers.filter(worker=>ownerIds.has(worker.taskId));
      planning={state:'available',
        candidateTaskIds:plan.candidates.filter(id=>ownerIds.has(id)).slice(0,8),
        waitingCount:plan.waiting.filter(id=>ownerIds.has(id)).length,
        blockedCount:plan.blocked.filter(id=>ownerIds.has(id)).length,
        verificationRequiredCount:plan.verificationRequired.filter(id=>ownerIds.has(id)).length,
        inFlight:owned.filter(worker=>worker.state==='running').length,
        workCount:totalWorkCount,
        coordinationMode:'task_claims',
        claimCandidateCount:plan.claimCandidates.filter(id=>ownerIds.has(id)).length,
        automaticDispatchAllowed:false,qualityCertified:false};
    }catch(error){
      if(error?.message!=='orchestrator_work_plan_too_large')throw error;
      planning={state:'scope_too_large',automaticDispatchAllowed:false,qualityCertified:false};
    }
    const candidate=new Set(plan?.candidates||[]);
    const waiting=new Set(plan?.waiting||[]);
    const blocked=new Set(plan?.blocked||[]);
    const states=new Map((plan?.workers||[]).map(worker=>[worker.taskId,worker.state]));
    const readiness=id=>blocked.has(id)?'blocked':waiting.has(id)?'waiting':
      candidate.has(id)?'candidate':states.get(id)||'unavailable';
    // Prioritize reviews and active work, then ready/waiting tasks. The rich
    // history remains capped at four works with five messages each; the wider
    // overview has no message contents and no provider authority.
    const priority=row=>{
      const state=readiness(row.id);
      return state==='uncertain'?0:state==='failed'?1:state==='running'?2:
        state==='blocked'?3:state==='candidate'?4:state==='waiting'?5:6;
    };
    const ordered=[...overviewRows].sort((a,b)=>priority(a)-priority(b)||
      String(b.updated_at).localeCompare(String(a.updated_at))||a.id.localeCompare(b.id));
    const rows=ordered.slice(0,4);

    // Coordinator evidence is read from the same bounded owner ports and
    // canonical receipts. It contains hashes/statuses only, never arbitrary
    // file contents, and cached Git metadata is explicitly historical.
    let workspaceEvidence={available:false,entries:[],truncated:false};
    if(this.files)try{
      const root=this.files.list(projectId,'');
      const entries=[];
      for(const entry of (root.entries||[]).slice(0,32)){
        if(entry.kind==='file'){
          const proof=this.files.read(projectId,entry.name);
          entries.push({path:entry.name,kind:'file',bytes:proof.bytes,sha256:proof.sha256});
        }else entries.push({path:entry.name,kind:entry.kind});
      }
      workspaceEvidence={available:true,entries,truncated:root.truncated===true||
        (root.entries||[]).length>entries.length};
    }catch(error){
      workspaceEvidence={available:false,entries:[],truncated:false,
        reason:String(error?.message||'workspace_unavailable').slice(0,80)};
    }
    const commandEvidence=this.db.prepare(`SELECT operation,status,updated_at,
      CASE WHEN json_valid(result) THEN json_extract(result,'$.exitCode') END exit_code,
      CASE WHEN json_valid(result) THEN json_extract(result,'$.commandOutcome') END command_outcome
      FROM lab_command_receipts
      WHERE project_id=? AND operation='project_command_run'
      ORDER BY rowid DESC LIMIT 12`).all(projectId);
    const receiptSummary=this.db.prepare(`SELECT
      COUNT(*) total,
      COALESCE(SUM(CASE WHEN status='running' THEN 1 ELSE 0 END),0) running,
      COALESCE(SUM(CASE WHEN status='uncertain' THEN 1 ELSE 0 END),0) uncertain,
      COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) failed
      FROM lab_command_receipts WHERE project_id=?`).get(projectId);
    const repositoryEvidence=project.repository_url
      ?this.historicalRepositoryHead(projectId,project.repository_url):null;
    const rowsWithEvidence=rows;
    return {
      planning,
      project:{name:redactOrchestratorAnalysisText(project.name,160),objective:redactOrchestratorAnalysisText(project.objective,600)},
      orchestrator:{name:redactOrchestratorAnalysisText(owner.name,160),mission:redactOrchestratorAnalysisText(owner.mission,800)},
      scope:{includedWorkCount:rows.length,workLimit:4,messageLimitPerWork:5,
        overviewCount:Math.min(ordered.length,32),overviewLimit:32,totalWorkCount,
        overviewTruncated:totalWorkCount>32},
      workOverview:ordered.slice(0,32).map(row=>({
        title:redactOrchestratorAnalysisText(row.title,180),
        status:row.status,latestRunStatus:row.last_run_status,
        readiness:readiness(row.id),updatedAt:row.updated_at
      })),
      evidence:{
        workspace:workspaceEvidence,
        commands:commandEvidence.map(row=>({operation:row.operation,status:row.status,
          updatedAt:row.updated_at,exitCode:row.exit_code,commandOutcome:row.command_outcome})),
        receipts:{total:Number(receiptSummary.total||0),running:Number(receiptSummary.running||0),
          uncertain:Number(receiptSummary.uncertain||0),failed:Number(receiptSummary.failed||0)},
        repository:repositoryEvidence
      },
      works:rowsWithEvidence.map(row=>{
        const runs=this.db.prepare(`SELECT status,started_at,completed_at,heartbeat_at
          FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 3`).all(row.id);
        const messages=this.store.messages(row.id,{limit:5}).map(message=>({
          role:message.role,content:redactOrchestratorAnalysisText(message.content,1200),createdAt:message.created_at
        }));
        return {title:redactOrchestratorAnalysisText(row.title,180),status:row.status,updatedAt:row.updated_at,
          providerSegments:row.provider_segments,monitor:this.monitor(row,runs,projectId),runs,messages};
      })
    };
  }

  mutate(operation,input) {
    const now=this.store.now();
    if(operation==='project_create') {
      return {projectId:this.createProjectRecord(input.name,input.objective||'',input.repositoryUrl,now)};
    }
    if(operation==='project_quick_create') {
      // Unlike mission_create, no work/draft or speculative user task exists.
      const projectId=this.createProjectRecord(UNTITLED_FORGE_PROJECT,'',null,now);
      const orchestratorId='orchestrator_'+randomUUID();
      const chat=this.store.createTask('Forjador');
      this.db.prepare('INSERT INTO lab_orchestrators (id,project_id,name,mission,status,chat_task_id,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(orchestratorId,projectId,'Forjador',
          'Conversa de projeto. Entender o pedido do usuário e coordenar apenas ações disponíveis e autorizadas.',
          'ready',chat.id,now);
      this.db.prepare('INSERT INTO lab_task_bindings VALUES(?,?,?,?)')
        .run(chat.id,projectId,orchestratorId,'orchestrator');
      return {projectId,projectName:UNTITLED_FORGE_PROJECT,
        orchestratorId,chatTaskId:chat.id,workCreated:0,providerMessagesSent:0};
    }
    if(operation==='project_auto_title') {
      const row=this.db.prepare(`SELECT p.name,o.chat_task_id AS chatTaskId FROM lab_projects p
        JOIN lab_orchestrators o ON o.project_id=p.id
        WHERE p.id=? AND p.workspace_session_id=? ORDER BY o.created_at,o.id LIMIT 1`)
        .get(input.projectId,this.store.getWorkspaceSession().id);
      if(!row)throw Error('orchestrator_project_unavailable');
      if(row.name!==UNTITLED_FORGE_PROJECT)
        return {projectId:input.projectId,name:row.name,changed:false};
      const first=this.db.prepare(`SELECT content FROM messages WHERE task_id=? AND role='user'
        ORDER BY created_at,id LIMIT 1`).get(row.chatTaskId);
      if(!first)return {projectId:input.projectId,name:row.name,changed:false};
      const title=suggestForgeProjectTitle(first.content);
      if(title===UNTITLED_FORGE_PROJECT)return {projectId:input.projectId,name:row.name,changed:false};
      const changed=this.db.prepare('UPDATE lab_projects SET name=? WHERE id=? AND name=?')
        .run(title,input.projectId,UNTITLED_FORGE_PROJECT).changes;
      return {projectId:input.projectId,name:title,changed:changed===1};
    }
    if(operation==='mission_create') {
      const projectName=input.name||missionProjectName(input.mission);
      const projectId=this.createProjectRecord(projectName,input.mission,input.repositoryUrl,now);
      const orchestratorId='orchestrator_'+randomUUID();
      const coordinatorName='Orquestrador';
      const coordinator=this.store.createTask(coordinatorName);
      this.db.prepare('INSERT INTO lab_orchestrators (id,project_id,name,mission,status,chat_task_id,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(orchestratorId,projectId,coordinatorName,input.mission,'ready',coordinator.id,now);
      this.db.prepare('INSERT INTO lab_task_bindings VALUES(?,?,?,?)')
        .run(coordinator.id,projectId,orchestratorId,'orchestrator');
      const work=this.store.createTask('Primeira frente');
      this.db.prepare('INSERT INTO lab_task_bindings VALUES(?,?,?,?)')
        .run(work.id,projectId,orchestratorId,'work');
      this.store.setDraft(work.id,input.mission,1);
      return {projectId,projectName,orchestratorId,chatTaskId:coordinator.id,
        taskId:work.id,taskTitle:work.title,draftRevision:1};
    }
    if(operation==='project_rename') {
      const workspaceSessionId=this.store.getWorkspaceSession().id;
      const changed=this.db.prepare('UPDATE lab_projects SET name=? WHERE id=? AND workspace_session_id=?')
        .run(input.name,input.projectId,workspaceSessionId).changes;
      if(changed!==1)throw Error('orchestrator_project_unavailable');
      return {projectId:input.projectId,name:input.name};
    }
    if(operation==='project_observation_set') {
      if(input.enabled) {
        // An App profile can request observation of ONE project at a time.
        // This is a local consent fence, not an external GitHub/Runtime grant.
        // Mutations are executed within the existing BEGIN IMMEDIATE receipt
        // transaction; concurrent requests cannot both pass this check.
        const other=this.db.prepare(`SELECT 1 FROM lab_projects
          WHERE workspace_session_id=? AND observation_requested=1 AND id<>? LIMIT 1`)
          .get(this.store.getWorkspaceSession().id,input.projectId);
        if(other)throw Error('orchestrator_project_observation_exclusive');
      }
      const result=this.db.prepare('UPDATE lab_projects SET observation_requested=? WHERE id=? AND workspace_session_id=?')
        .run(input.enabled?1:0,input.projectId,this.store.getWorkspaceSession().id);
      if(result.changes!==1)throw Error('orchestrator_project_unavailable');
      // This records intent only; it is not a Platform grant or a running
      // scheduler. This response must never imply successful remote observation.
      return {projectId:input.projectId,requested:input.enabled,active:false,
        state:input.enabled?'awaiting_external_authority':'paused',
        automaticGptDispatchAllowed:false,providerMessagesSent:0,externalCalls:0};
    }
    if(operation==='project_repository_set') {
      const repositoryUrl=normalizeGitHubRepositoryUrl(input.repositoryUrl);
      const project=this.db.prepare(`SELECT repository_url,observation_requested FROM lab_projects
        WHERE id=? AND workspace_session_id=?`).get(input.projectId,this.store.getWorkspaceSession().id);
      if(!project)throw Error('orchestrator_project_unavailable');
      if(project.repository_url!==repositoryUrl) {
        if(project.observation_requested===1)throw Error('orchestrator_repository_change_requires_observation_pause');
        const workStarted=this.db.prepare(`SELECT 1 FROM lab_task_bindings b JOIN tasks t ON t.id=b.task_id
          WHERE b.project_id=? AND b.kind='work' AND (
            t.draft_revision>0 OR
            EXISTS(SELECT 1 FROM messages m WHERE m.task_id=b.task_id) OR
            EXISTS(SELECT 1 FROM runs r WHERE r.task_id=b.task_id) OR
            EXISTS(SELECT 1 FROM action_ledger a WHERE a.task_id=b.task_id AND a.action_type='orchestrator.proposal-send')
          ) LIMIT 1`).get(input.projectId);
        const workUncertain=this.db.prepare(`SELECT 1 FROM lab_command_receipts
          WHERE project_id=? AND operation IN ('work_send','proposal_send') AND status IN ('running','uncertain') LIMIT 1`)
          .get(input.projectId);
        if(workStarted||workUncertain)throw Error('orchestrator_repository_change_requires_new_project');
      }
      const changed=this.db.prepare('UPDATE lab_projects SET repository_url=? WHERE id=? AND workspace_session_id=?')
        .run(repositoryUrl,input.projectId,this.store.getWorkspaceSession().id).changes;
      if(changed!==1)throw Error('orchestrator_project_unavailable');
      if(project.repository_url!==repositoryUrl)
        this.db.prepare('DELETE FROM lab_repository_head_evidence WHERE project_id=?').run(input.projectId);
      return {projectId:input.projectId,repositoryUrl};
    }
    if(operation==='orchestrator_create') {
      const orchestratorId='orchestrator_'+randomUUID();
      const chat=this.store.createTask(input.name);
      this.db.prepare('INSERT INTO lab_orchestrators (id,project_id,name,mission,status,chat_task_id,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(orchestratorId,input.projectId,input.name,input.mission,'ready',chat.id,now);
      this.db.prepare('INSERT INTO lab_task_bindings VALUES(?,?,?,?)')
        .run(chat.id,input.projectId,orchestratorId,'orchestrator');
      return {orchestratorId,chatTaskId:chat.id};
    }
    if(operation==='orchestrator_pause') {
      const owner=this.orchestrator(input.projectId,input.orchestratorId);
      this.db.prepare('UPDATE lab_orchestrators SET status=? WHERE id=?')
        .run(input.paused?'paused':'ready',input.orchestratorId);
      if(input.paused) {
        // A legacy coordinator request may already have left the process. Do not
        // cancel or replay it; preserve old orchestrator_chat receipts alongside
        // current analyze/prepare receipts so a late reply cannot be promoted.
        // Scope to this coordinator Task, not unrelated project work/GPT sends.
        this.db.prepare(`UPDATE lab_command_receipts
          SET status='uncertain',
              result=json_set(CASE WHEN json_valid(result) THEN result
                ELSE json_object('taskId',?) END,'$.reason','coordinator_paused_inflight'),
              updated_at=?
          WHERE project_id=? AND status='running'
            AND operation IN ('orchestrator_chat','orchestrator_analyze','orchestrator_prepare')
            AND id IN (SELECT id FROM lab_command_receipt_scope
              WHERE project_id=? AND task_id=?)`)
          .run(owner.chat_task_id,this.store.now(),input.projectId,input.projectId,owner.chat_task_id);
        this.continuation.quarantineInFlight(
          input.projectId,input.orchestratorId,'orchestrator_paused');
      }
      return {orchestratorId:input.orchestratorId,status:input.paused?'paused':'ready'};
    }
    if(operation==='work_draft_set') {
      this.task(input.projectId,input.taskId,'work');
      if(this.db.prepare('SELECT 1 FROM messages WHERE task_id=? LIMIT 1').get(input.taskId)||
         this.db.prepare('SELECT 1 FROM runs WHERE task_id=? LIMIT 1').get(input.taskId)||
         this.db.prepare(`SELECT 1 FROM lab_command_receipt_scope
           WHERE project_id=? AND task_id=? AND operation IN ('work_send','proposal_send')
           LIMIT 1`).get(input.projectId,input.taskId))
        throw Error('orchestrator_work_already_started');
      const current=this.store.getTaskDraft(input.taskId);
      if(input.draftRevision!==current.draft_revision+1)
        throw Error('task_draft_revision_conflict');
      const saved=this.store.setDraft(input.taskId,input.content,input.draftRevision);
      if(saved.draft!==input.content||saved.draft_revision!==input.draftRevision)
        throw Error('task_draft_revision_conflict');
      return {taskId:input.taskId,draftRevision:saved.draft_revision,
        contentSha256:createHash('sha256').update(input.content).digest('hex'),
        providerMessagesSent:0};
    }
    if(operation==='work_dependency_set') {
      this.task(input.projectId,input.taskId,'work');
      // Prerequisites are pre-execution policy, not retroactive evidence.
      // For continuing an already-executed work, create a new work milestone.
      if(this.db.prepare('SELECT 1 FROM runs WHERE task_id=? LIMIT 1').get(input.taskId)||
        this.hasUnresolvedWorkReceipt(input.projectId,input.taskId,{includeRunning:true}))
        throw Error('orchestrator_dependencies_locked_after_execution');
      for(const dep of input.dependsOn)this.task(input.projectId,dep,'work');
      const existing=this.db.prepare('SELECT task_id,prerequisite_id FROM lab_work_dependencies WHERE project_id=?').all(input.projectId);
      const graph=new Map();
      for(const edge of existing) {
        if(!graph.has(edge.task_id))graph.set(edge.task_id,[]);
        if(edge.task_id!==input.taskId)graph.get(edge.task_id).push(edge.prerequisite_id);
      }
      graph.set(input.taskId,[...input.dependsOn]);
      const done=new Set(),active=new Set();
      const visit=id=>{
        if(active.has(id))throw Error('orchestrator_dependency_cycle');
        if(done.has(id))return;
        active.add(id);
        for(const dep of graph.get(id)||[])visit(dep);
        active.delete(id);done.add(id);
      };
      for(const id of graph.keys())visit(id);
      this.db.prepare('DELETE FROM lab_work_dependencies WHERE project_id=? AND task_id=?').run(input.projectId,input.taskId);
      const insert=this.db.prepare('INSERT INTO lab_work_dependencies(project_id,task_id,prerequisite_id) VALUES(?,?,?)');
      for(const dep of input.dependsOn)insert.run(input.projectId,input.taskId,dep);
      return {taskId:input.taskId,dependsOn:[...input.dependsOn]};
    }
    if(operation==='work_batch_create') {
      // One existing BEGIN IMMEDIATE receipt transaction owns all creations.
      // Invalid titles, duplicate fronts or capacity overflow produce zero tasks.
      this.orchestrator(input.projectId,input.orchestratorId);
      const titles=input.titles.map(title=>title.trim());
      const titleKey=title=>title.normalize('NFKC').replace(/\s+/gu,' ').trim().toLocaleLowerCase('pt-BR');
      if(titles.length<2||titles.length>16||
        titles.some(title=>!title||title.length>140||/[\r\n\0]/u.test(title))||
        new Set(titles.map(titleKey)).size!==titles.length)
        throw Error('orchestrator_batch_titles_invalid');
      const current=this.db.prepare(`SELECT COUNT(*) n FROM lab_task_bindings
        WHERE project_id=? AND kind='work'`).get(input.projectId).n;
      if(current+titles.length>256)throw Error('orchestrator_work_plan_too_large');
      // A fresh requestId must not create a second copy of an existing work.
      // Validate inside the same receipt transaction, including across restarts.
      const existing=this.db.prepare(`SELECT t.title FROM tasks t
        JOIN lab_task_bindings b ON b.task_id=t.id
        WHERE b.project_id=? AND b.orchestrator_id=? AND b.kind='work'
          AND t.status!='archived'`).all(input.projectId,input.orchestratorId);
      const existingTitles=new Set(existing.map(row=>titleKey(row.title)));
      if(titles.some(title=>existingTitles.has(titleKey(title))))
        throw Error('orchestrator_batch_title_already_exists');
      const insert=this.db.prepare('INSERT INTO lab_task_bindings VALUES(?,?,?,?)');
      const taskIds=[];
      for(const title of titles) {
        const task=this.store.createTask(title);
        insert.run(task.id,input.projectId,input.orchestratorId,'work');
        taskIds.push(task.id);
      }
      return {taskIds,created:taskIds.length,providerMessagesSent:0};
    }
    if(operation==='work_create') {
      this.orchestrator(input.projectId,input.orchestratorId);
      const task=this.store.createTask(input.title);
      this.db.prepare('INSERT INTO lab_task_bindings VALUES(?,?,?,?)')
        .run(task.id,input.projectId,input.orchestratorId,'work');
      return {taskId:task.id};
    }
    if(operation==='conversation_rotate') {
      this.task(input.projectId,input.taskId,'work');
      assertTaskHasNoUncertainTransport(this.store,input.taskId);
      if(this.hasUnresolvedWorkReceipt(input.projectId,input.taskId,{includeRunning:true}))
        throw Error('orchestrator_reconciliation_required');
      if(this.db.prepare("SELECT 1 FROM runs WHERE status='running' LIMIT 1").get())
        throw Error('orchestrator_run_active');
      this.store.rotateConversation(input.taskId,'orchestrator_command');
      return {taskId:input.taskId,rotationPrepared:true,providerMessagesSent:0};
    }
    if(operation==='work_failover_prepare') {
      this.task(input.projectId,input.taskId,'work');
      const latest=this.db.prepare(`SELECT id,status,error,completed_at,worker_id
        FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 1`).get(input.taskId);
      if(!latest)throw Error('orchestrator_failover_source_missing');
      if(latest.status==='running')throw Error('orchestrator_failover_source_still_running');
      if(latest.status==='interrupted')throw Error('orchestrator_reconciliation_required');
      const reconciledResponse=latest.status==='succeeded'&&Boolean(this.db.prepare(`SELECT 1 FROM events
        WHERE task_id=? AND kind='provider.response.reconciled'
          AND json_extract(payload,'$.run_id')=? LIMIT 1`).get(input.taskId,latest.id));
      if(latest.status!=='failed'&&!reconciledResponse)
        throw Error('orchestrator_failover_source_not_reconciled');
      if(reconciledResponse)
        this.reconcileRecoveredWorkReceipt(input.taskId,latest.id,{alreadyInTransaction:true});
      assertTaskHasNoUncertainTransport(this.store,input.taskId);
      if(this.hasUnresolvedWorkReceipt(input.projectId,input.taskId,{includeRunning:true}))
        throw Error('orchestrator_reconciliation_required');
      const active=this.db.prepare(`SELECT id,sequence,chat_url FROM task_conversations
        WHERE task_id=? AND status='active' ORDER BY sequence DESC LIMIT 1`).get(input.taskId)||null;
      const generation=Number(this.db.prepare(`SELECT COUNT(*) n FROM events
        WHERE task_id=? AND kind='provider.failover.prepared'`).get(input.taskId)?.n||0)+1;
      this.store.rotateConversation(input.taskId,'orchestrator_failover');
      const checkpoint=this.store.checkpoint(input.taskId,
        `Failover GPT preparado após ${reconciledResponse?'reconciliação confirmada':'falha pré-envio confirmada'} do Run ${latest.id}; geração ${generation}.`,{
          failover_generation:generation,source_run_id:latest.id,
          source_worker_id:latest.worker_id||null,source_error:latest.error||null,
          source_reconciled_response:reconciledResponse,
          previous_conversation_id:active?.id||null,previous_conversation_sequence:active?.sequence||null,
          external_effect_replayed:false
        });
      this.store.event(input.taskId,'provider.failover.prepared',{
        generation,source_run_id:latest.id,source_status:latest.status,
        source_reconciled_response:reconciledResponse,
        checkpoint_version:checkpoint.version,previous_conversation_id:active?.id||null,
        provider_messages_sent:0
      });
      return {taskId:input.taskId,sourceRunId:latest.id,failoverGeneration:generation,
        checkpointVersion:checkpoint.version,rotationPrepared:true,
        sourceReconciledResponse:reconciledResponse,
        previousConversationId:active?.id||null,providerMessagesSent:0,
        effectsReplayed:false};
    }
    throw Error('orchestrator_unknown_operation');
  }

  preparedTask(projectId,orchestratorId,taskId) {
    return this.db.prepare(`SELECT t.id,t.title,t.draft,t.draft_revision,
      EXISTS(SELECT 1 FROM messages WHERE task_id=t.id) has_messages,
      EXISTS(SELECT 1 FROM runs WHERE task_id=t.id) has_runs,
      EXISTS(SELECT 1 FROM action_ledger WHERE task_id=t.id AND action_type='orchestrator.proposal-send') has_send
      FROM tasks t JOIN lab_task_bindings b ON b.task_id=t.id WHERE t.id=? AND b.project_id=?
      AND b.orchestrator_id=? AND b.kind='work' AND t.workspace_session_id=? AND t.status!='archived'`)
      .get(taskId,projectId,orchestratorId,this.store.getWorkspaceSession().id);
  }

}
