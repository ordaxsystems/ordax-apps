import {randomUUID,createHash} from 'node:crypto';
import {ORCHESTRATOR_CONTRACT,ORCHESTRATOR_TOOLS,validateOrchestratorInput} from './orchestrator-contract.mjs';
import {assertTaskHasNoUncertainTransport,listTaskUncertainTransportRuns} from './provider-uncertain-run-policy.mjs';
import {requireConfirmedChatReceipt} from './supervisor-chat-receipt.mjs';
import {redactOrchestratorAnalysisText} from './orchestrator-analysis-text.mjs';
import {validateWorkProposal} from './orchestrator-proposal.mjs';
import {LabContinuation} from './lab-continuation.mjs';
import {AutonomousDialogue} from './autonomous-dialogue.mjs';
import {ProjectWorkspace} from './project-workspace.mjs';
import {ProjectRepository} from './project-repository.mjs';
import {workExecutionSummary} from './work-execution-summary.mjs';
import {projectWorkPlan} from './work-plan-read-model.mjs';
import {appendRemoteRepositoryInstructions,normalizeGitHubRepositoryUrl} from './remote-repository-context.mjs';

function missionProjectName(mission) {
  const firstLine=String(mission||'').trim().split(/\r?\n/u,1)[0].trim();
  const firstSentence=firstLine.split(/(?<=[.!?])\s+/u,1)[0].trim();
  return Array.from(firstSentence).slice(0,140).join('')||'Novo projeto';
}

