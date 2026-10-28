import {randomUUID,createHash} from 'node:crypto';
import {ORCHESTRATOR_CONTRACT,ORCHESTRATOR_TOOLS,validateOrchestratorInput} from './orchestrator-contract.mjs';
import {assertTaskHasNoUncertainTransport,listTaskUncertainTransportRuns} from './provider-uncertain-run-policy.mjs';
import {requireConfirmedChatReceipt} from './supervisor-chat-receipt.mjs';
import {redactOrchestratorAnalysisText} from './orchestrator-analysis-text.mjs';
import {validateWorkProposal} from './orchestrator-proposal.mjs';
import {LabContinuation} from './lab-continuation.mjs';
import {ProjectWorkspace} from './project-workspace.mjs';
import {appendRemoteRepositoryInstructions,normalizeGitHubRepositoryUrl} from './remote-repository-context.mjs';

const GROQ_FALLBACK_HEALTH_FAILURES=new Set([
  'chatgpt_login_required','chatgpt_session_not_observed','chatgpt_verification_required',
  'chatgpt_provider_backend_access_restricted','chatgpt_provider_rate_limited_observed',
  'provider_health_unavailable','provider_health_observation_timeout'
]);

function missionProjectName(mission) {
  const firstLine=String(mission||'').trim().split(/\r?\n/u,1)[0].trim();
  const firstSentence=firstLine.split(/(?<=[.!?])\s+/u,1)[0].trim();
  return Array.from(firstSentence).slice(0,140).join('')||'Novo projeto';
}

