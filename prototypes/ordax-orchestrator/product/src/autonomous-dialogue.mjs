import {randomUUID} from 'node:crypto';
import {validateWorkProposal} from './orchestrator-proposal.mjs';
import {requireConfirmedChatReceipt} from './supervisor-chat-receipt.mjs';
import {assertTaskHasNoUncertainTransport} from './provider-uncertain-run-policy.mjs';
import {advanceStory,STORY_TURNS} from './autonomous-story.mjs';
import {diagnoseAgentFailure} from './agent-failure-diagnosis.mjs';

// One mission, one owner authorization, ONE canonical Store and existing GPT
// executor. A mission's consent covers at most two GPT Web submissions.
// No filesystem/network grants, arbitrary tools, replays or background daemon.
const LIMIT=2;
// These are terminal, known-invalid Groq replies. A single fresh review may
// be attempted after a restart, never after a running/uncertain receipt.
// Citation enums now constrain an invalid-evidence model reply at the source.
const RECOVERABLE_GROQ_REVIEW_FAILURES=new Set([
  'groq_incomplete_response','groq_review_invalid_evidence',
  // This is a fully rejected Groq response, not a GPT transport effect.
  // One idempotent recovery may use the corrected structured step schema.
  'groq_review_invalid_next_step'
]);
const noExtra=value=>typeof value==='string'&&value.trim().length>0;
const boundedError=error=>String(error?.message||error||'autonomous_step_failed').replace(/[^a-z0-9_]/gi,'_').slice(0,90);
const numbers=answer=>[...String(answer||'').matchAll(/\b[0-9]{1,6}\b/g)].map(m=>m[0]).filter(x=>Number(x)!==0);
function confirmDependency(proposal,answer) {
  const numeric=numbers(answer);
  // Numeric answers must be cited in a follow-up question, not guessed.
  if(numeric.length&&numeric.every(value=>!new RegExp('(^|[^0-9])'+value+'([^0-9]|$)').test(proposal.content)))
    throw Error('autonomous_question_ignores_confirmed_answer');
}
export class AutonomousDialogue {
  constructor({store,service,notify=()=>{}}={}) {
    if(!store?.db||!service||typeof notify!=='function')throw Error('autonomous_ports_required');
    this.store=store;this.db=store.db;this.service=service;this.notify=notify;this.inFlight=false;
    this.db.exec(`CREATE TABLE IF NOT EXISTS lab_autonomous_dialogues (
      id TEXT PRIMARY KEY,
      workspace_session_id TEXT NOT NULL REFERENCES workspace_sessions(id),
      actor_id TEXT NOT NULL,client_id TEXT NOT NULL,
      project_id TEXT NOT NULL REFERENCES lab_projects(id),
      orchestrator_id TEXT NOT NULL REFERENCES lab_orchestrators(id),
      request_id TEXT NOT NULL,mission TEXT NOT NULL,
      state TEXT NOT NULL,
      max_gpt_sends INTEGER NOT NULL CHECK(max_gpt_sends=2),
      task_a_id TEXT REFERENCES tasks(id),task_b_id TEXT REFERENCES tasks(id),
      question_a TEXT,question_b TEXT,question_final TEXT,
      last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      UNIQUE(workspace_session_id,actor_id,client_id,request_id)
    );
    CREATE INDEX IF NOT EXISTS idx_lab_autonomous_queue ON lab_autonomous_dialogues(state,created_at);`);
    // Story adds four canonical work Tasks to the SAME mission, Store and
    // provider; max_gpt_sends=2 remains a per-cycle cap for old profiles.
    if(!this.db.prepare("PRAGMA table_info(lab_autonomous_dialogues)").all().some(x=>x.name==='mode'))
      this.db.exec("ALTER TABLE lab_autonomous_dialogues ADD COLUMN mode TEXT NOT NULL DEFAULT 'dialogue' CHECK(mode IN ('dialogue','story'))");
    // Extend the existing mission ledger in place. Technical missions retain
    // mode=dialogue for compatibility and mark their dynamic review strategy.
    const missionColumns=this.db.prepare("PRAGMA table_info(lab_autonomous_dialogues)").all();
    for(const [column,definition] of [
      ['strategy',"TEXT NOT NULL DEFAULT 'legacy' CHECK(strategy IN ('legacy','semantic'))"],
      ['review_a_json','TEXT'],
      ['review_b_json','TEXT'],
      // A new explicit consent renews the existing two-send budget while
      // preserving the exact previous mission and source GPT Run.
      ['origin_mission_id','TEXT REFERENCES lab_autonomous_dialogues(id)'],
      ['origin_run_id','TEXT REFERENCES runs(id)']
    ])if(!missionColumns.some(row=>row.name===column))
      this.db.exec('ALTER TABLE lab_autonomous_dialogues ADD COLUMN '+column+' '+definition);
    this.db.exec(`CREATE TABLE IF NOT EXISTS lab_autonomous_story_turns (
      mission_id TEXT NOT NULL REFERENCES lab_autonomous_dialogues(id),
      ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 4),
      task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
      prompt TEXT NOT NULL,
      PRIMARY KEY(mission_id,ordinal)
    );
    CREATE TABLE IF NOT EXISTS lab_autonomous_story_quality (
      mission_id TEXT PRIMARY KEY REFERENCES lab_autonomous_dialogues(id),
      report_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`);
    this.db.prepare(`UPDATE lab_autonomous_dialogues SET
      state='reconciliation_required',
      last_error='interrupted_story_stage_requires_reconciliation',updated_at=?
      WHERE mode='story' AND (state LIKE 'story_planning_%' OR
        state LIKE 'story_sending_%' OR state='story_synthesizing')`).run(this.store.now());
    // Unknown effect after a process crash must NEVER be replayed.
    this.db.prepare(`UPDATE lab_autonomous_dialogues
      SET state='reconciliation_required',last_error='interrupted_effect_requires_reconciliation',updated_at=?
      WHERE state IN ('planning_a','sending_a','planning_b','sending_b','planning_final',
        'reviewing_a','reviewing_final')`)
      .run(this.store.now());
  }
  setNotifier(notify){if(typeof notify!=='function')throw Error('autonomous_notifier_invalid');this.notify=notify;}
  get(id){return this.db.prepare('SELECT * FROM lab_autonomous_dialogues WHERE id=?').get(id)||null;}
  summary(row) {
    if(!row)return null;
    const a=row.task_a_id?this.db.prepare('SELECT chat_url FROM tasks WHERE id=?').get(row.task_a_id):null;
    const b=row.task_b_id?this.db.prepare('SELECT chat_url FROM tasks WHERE id=?').get(row.task_b_id):null;
    const story=row.mode==='story',semantic=row.strategy==='semantic';
    const storedQuality=story?this.db.prepare('SELECT report_json FROM lab_autonomous_story_quality WHERE mission_id=?').get(row.id):null;
    const quality=storedQuality?JSON.parse(storedQuality.report_json):null;
    const turns=story?this.db.prepare('SELECT ordinal,task_id FROM lab_autonomous_story_turns WHERE mission_id=? ORDER BY ordinal').all(row.id):[];
    // Read-only review handles from the existing Store. These never grant a
    // provider send, retry, or evidence verification.
    const reviewTasks=story
      ?turns.map(turn=>({taskId:turn.task_id,label:'Cena '+turn.ordinal}))
      :[['GPT A',row.task_a_id],['GPT B',row.task_b_id]]
        .filter(([,taskId],i,all)=>typeof taskId==='string'&&taskId.length>0&&
          (!semantic||all.findIndex(([,id])=>id===taskId)===i))
        .map(([label,taskId])=>({taskId,label:semantic?'Trabalho GPT':label}));
    const semanticReview=semantic?(row.review_b_json||row.review_a_json):null;
    let decision=null;
    if(semanticReview){try{decision=JSON.parse(semanticReview);}catch{}}
    return {missionId:row.id,projectId:row.project_id,orchestratorId:row.orchestrator_id,
      mission:row.mission,
      mode:story?'story':semantic?'technical':'dialogue',storyCycles:story?2:null,storyTurns:turns.length,quality,reviewTasks,
      state:row.state,maxGPTSends:story?STORY_TURNS:row.max_gpt_sends,taskAId:row.task_a_id,taskBId:row.task_b_id,
      originMissionId:semantic?row.origin_mission_id||null:null,
      canContinue:semantic&&row.state==='budget_exhausted'&&
        ['continue_same_conversation','request_correction','new_conversation','new_work'].includes(decision?.decision)&&
        typeof decision?.nextPrompt==='string'&&decision.nextPrompt.length>=20&&
        decision.nextPrompt.trim()!==row.question_b?.trim(),
      decision:semantic?decision:null,
      questionFinal:semantic?row.question_final:row.state==='succeeded'?row.question_final:null,
      distinctConfirmedConversations:Boolean(a?.chat_url&&b?.chat_url&&a.chat_url!==b.chat_url),
      lastError:row.last_error,requiresReconciliation:row.state==='reconciliation_required'};
  }
  status(context,{projectId,orchestratorId}){
    this.service.requireAccess(context,'autonomous_dialogue_status',projectId);
    this.service.orchestrator(projectId,orchestratorId);
    const row=this.db.prepare(`SELECT * FROM lab_autonomous_dialogues WHERE
      workspace_session_id=? AND actor_id=? AND client_id=? AND project_id=?
      AND orchestrator_id=? ORDER BY rowid DESC LIMIT 1`)
      .get(context.workspaceSessionId,context.actorId,context.clientId,projectId,orchestratorId);
    return {mission:this.summary(row)};
  }
  start(context,{projectId,orchestratorId,mission,requestId,mode='dialogue',directUserPrompt=false}) {
    this.service.requireAccess(context,'autonomous_dialogue_start',projectId);
    const owner=this.service.orchestrator(projectId,orchestratorId);
    if(owner.status!=='ready')throw Error('orchestrator_paused');
    if(!noExtra(mission)||mission.length>4000||!['dialogue','story','technical'].includes(mode)||
       typeof directUserPrompt!=='boolean'||(directUserPrompt&&mode!=='technical'))
      throw Error('autonomous_mission_invalid');
    if(typeof this.service.coordinator?.send!=='function'||
       this.service.coordinator.available?.(projectId,orchestratorId)!==true||
       typeof this.service.provider?.send!=='function')throw Error('autonomous_provider_unavailable');
    const existing=this.db.prepare(`SELECT * FROM lab_autonomous_dialogues WHERE
      workspace_session_id=? AND actor_id=? AND client_id=? AND request_id=?`)
      .get(context.workspaceSessionId,context.actorId,context.clientId,requestId);
    if(existing) {
      if(existing.project_id!==projectId||existing.orchestrator_id!==orchestratorId||existing.mission!==mission||
        (existing.mode==='story'?'story':existing.strategy==='semantic'?'technical':'dialogue')!==mode||
        (directUserPrompt&&existing.question_a!==mission))
        throw Error('autonomous_request_conflict');
      return this.summary(existing);
    }
    if(this.db.prepare(`SELECT 1 FROM lab_autonomous_dialogues
      WHERE workspace_session_id=? AND
        (state IN ('queued','planning_a','ready_a','sending_a','ready_b','planning_b',
        'ready_final','sending_b','planning_final','reviewing_a','ready_review_final',
        'reviewing_final','story_ready_synthesis') OR
        (mode='story' AND (state LIKE 'story_queued_%' OR state LIKE 'story_ready_%' OR
        state LIKE 'story_planning_%' OR state LIKE 'story_sending_%' OR state='story_synthesizing')))
      LIMIT 1`).get(context.workspaceSessionId))
      throw Error('autonomous_mission_already_running');
    const id='autonomous_'+randomUUID(),now=this.store.now();
    // The first execution of a conversational request must send the user's
    // exact message. Do not let the planner add requirements that were never
    // asked for. Reuse the existing Work/Task, Run and two-send mission ledger.
    this.db.exec('SAVEPOINT autonomous_start_atomic');
    try {
      const initialTask=directUserPrompt?this.service.mutate('work_create',{
        projectId,orchestratorId,title:Array.from(mission.trim().split(/\\r?\\n/u,1)[0]).slice(0,130).join('')
      }).taskId:null;
      this.db.prepare(`INSERT INTO lab_autonomous_dialogues
        (id,workspace_session_id,actor_id,client_id,project_id,orchestrator_id,request_id,mission,
          state,max_gpt_sends,task_a_id,question_a,created_at,updated_at,mode,strategy)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id,context.workspaceSessionId,context.actorId,context.clientId,projectId,orchestratorId,
          requestId,mission,directUserPrompt?'ready_a':mode==='story'?'story_queued_1':'queued',
          LIMIT,initialTask,directUserPrompt?mission:null,now,now,
          mode==='story'?'story':'dialogue',mode==='technical'?'semantic':'legacy');
      this.db.exec('RELEASE SAVEPOINT autonomous_start_atomic');
    } catch(error) {
      this.db.exec('ROLLBACK TO SAVEPOINT autonomous_start_atomic');
      this.db.exec('RELEASE SAVEPOINT autonomous_start_atomic');
      throw error;
    }
    this.notify();
    // Initiating a mission is the ONLY operator action. The existing App
    // lifetime tick also resumes queued/ready (never indeterminate) stages.
    queueMicrotask(()=>{void this.tick(context).catch(()=>{});});
    return this.summary(this.get(id));
  }
  // A second human authorization extends the *same* technical mission chain.
  // One new ledger row represents one bounded two-send consent window; the
  // previous Run, decision, Task and project remain the canonical sources.
  continueTechnical(context,{projectId,orchestratorId,sourceMissionId,requestId}) {
    this.service.requireAccess(context,'autonomous_dialogue_continue',projectId);
    const owner=this.service.orchestrator(projectId,orchestratorId);
    const session=this.store.getWorkspaceSession();
    return this.service.transaction(()=>{
      const existing=this.db.prepare(`SELECT * FROM lab_autonomous_dialogues WHERE
        workspace_session_id=? AND actor_id=? AND client_id=? AND request_id=?`)
        .get(session.id,context.actorId,context.clientId,requestId);
      if(existing) {
        if(existing.origin_mission_id!==sourceMissionId||existing.project_id!==projectId||
           existing.orchestrator_id!==orchestratorId||existing.strategy!=='semantic')
          throw Error('autonomous_request_conflict');
        return this.summary(existing);
      }
      if(owner.status!=='ready'||this.service.coordinator.available?.(projectId,orchestratorId)!==true||
         typeof this.service.provider?.send!=='function')
        throw Error('autonomous_provider_unavailable');
      const previous=this.db.prepare(`SELECT * FROM lab_autonomous_dialogues WHERE
        id=? AND workspace_session_id=? AND actor_id=? AND client_id=?
        AND project_id=? AND orchestrator_id=?`)
        .get(sourceMissionId,session.id,context.actorId,context.clientId,projectId,orchestratorId);
      const latest=this.db.prepare(`SELECT id FROM lab_autonomous_dialogues WHERE
        workspace_session_id=? AND actor_id=? AND client_id=? ORDER BY rowid DESC LIMIT 1`)
        .get(session.id,context.actorId,context.clientId);
      if(!previous||latest?.id!==sourceMissionId||previous.strategy!=='semantic'||
         previous.state!=='budget_exhausted'||!previous.task_b_id||!previous.review_b_json||
         !previous.question_final)
        throw Error('autonomous_continuation_source_unavailable');
      let decision;
      try{decision=JSON.parse(previous.review_b_json);}catch{}
      if(!decision||!['continue_same_conversation','request_correction',
        'new_conversation','new_work'].includes(decision.decision)||
        decision.sourceRunId==null||decision.nextPrompt!==previous.question_final||
        typeof decision.nextPrompt!=='string'||decision.nextPrompt.length<20||
        decision.reviewOnly!==true||decision.externalEffectVerified!==false||
        decision.automaticGPTSendAuthorized!==false||
        decision.nextPrompt.trim()===previous.question_b?.trim())
        throw Error('autonomous_continuation_decision_invalid');
      const source=this.service.reviewableGPTResult(projectId,orchestratorId,decision.sourceRunId);
      if(source?.taskId!==previous.task_b_id||
         this.service.hasUnresolvedWorkReceipt(projectId,previous.task_b_id)||
         String(this.store.getTaskDraft(previous.task_b_id)?.draft||'')!=='')
        throw Error('autonomous_continuation_source_superseded');
      if(this.db.prepare(`SELECT 1 FROM lab_autonomous_dialogues WHERE
        workspace_session_id=? AND (state IN ('queued','planning_a','ready_a',
          'sending_a','ready_b','planning_b','ready_final','sending_b',
          'planning_final','reviewing_a','ready_review_final','reviewing_final')
          OR (mode='story' AND (state LIKE 'story_queued_%' OR state LIKE 'story_ready_%'
            OR state LIKE 'story_planning_%' OR state LIKE 'story_sending_%'
            OR state='story_synthesizing')))
        LIMIT 1`).get(session.id))
        throw Error('autonomous_mission_already_running');
      const id='autonomous_'+randomUUID(),now=this.store.now();
      const taskId=decision.decision==='new_work'
        ?this.service.mutate('work_create',{projectId,orchestratorId,
          title:'Continuação técnica · '+id.slice(-12)}).taskId
        :previous.task_b_id;
      this.db.prepare(`INSERT INTO lab_autonomous_dialogues
        (id,workspace_session_id,actor_id,client_id,project_id,orchestrator_id,
         request_id,mission,state,max_gpt_sends,task_a_id,question_a,
         created_at,updated_at,mode,strategy,origin_mission_id,origin_run_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id,session.id,context.actorId,context.clientId,projectId,orchestratorId,
          requestId,previous.mission,'ready_a',LIMIT,taskId,decision.nextPrompt,
          now,now,'dialogue','semantic',previous.id,source.runId);
      this.notify();
      queueMicrotask(()=>{void this.tick(context).catch(()=>{});});
      return this.summary(this.get(id));
    });
  }
  assertMissionSession(context,row,{allowPaused=false}={}) {
    const session=this.store.getWorkspaceSession();
    // Also recheck after every asynchronous coordinator/provider response:
    // an old workspace can retain durable evidence, not execution authority.
    if(!context||session?.status!=='active'||session.id!==row.workspace_session_id||
      context.workspaceSessionId!==row.workspace_session_id||
      context.actorId!==row.actor_id||context.clientId!==row.client_id)
      throw Error('autonomous_owner_changed');
    this.service.requireAccess(context,'autonomous_dialogue_start',row.project_id);
    if(!allowPaused&&this.service.orchestrator(row.project_id,row.orchestrator_id).status!=='ready')
      throw Error('autonomous_owner_paused');
  }
  move(id,expected,next,patch={}) {
    const allowed=new Set(['question_a','question_b','question_final','task_a_id','task_b_id',
      'last_error','review_a_json','review_b_json']);
    if(Object.keys(patch).some(k=>!allowed.has(k)))throw Error('autonomous_patch_invalid');
    const columns=Object.keys(patch);
    const sql=`UPDATE lab_autonomous_dialogues SET state=?,updated_at=?${columns.map(k=>','+k+'=?').join('')}
      WHERE id=? AND state=?`;
    const args=[next,this.store.now(),...columns.map(k=>patch[k]),id,expected];
    if(this.db.prepare(sql).run(...args).changes!==1)throw Error('autonomous_state_race');
    this.notify();
  }
  answer(taskId) {
    const task=this.db.prepare('SELECT chat_url FROM tasks WHERE id=?').get(taskId);
    const run=this.db.prepare("SELECT status FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 1").get(taskId);
    const text=this.db.prepare("SELECT content FROM messages WHERE task_id=? AND role='assistant' ORDER BY rowid DESC LIMIT 1").get(taskId)?.content;
    const intent=this.db.prepare("SELECT COUNT(*) AS n FROM events WHERE task_id=? AND kind='provider.submission.intent'").get(taskId).n;
    const provenance=this.db.prepare("SELECT COUNT(*) AS n FROM events WHERE task_id=? AND kind='provider.submission.provenance'").get(taskId).n;
    if(run?.status!=='succeeded'||!/^https:\/\/chatgpt\.com\/c\//.test(task?.chat_url||'')||
       !noExtra(text)||intent!==1||provenance!==1)
      throw Error('autonomous_provider_response_unconfirmed');
    return text;
  }
  async plan(row,phase) {
    const owner=this.service.orchestrator(row.project_id,row.orchestrator_id);
    const prior=phase==='a'?null:phase==='b'?this.answer(row.task_a_id):this.answer(row.task_b_id);
    const analysisContext=this.service.analysisContext(row.project_id,row.orchestrator_id);
    const directive=phase==='a'
      ?row.strategy==='semantic'
        ?'Prepare UMA missão inicial concreta para o GPT: investigar ou realizar a tarefa técnica pedida, explicar os efeitos reais e as provas. Não invente alterações nem presuma acesso externo; o modelo GPT será o executor intelectual.'
        :'Crie apenas UMA pergunta curta e verificável ao GPT A. Não calcule a resposta.'
      :phase==='b'
        ?'Leia a resposta confirmada do GPT A no contexto. Crie UMA pergunta NOVA ao GPT B que DEPENDA dela e cite o resultado comprovado. Não responda à pergunta.'
        :'Leia as respostas confirmadas GPT A e GPT B. Prepare UMA próxima pergunta que DEPENDA da resposta GPT B. Não a envie nem a execute.';
    const response=await this.service.withCoordinatorTurn(owner.chat_task_id,()=>this.service.coordinator.send({
      taskId:owner.chat_task_id,projectId:row.project_id,orchestratorId:row.orchestrator_id,
      mission:'MISSÃO AUTÔNOMA com autorização inicial para, no máximo, duas perguntas GPT: '+
        row.mission+'\nETAPA ATUAL: '+directive+(prior?'\nResposta anterior confirmada: '+prior.slice(0,1400):''),
      analysisContext,prepareWork:true,repositoryUrl:null
    }));
    const proposal=validateWorkProposal(response?.proposal);
    if(phase!=='a')confirmDependency(proposal,prior);
    if(phase==='b'&&proposal.content===row.question_a)throw Error('autonomous_duplicate_question');
    return proposal;
  }
  // An engineering mission uses the existing coordinator receipt, NOT a
  // synthetic "OK" detector. Each decision is anchored to the exact latest
  // GPT Run and its canonical provider delivery provenance.
  async reviewTechnical(row,phase,context) {
    const taskId=phase==='a'?row.task_a_id:row.task_b_id;
    const run=this.db.prepare("SELECT id,status FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 1").get(taskId);
    if(!run||run.status!=='succeeded'||
       !this.service.reviewableGPTResult(row.project_id,row.orchestrator_id,run.id))
      throw Error('autonomous_review_source_unconfirmed');
    this.assertMissionSession(context,row);
    const baseRequestId='technical_'+row.id+'_'+phase;
    const firstReceipt=this.db.prepare('SELECT status,result FROM lab_command_receipts WHERE '+
      'workspace_session_id=? AND request_id=?').get(row.workspace_session_id,baseRequestId);
    let firstFailure=null;
    try{firstFailure=JSON.parse(firstReceipt?.result||'null');}catch{}
    // A known terminal Groq parse/evidence failure may be reviewed once
    // more under the strict model schema. No uncertain replay or GPT resend.
    const retry=firstReceipt?.status==='failed'&&
      firstFailure?.reason==='coordinator_request_failed'&&
      RECOVERABLE_GROQ_REVIEW_FAILURES.has(firstFailure?.failureCode);
    const receipt=await this.service.invoke(context,'orchestrator_analyze',{
      projectId:row.project_id,orchestratorId:row.orchestrator_id,
      reviewRunId:run.id,requestId:retry?baseRequestId+'_recovery':baseRequestId
    });
    if(receipt?.status!=='succeeded'||receipt?.result?.responseObserved!==true)
      throw Error('autonomous_semantic_review_unconfirmed');
    const decision=receipt.result.reviewDecision;
    if(decision?.sourceRunId!==run.id||decision.reviewOnly!==true||
      decision.externalEffectVerified!==false||
      decision.automaticGPTSendAuthorized!==false)
      throw Error('autonomous_semantic_decision_unconfirmed');
    this.assertMissionSession(context,row);
    // The user may have sent another GPT message while Groq was reasoning.
    // A decision grounded in a superseded Run cannot route the next action.
    if(!this.service.reviewableGPTResult(row.project_id,row.orchestrator_id,run.id))
      throw Error('autonomous_review_source_superseded');
    return decision;
  }
  async send(row,phase,context) {
    const taskId=phase==='a'?row.task_a_id:row.task_b_id;
    const content=phase==='a'?row.question_a:row.question_b;
    // Reuse the exact host-authorized session object. A lookalike object
    // must never pass the canonical per-process authority predicate.
    this.assertMissionSession(context,row);
    assertTaskHasNoUncertainTransport(this.store,taskId);
    if(row.origin_mission_id&&row.strategy==='semantic'&&phase==='a') {
      const previous=this.get(row.origin_mission_id);
      let decision;
      try{decision=JSON.parse(previous?.review_b_json||'null');}catch{}
      const evidence=this.service.reviewableGPTResult(row.project_id,row.orchestrator_id,row.origin_run_id);
      if(previous?.state!=='budget_exhausted'||!decision||
         previous.task_b_id!==evidence?.taskId||decision.sourceRunId!==row.origin_run_id||
         decision.nextPrompt!==content||String(this.store.getTaskDraft(taskId)?.draft||'')!==''||
         String(this.store.getTaskDraft(previous.task_b_id)?.draft||'')!=='') {
        const error=Error('autonomous_continuation_source_or_draft_changed');
        error.providerDeliveryState='not_submitted';
        throw error;
      }
      // A segment change is made only at the actual, authorized send stage.
      if(decision.decision==='new_conversation')
        this.store.rotateConversation(taskId,'technical_mission_continuation');
    }
    if(row.strategy==='semantic'&&phase==='b') {
      const decision=JSON.parse(row.review_a_json||'null');
      const sourceRun=this.db.prepare("SELECT id FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 1")
        .get(row.task_a_id);
      const draft=this.store.getTaskDraft(taskId);
      if(!decision||row.question_b!==decision.nextPrompt||
         decision.sourceRunId!==sourceRun?.id||draft.draft!=='') {
        // No second provider call was made, so this can be safely blocked.
        const error=Error('autonomous_semantic_source_or_draft_changed');
        error.providerDeliveryState='not_submitted';
        throw error;
      }
      if(decision.decision==='new_conversation')
        this.store.rotateConversation(taskId,'technical_mission_review');
    }
    const r=await this.service.provider.send({taskId,content,draftRevision:null,taskKind:'work'});
    requireConfirmedChatReceipt(r);
    if(row.strategy==='semantic') {
      const run=this.db.prepare("SELECT id,status FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 1").get(taskId);
      if(run?.status!=='succeeded'||(r.runId&&r.runId!==run.id)||
        !this.service.reviewableGPTResult(row.project_id,row.orchestrator_id,run.id))
        throw Error('autonomous_provider_response_unconfirmed');
    }else{
      const answer=this.answer(taskId);
      if(!answer)throw Error('autonomous_provider_response_unconfirmed');
      if(phase==='b') {
        const a=this.db.prepare('SELECT chat_url FROM tasks WHERE id=?').get(row.task_a_id);
        const b=this.db.prepare('SELECT chat_url FROM tasks WHERE id=?').get(taskId);
        if(a?.chat_url===b?.chat_url)throw Error('autonomous_conversations_not_distinct');
      }
    }
  }
  async step(context) {
    const session=this.store.getWorkspaceSession();
    if(!context||session?.status!=='active'||session.id!==context.workspaceSessionId)
      return {state:'blocked_workspace'};
    // Historical queued missions are retained, but never select or starve
    // a current mission. The same applies to a different owner/client.
    const row=this.db.prepare(`SELECT * FROM lab_autonomous_dialogues
      WHERE workspace_session_id=? AND actor_id=? AND client_id=? AND
        (state IN ('queued','ready_a','ready_b','ready_final','ready_review_final','story_ready_synthesis')
        OR (mode='story' AND (state LIKE 'story_queued_%' OR state LIKE 'story_ready_%')))
      ORDER BY created_at,id LIMIT 1`).get(context.workspaceSessionId,context.actorId,context.clientId);
    if(!row)return {state:'idle'};
    this.assertMissionSession(context,row,{allowPaused:true});
    if(this.service.orchestrator(row.project_id,row.orchestrator_id).status!=='ready')return {state:'paused'};
    if(this.service.coordinator.available?.(row.project_id,row.orchestrator_id)!==true)
      return {state:'blocked_coordinator'};
    // Busy is a wait condition, not an uncertain autonomous API effect.
    if(this.service.coordinatorTurnBusy(this.service.orchestrator(row.project_id,row.orchestrator_id).chat_task_id))
      return {state:'coordinator_busy'};
    // Semantic planning and evidence review run only on the independent
    // Groq coordinator lane. An occupied GPT WebContentsView must not
    // prevent classifying an already confirmed response or stopping work.
    const coordinatorOnly=row.strategy==='semantic'&&
      ['queued','ready_b','ready_review_final'].includes(row.state);
    if(!coordinatorOnly&&this.service.executorAdmission().availableSlots===0)
      return {state:'executor_busy'};
    if(row.mode==='story')return advanceStory(this,context,row);
    let working='';
    try {
      if(row.state==='queued') {
        working='planning_a';this.move(row.id,'queued',working);
        const p=await this.plan(row,'a');
        this.assertMissionSession(context,row);
        this.db.exec('SAVEPOINT autonomous_work_creation');
        try {
          const task=this.service.mutate('work_create',{projectId:row.project_id,
            orchestratorId:row.orchestrator_id,title:p.title});
          this.move(row.id,working,'ready_a',{task_a_id:task.taskId,question_a:p.content});
          this.db.exec('RELEASE SAVEPOINT autonomous_work_creation');
        } catch(error) {
          this.db.exec('ROLLBACK TO SAVEPOINT autonomous_work_creation');
          this.db.exec('RELEASE SAVEPOINT autonomous_work_creation');
          throw error;
        }
      } else if(row.state==='ready_a') {
        working='sending_a';this.move(row.id,'ready_a',working);
        await this.send(row,'a',context);
        this.assertMissionSession(context,row);
        this.move(row.id,working,'ready_b');
      } else if(row.state==='ready_b'&&row.strategy==='semantic') {
        working='reviewing_a';this.move(row.id,'ready_b',working);
        const decision=await this.reviewTechnical(row,'a',context);
        this.assertMissionSession(context,row);
        const review_a_json=JSON.stringify(decision);
        if(['verify_external_effect','candidate_complete','blocked'].includes(decision.decision)) {
          this.move(row.id,working,decision.decision==='blocked'?'blocked':'verification_required',
            {review_a_json});
        }else{
          // The owner authorized up to two GPT submissions at mission start.
          // Groq determines WHAT to do next, but cannot grant more sends.
          const next=decision.nextPrompt;
          if(typeof next!=='string'||next.length<20)throw Error('autonomous_semantic_next_step_missing');
          this.db.exec('SAVEPOINT semantic_work_binding');
          try{
            const taskId=decision.decision==='new_work'
              ?this.service.mutate('work_create',{projectId:row.project_id,
                orchestratorId:row.orchestrator_id,
                title:'Etapa técnica · '+row.id.slice(-12)}).taskId
              :row.task_a_id;
            this.move(row.id,working,'ready_final',{
              task_b_id:taskId,question_b:next,review_a_json});
            this.db.exec('RELEASE SAVEPOINT semantic_work_binding');
          }catch(error){
            this.db.exec('ROLLBACK TO SAVEPOINT semantic_work_binding');
            this.db.exec('RELEASE SAVEPOINT semantic_work_binding');
            throw error;
          }
        }
      } else if(row.state==='ready_b') {
        working='planning_b';this.move(row.id,'ready_b',working);
        const p=await this.plan(row,'b');
        this.assertMissionSession(context,row);
        this.db.exec('SAVEPOINT autonomous_work_creation');
        try {
          const task=this.service.mutate('work_create',{projectId:row.project_id,
            orchestratorId:row.orchestrator_id,title:p.title});
          this.move(row.id,working,'ready_final',{task_b_id:task.taskId,question_b:p.content});
          this.db.exec('RELEASE SAVEPOINT autonomous_work_creation');
        } catch(error) {
          this.db.exec('ROLLBACK TO SAVEPOINT autonomous_work_creation');
          this.db.exec('RELEASE SAVEPOINT autonomous_work_creation');
          throw error;
        }
      } else if(row.state==='ready_final') {
        working='sending_b';this.move(row.id,'ready_final',working);
        await this.send(row,'b',context);
        this.assertMissionSession(context,row);
        if(row.strategy==='semantic') {
          this.move(row.id,working,'ready_review_final');
        }else{
          this.move(row.id,working,'planning_final');
          working='planning_final';
          const p=await this.plan(this.get(row.id),'final');
          this.assertMissionSession(context,row);
          this.move(row.id,working,'succeeded',{question_final:p.content});
        }
      } else if(row.state==='ready_review_final'&&row.strategy==='semantic') {
        working='reviewing_final';this.move(row.id,'ready_review_final',working);
        const decision=await this.reviewTechnical(row,'final',context);
        this.assertMissionSession(context,row);
        this.move(row.id,working,
          decision.decision==='blocked'?'blocked':
            ['verify_external_effect','candidate_complete'].includes(decision.decision)
              ?'verification_required':'budget_exhausted',{
          review_b_json:JSON.stringify(decision),question_final:decision.nextPrompt||null
        });
      }
      return {state:'advanced',missionId:row.id};
    } catch(error) {
      if(!working)throw error;
      const unknown=working.startsWith('sending')&&error?.providerDeliveryState!=='not_submitted'
        ||working.startsWith('reviewing')
        ||working.startsWith('planning')&&error?.orchestratorRequestOutcome!=='rejected'&&
          error?.orchestratorRequestOutcome!=='response_invalid';
      this.move(row.id,working,unknown?'reconciliation_required':'blocked',
        {last_error:diagnoseAgentFailure({code:error?.providerFailureCode||error?.message,
          stage:working,deliveryState:working.startsWith('sending')
            ?error?.providerDeliveryState||'unknown':'unknown'}).evidence.code});
      return {state:unknown?'reconciliation_required':'blocked',error:boundedError(error)};
    }
  }
  // A previously confirmed GPT send can outlive the response observation
  // deadline. The linked-thread reconciler may later commit exactly that
  // response; re-enter semantic review ONLY after immutable Run evidence.
  // No provider interaction or replay occurs in this method.
  resumeReconciledTechnical(context) {
    const session=this.store.getWorkspaceSession();
    if(!context||session?.status!=='active'||
       context.workspaceSessionId!==session.id)return false;
    // Never revive an older mission after the owner started a newer one.
    const row=this.db.prepare('SELECT * FROM lab_autonomous_dialogues WHERE '+
      'workspace_session_id=? AND actor_id=? AND client_id=? ORDER BY rowid DESC LIMIT 1')
      .get(session.id,context.actorId,context.clientId);
    if(!row||row.state!=='reconciliation_required'||row.strategy!=='semantic'||
       row.mode!=='dialogue'||!['response_not_observed','autonomous_semantic_review_unconfirmed'].includes(row.last_error)||
       !row.task_a_id||!row.question_a||row.question_final||row.review_b_json)return false;
    // Recovery is possible after either confirmed GPT turn, never between
    // turns or when the prior Groq decision has been replaced.
    const finalPhase=Boolean(row.task_b_id||row.question_b||row.review_a_json);
    if(finalPhase){
      if(!row.task_b_id||!row.question_b||!row.review_a_json)return false;
      let prior=null;
      try{prior=JSON.parse(row.review_a_json);}catch{return false;}
      const continued=['continue_same_conversation','request_correction',
        'new_conversation','new_work'].includes(prior?.decision);
      const source=this.db.prepare('SELECT status FROM runs WHERE id=? AND task_id=?')
        .get(prior?.sourceRunId,row.task_a_id);
      if(!continued||prior.nextPrompt!==row.question_b||prior.reviewOnly!==true||
         prior.externalEffectVerified!==false||prior.automaticGPTSendAuthorized!==false||
         source?.status!=='succeeded'||
         (prior.decision==='new_work')!==(row.task_b_id!==row.task_a_id))return false;
    }
    this.assertMissionSession(context,row,{allowPaused:true});
    // Another project's scoped Groq receipt must not starve this recovery.
    // Unknown/unscoped receipts and same-project uncertainty remain fail-closed;
    // the running GPT gate remains global (one physical executor).
    if(this.db.prepare("SELECT 1 FROM runs WHERE status='running' LIMIT 1").get()||
       this.db.prepare("SELECT 1 FROM lab_command_receipts WHERE (project_id=? OR project_id IS NULL) "+
         "AND status IN ('running','uncertain') LIMIT 1").get(row.project_id))
      return false;
    const taskId=finalPhase?row.task_b_id:row.task_a_id;
    const question=finalPhase?row.question_b:row.question_a;
    const previous=row.origin_mission_id?this.get(row.origin_mission_id):null;
    const origin=previous?this.db.prepare('SELECT task_id,status FROM runs WHERE id=?')
      .get(row.origin_run_id):null;
    let previousDecision=null;
    if(previous){try{previousDecision=JSON.parse(previous.review_b_json);}catch{}}
    if(row.origin_mission_id&&(previous?.state!=='budget_exhausted'||
       previousDecision?.sourceRunId!==row.origin_run_id||
       origin?.task_id!==previous.task_b_id||origin.status!=='succeeded'))return false;
    const initialCount=previous&&taskId===previous.task_b_id
      ?this.db.prepare('SELECT COUNT(*) n FROM runs WHERE task_id=? AND rowid BETWEEN 1 AND (SELECT rowid FROM runs WHERE id=?)').get(taskId,row.origin_run_id).n
      :0;
    const expectedRuns=initialCount+(finalPhase&&taskId===row.task_a_id?2:1);
    const task=this.db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId);
    const count=this.db.prepare('SELECT COUNT(*) n FROM runs WHERE task_id=?').get(taskId)?.n;
    const run=this.db.prepare('SELECT id,status FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 1').get(taskId);
    const user=this.db.prepare("SELECT content FROM messages WHERE task_id=? AND role='user' ORDER BY rowid DESC LIMIT 1").get(taskId);
    if(task?.status!=='ready'||count!==expectedRuns||run?.status!=='succeeded'||
       user?.content?.trim()!==question.trim()||
       String(this.store.getTaskDraft(taskId)?.draft||'').trim())return false;
    const event=kind=>this.db.prepare("SELECT 1 FROM events WHERE task_id=? AND kind=? "+
      "AND json_extract(payload,'$.run_id')=? LIMIT 1").get(taskId,kind,run.id);
    if(!event('provider.submission.provenance')||
       (row.last_error==='response_not_observed'&&!event('provider.response.reconciled'))||
       !this.service.reviewableGPTResult(row.project_id,row.orchestrator_id,run.id))
      return false;
    if(row.last_error==='autonomous_semantic_review_unconfirmed'){
      // Only a known terminal Groq review error is eligible. The retry has
      // its OWN idempotent receipt and must not be attempted twice.
      const requestId='technical_'+row.id+'_'+(finalPhase?'final':'a');
      const first=this.db.prepare('SELECT status,result FROM lab_command_receipts '+
        'WHERE workspace_session_id=? AND request_id=?').get(row.workspace_session_id,requestId);
      const retried=this.db.prepare('SELECT 1 FROM lab_command_receipts '+
        'WHERE workspace_session_id=? AND request_id=?').get(row.workspace_session_id,requestId+'_recovery');
      let evidence=null;
      try{evidence=JSON.parse(first?.result||'null');}catch{}
      if(retried||first?.status!=='failed'||evidence?.reason!=='coordinator_request_failed'||
         !RECOVERABLE_GROQ_REVIEW_FAILURES.has(evidence?.failureCode))return false;
    }
    // A state transition, never a second GPT submission. The existing
    // reviewTechnical() owns the deterministic Groq review request receipt.
    this.move(row.id,'reconciliation_required',finalPhase?'ready_review_final':'ready_b',
      {last_error:null});
    return true;
  }
  async tick(context){
    const session=this.store.getWorkspaceSession();
    if(!context||session?.status!=='active'||session.id!==context.workspaceSessionId)
      return {state:'blocked_workspace'};
    if(this.inFlight)return {state:'busy'};
    this.inFlight=true;
    try {
      // Recovery changes only the mission state after canonical reconciliation.
      // The ordinary state machine performs the Groq review and any authorized
      // next step, with its existing two-send budget and idempotent receipts.
      this.resumeReconciledTechnical(context);
      // One complete authorized mission in one handoff. Yield between durable
      // stages, while allowing a separate App event to stop at any blocker.
      let result={state:'idle'};
      for(let i=0;i<STORY_TURNS*2+2;i++){
        result=await this.step(context);
        if(result.state!=='advanced')return result;
      }
      return result;
    }finally{this.inFlight=false;}
  }
}