// App-owned domain only. Reuses Store/Task/Run/messages; no second SQLite,
// provider worker, device executor, identity, grants or global Memory service.
export class OrchestratorService {
  constructor({store,authorize,provider=null,coordinator=null,confirmProposal=null,confirmProposalSend=null,workspacePort=null,repositoryPort=null}={}) {
    if(!store?.db || typeof authorize!=='function')throw Error('orchestrator_ports_required');
    this.store=store; this.db=store.db; this.authorize=authorize;
    this.provider=provider; this.coordinator=coordinator;
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

  assertProviderTaskAvailable(taskId,{allowCoordinator=false}={}) {
    const binding=this.db.prepare(`SELECT b.kind,b.project_id,o.status FROM lab_task_bindings b
      JOIN lab_orchestrators o ON o.id=b.orchestrator_id WHERE b.task_id=?`).get(taskId);
    if(binding?.kind==='orchestrator'&&!allowCoordinator)throw Error('orchestrator_coordinator_channel_required');
    if(allowCoordinator&&binding?.kind!=='orchestrator')throw Error('orchestrator_coordinator_task_required');
    if(binding?.status==='paused')throw Error('orchestrator_paused');
    const uncertain=binding?.kind==='work'
      ?this.hasUnresolvedWorkReceipt(binding.project_id,taskId)
      :Boolean(this.db.prepare(`SELECT 1 FROM lab_command_receipt_scope
        WHERE status='uncertain' AND task_id=? LIMIT 1`).get(taskId));
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

  async invoke(context,operation,raw={}) {
    const {tool,input}=validateOrchestratorInput(operation,raw);
    this.requireAccess(context,operation,input.projectId||null);
    if(operation==='autonomous_dialogue_status')return this.autonomous.status(context,input);
    if(operation==='autonomous_dialogue_start')return {status:'succeeded',operation,result:this.autonomous.start(context,input)};
    if(operation==='repository_observe') {
      const repositoryUrl=this.projectRepositoryUrl(input.projectId);
      const recheck=()=>{
        this.requireAccess(context,operation,input.projectId);
        if(this.projectRepositoryUrl(input.projectId)!==repositoryUrl)
          throw Error('orchestrator_repository_changed_during_observation');
      };
      return this.repository.observe(context,{projectId:input.projectId,repositoryUrl},recheck);
    }
    if(operation==='workspace_snapshot')return this.workspace.snapshot(context,input,()=>this.requireAccess(context,operation,input.projectId));
    if(operation==='workspace_bind')return this.bindWorkspace(context,input);
    if(tool.readOnly)return this.read(context,operation,input);
    if(operation==='proposal_send')return this.confirmAndSendProposal(context,input);
    if(operation==='proposal_review'&&input.approved)return this.confirmAndReviewProposal(context,input);
    if(['work_send','orchestrator_chat','orchestrator_analyze','orchestrator_prepare'].includes(operation))return this.dispatch(context,operation,input);
    return this.transaction(()=>{
      const reserved=this.reserve(context,operation,input);
      if(reserved.existing)return reserved.existing;
      const result=operation==='proposal_review'?this.reviewProposal(context,input):this.mutate(operation,input);
      if(['project_create','mission_create'].includes(operation))this.db.prepare('UPDATE lab_command_receipts SET project_id=? WHERE id=?')
        .run(result.projectId,reserved.commandId);
      return this.finish(reserved.commandId,result);
    });
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
      coordinatorAvailable:this.coordinator?.available?.()===true,
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
      // Any outstanding send in this project is relevant: parallel owners can
      // share a repo, and missing/invalid target receipts are fail-closed.
      const unresolved=this.db.prepare(`SELECT COUNT(*) AS total
        FROM lab_command_receipts
        WHERE project_id=? AND operation IN ('work_send','proposal_send')
          AND status IN ('running','uncertain')`).get(input.projectId);
      const modelConfigured=this.coordinator?.available?.()===true;
      const blockers=[];
      if(owner.status!=='ready')blockers.push('coordinator_paused');
      if(!modelConfigured)blockers.push('coordinator_unavailable');
      if(work.total===0)blockers.push('no_registered_work');
      if(unresolved.total>0)blockers.push('work_receipts_unresolved');
      return {
        schema:'ordax.orchestrator.project-preflight/1',
        projectId:input.projectId,orchestratorId:input.orchestratorId,
        observedAt:this.store.now(),
        provenance:{source:'app_sqlite',externalObservation:false},
        repository:{urlRegistered:Boolean(project?.repository_url),authenticatedRead:'unavailable'},
        observation:{requested:project.observation_requested===1,active:false,
          state:project.observation_requested===1?'awaiting_external_authority':'paused',
          automaticGptDispatchAllowed:false,backgroundSchedulerActive:false},
        runtime:{grantVerified:false},
        coordinator:{state:owner.status,modelConfigured,providerResponseVerified:false},
        work:{registered:Number(work.total),started:Number(work.started),unresolvedSends:Number(unresolved.total)},
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
      (SELECT COUNT(*) FROM runs r WHERE r.task_id=t.id AND r.status='running') running_runs
      FROM tasks t JOIN lab_task_bindings b ON b.task_id=t.id
      WHERE b.project_id=? AND b.kind='work' AND (? IS NULL OR b.orchestrator_id=?)
      AND t.workspace_session_id=? ORDER BY t.updated_at DESC,t.id LIMIT 200`)
      .all(input.projectId,input.orchestratorId||null,input.orchestratorId||null,context.workspaceSessionId)
      .map(work=>({...work,execution:workExecutionSummary([work])[0],
        dependsOn:this.db.prepare('SELECT prerequisite_id FROM lab_work_dependencies WHERE project_id=? AND task_id=? ORDER BY prerequisite_id')
          .all(input.projectId,work.id).map(row=>row.prerequisite_id)}))};
    if(operation==='work_get') {
      const task=this.task(input.projectId,input.taskId);
      const runs=this.db.prepare(`SELECT id,status,started_at,completed_at,heartbeat_at
        FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 10`).all(task.id);
      return {...task,runs,conversations:this.store.listConversations(task.id).slice(-50),
        pendingApprovals:this.store.pendingApprovals(task.id).map(a=>({id:a.id,status:a.status,actionId:a.action_id})),
        monitor:this.monitor(task,runs,input.projectId)};
    }
    if(operation==='work_messages') {
      this.task(input.projectId,input.taskId);
      const page=this.store.messagesPage(input.taskId,{before:input.before||null,limit:input.limit||50});
      return {...page,messages:page.messages.map(m=>({id:m.id,role:m.role,content:m.content,created_at:m.created_at}))};
    }
    if(operation==='command_get')return this.getReceipt(context,input.commandId);
    throw Error('orchestrator_unknown_operation');
  }

  // The Electron host currently has ONE shared WebContentsView and ONE
  // canonical provider transport. This capability is a verified ceiling,
  // not an opt-in flag that may be raised without isolated workers.
  executorAdmission() {
    const activeRuns=Number(this.db.prepare(
      "SELECT COUNT(*) n FROM runs WHERE status='running'"
    ).get().n);
    // Only GPT Web submissions occupy the single WebContentsView executor.
    // Groq/chat/analysis requests have their own coordinator lane and must
    // not consume provider capacity, even while their receipts are running.
    // Keep ALL in-flight GPT sends reserved until their durable receipt ends.
    const activeCommands=Number(this.db.prepare(`SELECT COUNT(*) n
      FROM lab_command_receipts WHERE status='running'
      AND operation IN ('work_send','proposal_send')`).get().n);
    const hostOccupied=Boolean(this.provider?.busy?.());
    const occupied=activeRuns>0||activeCommands>0||hostOccupied;
    return Object.freeze({
      mode:'single_embedded_chatgpt_worker',
      maxConcurrentSends:1,
      activeRuns,activeCommands,hostOccupied,
      availableSlots:occupied?0:1,
      isolatedWorkerSessions:false,
      parallelProviderSendsEnabled:false
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
        ORDER BY t.created_at,t.id LIMIT 257`)
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

  analysisContext(projectId,orchestratorId) {
    const owner=this.orchestrator(projectId,orchestratorId);
    const project=this.db.prepare(`SELECT name,objective FROM lab_projects
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
    // Preserve project-wide dependencies internally but disclose only THIS
    // coordinator's scoped work in the Groq analysis.
    let planning={state:'unavailable',automaticDispatchAllowed:false,qualityCertified:false};
    let plan=null;
    try {
      plan=this.projectPlan(projectId,4);
      const owned=plan.workers.filter(worker=>ownerIds.has(worker.taskId));
      planning={state:'available',
        candidateTaskIds:plan.candidates.filter(id=>ownerIds.has(id)).slice(0,8),
        waitingCount:plan.waiting.filter(id=>ownerIds.has(id)).length,
        blockedCount:plan.blocked.filter(id=>ownerIds.has(id)).length,
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
      works:rows.map(row=>{
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
    if(operation==='mission_create') {
      const projectName=input.name||missionProjectName(input.mission);
      const projectId=this.createProjectRecord(projectName,input.mission,input.repositoryUrl,now);
      const orchestratorId='orchestrator_'+randomUUID();
      const coordinatorName='Orquestrador';
      const coordinator=this.store.createTask(coordinatorName);
      this.db.prepare('INSERT INTO lab_orchestrators VALUES(?,?,?,?,?,?,?)')
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
      return {projectId:input.projectId,repositoryUrl};
    }
    if(operation==='orchestrator_create') {
      const orchestratorId='orchestrator_'+randomUUID();
      const chat=this.store.createTask(input.name);
      this.db.prepare('INSERT INTO lab_orchestrators VALUES(?,?,?,?,?,?,?)')
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
      return this.continuation.configure(input.projectId,input.orchestratorId,input.enabled);
    }
    if(operation==='orchestrator_pause') {
      const owner=this.orchestrator(input.projectId,input.orchestratorId);
      this.db.prepare('UPDATE lab_orchestrators SET status=? WHERE id=?')
        .run(input.paused?'paused':'ready',input.orchestratorId);
      if(input.paused) {
        // A Groq request may already have left the process. Do not cancel or
        // replay it; atomically preserve an uncertain receipt at the pause
        // boundary so a late reply cannot be promoted after rapid resume.
        // Scope to this coordinator Task, not unrelated project work/GPT sends.
        this.db.prepare(`UPDATE lab_command_receipts
          SET status='uncertain',result=json_object('taskId',?,'reason','coordinator_paused_inflight'),
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
    return this.activeCoordinatorTurns.has(taskId)||Boolean(this.db.prepare(`
      SELECT 1 FROM lab_command_receipt_scope
      WHERE status='running' AND operation IN
        ('orchestrator_chat','orchestrator_analyze','orchestrator_prepare')
      AND task_id=? LIMIT 1`).get(taskId));
  }

  // A running GPT Web action must only defer opt-in Groq coordination for
  // its own project. Neither a global provider busy flag nor work in another
  // project has authority to block this read-only coordinator channel.
  projectWorkInProgress(projectId) {
    return Boolean(this.db.prepare(`SELECT 1 FROM lab_command_receipts
      WHERE project_id=? AND status='running'
        AND operation IN ('work_send','proposal_send')
      UNION ALL
      SELECT 1 FROM runs r JOIN lab_task_bindings b ON b.task_id=r.task_id
      WHERE b.project_id=? AND b.kind='work' AND r.status='running'
      LIMIT 1`).get(projectId,projectId));
  }

  // Shared bounded-memory selector for opt-in reviews and proposals. An
  // unavailable, occupied or project-busy coordinator must not hold the
  // whole queue. Receipt, consent and provider gates remain in the caller.
  // The SQLite iterator does not materialize the full backlog.
  selectContinuationCandidate(candidates) {
    let blocked='idle';
    for(const row of candidates) {
      if(this.coordinator?.available?.(row.project_id,row.orchestrator_id)!==true) {
        if(blocked==='idle')blocked='blocked_coordinator';
        continue;
      }
      if(this.coordinatorTurnBusy(this.orchestrator(row.project_id,row.orchestrator_id).chat_task_id)) {
        if(blocked==='idle')blocked='coordinator_busy';
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

  async dispatch(context,operation,input,preparedSend=null) {
    if(operation==='work_send'||operation==='proposal_send')
      return this.dispatchCore(context,operation,input,preparedSend);
    // Repeated requestIds return their existing receipt even while busy.
    const existing=this.db.prepare(`SELECT id FROM lab_command_receipts
      WHERE workspace_session_id=? AND actor_id=? AND client_id=? AND request_id=?`)
      .get(context.workspaceSessionId,context.actorId,context.clientId,input.requestId);
    if(existing)return this.transaction(()=>this.reserve(context,operation,input).existing);
    const chatTaskId=this.orchestrator(input.projectId,input.orchestratorId).chat_task_id;
    return this.withCoordinatorTurn(chatTaskId,()=>this.dispatchCore(context,operation,input,preparedSend));
  }

  async dispatchCore(context,operation,input,preparedSend=null) {
    const existing=this.db.prepare(`SELECT id,input_hash FROM lab_command_receipts WHERE workspace_session_id=?
      AND actor_id=? AND client_id=? AND request_id=?`).get(context.workspaceSessionId,
      context.actorId,context.clientId,input.requestId);
    // Return an accepted command even if the provider is now offline; never replay.
    if(existing)return this.transaction(()=>this.reserve(context,operation,input).existing);
    const isWorkSend=operation==='work_send'||operation==='proposal_send';
    // Transport is determined by the operation, never by the visible GPT pane.
    // Coordinator conversations use the configured coordinator (Groq on
    // Windows); only explicit work sends reach the ChatGPT Web executor.
    const usesProvider=isWorkSend;
    const sendInput=preparedSend||input;
    const orch=isWorkSend?null:this.orchestrator(input.projectId,input.orchestratorId);
    const task=isWorkSend?this.task(input.projectId,sendInput.taskId,'work'):
      this.task(input.projectId,orch.chat_task_id,'orchestrator');
    const owner=orch||this.orchestrator(input.projectId,task.orchestrator_id);
    if(isWorkSend)this.assertDependenciesSatisfied(input.projectId,task.id);
    const repositoryUrl=this.projectRepositoryUrl(input.projectId);
    if(owner.status==='paused')throw Error('orchestrator_paused');
    const port=usesProvider?this.provider:this.coordinator;
    if(typeof port?.send!=='function'||(port.available&&port.available(input.projectId,owner.id)!==true))
      throw Error('orchestrator_provider_unavailable');
    const prepareWork=operation==='orchestrator_prepare';
    const analysisContext=operation==='orchestrator_analyze'||prepareWork
      ?this.analysisContext(input.projectId,input.orchestratorId):null;
    if(operation==='orchestrator_analyze'&&analysisContext.works.length===0)throw Error('orchestrator_works_unavailable');
    const content=operation==='orchestrator_analyze'
      ?'Analise explicitamente as conversas recentes de trabalho deste projeto e recomende próximos passos, sem executar nenhum deles.'
      :sendInput.content;
    const providerContent=usesProvider
      ?preparedSend?.providerContent||appendRemoteRepositoryInstructions(content,repositoryUrl)
      :content;
    const workspaceStatus=isWorkSend?null:this.workspace.status(context,input.projectId);
    const workspaceObservation=workspaceStatus?{
      state:workspaceStatus.state,
      capabilityAvailable:workspaceStatus.available===true,
      snapshotObserved:false,
      gitMetadataAvailable:false,
      fileContentAvailable:false,
      filesRead:workspaceStatus.filesRead,
      filesWritten:workspaceStatus.filesWritten
    }:null;
    // GPT transport admission and uncertain GPT receipts must never block
    // the independent Groq conversation with the coordinator.
    if(usesProvider) {
      assertTaskHasNoUncertainTransport(this.store,task.id);
      if(this.executorAdmission().availableSlots===0)
        throw Error('orchestrator_executor_busy');
    }
    // Advisory API replies cannot submit GPT work. Preserve their uncertain
    // receipts without replay, but allow a fresh explicit API request. Only
    // uncertain provider submissions quarantine the work transport.
    if(isWorkSend&&this.hasUnresolvedWorkReceipt(input.projectId,task.id))
      throw Error('orchestrator_reconciliation_required');
    const reserved=this.transaction(()=>{
      this.requireAccess(context,operation,input.projectId);
      if(isWorkSend)this.assertDependenciesSatisfied(input.projectId,task.id);
      const reservation=this.reserve(context,operation,input);
      if(reservation.existing)return {existing:reservation.existing};
      if(preparedSend) {
        reservation.sendActionId=this.store.beginAction(task.id,null,'orchestrator.proposal-send',reservation.commandId,
          {actorId:context.actorId,clientId:context.clientId,sourceActionId:input.actionId,
            contentSha256:createHash('sha256').update(providerContent).digest('hex'),reviewedDraftRevision:sendInput.reviewedDraftRevision,
            draftRevision:sendInput.draftRevision});
        reservation.approvalId=this.store.requestApproval(task.id,reservation.sendActionId,'Envio único confirmado em diálogo nativo');
        this.store.resolveApproval(task.id,reservation.approvalId,true);
        this.db.prepare("UPDATE action_ledger SET status='dispatching' WHERE id=?").run(reservation.sendActionId);
      }
      this.db.prepare('UPDATE lab_command_receipts SET result=? WHERE id=?')
        .run(JSON.stringify({taskId:task.id,...(reservation.sendActionId?{
          sendActionId:reservation.sendActionId,approvalId:reservation.approvalId}: {})}),reservation.commandId);
      if(!usesProvider) {
        const coordinatorDraft=['orchestrator_chat','orchestrator_prepare'].includes(operation)&&input.draftRevision!==undefined;
        if(coordinatorDraft) {
          const draft=this.store.getTaskDraft(task.id);
          if(draft.draft_revision!==input.draftRevision||draft.draft.trim()!==content.trim())
            throw Error('task_draft_revision_conflict');
          if(!Number.isSafeInteger(input.draftRevision+1))throw Error('invalid_task_draft_revision');
        }
        this.store.appendMessage(task.id,'user',content);
        if(coordinatorDraft) {
          const cleared=this.store.setDraft(task.id,'',input.draftRevision+1);
          if(cleared.draft!==''||cleared.draft_revision!==input.draftRevision+1)
            throw Error('task_draft_revision_conflict');
        }
      }
      return reservation;
    });
    if(reserved.existing)return reserved.existing;
    try {
      // Fresh authorization immediately before a potentially external effect.
      this.requireAccess(context,operation,input.projectId);
      const reply=await port.send({taskId:task.id,content:usesProvider?providerContent:content,
        draftRevision:sendInput.draftRevision??null,
        taskKind:isWorkSend?'work':null,
        mission:owner.mission,projectId:input.projectId,orchestratorId:owner.id,analysisContext,prepareWork,
        workspaceObservation,repositoryUrl});
      this.requireAccess(context,operation,input.projectId);
      if(!usesProvider) {
        // Pause can happen during the external Groq await. A durable receipt
        // already moved to uncertain must remain terminal even after resume.
        if(this.db.prepare('SELECT status FROM lab_command_receipts WHERE id=?')
          .get(reserved.commandId)?.status!=='running')
          return this.getReceipt(context,reserved.commandId);
        if(!reply||typeof reply.content!=='string'||!reply.content.trim()||reply.content.length>12000)
          throw Error('orchestrator_reply_invalid');
        return this.transaction(()=>{
          let proposalActionId=null;
          if(prepareWork) {
            const proposal=validateWorkProposal(reply.proposal);
            proposalActionId=this.store.beginAction(task.id,null,'orchestrator.work-proposal',reserved.commandId,
              {projectId:input.projectId,orchestratorId:owner.id,actorId:context.actorId,clientId:context.clientId,proposal});
            this.store.requestApproval(task.id,proposalActionId,'Revisar nova frente e rascunho; nenhum envio ao GPT');
          }
          this.store.appendMessage(task.id,'assistant',reply.content);
          return this.finish(reserved.commandId,{taskId:task.id,responseObserved:true,
            ...(proposalActionId?{proposalActionId}:{}),
            proposalsExecuted:0,provider:reply.provider||'groq',...(analysisContext?{analysis:{workCount:analysisContext.works.length,
              messageCount:analysisContext.works.reduce((n,work)=>n+work.messages.length,0)}}:{})});
        });
      }
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
      // The pause transaction may have sealed the accepted Groq receipt while
      // the model was in flight. Preserve it instead of trying to finish twice.
      if(!usesProvider&&this.db.prepare('SELECT status FROM lab_command_receipts WHERE id=?')
        .get(reserved.commandId)?.status!=='running')
        return this.getReceipt(context,reserved.commandId);
      // Coordinator and work-chat transports are distinct and never silently
      // substitute for each other after any rejection or uncertain outcome.
      const failure=error;
      // Only an explicit pre-submit disposition from the provider executor is
      // retryable. Missing/invalid evidence remains uncertain and quarantined.
      const notSubmitted=usesProvider&&failure?.providerDeliveryState==='not_submitted';
      const failureCode=/^[a-z][a-z0-9_]{1,80}$/i.test(String(failure?.providerFailureCode||''))
        ?String(failure.providerFailureCode):'provider_send_unconfirmed';
      const coordinatorCode=!usesProvider&&/^(?:groq|chatgpt)_[a-z0-9_]{1,64}$/.test(String(failure?.orchestratorFailureCode||''))
        ?String(failure.orchestratorFailureCode):null;
      const coordinatorOutcome=!usesProvider&&['rejected','response_invalid'].includes(failure?.orchestratorRequestOutcome)
        ?failure.orchestratorRequestOutcome:null;
      const coordinatorRejected=Boolean(coordinatorCode&&coordinatorOutcome);
      const coordinatorHttpStatus=coordinatorCode&&Number.isSafeInteger(failure?.orchestratorHttpStatus)
        ?failure.orchestratorHttpStatus:null;
      const result={taskId:task.id,reason:notSubmitted?'provider_not_submitted':coordinatorRejected?'coordinator_request_failed':'execution_unconfirmed',
        ...(notSubmitted?{providerStage:String(failure?.providerFailureStage||'unknown'),failureCode}:{}),
        ...(coordinatorCode?{failureCode:coordinatorCode}:{}),...(coordinatorHttpStatus!==null?{httpStatus:coordinatorHttpStatus}:{}),...(reserved.sendActionId?{
        sendActionId:reserved.sendActionId,approvalId:reserved.approvalId}:{})};
      this.transaction(()=>{
        if(reserved.sendActionId)this.store.finishAction(task.id,reserved.sendActionId,notSubmitted?'failed':'indeterminate',result);
        this.finish(reserved.commandId,result,notSubmitted||coordinatorRejected?'failed':'uncertain');
      });
      this.requireAccess(context,operation,input.projectId);
      return this.getReceipt(context,reserved.commandId);
    }
  }
}