// App-owned domain only. Reuses Store/Task/Run/messages; no second SQLite,
// provider worker, device executor, identity, grants or global Memory service.
export class OrchestratorService {
  constructor({store,authorize,provider=null,coordinator=null,confirmProposal=null,confirmProposalSend=null,workspacePort=null}={}) {
    if(!store?.db || typeof authorize!=='function')throw Error('orchestrator_ports_required');
    this.store=store; this.db=store.db; this.authorize=authorize;
    this.provider=provider; this.coordinator=coordinator;
    this.confirmProposal=confirmProposal;
    this.confirmProposalSend=confirmProposalSend;
    this.pendingProposalReviews=new Set();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lab_projects (
        id TEXT PRIMARY KEY, workspace_session_id TEXT NOT NULL REFERENCES workspace_sessions(id),
        name TEXT NOT NULL, objective TEXT NOT NULL, created_at TEXT NOT NULL,
        repository_url TEXT
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
    if(!receiptSchema.includes("'failed'"))this.transaction(()=>{
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
    if(!this.db.prepare('PRAGMA table_info(lab_projects)').all().some(column=>column.name==='repository_url'))
      this.db.exec('ALTER TABLE lab_projects ADD COLUMN repository_url TEXT');
    this.continuation=new LabContinuation({store,service:this});
    this.workspace=new ProjectWorkspace({store,port:workspacePort});
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
      const rows=this.db.prepare("SELECT result FROM lab_command_receipts WHERE status='running' AND operation='proposal_send'").all();
      for(const row of rows) {
        const result=row.result?JSON.parse(row.result):null;
        if(result?.sendActionId&&result?.taskId)this.store.finishAction(result.taskId,result.sendActionId,'indeterminate',
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

  assertProviderTaskAvailable(taskId,{allowCoordinator=false}={}) {
    const binding=this.db.prepare(`SELECT b.kind,o.status FROM lab_task_bindings b
      JOIN lab_orchestrators o ON o.id=b.orchestrator_id WHERE b.task_id=?`).get(taskId);
    if(binding?.kind==='orchestrator'&&!allowCoordinator)throw Error('orchestrator_coordinator_channel_required');
    if(allowCoordinator&&binding?.kind!=='orchestrator')throw Error('orchestrator_coordinator_task_required');
    if(binding?.status==='paused')throw Error('orchestrator_paused');
    if(this.db.prepare("SELECT 1 FROM lab_command_receipts WHERE status='uncertain' AND json_extract(result,'$.taskId')=?").get(taskId))
      throw Error('orchestrator_reconciliation_required');
  }

  receipt(row) {
    return {commandId:row.id,operation:row.operation,status:row.status,
      requiresReconciliation:row.status==='uncertain',
      result:row.result?JSON.parse(row.result):null,updatedAt:row.updated_at};
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
      return {proposals:this.db.prepare(`SELECT id,payload,status,result FROM action_ledger WHERE task_id=?
        AND action_type='orchestrator.work-proposal' AND status IN ('pending','succeeded') ORDER BY created_at DESC,id LIMIT 50`)
        .all(owner.chat_task_id).flatMap(row=>{
          const payload=JSON.parse(row.payload);
          if(payload.actorId!==context.actorId||payload.clientId!==context.clientId)return [];
          const proposal={actionId:row.id,status:'pending',...validateWorkProposal(payload.proposal)};
          if(row.status==='pending')return [proposal];
          const result=row.result?JSON.parse(row.result):null;
          if(!result?.approved||!result.taskId)return [];
          const task=this.preparedTask(input.projectId,input.orchestratorId,result.taskId);
          if(!task||!task.draft.trim()||task.has_messages||task.has_runs||task.has_send)return [];
          return [{...proposal,status:'prepared',taskId:task.id,title:task.title,content:task.draft,draftRevision:task.draft_revision}];
        })};
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
      continuationEnabled:Number(this.db.prepare('SELECT COUNT(*) n FROM lab_continuation_policies WHERE enabled=1').get().n),
      coordinatorAvailable:this.coordinator?.available?.()===true,
      providerExecutionAvailable:typeof this.provider?.send==='function',
      activeRuns:Number(this.db.prepare("SELECT COUNT(*) n FROM runs WHERE status='running'").get().n),
      uncertainCommands:Number(this.db.prepare(`SELECT COUNT(*) n FROM lab_command_receipts
        WHERE status='uncertain' AND workspace_session_id=? AND actor_id=? AND client_id=?`)
        .get(context.workspaceSessionId,context.actorId,context.clientId).n)
    };
    if(operation==='projects_list')return {projects:this.db.prepare(
      'SELECT id,name,objective,repository_url,created_at FROM lab_projects WHERE workspace_session_id=? ORDER BY created_at,id LIMIT 200')
      .all(context.workspaceSessionId).filter(row=>this.authorize({context,operation,projectId:row.id})===true)};
    if(operation==='orchestrators_list')return {orchestrators:this.db.prepare(
      'SELECT * FROM lab_orchestrators WHERE project_id=? ORDER BY created_at,id LIMIT 100').all(input.projectId)};
    if(operation==='work_list')return {works:this.db.prepare(`SELECT t.id,t.title,t.status,t.updated_at,
      b.orchestrator_id,(SELECT COUNT(*) FROM task_conversations c WHERE c.task_id=t.id) provider_segments
      FROM tasks t JOIN lab_task_bindings b ON b.task_id=t.id
      WHERE b.project_id=? AND b.kind='work' AND (? IS NULL OR b.orchestrator_id=?)
      AND t.workspace_session_id=? ORDER BY t.updated_at DESC,t.id LIMIT 200`)
      .all(input.projectId,input.orchestratorId||null,input.orchestratorId||null,context.workspaceSessionId)};
    if(operation==='work_get') {
      const task=this.task(input.projectId,input.taskId);
      const runs=this.db.prepare(`SELECT id,status,started_at,completed_at,heartbeat_at
        FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 10`).all(task.id);
      return {...task,runs,conversations:this.store.listConversations(task.id).slice(-50),
        pendingApprovals:this.store.pendingApprovals(task.id).map(a=>({id:a.id,status:a.status,actionId:a.action_id})),
        monitor:this.monitor(task,runs)};
    }
    if(operation==='work_messages') {
      this.task(input.projectId,input.taskId);
      const page=this.store.messagesPage(input.taskId,{before:input.before||null,limit:input.limit||50});
      return {...page,messages:page.messages.map(m=>({id:m.id,role:m.role,content:m.content,created_at:m.created_at}))};
    }
    if(operation==='command_get')return this.getReceipt(context,input.commandId);
    throw Error('orchestrator_unknown_operation');
  }

  monitor(task,runs) {
    const command=this.db.prepare(`SELECT status,result FROM lab_command_receipts
      WHERE json_extract(result,'$.taskId')=? ORDER BY rowid DESC LIMIT 1`).get(task.id);
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

  analysisContext(projectId,orchestratorId) {
    const owner=this.orchestrator(projectId,orchestratorId);
    const project=this.db.prepare(`SELECT name,objective FROM lab_projects
      WHERE id=? AND workspace_session_id=?`).get(projectId,this.store.getWorkspaceSession().id);
    if(!project)throw Error('orchestrator_project_unavailable');
    const rows=this.db.prepare(`SELECT t.id,t.title,t.status,t.updated_at,
      (SELECT COUNT(*) FROM task_conversations c WHERE c.task_id=t.id) provider_segments
      FROM tasks t JOIN lab_task_bindings b ON b.task_id=t.id
      WHERE b.project_id=? AND b.orchestrator_id=? AND b.kind='work'
        AND t.workspace_session_id=? ORDER BY t.updated_at DESC,t.id LIMIT 4`)
      .all(projectId,orchestratorId,this.store.getWorkspaceSession().id);
    return {
      project:{name:redactOrchestratorAnalysisText(project.name,160),objective:redactOrchestratorAnalysisText(project.objective,600)},
      orchestrator:{name:redactOrchestratorAnalysisText(owner.name,160),mission:redactOrchestratorAnalysisText(owner.mission,800)},
      scope:{includedWorkCount:rows.length,workLimit:4,messageLimitPerWork:5},
      works:rows.map(row=>{
        const runs=this.db.prepare(`SELECT status,started_at,completed_at,heartbeat_at
          FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 3`).all(row.id);
        const messages=this.store.messages(row.id,{limit:5}).map(message=>({
          role:message.role,content:redactOrchestratorAnalysisText(message.content,1200),createdAt:message.created_at
        }));
        return {title:redactOrchestratorAnalysisText(row.title,180),status:row.status,updatedAt:row.updated_at,
          providerSegments:row.provider_segments,monitor:this.monitor(row,runs),runs,messages};
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
    if(operation==='project_repository_set') {
      const repositoryUrl=normalizeGitHubRepositoryUrl(input.repositoryUrl);
      const project=this.db.prepare(`SELECT repository_url FROM lab_projects
        WHERE id=? AND workspace_session_id=?`).get(input.projectId,this.store.getWorkspaceSession().id);
      if(!project)throw Error('orchestrator_project_unavailable');
      if(project.repository_url!==repositoryUrl) {
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
      this.orchestrator(input.projectId,input.orchestratorId);
      this.db.prepare('UPDATE lab_orchestrators SET status=? WHERE id=?')
        .run(input.paused?'paused':'ready',input.orchestratorId);
      return {orchestratorId:input.orchestratorId,status:input.paused?'paused':'ready'};
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
    if(this.provider.busy?.()||this.db.prepare("SELECT 1 FROM runs WHERE status='running' LIMIT 1").get()||
      this.db.prepare("SELECT 1 FROM lab_command_receipts WHERE status='running' LIMIT 1").get())
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

  async dispatch(context,operation,input,preparedSend=null) {
    const existing=this.db.prepare(`SELECT id,input_hash FROM lab_command_receipts WHERE workspace_session_id=?
      AND actor_id=? AND client_id=? AND request_id=?`).get(context.workspaceSessionId,
      context.actorId,context.clientId,input.requestId);
    // Return an accepted command even if the provider is now offline; never replay.
    if(existing)return this.transaction(()=>this.reserve(context,operation,input).existing);
    const isWorkSend=operation==='work_send'||operation==='proposal_send';
    const gptWebChat=operation==='orchestrator_chat';
    const usesProvider=isWorkSend||gptWebChat;
    const sendInput=preparedSend||input;
    const orch=isWorkSend?null:this.orchestrator(input.projectId,input.orchestratorId);
    const task=isWorkSend?this.task(input.projectId,sendInput.taskId,'work'):
      this.task(input.projectId,orch.chat_task_id,'orchestrator');
    const owner=orch||this.orchestrator(input.projectId,task.orchestrator_id);
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
    const providerChatDraft=gptWebChat&&input.draftRevision!==undefined;
    if(providerChatDraft) {
      const draft=this.store.getTaskDraft(task.id);
      if(draft.draft_revision!==input.draftRevision||draft.draft.trim()!==content.trim())
        throw Error('task_draft_revision_conflict');
      if(!Number.isSafeInteger(input.draftRevision+1))throw Error('invalid_task_draft_revision');
    }
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
    assertTaskHasNoUncertainTransport(this.store,task.id);
    // A single global executor until multi-session E2E proves concurrency.
    if(this.db.prepare("SELECT 1 FROM lab_command_receipts WHERE status='running' LIMIT 1").get()||
      this.db.prepare("SELECT 1 FROM runs WHERE status='running' LIMIT 1").get()||this.provider?.busy?.())
      throw Error('orchestrator_executor_busy');
    // Advisory API replies cannot submit GPT work. Preserve their uncertain
    // receipts without replay, but allow a fresh explicit API request. Only
    // uncertain provider submissions quarantine the work transport.
    if(isWorkSend&&this.db.prepare("SELECT 1 FROM lab_command_receipts WHERE status='uncertain' AND json_extract(result,'$.taskId')=?").get(task.id))
      throw Error('orchestrator_reconciliation_required');
    const reserved=this.transaction(()=>{
      this.requireAccess(context,operation,input.projectId);
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
        draftRevision:providerChatDraft?input.draftRevision+1:sendInput.draftRevision??null,
        taskKind:gptWebChat?'orchestrator':isWorkSend?'work':null,
        mission:owner.mission,projectId:input.projectId,orchestratorId:owner.id,analysisContext,prepareWork,
        workspaceObservation,repositoryUrl});
      this.requireAccess(context,operation,input.projectId);
      if(!usesProvider) {
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
      // The central chat is the GPT executor, never an implicit Groq chat.
      // A failed, unavailable, or uncertain GPT submission must not be
      // replaced with an answer from a different model.
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
