import {randomUUID,createHash} from 'node:crypto';
import {ORCHESTRATOR_CONTRACT,ORCHESTRATOR_TOOLS,validateOrchestratorInput} from './forge-contract.mjs';
import {assertTaskHasNoUncertainTransport,listTaskUncertainTransportRuns} from './provider-uncertain-run-policy.mjs';
import {requireConfirmedChatReceipt} from './supervisor-chat-receipt.mjs';
import {redactOrchestratorAnalysisText} from './orchestrator-analysis-text.mjs';
import {validateWorkProposal} from './orchestrator-proposal.mjs';
import {findProviderSubmissionProvenance} from './provider-submission-provenance.mjs';
import {LabContinuation} from './lab-continuation.mjs';
import {AutonomousDialogue} from './autonomous-dialogue.mjs';
import {appOwnedSiteDecision} from './natural-site-intent.mjs';
import {latestSiteWork} from './site-work-context.mjs';
import {ProjectWorkspace} from './project-workspace.mjs';
import {providerSessionReport} from './provider-compose-availability.mjs';
import {forgeProjectContext,forgeMcpDiscovery} from './forge-executor-context.mjs';
import {forgeProjectMemoryView} from './forge-project-memory-view.mjs';
import {forgeProjectAdministratorView} from './forge-project-administrator-view.mjs';
import {forgeProjectHandoffView} from './forge-project-handoff-view.mjs';
import {forgeProjectMissionsView} from './forge-project-missions-view.mjs';
import {UNTITLED_FORGE_PROJECT,suggestForgeProjectTitle} from './project-auto-title.mjs';
import {deleteProjectRecords} from './project-deletion.mjs';
import {ProjectRepository} from './project-repository.mjs';
import {workExecutionSummary} from './work-execution-summary.mjs';
import {projectWorkPlan} from './work-plan-read-model.mjs';
import {appendRemoteRepositoryInstructions,normalizeGitHubRepositoryUrl} from './remote-repository-context.mjs';

function missionProjectName(mission) {
  const firstLine=String(mission||'').trim().split(/\r?\n/u,1)[0].trim();
  const firstSentence=firstLine.split(/(?<=[.!?])\s+/u,1)[0].trim();
  return Array.from(firstSentence).slice(0,140).join('')||'Novo projeto';
}

function appOwnedProposal(content) {
  const normalized=String(content||'').trim();
  if(!normalized)throw Error('orchestrator_proposal_invalid');
  const firstLine=normalized.split(/\r?\n/u,1)[0].replace(/\s+/gu,' ').trim();
  const title=Array.from(firstLine).slice(0,140).join('')||'Nova frente';
  return validateWorkProposal({title,content:normalized,
    reason:'Proposta local derivada diretamente da solicitação registrada; nenhum modelo externo foi consultado.'});
}

function appOwnedAnalysisSummary(context) {
  const planning=context?.planning||{};
  return ['Análise local do Forge registrada.',
    Number(context?.scope?.totalWorkCount||0)+' frente(s) no projeto; '+
      Number(context?.scope?.includedWorkCount||0)+' inspecionada(s) em detalhe.',
    (Array.isArray(planning.candidateTaskIds)?planning.candidateTaskIds.length:0)+' pronta(s), '+
      Number(planning.waitingCount||0)+' aguardando dependência, '+
      Number(planning.blockedCount||0)+' bloqueada(s), '+
      Number(planning.verificationRequiredCount||0)+' aguardando verificação.',
    'Evidência local: '+Number(context?.evidence?.workspace?.entries?.length||0)+' entrada(s) de workspace, '+
      Number(context?.evidence?.commands?.length||0)+' comando(s)/teste(s) recente(s), '+
      Number(context?.evidence?.receipts?.uncertain||0)+' recibo(s) incerto(s); Git histórico '+
      (context?.evidence?.repository?'disponível':'indisponível')+'.',
    'Nenhum modelo externo foi consultado e nenhuma mensagem GPT foi enviada.'].join(' ');
}

function appOwnedRunReview(source) {
  const observedExcerpt=redactOrchestratorAnalysisText(source.observedAnswer,180)
    .replace(/\s+/gu,' ').trim();
  return {sourceRunId:source.runId,decision:'verify_external_effect',
    summary:'O Forge confirmou a resposta GPT deste Run, mas não há prova externa suficiente para certificar efeitos.',
    reason:'A política local diferencia resposta observada de alteração real em arquivos, testes, GitHub ou publicação.',
    observedExcerpt,nextPrompt:null,reviewOnly:true,externalEffectVerified:false,
    automaticGPTSendAuthorized:false,reviewProvider:'ordax_app_policy',
    acceptance:{criterion:'Comprovar os efeitos externos alegados pela resposta GPT usando evidência verificável do projeto.',
      status:'requires_external_verification',observedExcerpt}};
}

