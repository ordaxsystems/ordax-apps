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
      WHERE state IN ('planning_a','sending_a','planning_b','sending_b','planning_final')`)
      .run(this.store.now());
  }
  setNotifier(notify){if(typeof notify!=='function')throw Error('autonomous_notifier_invalid');this.notify=notify;}
  get(id){return this.db.prepare('SELECT * FROM lab_autonomous_dialogues WHERE id=?').get(id)||null;}
  summary(row) {
    if(!row)return null;
    const a=row.task_a_id?this.db.prepare('SELECT chat_url FROM tasks WHERE id=?').get(row.task_a_id):null;
    const b=row.task_b_id?this.db.prepare('SELECT chat_url FROM tasks WHERE id=?').get(row.task_b_id):null;
    const story=row.mode==='story';
    const storedQuality=story?this.db.prepare('SELECT report_json FROM lab_autonomous_story_quality WHERE mission_id=?').get(row.id):null;
    const quality=storedQuality?JSON.parse(storedQuality.report_json):null;
    const turns=story?this.db.prepare('SELECT ordinal,task_id FROM lab_autonomous_story_turns WHERE mission_id=? ORDER BY ordinal').all(row.id):[];
    return {missionId:row.id,projectId:row.project_id,orchestratorId:row.orchestrator_id,
      mode:story?'story':'dialogue',storyCycles:story?2:null,storyTurns:turns.length,quality,
      state:row.state,maxGPTSends:story?STORY_TURNS:row.max_gpt_sends,taskAId:row.task_a_id,taskBId:row.task_b_id,
      questionFinal:row.state==='succeeded'?row.question_final:null,
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
  start(context,{projectId,orchestratorId,mission,requestId,mode='dialogue'}) {
    this.service.requireAccess(context,'autonomous_dialogue_start',projectId);
    const owner=this.service.orchestrator(projectId,orchestratorId);
    if(owner.status!=='ready')throw Error('orchestrator_paused');
    if(!noExtra(mission)||mission.length>4000||!['dialogue','story'].includes(mode))throw Error('autonomous_mission_invalid');
    if(typeof this.service.coordinator?.send!=='function'||
       this.service.coordinator.available?.(projectId,orchestratorId)!==true||
       typeof this.service.provider?.send!=='function')throw Error('autonomous_provider_unavailable');
    const existing=this.db.prepare(`SELECT * FROM lab_autonomous_dialogues WHERE
      workspace_session_id=? AND actor_id=? AND client_id=? AND request_id=?`)
      .get(context.workspaceSessionId,context.actorId,context.clientId,requestId);
    if(existing) {
      if(existing.project_id!==projectId||existing.orchestrator_id!==orchestratorId||existing.mission!==mission||existing.mode!==mode)
        throw Error('autonomous_request_conflict');
      return this.summary(existing);
    }
    if(this.db.prepare(`SELECT 1 FROM lab_autonomous_dialogues
      WHERE state IN ('queued','planning_a','ready_a','sending_a','ready_b','planning_b',
        'ready_final','sending_b','planning_final','story_ready_synthesis') OR (mode='story' AND (state LIKE 'story_queued_%' OR state LIKE 'story_ready_%' OR state LIKE 'story_planning_%' OR state LIKE 'story_sending_%' OR state='story_synthesizing')) LIMIT 1`).get())
      throw Error('autonomous_mission_already_running');
    const id='autonomous_'+randomUUID(),now=this.store.now();
    this.db.prepare(`INSERT INTO lab_autonomous_dialogues
      (id,workspace_session_id,actor_id,client_id,project_id,orchestrator_id,request_id,mission,
        state,max_gpt_sends,created_at,updated_at,mode)
      VALUES(?,?,?,?,?,?,?,?,?,?,?, ?,?)`)
      .run(id,context.workspaceSessionId,context.actorId,context.clientId,projectId,orchestratorId,
        requestId,mission,mode==='story'?'story_queued_1':'queued',LIMIT,now,now,mode);
    this.notify();
    // Initiating a mission is the ONLY operator action. The existing App
    // lifetime tick also resumes queued/ready (never indeterminate) stages.
    queueMicrotask(()=>{void this.tick(context).catch(()=>{});});
    return this.summary(this.get(id));
  }
  move(id,expected,next,patch={}) {
    const allowed=new Set(['question_a','question_b','question_final','task_a_id','task_b_id','last_error']);
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
      ?'Crie apenas UMA pergunta curta e verificável ao GPT A. Não calcule a resposta.'
      :phase==='b'
        ?'Leia a resposta confirmada do GPT A no contexto. Crie UMA pergunta NOVA ao GPT B que DEPENDA dela e cite o resultado comprovado. Não responda à pergunta.'
        :'Leia as respostas confirmadas GPT A e GPT B. Prepare UMA próxima pergunta que DEPENDA da resposta GPT B. Não a envie nem a execute.';
    const response=await this.service.coordinator.send({
      taskId:owner.chat_task_id,projectId:row.project_id,orchestratorId:row.orchestrator_id,
      mission:'MISSÃO AUTÔNOMA com autorização inicial para, no máximo, duas perguntas GPT: '+
        row.mission+'\nETAPA ATUAL: '+directive+(prior?'\nResposta anterior confirmada: '+prior.slice(0,1400):''),
      analysisContext,prepareWork:true,repositoryUrl:null
    });
    const proposal=validateWorkProposal(response?.proposal);
    if(phase!=='a')confirmDependency(proposal,prior);
    if(phase==='b'&&proposal.content===row.question_a)throw Error('autonomous_duplicate_question');
    return proposal;
  }
  async send(row,phase,context) {
    const taskId=phase==='a'?row.task_a_id:row.task_b_id;
    const content=phase==='a'?row.question_a:row.question_b;
    // Reuse the exact host-authorized session object. A lookalike object
    // must never pass the canonical per-process authority predicate.
    this.service.requireAccess(context,'autonomous_dialogue_start',row.project_id);
    assertTaskHasNoUncertainTransport(this.store,taskId);
    const r=await this.service.provider.send({taskId,content,draftRevision:null,taskKind:'work'});
    requireConfirmedChatReceipt(r);
    const answer=this.answer(taskId);
    if(!answer)throw Error('autonomous_provider_response_unconfirmed');
    if(phase==='b') {
      const a=this.db.prepare('SELECT chat_url FROM tasks WHERE id=?').get(row.task_a_id);
      const b=this.db.prepare('SELECT chat_url FROM tasks WHERE id=?').get(taskId);
      if(a?.chat_url===b?.chat_url)throw Error('autonomous_conversations_not_distinct');
    }
  }
  async step(context) {
    const row=this.db.prepare(`SELECT * FROM lab_autonomous_dialogues
      WHERE state IN ('queued','ready_a','ready_b','ready_final','story_ready_synthesis')
        OR (mode='story' AND (state LIKE 'story_queued_%' OR state LIKE 'story_ready_%'))
      ORDER BY created_at,id LIMIT 1`).get();
    if(!row)return {state:'idle'};
    this.service.requireAccess(context,'autonomous_dialogue_start',row.project_id);
    if(context.actorId!==row.actor_id||context.clientId!==row.client_id||
       context.workspaceSessionId!==row.workspace_session_id)throw Error('autonomous_owner_changed');
    if(this.service.orchestrator(row.project_id,row.orchestrator_id).status!=='ready')return {state:'paused'};
    if(this.service.coordinator.available?.(row.project_id,row.orchestrator_id)!==true)
      return {state:'blocked_coordinator'};
    if(this.service.provider.busy?.()||
       this.db.prepare("SELECT 1 FROM runs WHERE status='running' LIMIT 1").get()||
       this.db.prepare("SELECT 1 FROM lab_command_receipts WHERE status='running' LIMIT 1").get())
      return {state:'executor_busy'};
    if(row.mode==='story')return advanceStory(this,context,row);
    let working='';
    try {
      if(row.state==='queued') {
        working='planning_a';this.move(row.id,'queued',working);
        const p=await this.plan(row,'a');
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
        await this.send(row,'a',context);this.move(row.id,working,'ready_b');
      } else if(row.state==='ready_b') {
        working='planning_b';this.move(row.id,'ready_b',working);
        const p=await this.plan(row,'b');
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
        this.move(row.id,working,'planning_final');
        working='planning_final';
        const p=await this.plan(this.get(row.id),'final');
        this.move(row.id,working,'succeeded',{question_final:p.content});
      }
      return {state:'advanced',missionId:row.id};
    } catch(error) {
      if(!working)throw error;
      const unknown=working.startsWith('sending')&&error?.providerDeliveryState!=='not_submitted'
        ||working.startsWith('planning')&&error?.orchestratorRequestOutcome!=='rejected'&&
          error?.orchestratorRequestOutcome!=='response_invalid';
      this.move(row.id,working,unknown?'reconciliation_required':'blocked',
        {last_error:diagnoseAgentFailure({code:error?.providerFailureCode||error?.message,
          stage:working,deliveryState:working.startsWith('sending')
            ?error?.providerDeliveryState||'unknown':'unknown'}).evidence.code});
      return {state:unknown?'reconciliation_required':'blocked',error:boundedError(error)};
    }
  }
  async tick(context){
    if(this.inFlight)return {state:'busy'};
    this.inFlight=true;
    try {
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