// App-owned domain only. Reuses Store/Task/Run/messages; no second SQLite,
// provider worker, device executor, identity, grants or global Memory service.
export class OrchestratorService {
  constructor({store,authorize,provider=null,confirmProposal=null,confirmProposalSend=null,workspacePort=null,fileBroker=null,development=null,repositoryPort=null,verifyLocalArtifact=null,continuousExecutionByDefault=false}={}) {
    if(!store?.db || typeof authorize!=='function')throw Error('orchestrator_ports_required');
    this.store=store; this.db=store.db; this.authorize=authorize;
    this.provider=provider;
    // Optional native Forge MCP projection of the separately owned Forge Git checkpoint.
    this.forgeGitMemoryPort=null;
    // Native renderer proof is an optional App-owned read-only port. It is
    // never used as project authorization or as evidence of publication.
    this.viewPort=null;
    this.continuousExecutionByDefault=continuousExecutionByDefault===true;
    // Optional App-owned, read-only local proof port. No filesystem authority
    // is inferred from a persisted model answer, asset path or remote URL.
    this.verifyLocalArtifact=typeof verifyLocalArtifact==='function'?verifyLocalArtifact:null;
    this.confirmProposal=confirmProposal;
    this.confirmProposalSend=confirmProposalSend;
    this.pendingProposalReviews=new Set();
    // One process-local admission lane per canonical coordinator Task.
    // The durable command receipts remain the only source of truth.
    this.activeCoordinatorTurns=new Set();
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
    const receiptSchema=this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='lab_command_receipts'").get()?.sql||'';
    // Legacy table migration renames the referenced table. Drop only its
    // derived VIEW before that migration so SQLite cannot retain a dangling
    // reference to the old table name. Recreate after migration below.
    if(!receiptSchema.includes("'failed'")){
      this.db.exec('DROP VIEW IF EXISTS lab_command_receipt_scope');
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
    this.db.exec(`CREATE VIEW IF NOT EXISTS lab_command_receipt_scope AS
      SELECT c.rowid AS receipt_rowid,c.id,c.project_id,c.operation,c.status,
        b.task_id AS task_id,
        CASE WHEN c.operation IN ('work_send','proposal_send')
          AND c.status IN ('running','uncertain') AND b.task_id IS NULL
          THEN 1 ELSE 0 END AS unknown_work_target
      FROM lab_command_receipts c
      LEFT JOIN lab_task_bindings b ON b.project_id=c.project_id
        AND b.task_id=CASE WHEN json_valid(c.result) THEN
          CASE WHEN json_type(c.result,'$.taskId')='text'
            THEN json_extract(c.result,'$.taskId') END END`);
    this.continuation=new LabContinuation({store,service:this});
    this.autonomous=new AutonomousDialogue({store,service:this});
    this.workspace=new ProjectWorkspace({store,port:workspacePort});
    this.files=fileBroker;
    this.development=development;
    this.repository=new ProjectRepository({port:repositoryPort});
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
    return {commandId:row.id,operation:row.operation,status:row.status,
      requiresReconciliation:row.status==='uncertain',
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

  startDevAutonomousForjador(context,raw={}) {
    if(!this.continuousExecutionByDefault)return null;
    const {input}=validateOrchestratorInput('forjador_send',raw);
    this.requireAccess(context,'forjador_send',input.projectId);
    const owner=this.orchestrator(input.projectId,input.orchestratorId);
    if(owner.status!=='ready')throw Error('orchestrator_paused');
    this.assertProviderTaskAvailable(owner.chat_task_id,{allowCoordinator:true});
    const existingSite=latestSiteWork(this.store,input.projectId,input.orchestratorId);
    const route=appOwnedSiteDecision({
      delegateWork:true,currentRequest:input.content,existingSite:Boolean(existingSite)
    });
    if(!route)return null;
    return this.transaction(()=>{
      const reserved=this.reserve(context,'forjador_send',input);
      if(reserved.existing)return reserved.existing;
      const draft=this.store.getTaskDraft(owner.chat_task_id);
      if(input.draftRevision!=null&&
         (draft?.draft_revision!==input.draftRevision||draft?.draft!==input.content))
        throw Error('task_draft_revision_conflict');
      const enabled=this.db.prepare(`UPDATE lab_orchestrators
        SET continuous_execution_enabled=1 WHERE id=? AND project_id=?`)
        .run(owner.id,input.projectId).changes;
      if(enabled!==1)throw Error('autonomous_continuous_owner_changed');
      this.store.appendMessage(owner.chat_task_id,'user',input.content,{authorSource:'human'});
      if(input.draftRevision!=null)
        this.store.setDraft(owner.chat_task_id,'',input.draftRevision+1);
      const accepted=this.autonomous.start(context,{
        projectId:input.projectId,orchestratorId:input.orchestratorId,
        mission:input.content,mode:'technical',directUserPrompt:true,
        ...(route.workIntent==='edit'&&existingSite?.taskId
          ?{resumeSiteTaskId:existingSite.taskId}:{}),
        requestId:'dev_'+reserved.commandId
      });
      return this.finish(reserved.commandId,{
        taskId:owner.chat_task_id,autonomousMissionId:accepted.missionId,
        provider:'forge_autonomy',delegation:'technical',
        responseObserved:false,effectVerified:false
      });
    });
  }

  async invoke(context,operation,raw={}) {
    const {tool,input}=validateOrchestratorInput(operation,raw);
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
    this.requireAccess(context,operation,input.projectId||null);
    if(operation==='forge_git_memory'){
      if(typeof this.forgeGitMemoryPort?.read!=='function')
        throw Error('forge_git_memory_unavailable');
      const view=await this.forgeGitMemoryPort.read();
      this.requireAccess(context,operation);
      return view;
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
            'forge_app_ui_unavailable'].includes(error?.message));
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
    if(operation==='autonomous_continuous_set')return {status:'succeeded',operation,
      result:this.autonomous.setContinuousExecution(context,input)};
    if(operation==='autonomous_dialogue_continue')return {status:'succeeded',operation,
      result:this.autonomous.continueTechnical(context,input)};
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
      if(this.autonomous.inFlight||this.activeCoordinatorTurns.size||this.pendingProposalReviews.size)
        throw Error('orchestrator_project_delete_work_active');
      // Detach ONLY the deletion receipt before removing all scoped history.
      this.db.prepare('UPDATE lab_command_receipts SET project_id=NULL WHERE id=?').run(reserved.commandId);
      const result=deleteProjectRecords(this.db,{projectId:input.projectId,
        workspaceSessionId:context.workspaceSessionId,confirmName:input.confirmName});
      return this.finish(reserved.commandId,result);
    });
    if(operation==='project_file_write')return this.writeProjectFile(context,input);
    if(operation==='project_development_status')return this.development?.status(input.projectId,{taskId:input.taskId??null})??{projectId:input.projectId,available:false,reason:'native_owner_port_unavailable'};
    if(operation==='project_worktree_prepare')return this.prepareProjectWorktree(context,input);
    if(operation==='project_worktree_review')return this.reviewProjectWorktree(context,input);
    if(operation==='project_worktree_verify')return this.verifyProjectWorktree(context,input);
    if(operation==='project_worktree_integrate')return this.integrateProjectWorktree(context,input);
    if(operation==='project_command_run')return this.runProjectCommand(context,input);
    if(tool.readOnly&&operation==='status'){
      const status=this.read(context,operation,input);
      // A provider SEND method is only an installed adapter, not login proof.
      // Probe the real currently idle ChatGPT WebContentsView with bounded
      // read-only health; an unavailable/failed probe stays unverified.
      let observed=null;
      try{observed=await this.provider?.sessionHealth?.();}catch{}
      this.requireAccess(context,operation);
      return {...status,providerSession:providerSessionReport(observed)};
    }
    if(tool.readOnly)return this.read(context,operation,input);
    if(operation==='proposal_send')return this.confirmAndSendProposal(context,input);
    if(operation==='proposal_review'&&input.approved)return this.confirmAndReviewProposal(context,input);
    if(['work_send','forjador_send','orchestrator_analyze','orchestrator_prepare'].includes(operation))return this.dispatch(context,operation,input);
    return this.transaction(()=>{
      const reserved=this.reserve(context,operation,input);
      if(reserved.existing)return reserved.existing;
      const result=operation==='project_memory_propose'
        ?(this.task(input.projectId,input.taskId),this.store.memoryCandidates.proposeFromAssistant(input.taskId,input))
        :operation==='proposal_review'?this.reviewProposal(context,input)
        :operation==='work_parallel_launch'?this.prepareParallelLaunch(input,reserved.commandId)
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

  // Never repeat an uncertain terminal command: it may already have changed files.
  async runProjectCommand(context,input) {
    if(!this.development)throw Error('forge_development_unavailable');
    if(input.taskId!==undefined&&input.taskId!==null)this.task(input.projectId,input.taskId,'work');
    const reserved=this.transaction(()=>this.reserve(context,'project_command_run',input));
    if(reserved.existing)return reserved.existing;
    try {
      this.requireAccess(context,'project_command_run',input.projectId);
      const result=await this.development.run(input);
      return this.transaction(()=>this.finish(reserved.commandId,result));
    }catch(error) {
      const deterministic=new Set(['forge_development_owner_approval_required',
        'forge_development_command_invalid','forge_development_directory_invalid',
        'forge_workspace_missing_or_moved','forge_workspace_project_unavailable',
        'forge_worktree_task_unprepared']);
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
      const proof=this.files.write(input.projectId,input.path,input.content,
        input.expectedSha256??null,taskId);
      return this.transaction(()=>this.finish(reserved.commandId,proof));
    }catch(error){
      const deterministic=new Set(['forge_file_path_invalid','forge_file_content_invalid',
        'forge_file_size_limit','forge_file_expected_hash_invalid',
        'forge_file_version_conflict','forge_file_not_found','forge_file_reparse_denied',
        'forge_file_internal_path_denied','forge_workspace_binding_required',
        'forge_worktree_task_unprepared','forge_task_workspace_required',
        'orchestrator_task_unavailable']);
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
      return {...forgeProjectContext({projectId:input.projectId,project,
        workspace:this.workspace.status(context,input.projectId),workCount:total,
        latestRunStatus:last?.status||null}),
        projectMissions:forgeProjectMissionsView(this.store,input.projectId),
        development:this.development?.status(input.projectId)??{available:false,reason:'native_owner_port_unavailable'},
        appPrivateFiles:this.files?.status(input.projectId)||{available:false,mode:'capability_unavailable'}};
    }
    if(operation==='project_memory')return forgeProjectMemoryView(this.store,input.projectId);
    if(operation==='project_administrator_snapshot')return forgeProjectAdministratorView(this.store,input.projectId);
    if(operation==='project_files_status'){
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
    if(operation==='project_handoff')return forgeProjectHandoffView(this.store,input.projectId,{taskId:input.taskId||null});
    if(operation==='continuity_status') {
      this.orchestrator(input.projectId,input.orchestratorId);
      return this.continuation.status(input.projectId,input.orchestratorId);
    }
    if(operation==='status')return {
      contract:ORCHESTRATOR_CONTRACT,engine:'app-owned',
      tools:ORCHESTRATOR_TOOLS.map(t=>t.name),
      externalTransport:'not_connected',autonomousExecution:false,
      autonomousAnalysisAvailable:true,
      coordinatorDraftCommitAvailable:true,
      workspacePortAvailable:this.workspace.available(),
      repositoryPortAvailable:this.repository.available(),
      continuationEnabled:Number(this.db.prepare('SELECT COUNT(*) n FROM lab_continuation_policies WHERE enabled=1').get().n),
      analysisAvailable:true,analysisMode:'app_owned',
      providerExecutionAvailable:typeof this.provider?.send==='function',
      executor:this.executorAdmission(),
      activeRuns:Number(this.db.prepare("SELECT COUNT(*) n FROM runs WHERE status='running'").get().n),
      uncertainCommands:Number(this.db.prepare(`SELECT COUNT(*) n FROM lab_command_receipts
        WHERE status='uncertain' AND workspace_session_id=? AND actor_id=? AND client_id=?`)
        .get(context.workspaceSessionId,context.actorId,context.clientId).n)
    };
    if(operation==='projects_list')return {projects:this.db.prepare(
      'SELECT id,name,objective,repository_url,created_at,observation_requested FROM lab_projects WHERE workspace_session_id=? ORDER BY created_at,id LIMIT 200')
      .all(context.workspaceSessionId).filter(row=>this.authorize({context,operation,projectId:row.id})===true)};
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
        analysisEngine:{state:owner.status,available:true,mode:'app_owned',externalModelUsed:false},
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
    if(operation==='work_list')return {works:this.db.prepare(`SELECT t.id,t.title,t.status,t.updated_at,
      b.orchestrator_id,(SELECT COUNT(*) FROM task_conversations c WHERE c.task_id=t.id) provider_segments,
      (SELECT r.status FROM runs r WHERE r.task_id=t.id ORDER BY r.rowid DESC LIMIT 1) latest_run_status,
      (SELECT r.started_at FROM runs r WHERE r.task_id=t.id ORDER BY r.rowid DESC LIMIT 1) latest_started_at,
      (SELECT r.heartbeat_at FROM runs r WHERE r.task_id=t.id ORDER BY r.rowid DESC LIMIT 1) latest_heartbeat_at,
      (SELECT COUNT(*) FROM runs r WHERE r.task_id=t.id AND r.status='running') running_runs
      FROM tasks t JOIN lab_task_bindings b ON b.task_id=t.id
      WHERE b.project_id=? AND b.kind='work' AND (? IS NULL OR b.orchestrator_id=?)
      AND t.workspace_session_id=? ORDER BY t.updated_at DESC,t.id LIMIT 200`)
      .all(input.projectId,input.orchestratorId||null,input.orchestratorId||null,context.workspaceSessionId)
      .map(work=>({
        ...work,
        execution:workExecutionSummary([{...work,monitor:this.monitor(work,[{
          status:work.latest_run_status,started_at:work.latest_started_at,
          heartbeat_at:work.latest_heartbeat_at
        }],input.projectId)}])[0],
        dependsOn:this.db.prepare('SELECT prerequisite_id FROM lab_work_dependencies WHERE project_id=? AND task_id=? ORDER BY prerequisite_id')
          .all(input.projectId,work.id).map(row=>row.prerequisite_id)
      }))};
    if(operation==='work_get') {
      const task=this.task(input.projectId,input.taskId);
      const runs=this.db.prepare(`SELECT id,status,started_at,completed_at,heartbeat_at
        FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 10`).all(task.id);
      return {...task,runs,
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

  // Provider admission is owned by the canonical Electron scheduler.
  // SQLite remains the durable Run/receipt authority, while capacity reflects
  // physical WebContents lanes rather than imposing a false global lock.
  executorAdmission() {
    const activeRuns=Number(this.db.prepare(
      "SELECT COUNT(*) n FROM runs WHERE status='running'"
    ).get().n);
    const activeCommands=Number(this.db.prepare(`SELECT COUNT(*) n
      FROM lab_command_receipts WHERE status='running'
      AND operation IN ('work_send','proposal_send','forjador_send')`).get().n);
    const capacity=this.provider?.capacity?.()||null;
    const maxConcurrentSends=Number.isSafeInteger(capacity?.maxConcurrentSends)&&
      capacity.maxConcurrentSends>0?capacity.maxConcurrentSends:1;
    const hostOccupied=Boolean(this.provider?.busy?.());
    const capacityKnown=Number.isSafeInteger(capacity?.maxConcurrentSends)&&
      Number.isSafeInteger(capacity?.availableSlots);
    const fallbackActive=Math.min(maxConcurrentSends,
      Math.max(activeRuns,activeCommands,hostOccupied?1:0));
    const activeProviderSends=Number.isSafeInteger(capacity?.active)
      ?Math.max(0,capacity.active):fallbackActive;
    const queuedProviderSends=Number.isSafeInteger(capacity?.queued)
      ?Math.max(0,capacity.queued):0;
    const availableSlots=capacityKnown
      ?Math.max(0,Math.min(maxConcurrentSends,capacity.availableSlots))
      :Math.max(0,maxConcurrentSends-fallbackActive);
    const parallel=maxConcurrentSends>1;
    return Object.freeze({
      mode:parallel?'embedded_chatgpt_worker_pool':'single_embedded_chatgpt_worker',
      maxConcurrentSends,
      activeRuns,activeCommands,activeProviderSends,queuedProviderSends,hostOccupied,
      availableSlots,
      isolatedWorkerSessions:parallel,
      parallelProviderSendsEnabled:parallel
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
      const planning=projectWorkPlan({
        projectId:projectId,maxParallel:maxParallel,edges,
        works:works.map(w=>({...w,monitor:this.monitor(w,[{
          status:w.latest_run_status,started_at:w.latest_started_at,
          heartbeat_at:w.latest_heartbeat_at
        }],projectId)}))
      });
      const executor=this.executorAdmission();
      return Object.freeze({...planning,
        executor,
        // Structural candidates are not permission to send. Only one candidate
        // can occupy the real shared-browser lane, and zero when it is busy.
        transportSlotCandidates:Object.freeze(planning.candidates.slice(0,executor.availableSlots)),
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
        executorMode:plan.executor.mode,
        physicalProviderLanes:plan.executor.maxConcurrentSends,
        availablePhysicalSlots:plan.executor.availableSlots,
        transportSlotCandidateCount:plan.transportSlotCandidates.filter(id=>ownerIds.has(id)).length,
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
    if(operation==='continuity_proposals_set') {
      this.orchestrator(input.projectId,input.orchestratorId);
      return this.continuation.configureProposals(input.projectId,input.orchestratorId,input.enabled);
    }
    if(operation==='continuity_set') {
      this.orchestrator(input.projectId,input.orchestratorId);
      return this.continuation.configure(input.projectId,input.orchestratorId,input.enabled,{
        reviewIntervalMinutes:input.reviewIntervalMinutes??null
      });
    }
    if(operation==='continuity_followup_prepare') {
      const owner=this.orchestrator(input.projectId,input.orchestratorId);
      if(owner.status!=='ready')throw Error('orchestrator_paused');
      const policy=this.db.prepare('SELECT enabled FROM lab_continuation_policies WHERE project_id=? AND orchestrator_id=?')
        .get(input.projectId,input.orchestratorId);
      if(policy?.enabled!==1)throw Error('orchestrator_continuity_disabled');
      const analyzed=this.db.prepare(`SELECT q.task_id,c.result
        FROM lab_continuation_reviews q JOIN lab_command_receipts c ON c.id=q.command_id
        WHERE q.run_id=? AND q.project_id=? AND q.orchestrator_id=?
          AND q.state='analyzed' AND c.status='succeeded' AND c.operation='orchestrator_analyze'`)
        .get(input.reviewRunId,input.projectId,input.orchestratorId);
      let decision;
      try{decision=JSON.parse(analyzed?.result||'{}').reviewDecision;}catch{}
      const route=new Set(['continue_same_conversation','request_correction','new_conversation']);
      if(!analyzed||!route.has(decision?.decision)||decision?.reviewOnly!==true||
         decision.sourceRunId!==input.reviewRunId||decision.externalEffectVerified!==false||
         decision.automaticGPTSendAuthorized!==false||
         typeof decision.nextPrompt!=='string'||decision.nextPrompt.trim().length<20||
         decision.nextPrompt.length>2200)throw Error('orchestrator_followup_decision_unavailable');
      const source=this.reviewableGPTResult(input.projectId,input.orchestratorId,input.reviewRunId);
      if(!source||source.taskId!==analyzed.task_id)throw Error('orchestrator_followup_source_stale');
      this.assertProviderTaskAvailable(source.taskId);
      if(this.hasUnresolvedWorkReceipt(input.projectId,source.taskId,{includeRunning:true}))
        throw Error('orchestrator_reconciliation_required');
      // A different requestId must never prepare or rotate this source Run
      // twice. The durable event and draft update share the same transaction.
      if(this.db.prepare(`SELECT 1 FROM events WHERE task_id=? AND kind='orchestrator.followup.prepared'
        AND json_extract(payload,'$.source_run_id')=? LIMIT 1`)
        .get(source.taskId,input.reviewRunId))throw Error('orchestrator_followup_already_prepared');
      const draft=this.store.getTaskDraft(source.taskId);
      if(draft.draft!=='')throw Error('orchestrator_followup_draft_not_empty');
      if(!Number.isSafeInteger(draft.draft_revision+1))
        throw Error('orchestrator_draft_revision_exhausted');
      const rotate=decision.decision==='new_conversation';
      if(rotate) {
        if(this.db.prepare("SELECT 1 FROM runs WHERE status='running' LIMIT 1").get()||
           this.provider?.busy?.())throw Error('orchestrator_executor_busy');
        this.store.rotateConversation(source.taskId,'orchestrator_review_approved');
      }
      const prepared=this.store.setDraft(source.taskId,decision.nextPrompt,draft.draft_revision+1);
      if(prepared.draft!==decision.nextPrompt||prepared.draft_revision!==draft.draft_revision+1)
        throw Error('orchestrator_followup_draft_conflict');
      this.store.event(source.taskId,'orchestrator.followup.prepared',{
        source_run_id:input.reviewRunId,decision:decision.decision,
        draft_revision:prepared.draft_revision,conversation_rotated:rotate
      });
      return {taskId:source.taskId,sourceRunId:input.reviewRunId,decision:decision.decision,
        draftRevision:prepared.draft_revision,conversationRotated:rotate,
        providerMessagesSent:0,requiresUserSend:true};
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
      if(this.db.prepare("SELECT 1 FROM runs WHERE status='running' LIMIT 1").get()||this.provider?.busy?.())
        throw Error('orchestrator_executor_busy');
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

  inspectProposal(context,input) {
    const owner=this.orchestrator(input.projectId,input.orchestratorId);
    const action=this.db.prepare(`SELECT payload,status FROM action_ledger WHERE id=? AND task_id=?
      AND action_type='orchestrator.work-proposal'`).get(input.actionId,owner.chat_task_id);
    if(!action)throw Error('orchestrator_proposal_unavailable');
    const payload=JSON.parse(action.payload);
    if(payload.actorId!==context.actorId||payload.clientId!==context.clientId||
      payload.projectId!==input.projectId||payload.orchestratorId!==input.orchestratorId)
      throw Error('orchestrator_access_denied');
    if(action.status!=='pending')throw Error('orchestrator_proposal_already_reviewed');
    if(input.approved&&owner.status==='paused')throw Error('orchestrator_paused');
    const approval=this.db.prepare(`SELECT id FROM approval_ledger WHERE action_id=? AND task_id=? AND status='pending'`)
      .get(input.actionId,owner.chat_task_id);
    if(!approval)throw Error('orchestrator_proposal_approval_missing');
    const proposal=validateWorkProposal(payload.proposal);
    return {owner,approval,proposal};
  }

  async confirmAndReviewProposal(context,input) {
    const existing=this.db.prepare(`SELECT id FROM lab_command_receipts WHERE workspace_session_id=?
      AND actor_id=? AND client_id=? AND request_id=?`).get(context.workspaceSessionId,
      context.actorId,context.clientId,input.requestId);
    if(existing)return this.transaction(()=>this.reserve(context,'proposal_review',input).existing);
    const {proposal}=this.inspectProposal(context,input);
    if(this.pendingProposalReviews.has(input.actionId))throw Error('orchestrator_proposal_review_busy');
    this.pendingProposalReviews.add(input.actionId);
    try {
      // No SQLite transaction or main-thread blocking dialog during human review.
      if(await this.confirmProposal?.({projectId:input.projectId,orchestratorId:input.orchestratorId,proposal})!==true)
        throw Error('orchestrator_proposal_not_approved');
      this.requireAccess(context,'proposal_review',input.projectId);
      return this.transaction(()=>{
        const reserved=this.reserve(context,'proposal_review',input);
        if(reserved.existing)return reserved.existing;
        return this.finish(reserved.commandId,this.reviewProposal(context,input,true));
      });
    } finally {this.pendingProposalReviews.delete(input.actionId);}
  }

  reviewProposal(context,input,nativeConfirmed=false) {
    const {owner,approval,proposal}=this.inspectProposal(context,input);
    let taskId=null;
    if(input.approved) {
      // A caller/model-supplied boolean is not approval. Only the trusted App
      // process can supply the confirmation port; MCP uses this same gate.
      if(nativeConfirmed!==true)
        throw Error('orchestrator_proposal_not_approved');
      taskId=this.mutate('work_create',{projectId:input.projectId,orchestratorId:input.orchestratorId,title:proposal.title}).taskId;
      this.store.setDraft(taskId,proposal.content,1);
    }
    this.store.resolveApproval(owner.chat_task_id,approval.id,input.approved);
    const result={taskId,approved:input.approved,providerMessagesSent:0};
    this.store.finishAction(owner.chat_task_id,input.actionId,input.approved?'succeeded':'cancelled',result);
    return result;
  }

  prepareParallelLaunch(input,commandId) {
    if(typeof commandId!=='string'||!commandId)throw Error('orchestrator_parallel_launch_invalid');
    const taskIds=[...new Set(input.taskIds)];
    if(taskIds.length!==input.taskIds.length||taskIds.length<2||taskIds.length>16)
      throw Error('orchestrator_parallel_tasks_invalid');
    const tasks=taskIds.map(taskId=>this.task(input.projectId,taskId,'work'));
    const orchestratorIds=new Set(tasks.map(task=>task.orchestrator_id));
    if(orchestratorIds.size!==1)throw Error('orchestrator_parallel_owner_mismatch');
    const owner=this.orchestrator(input.projectId,tasks[0].orchestrator_id);
    if(owner.status!=='ready')throw Error('orchestrator_paused');
    if(owner.continuous_execution_enabled!==1)
      throw Error('orchestrator_parallel_launch_disabled');

    // One Work may belong to only one durable launch intent. A failed or
    // uncertain child is never retried under a second launch; create a new
    // Work milestone instead.
    const historical=this.db.prepare(`SELECT result FROM lab_command_receipts
      WHERE project_id=? AND operation='work_parallel_launch' AND status='succeeded'`)
      .all(input.projectId);
    const already=new Set();
    for(const row of historical){
      let parsed=null;try{parsed=JSON.parse(row.result||'null');}catch{}
      for(const entry of parsed?.tasks||[])if(typeof entry?.taskId==='string')already.add(entry.taskId);
    }
    if(taskIds.some(taskId=>already.has(taskId)))
      throw Error('orchestrator_parallel_work_already_launched');

    const entries=[];
    for(const task of tasks){
      this.assertDependenciesSatisfied(input.projectId,task.id);
      if(this.db.prepare('SELECT 1 FROM messages WHERE task_id=? LIMIT 1').get(task.id)||
         this.db.prepare('SELECT 1 FROM runs WHERE task_id=? LIMIT 1').get(task.id)||
         this.db.prepare(`SELECT 1 FROM lab_command_receipt_scope
           WHERE project_id=? AND task_id=? AND operation IN ('work_send','proposal_send')
           LIMIT 1`).get(input.projectId,task.id))
        throw Error('orchestrator_parallel_work_already_started');
      const draft=this.store.getTaskDraft(task.id);
      if(typeof draft.draft!=='string'||!draft.draft.trim()||draft.draft.length>6000||
         !Number.isSafeInteger(draft.draft_revision)||draft.draft_revision<1)
        throw Error('orchestrator_parallel_draft_required');
      const digest=createHash('sha256').update(draft.draft).digest('hex');
      const requestId='parallel_'+createHash('sha256')
        .update(commandId+'\0'+task.id).digest('hex').slice(0,48);
      entries.push({taskId:task.id,orchestratorId:task.orchestrator_id,
        content:draft.draft,draftRevision:draft.draft_revision,
        contentSha256:digest,requestId});
    }
    const waitForRunIds=this.db.prepare(`SELECT r.id FROM runs r
      JOIN lab_task_bindings b ON b.task_id=r.task_id
      WHERE b.project_id=? AND r.status='running' ORDER BY r.started_at,r.id`)
      .all(input.projectId).map(row=>row.id);
    return {launchId:commandId,orchestratorId:owner.id,tasks:entries,waitForRunIds,
      providerMessagesSent:0,dispatchQueued:true};
  }

  async tickParallelDispatch(context) {
    const session=this.store.getWorkspaceSession();
    if(session?.status!=='active'||context?.workspaceSessionId!==session.id)
      return {state:'blocked_workspace'};
    const admission=this.executorAdmission();
    if(admission.availableSlots<1)return {state:'executor_busy',availableSlots:0};

    const launches=this.db.prepare(`SELECT id,project_id,result,created_at
      FROM lab_command_receipts
      WHERE workspace_session_id=? AND actor_id=? AND client_id=?
        AND operation='work_parallel_launch' AND status='succeeded'
      ORDER BY created_at,id LIMIT 32`)
      .all(context.workspaceSessionId,context.actorId,context.clientId);
    const ready=[];
    for(const launch of launches){
      let result=null;try{result=JSON.parse(launch.result||'null');}catch{}
      if(!Array.isArray(result?.tasks)||!Array.isArray(result?.waitForRunIds)||
         typeof result?.orchestratorId!=='string')continue;
      let owner=null;try{owner=this.orchestrator(launch.project_id,result.orchestratorId);}catch{continue;}
      if(owner.status!=='ready'||owner.continuous_execution_enabled!==1)continue;
      if(result.waitForRunIds.some(runId=>this.db.prepare(
        "SELECT 1 FROM runs WHERE id=? AND status='running'").get(runId)))continue;
      for(const entry of result.tasks){
        if(ready.length>=admission.availableSlots)break;
        if(!entry||typeof entry.taskId!=='string'||typeof entry.requestId!=='string'||
           typeof entry.content!=='string'||!/^[a-f0-9]{64}$/.test(entry.contentSha256||'')||
           !Number.isSafeInteger(entry.draftRevision))continue;
        const existing=this.db.prepare(`SELECT status FROM lab_command_receipts
          WHERE workspace_session_id=? AND actor_id=? AND client_id=? AND request_id=?`)
          .get(context.workspaceSessionId,context.actorId,context.clientId,entry.requestId);
        if(existing)continue;
        ready.push({launch,entry});
      }
      if(ready.length>=admission.availableSlots)break;
    }
    if(!ready.length)return {state:'idle',availableSlots:admission.availableSlots};

    const start=async({launch,entry})=>{
      this.requireAccess(context,'work_parallel_launch',launch.project_id);
      const task=this.task(launch.project_id,entry.taskId,'work');
      const draft=this.store.getTaskDraft(entry.taskId);
      const digest=createHash('sha256').update(String(draft.draft||'')).digest('hex');
      const childInput={projectId:launch.project_id,taskId:entry.taskId,
        content:entry.content,requestId:entry.requestId,draftRevision:entry.draftRevision+1};
      if(draft.draft!==entry.content||draft.draft_revision!==entry.draftRevision||
         digest!==entry.contentSha256){
        return this.transaction(()=>{
          const reserved=this.reserve(context,'work_send',childInput);
          if(reserved.existing)return reserved.existing;
          return this.finish(reserved.commandId,{taskId:entry.taskId,
            reason:'parallel_launch_snapshot_changed',providerMessagesSent:0},'failed');
        });
      }
      this.assertDependenciesSatisfied(launch.project_id,task.id);
      return this.dispatch(context,'work_send',childInput,null,
        {authorSourceOverride:'orchestrator'});
    };
    const settled=await Promise.allSettled(ready.map(start));
    return {state:'dispatched',requested:ready.length,
      fulfilled:settled.filter(item=>item.status==='fulfilled').length,
      rejected:settled.filter(item=>item.status==='rejected').length,
      availableSlots:Math.max(0,admission.availableSlots-ready.length)};
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

  inspectPreparedSend(context,input) {
    const owner=this.orchestrator(input.projectId,input.orchestratorId);
    if(owner.status==='paused')throw Error('orchestrator_paused');
    const action=this.db.prepare(`SELECT payload,result FROM action_ledger WHERE id=? AND task_id=?
      AND action_type='orchestrator.work-proposal' AND status='succeeded'`).get(input.actionId,owner.chat_task_id);
    if(!action)throw Error('orchestrator_proposal_unavailable');
    const payload=JSON.parse(action.payload),result=JSON.parse(action.result||'null');
    if(payload.actorId!==context.actorId||payload.clientId!==context.clientId||
      payload.projectId!==input.projectId||payload.orchestratorId!==input.orchestratorId)
      throw Error('orchestrator_access_denied');
    if(!result?.approved||!this.db.prepare(`SELECT 1 FROM approval_ledger WHERE action_id=? AND task_id=? AND status='approved'`)
      .get(input.actionId,owner.chat_task_id))throw Error('orchestrator_proposal_approval_missing');
    const task=this.preparedTask(input.projectId,input.orchestratorId,result.taskId);
    if(!task||task.has_messages||task.has_runs||task.has_send)throw Error('orchestrator_first_send_unavailable');
    if(task.draft_revision!==input.draftRevision||!Number.isSafeInteger(task.draft_revision+1)||!task.draft.trim()||task.draft.length>6000)
      throw Error('orchestrator_draft_changed');
    // Existing executor consumes the NEXT revision when clearing the draft.
    return {taskId:task.id,title:task.title,content:task.draft,reviewedDraftRevision:task.draft_revision,draftRevision:task.draft_revision+1};
  }

  async confirmAndSendProposal(context,input) {
    const existing=this.db.prepare(`SELECT id FROM lab_command_receipts WHERE workspace_session_id=?
      AND actor_id=? AND client_id=? AND request_id=?`).get(context.workspaceSessionId,
      context.actorId,context.clientId,input.requestId);
    if(existing)return this.transaction(()=>this.reserve(context,'proposal_send',input).existing);
    this.requireAccess(context,'work_send',input.projectId);
    const draft=this.inspectPreparedSend(context,input);
    const repositoryUrl=this.projectRepositoryUrl(input.projectId);
    const providerContent=appendRemoteRepositoryInstructions(draft.content,repositoryUrl);
    const reviewedDraft={...draft,repositoryUrl,providerContent};
    if(typeof this.provider?.send!=='function')throw Error('orchestrator_provider_unavailable');
    if(this.executorAdmission().availableSlots===0)
      throw Error('orchestrator_executor_busy');
    if(this.pendingProposalReviews.has(input.actionId))throw Error('orchestrator_proposal_review_busy');
    this.pendingProposalReviews.add(input.actionId);
    try {
      if(this.provider.ready&&await this.provider.ready()!==true)throw Error('orchestrator_provider_unavailable');
      if(await this.confirmProposalSend?.({...draft,content:providerContent,sourceContent:draft.content,
        repositoryUrl,projectId:input.projectId,orchestratorId:input.orchestratorId})!==true)
        throw Error('orchestrator_proposal_not_approved');
      this.requireAccess(context,'proposal_send',input.projectId);
      this.requireAccess(context,'work_send',input.projectId);
      const current=this.inspectPreparedSend(context,input);
      if(current.content!==draft.content||this.projectRepositoryUrl(input.projectId)!==repositoryUrl)
        throw Error('orchestrator_draft_changed');
      return await this.dispatch(context,'proposal_send',input,{...current,...reviewedDraft});
    }finally{this.pendingProposalReviews.delete(input.actionId);}
  }

  assertDependenciesSatisfied(projectId,taskId) {
    const hasDependencies=this.db.prepare(
      'SELECT 1 FROM lab_work_dependencies WHERE project_id=? AND task_id=? LIMIT 1'
    ).get(projectId,taskId);
    if(!hasDependencies)return;
    const plan=this.projectPlan(projectId,4);
    const states=new Map(plan.workers.map(worker=>[worker.taskId,worker.state]));
    const target=plan.workers.find(worker=>worker.taskId===taskId);
    if(!target||target.dependsOn.some(id=>states.get(id)!=='succeeded'))
      throw Error('orchestrator_work_prerequisite_not_confirmed');
  }

  coordinatorTurnBusy(taskId) {
    // orchestrator_chat remains queryable here only for receipts created by older
    // versions. It is no longer a valid operation for new commands.
    return this.activeCoordinatorTurns.has(taskId)||Boolean(this.db.prepare(`
      SELECT 1 FROM lab_command_receipt_scope
      WHERE status='running' AND operation IN
        ('forjador_send','orchestrator_chat','orchestrator_analyze','orchestrator_prepare')
      AND task_id=? LIMIT 1`).get(taskId));
  }

  // A running GPT Web action only defers bounded analysis/proposal work for
  // its own project. Neither a global provider busy flag nor work in another
  // project has authority to block unrelated read-only coordination.
  projectWorkInProgress(projectId) {
    return Boolean(this.db.prepare(`SELECT 1 FROM lab_command_receipts
      WHERE project_id=? AND status='running'
        AND operation IN ('work_send','proposal_send','forjador_send')
      UNION ALL
      SELECT 1 FROM runs r JOIN lab_task_bindings b ON b.task_id=r.task_id
      WHERE b.project_id=? AND b.kind='work' AND r.status='running'
      LIMIT 1`).get(projectId,projectId));
  }

  // Shared bounded-memory selector for app-owned reviews and proposals.
  // No external coordinator/model participates in this queue.
  selectContinuationCandidate(candidates) {
    let blocked='idle';
    for(const row of candidates) {
      if(this.coordinatorTurnBusy(this.orchestrator(row.project_id,row.orchestrator_id).chat_task_id)) {
        if(blocked==='idle')blocked='analysis_busy';
        continue;
      }
      if(this.projectWorkInProgress(row.project_id)) {
        if(blocked==='idle')blocked='executor_busy';
        continue;
      }
      return {row};
    }
    return {state:blocked};
  }

  async withCoordinatorTurn(taskId,action) {
    if(typeof taskId!=='string'||!taskId||typeof action!=='function')
      throw Error('orchestrator_coordinator_ports_required');
    // Fail closed BEFORE the model request. This is not a queue or a retry.
    if(this.coordinatorTurnBusy(taskId)){
      const error=Error('orchestrator_coordinator_busy');
      error.orchestratorRequestOutcome='rejected';
      throw error;
    }
    this.activeCoordinatorTurns.add(taskId);
    try{return await action();}
    finally{this.activeCoordinatorTurns.delete(taskId);}
  }

  async dispatch(context,operation,input,preparedSend=null,internal={}) {
    if(operation==='work_send'||operation==='proposal_send'||operation==='forjador_send')
      return this.dispatchCore(context,operation,input,preparedSend,internal);
    if(operation!=='orchestrator_analyze'&&operation!=='orchestrator_prepare')
      throw Error('orchestrator_unknown_operation');
    const existing=this.db.prepare(`SELECT id FROM lab_command_receipts
      WHERE workspace_session_id=? AND actor_id=? AND client_id=? AND request_id=?`)
      .get(context.workspaceSessionId,context.actorId,context.clientId,input.requestId);
    if(existing)return this.transaction(()=>this.reserve(context,operation,input).existing);
    const chatTaskId=this.orchestrator(input.projectId,input.orchestratorId).chat_task_id;
    return this.withCoordinatorTurn(chatTaskId,()=>this.dispatchLocalCoordination(
      context,operation,input
    ));
  }

  dispatchLocalCoordination(context,operation,input) {
    const owner=this.orchestrator(input.projectId,input.orchestratorId);
    if(owner.status==='paused')throw Error('orchestrator_paused');
    const task=this.task(input.projectId,owner.chat_task_id,'orchestrator');
    const prepareWork=operation==='orchestrator_prepare';
    const reviewSource=operation==='orchestrator_analyze'&&input.reviewRunId
      ?this.reviewableGPTResult(input.projectId,input.orchestratorId,input.reviewRunId):null;
    if(input.reviewRunId&&!reviewSource)throw Error('orchestrator_review_source_unconfirmed');
    const analysisContext=operation==='orchestrator_analyze'
      ?this.analysisContext(input.projectId,input.orchestratorId):null;
    if(operation==='orchestrator_analyze'&&analysisContext.works.length===0)
      throw Error('orchestrator_works_unavailable');
    const proposal=prepareWork?appOwnedProposal(input.content):null;
    const reviewDecision=reviewSource?appOwnedRunReview(reviewSource):null;
    const analysisSummary=operation==='orchestrator_analyze'&&!reviewSource
      ?appOwnedAnalysisSummary(analysisContext):null;

    return this.transaction(()=>{
      this.requireAccess(context,operation,input.projectId);
      if(reviewSource&&['running','uncertain','succeeded'].includes(
        this.runReviewReceipt(context,input.projectId,reviewSource.runId).status))
        throw Error('orchestrator_run_review_already_attempted');
      const reservation=this.reserve(context,operation,input);
      if(reservation.existing)return reservation.existing;

      if(prepareWork&&input.draftRevision!==undefined) {
        const draft=this.store.getTaskDraft(task.id);
        if(draft.draft_revision!==input.draftRevision||
           draft.draft.trim()!==String(input.content||'').trim())
          throw Error('task_draft_revision_conflict');
        if(!Number.isSafeInteger(input.draftRevision+1))
          throw Error('invalid_task_draft_revision');
      }

      this.db.prepare('UPDATE lab_command_receipts SET result=? WHERE id=?')
        .run(JSON.stringify({taskId:task.id,...(reviewSource?{reviewRunId:reviewSource.runId}:{})}),
          reservation.commandId);

      let proposalActionId=null;
      if(proposal) {
        proposalActionId=this.store.beginAction(task.id,null,'orchestrator.work-proposal',
          reservation.commandId,{projectId:input.projectId,orchestratorId:owner.id,
            actorId:context.actorId,clientId:context.clientId,proposal});
        this.store.requestApproval(task.id,proposalActionId,
          'Revisar nova frente e rascunho; nenhum envio ao GPT');
        if(input.draftRevision!==undefined) {
          const cleared=this.store.setDraft(task.id,'',input.draftRevision+1);
          if(cleared.draft!==''||cleared.draft_revision!==input.draftRevision+1)
            throw Error('task_draft_revision_conflict');
        }
      }

      if(analysisSummary)this.store.appendMessage(task.id,'assistant',analysisSummary);
      return this.finish(reservation.commandId,{
        taskId:task.id,analysisObserved:operation==='orchestrator_analyze',
        appOwned:true,provider:'ordax_app_policy',
        ...(analysisSummary?{analysisSummary}:{}),
        ...(reviewSource?{reviewRunId:reviewSource.runId,reviewDecision}:{}),
        ...(proposalActionId?{proposalActionId}:{}),proposalsExecuted:0,
        ...(analysisContext?{analysis:{workCount:analysisContext.works.length,
          messageCount:analysisContext.works.reduce((n,work)=>n+work.messages.length,0)}}:{})
      });
    });
  }

  async dispatchCore(context,operation,input,preparedSend=null,internal={}) {
    const authorSourceOverride=internal?.authorSourceOverride??null;
    if(authorSourceOverride!==null&&!['human','orchestrator'].includes(authorSourceOverride))
      throw Error('invalid_message_author_source');
    const existing=this.db.prepare(`SELECT id,input_hash FROM lab_command_receipts WHERE workspace_session_id=?
      AND actor_id=? AND client_id=? AND request_id=?`).get(context.workspaceSessionId,
      context.actorId,context.clientId,input.requestId);
    // Return an accepted command even if the provider is now offline; never replay.
    if(existing)return this.transaction(()=>this.reserve(context,operation,input).existing);
    const isWorkSend=operation==='work_send'||operation==='proposal_send';
    const isForjadorSend=operation==='forjador_send';
    const sendInput=preparedSend||input;
    const orch=isWorkSend?null:this.orchestrator(input.projectId,input.orchestratorId);
    const task=isWorkSend?this.task(input.projectId,sendInput.taskId,'work'):
      this.task(input.projectId,orch.chat_task_id,'orchestrator');
    const owner=orch||this.orchestrator(input.projectId,task.orchestrator_id);
    if(isWorkSend)this.assertDependenciesSatisfied(input.projectId,task.id);
    if(isForjadorSend){
      this.assertProviderTaskAvailable(task.id,{allowCoordinator:true});
      if(sendInput.draftRevision!=null){
        const draft=this.store.getTaskDraft(task.id);
        if(draft.draft_revision!==sendInput.draftRevision||
           draft.draft.trim()!==String(sendInput.content||'').trim())
          throw Error('task_draft_revision_conflict');
        if(!Number.isSafeInteger(sendInput.draftRevision+1))
          throw Error('invalid_task_draft_revision');
      }
    }
    const repositoryUrl=this.projectRepositoryUrl(input.projectId);
    if(owner.status==='paused')throw Error('orchestrator_paused');
    if(typeof this.provider?.send!=='function'||
       (this.provider.available&&this.provider.available(input.projectId,owner.id)!==true))
      throw Error('orchestrator_provider_unavailable');
    const providerContent=preparedSend?.providerContent||
      appendRemoteRepositoryInstructions(sendInput.content,repositoryUrl);
    // GPT transport admission applies only to real GPT Web sends.
    assertTaskHasNoUncertainTransport(this.store,task.id);
    if(this.executorAdmission().availableSlots===0)throw Error('orchestrator_executor_busy');
    if(isWorkSend&&this.hasUnresolvedWorkReceipt(input.projectId,task.id))
      throw Error('orchestrator_reconciliation_required');
    const reserved=this.transaction(()=>{
      this.requireAccess(context,operation,input.projectId);
      if(isWorkSend)this.assertDependenciesSatisfied(input.projectId,task.id);
      const reservation=this.reserve(context,operation,input);
      if(reservation.existing)return {existing:reservation.existing};
      if(preparedSend) {
        reservation.sendActionId=this.store.beginAction(task.id,null,'orchestrator.proposal-send',
          reservation.commandId,{actorId:context.actorId,clientId:context.clientId,
            sourceActionId:input.actionId,
            contentSha256:createHash('sha256').update(providerContent).digest('hex'),
            reviewedDraftRevision:sendInput.reviewedDraftRevision,
            draftRevision:sendInput.draftRevision});
        reservation.approvalId=this.store.requestApproval(task.id,reservation.sendActionId,
          'Envio único confirmado em diálogo nativo');
        this.store.resolveApproval(task.id,reservation.approvalId,true);
        this.db.prepare("UPDATE action_ledger SET status='dispatching' WHERE id=?")
          .run(reservation.sendActionId);
      }
      this.db.prepare('UPDATE lab_command_receipts SET result=? WHERE id=?')
        .run(JSON.stringify({taskId:task.id,...(reservation.sendActionId?{
          sendActionId:reservation.sendActionId,approvalId:reservation.approvalId}: {})}),
          reservation.commandId);
      return reservation;
    });
    if(reserved.existing)return reserved.existing;
    try {
      // Fresh authorization immediately before a potentially external effect.
      this.requireAccess(context,operation,input.projectId);
      const reply=await this.provider.send({taskId:task.id,content:providerContent,
        draftRevision:isForjadorSend&&sendInput.draftRevision!=null
          ?sendInput.draftRevision+1:sendInput.draftRevision??null,
        taskKind:isForjadorSend?'orchestrator':'work',
        authorSource:authorSourceOverride||'human',
        mission:owner.mission,projectId:input.projectId,orchestratorId:owner.id,
        repositoryUrl});
      this.requireAccess(context,operation,input.projectId);
      // Existing runTask can return an error result instead of throwing.
      requireConfirmedChatReceipt(reply);
      const canonicalRun=this.db.prepare('SELECT status FROM runs WHERE id=? AND task_id=?').get(reply.runId,task.id);
      if(canonicalRun?.status!=='succeeded')throw Error('orchestrator_effect_unconfirmed');
      return this.transaction(()=>{
        const result={taskId:task.id,runId:reply.runId,responseObserved:true,effectVerified:false,
          provider:'chatgpt_web',
          ...(reserved.sendActionId?{sendActionId:reserved.sendActionId,approvalId:reserved.approvalId}:{})};
        if(reserved.sendActionId){
          this.db.prepare('UPDATE action_ledger SET run_id=? WHERE id=?').run(reply.runId,reserved.sendActionId);
          this.store.finishAction(task.id,reserved.sendActionId,'succeeded',result);
        }
        return this.finish(reserved.commandId,result);
      });
    } catch(error) {
      const notSubmitted=error?.providerDeliveryState==='not_submitted';
      const failureCode=/^[a-z][a-z0-9_]{1,80}$/i.test(String(error?.providerFailureCode||''))
        ?String(error.providerFailureCode):'provider_send_unconfirmed';
      const result={taskId:task.id,
        reason:notSubmitted?'provider_not_submitted':'execution_unconfirmed',
        ...(notSubmitted?{providerStage:String(error?.providerFailureStage||'unknown'),failureCode}:{}),
        ...(reserved.sendActionId?{sendActionId:reserved.sendActionId,
          approvalId:reserved.approvalId}:{})};
      this.transaction(()=>{
        if(reserved.sendActionId)this.store.finishAction(task.id,reserved.sendActionId,
          notSubmitted?'failed':'indeterminate',result);
        this.finish(reserved.commandId,result,notSubmitted?'failed':'uncertain');
      });
      this.requireAccess(context,operation,input.projectId);
      return this.getReceipt(context,reserved.commandId);
    }
  }
}
