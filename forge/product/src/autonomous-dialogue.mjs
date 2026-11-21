import {redactOrchestratorAnalysisText} from './orchestrator-analysis-text.mjs';
import {technicalMissionPolicy} from './technical-mission-policy.mjs';
import {normalizedHtmlControlChecks} from './isolated-html-controls.mjs';

// Read-only compatibility projection of historical autonomous mission records.
// No new mission, retry, provider send, scheduler or continuation can start here.
const LIMIT=2;
export class AutonomousDialogue {
  constructor({store,service}={}) {
    if(!store?.db||!service)throw Error('autonomous_ports_required');
    this.store=store;this.db=store.db;this.service=service;
    this.db.exec(`CREATE TABLE IF NOT EXISTS lab_autonomous_dialogues (
      id TEXT PRIMARY KEY,
      workspace_session_id TEXT NOT NULL REFERENCES workspace_sessions(id),
      actor_id TEXT NOT NULL,client_id TEXT NOT NULL,
      project_id TEXT NOT NULL REFERENCES lab_projects(id),
      orchestrator_id TEXT NOT NULL REFERENCES lab_orchestrators(id),
      request_id TEXT NOT NULL,mission TEXT NOT NULL,
      state TEXT NOT NULL,
      max_gpt_sends INTEGER NOT NULL CHECK(max_gpt_sends=2),
      followup_policy TEXT NOT NULL DEFAULT 'two_send' CHECK(followup_policy IN ('two_send','review_only')),
      task_a_id TEXT REFERENCES tasks(id),task_b_id TEXT REFERENCES tasks(id),
      question_a TEXT,question_b TEXT,question_final TEXT,
      last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      UNIQUE(workspace_session_id,actor_id,client_id,request_id)
    );
    CREATE INDEX IF NOT EXISTS idx_lab_autonomous_queue ON lab_autonomous_dialogues(state,created_at);`);
    // Continuous execution is a project/coordinator preference on the
    // canonical owner row, never a second mission database or broker.
    if(!this.db.prepare('PRAGMA table_info(lab_orchestrators)').all()
      .some(column=>column.name==='continuous_execution_enabled'))
      this.db.exec('ALTER TABLE lab_orchestrators ADD COLUMN continuous_execution_enabled INTEGER NOT NULL DEFAULT 0 CHECK(continuous_execution_enabled IN (0,1))');
    // Story uses its existing four-turn mission; this preference applies
    // only to technical continuation with independently confirmed Runs.
    if(!this.db.prepare("PRAGMA table_info(lab_autonomous_dialogues)").all().some(x=>x.name==='mode'))
      this.db.exec("ALTER TABLE lab_autonomous_dialogues ADD COLUMN mode TEXT NOT NULL DEFAULT 'dialogue' CHECK(mode IN ('dialogue','story'))");
    // Extend the existing mission ledger in place. Technical missions retain
    // mode=dialogue for compatibility and mark their dynamic review strategy.
    const missionColumns=this.db.prepare("PRAGMA table_info(lab_autonomous_dialogues)").all();
    for(const [column,definition] of [
      ['strategy',"TEXT NOT NULL DEFAULT 'legacy' CHECK(strategy IN ('legacy','semantic'))"],
      ['review_a_json','TEXT'],
      ['followup_policy',"TEXT NOT NULL DEFAULT 'two_send' CHECK(followup_policy IN ('two_send','review_only'))"],
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
    // Older releases persisted automated GPT submissions with role=user
    // and no author_source, making the UI falsely call them "Você".
    // Reclassify only messages whose exact text, Task and Run timestamp
    // match the original mission ledger. Do not change the transcript,
    // submission receipts, run state or replay any provider request.
    if(!this.db.prepare(
      "SELECT 1 FROM store_migrations WHERE name='automatic-message-author-v1'").get()){
      this.db.exec('BEGIN IMMEDIATE');
      try{
        this.db.prepare(`UPDATE messages SET author_source='orchestrator'
          WHERE role='user' AND author_source='human' AND EXISTS (
            SELECT 1 FROM lab_autonomous_dialogues a
            JOIN runs r ON r.task_id=messages.task_id
            WHERE (
              (a.task_a_id=messages.task_id AND a.question_a=messages.content) OR
              (a.task_b_id=messages.task_id AND a.question_b=messages.content)
            )
            AND ABS(unixepoch(r.started_at)-unixepoch(messages.created_at))<=2
          )`).run();
        this.db.prepare('INSERT INTO store_migrations(name,applied_at) VALUES(?,?)')
          .run('automatic-message-author-v1',this.store.now());
        this.db.exec('COMMIT');
      }catch(error){
        if(this.db.isTransaction)this.db.exec('ROLLBACK');
        throw error;
      }
    }
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
  get(id){return this.db.prepare('SELECT * FROM lab_autonomous_dialogues WHERE id=?').get(id)||null;}
  // P1.3: project multi-cycle progress from the existing, authenticated
  // mission ledger. This is observation only: it never grants a new send.
  technicalHistory(row) {
    if(row.strategy!=='semantic')return null;
    const scope=['workspace_session_id','actor_id','client_id','project_id','orchestrator_id'];
    const visited=new Set(),history=[];
    let cursor=row,truncated=false;
    while(cursor&&history.length<16){
      if(visited.has(cursor.id)||cursor.strategy!=='semantic'||
         scope.some(key=>cursor[key]!==row[key])){truncated=true;break;}
      visited.add(cursor.id);history.push(cursor);
      if(!cursor.origin_mission_id)break;
      cursor=this.get(cursor.origin_mission_id);
      if(!cursor)truncated=true;
    }
    if(history.length===16&&history.at(-1).origin_mission_id)truncated=true;
    history.reverse();
    const stages=[],reviewTasks=new Map();
    // Read-only projection of the budget across explicit consent cycles.
    // A review is counted only after its GPT Run and provenance are verified;
    // an uncertain send is NEVER advertised as completed.
    const authorizedGPTSends=history.reduce((total,mission)=>total+
      (mission.followup_policy==='review_only'?1:
        Number(mission.max_gpt_sends)===LIMIT?LIMIT:0),0);
    for(const [i,mission] of history.entries()){
      for(const [phase,taskId,raw] of [
        ['a',mission.task_a_id,mission.review_a_json],
        ['final',mission.task_b_id,mission.review_b_json]
      ]){
        if(!taskId||!raw)continue;
        let decision=null;
        try{decision=JSON.parse(raw);}catch{continue;}
        if(typeof decision?.sourceRunId!=='string'||decision.reviewOnly!==true||
           decision.externalEffectVerified!==false||
           decision.automaticGPTSendAuthorized!==false)continue;
        const run=this.db.prepare(`SELECT id FROM runs WHERE id=? AND task_id=? AND status='succeeded'
          AND EXISTS(SELECT 1 FROM conversation_completed_runs c WHERE c.run_id=runs.id
            AND c.task_id=runs.task_id)`).get(decision.sourceRunId,taskId);
        if(!run)continue;
        const proven=this.db.prepare(`SELECT 1 FROM events
          WHERE task_id=? AND kind='provider.submission.provenance'
            AND json_extract(payload,'$.run_id')=? LIMIT 1`).get(taskId,run.id);
        const reviewed=this.db.prepare(`SELECT 1 FROM lab_command_receipts
          WHERE workspace_session_id=? AND project_id=? AND status='succeeded'
          AND request_id IN (?,?) LIMIT 1`).get(
            mission.workspace_session_id,mission.project_id,
            'technical_'+mission.id+'_'+phase,
            'technical_'+mission.id+'_'+phase+'_recovery');
        if(!proven||!reviewed)continue;
        const cycle=i+1,step=phase==='a'?1:2;
        const proposed=decision.acceptance;
        const acceptance=proposed&&
          ['answer_indicates_progress','requires_external_verification','not_met']
            .includes(proposed.status)&&typeof proposed.criterion==='string'&&
          proposed.criterion.trim().length>0
          ?{status:proposed.status,
            criterion:redactOrchestratorAnalysisText(proposed.criterion,180)}:null;
        const prompt=phase==='a'?mission.mission:mission.question_b||mission.mission;
        const specialist=technicalMissionPolicy(prompt).label;
        stages.push({cycle,step,runId:run.id,taskId,
          decision:decision.decision,acceptance,specialist});
        if(!reviewTasks.has(taskId))
          reviewTasks.set(taskId,{taskId,label:'Trabalho GPT · ciclo '+cycle});
      }
    }
    return {cycles:history.length,completedReviews:stages.length,
      authorizedGPTSends,truncated,stages,reviewTasks:[...reviewTasks.values()]};
  }
  // A model answer and a DB asset record cannot attest a file. Reuse the
  // native preview verifier against CURRENT bytes and require the canonical
  // capture receipt bound to this exact latest completed GPT Run.
  verifiedHtmlForRun(projectId,orchestratorId,runId) {
    if(typeof this.service.verifyLocalArtifact!=='function')return null;
    const source=this.service.reviewableGPTResult(projectId,orchestratorId,runId);
    if(!source)return null;
    const asset=this.db.prepare(`SELECT a.id,a.sha256
      FROM message_assets a
      JOIN messages m ON m.id=a.message_id AND m.task_id=a.task_id
        AND m.role='assistant'
      JOIN events e ON e.task_id=a.task_id AND e.kind='provider.artifact.html_verified'
        AND json_valid(e.payload)
        AND json_extract(e.payload,'$.run_id')=?
        AND json_extract(e.payload,'$.asset_id')=a.id
        AND json_extract(e.payload,'$.sha256')=a.sha256
      WHERE a.task_id=? AND a.kind='file' AND a.mime_type='text/html'
        AND length(a.sha256)=64
        AND m.id=(SELECT id FROM messages WHERE task_id=?
          AND role='assistant' ORDER BY rowid DESC LIMIT 1)
      ORDER BY e.seq DESC LIMIT 1`).get(runId,source.taskId,source.taskId);
    if(!asset)return null;
    try {
      const proof=this.service.verifyLocalArtifact({taskId:source.taskId,assetId:asset.id});
      if(proof?.verified!==true||proof.sha256!==asset.sha256||
         !Number.isSafeInteger(proof.bytes)||proof.bytes<40||
         proof.bytes>2*1024*1024||
         proof.verification!=='local_bytes_and_structure')return null;
      // Only a native, hashed snapshot receipt of THIS Run and file may
      // attest isolated browser rendering. It never certifies interaction or deploy.
      const render=this.db.prepare(`SELECT
        json_extract(payload,'$.screenshot_sha256') screenshotSha256,
        json_extract(payload,'$.width') width,
        json_extract(payload,'$.height') height
        FROM events WHERE task_id=? AND kind='provider.artifact.browser_render_observed'
          AND json_valid(payload)
          AND json_extract(payload,'$.run_id')=?
          AND json_extract(payload,'$.asset_id')=?
          AND json_extract(payload,'$.sha256')=?
          AND json_extract(payload,'$.kind')='isolated_browser_snapshot'
          AND json_extract(payload,'$.browser_tested')=0
          AND json_extract(payload,'$.published')=0
          AND json_extract(payload,'$.external_effect_verified')=0
        ORDER BY rowid DESC LIMIT 1`).get(source.taskId,runId,asset.id,proof.sha256);
      const browserRender=render&&/^[a-f0-9]{64}$/.test(render.screenshotSha256||'')&&
        Number.isSafeInteger(render.width)&&render.width>=200&&render.width<=5000&&
        Number.isSafeInteger(render.height)&&render.height>=160&&render.height<=5000
        ?Object.freeze({kind:'isolated_browser_snapshot',screenshotSha256:render.screenshotSha256,
          width:render.width,height:render.height}):null;
      let browserControls=null;
      if(browserRender){
        const row=this.db.prepare(`SELECT payload FROM events
          WHERE task_id=? AND kind='provider.artifact.browser_controls_observed'
            AND json_valid(payload)
            AND json_extract(payload,'$.run_id')=?
            AND json_extract(payload,'$.asset_id')=?
            AND json_extract(payload,'$.sha256')=?
          ORDER BY rowid DESC LIMIT 1`).get(source.taskId,runId,asset.id,proof.sha256);
        if(row)try{
          const event=JSON.parse(row.payload);
          if(event.kind==='isolated_browser_controls'&&
             event.browser_tested===false&&event.published===false&&
             event.external_effect_verified===false)
            browserControls=normalizedHtmlControlChecks(event.report);
        }catch{}
      }
      return Object.freeze({kind:'local_html_file',runId,assetId:asset.id,
        sha256:proof.sha256,bytes:proof.bytes,
        verification:'local_bytes_and_structure',
        browserRenderObserved:Boolean(browserRender),browserRender,
        browserControls,
        browserTested:false,published:false,externalEffectVerified:false});
    }catch{return null;}
  }
  // Shared SSOT for Run/Task/project/asset provenance. A row alone never
  // grants proof: the native file verifier must still confirm current bytes.
  resolveVerifiedHtmlSource(taskId,assetId,sha256){
    const row=this.db.prepare(`SELECT b.project_id projectId,
      b.orchestrator_id orchestratorId,
      json_extract(e.payload,'$.run_id') runId
      FROM lab_task_bindings b JOIN events e ON e.task_id=b.task_id
      WHERE b.kind='work' AND b.task_id=? AND
        e.kind='provider.artifact.html_verified' AND json_valid(e.payload)
        AND json_extract(e.payload,'$.asset_id')=?
        AND json_extract(e.payload,'$.sha256')=?
      ORDER BY e.rowid DESC LIMIT 1`).get(taskId,assetId,sha256);
    if(!row||typeof row.runId!=='string')return null;
    const proof=this.verifiedHtmlForRun(row.projectId,row.orchestratorId,row.runId);
    if(!proof||proof.assetId!==assetId||proof.sha256!==sha256)return null;
    return {row,proof};
  }
  // Native-only entrypoint, never an Orchestrator operation or model command.
  // Provenance, latest Run, file hash and workspace owner must all be current.
  recordBrowserRenderObservation(observation) {
    if(observation?.kind!=='isolated_browser_snapshot'||
       typeof observation.taskId!=='string'||typeof observation.assetId!=='string'||
       !/^[a-f0-9]{64}$/.test(observation.sha256||'')||
       !/^[a-f0-9]{64}$/.test(observation.screenshotSha256||'')||
       !Number.isSafeInteger(observation.width)||observation.width<200||
       observation.width>5000||!Number.isSafeInteger(observation.height)||
       observation.height<160||observation.height>5000||
       observation.browserTested!==false||observation.published!==false||
       observation.externalEffectVerified!==false)return null;
    const linked=this.resolveVerifiedHtmlSource(
      observation.taskId,observation.assetId,observation.sha256);
    if(!linked)return null;
    const {row}=linked;
    const existing=this.db.prepare(`SELECT 1 FROM events WHERE task_id=?
      AND kind='provider.artifact.browser_render_observed' AND json_valid(payload)
      AND json_extract(payload,'$.run_id')=?
      AND json_extract(payload,'$.asset_id')=?
      AND json_extract(payload,'$.sha256')=? LIMIT 1`).get(
      observation.taskId,row.runId,observation.assetId,observation.sha256);
    if(!existing)this.store.event(observation.taskId,'provider.artifact.browser_render_observed',{
      run_id:row.runId,asset_id:observation.assetId,sha256:observation.sha256,
      kind:'isolated_browser_snapshot',
      screenshot_sha256:observation.screenshotSha256,
      width:observation.width,height:observation.height,
      browser_tested:false,published:false,external_effect_verified:false
    });
    return this.verifiedHtmlForRun(row.projectId,row.orchestratorId,row.runId);
  }
  // A bounded, trusted native DOM probe may attest its own narrow scope,
  // never the site as a whole, external effects or published behavior.
  recordBrowserControlsObservation(observation){
    const report=normalizedHtmlControlChecks(observation?.report);
    if(observation?.kind!=='isolated_browser_controls'||!report||
       typeof observation.taskId!=='string'||typeof observation.assetId!=='string'||
       !/^[a-f0-9]{64}$/.test(observation.sha256||'')||
       observation.browserTested!==false||observation.published!==false||
       observation.externalEffectVerified!==false)return null;
    const linked=this.resolveVerifiedHtmlSource(
      observation.taskId,observation.assetId,observation.sha256);
    if(!linked||linked.proof.browserRenderObserved!==true)return null;
    const {row}=linked;
    const exists=this.db.prepare(`SELECT 1 FROM events WHERE task_id=?
      AND kind='provider.artifact.browser_controls_observed' AND json_valid(payload)
      AND json_extract(payload,'$.run_id')=?
      AND json_extract(payload,'$.asset_id')=?
      AND json_extract(payload,'$.sha256')=? LIMIT 1`).get(
      observation.taskId,row.runId,observation.assetId,observation.sha256);
    if(!exists)this.store.event(observation.taskId,'provider.artifact.browser_controls_observed',{
      kind:'isolated_browser_controls',run_id:row.runId,
      asset_id:observation.assetId,sha256:observation.sha256,
      report,browser_tested:false,published:false,external_effect_verified:false
    });
    return this.verifiedHtmlForRun(row.projectId,row.orchestratorId,row.runId);
  }
  // The app-owned review receives a verified, mission-scoped handoff.
  // This is derived only from canonical Run/mission/review evidence and
  // never authorizes another GPT send or certifies external effects.
  reviewScope(context,{projectId,orchestratorId,runId,taskId}={}) {
    if(!context||!projectId||!orchestratorId||!runId||!taskId)return null;
    const row=this.db.prepare(`SELECT * FROM lab_autonomous_dialogues
      WHERE workspace_session_id=? AND actor_id=? AND client_id=?
        AND project_id=? AND orchestrator_id=? AND strategy='semantic'
        AND ((state='reviewing_a' AND task_a_id=?) OR
             (state='reviewing_final' AND task_b_id=?))
      ORDER BY rowid DESC LIMIT 1`).get(context.workspaceSessionId,
        context.actorId,context.clientId,projectId,orchestratorId,taskId,taskId);
    if(!row)return null;
    const current=this.db.prepare('SELECT id,status FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 1')
      .get(taskId);
    if(current?.id!==runId||current.status!=='succeeded')
      throw Error('autonomous_review_run_superseded');
    const step=row.state==='reviewing_a'?1:2;
    const history=this.technicalHistory(row);
    const cycle=history?.cycles||1;
    let previousAcceptance=null;
    if(step===2){
      const prior=history?.stages.find(x=>x.cycle===cycle&&x.step===1);
      if(!prior||prior.taskId!==row.task_a_id||!row.review_a_json)
        throw Error('autonomous_review_prerequisite_unconfirmed');
      previousAcceptance=prior.acceptance||null;
    }
    const specialist=technicalMissionPolicy(step===1?row.mission:row.question_b).label;
    return Object.freeze({
      objective:redactOrchestratorAnalysisText(row.mission,500),
      cycle,step,specialist,
      authorizedGPTSends:row.followup_policy==='review_only'?1:LIMIT,
      previousAcceptance:previousAcceptance?Object.freeze(previousAcceptance):null,
      verifiedArtifact:this.verifiedHtmlForRun(projectId,orchestratorId,runId),
      externalEffectsVerified:false,automaticGPTSendAuthorized:false
    });
  }
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
    const localReviewTasks=story
      ?turns.map(turn=>({taskId:turn.task_id,label:'Cena '+turn.ordinal}))
      :[['GPT A',row.task_a_id],['GPT B',row.task_b_id]]
        .filter(([,taskId],i,all)=>typeof taskId==='string'&&taskId.length>0&&
          (!semantic||all.findIndex(([,id])=>id===taskId)===i))
        .map(([label,taskId])=>({taskId,label:semantic?'Trabalho GPT':label}));
    const chainProgress=semantic?this.technicalHistory(row):null;
    const lastReviewed=chainProgress?.stages.at(-1);
    let verifiedArtifact=lastReviewed&&lastReviewed.cycle===chainProgress.cycles
      ?this.verifiedHtmlForRun(row.project_id,row.orchestrator_id,lastReviewed.runId)
      :null;
    const verifiedFirstStage=chainProgress?.stages.find(stage=>
      stage.cycle===chainProgress.cycles&&stage.step===1);
    const pendingStage=semantic&&['ready_final','sending_b','ready_review_final','reviewing_final']
      .includes(row.state)&&row.question_b&&verifiedFirstStage
      ?{step:2,specialist:technicalMissionPolicy(row.question_b).label,
        prerequisiteRunId:verifiedFirstStage.runId,
        acceptance:verifiedFirstStage.acceptance,
        state:row.state==='ready_final'?'ready':'under_review_or_execution'}:null;
    const reviewTasks=semantic
      ?[...(chainProgress?.reviewTasks||[]),...localReviewTasks.filter(item=>
        !chainProgress?.reviewTasks.some(previous=>previous.taskId===item.taskId))]
      :localReviewTasks;
    const semanticReview=semantic?(row.review_b_json||row.review_a_json):null;
    let decision=null;
    if(semanticReview){try{decision=JSON.parse(semanticReview);}catch{}}
    // Link the user's result action to the Run actually reviewed, not to
    // the last Task in the mission. A newer Task may have an interrupted or
    // indeterminate provider submission and must never masquerade as a result.
    let reviewedTaskId=null;
    if(semantic&&typeof decision?.sourceRunId==='string'){
      const reviewed=this.db.prepare('SELECT task_id,status FROM runs WHERE id=?')
        .get(decision.sourceRunId);
      if(reviewed?.status==='succeeded'&&
        [row.task_a_id,row.task_b_id].includes(reviewed.task_id)){
        reviewedTaskId=reviewed.task_id;
        if(!verifiedArtifact)
          verifiedArtifact=this.verifiedHtmlForRun(row.project_id,row.orchestrator_id,decision.sourceRunId);
      }
    }
    return {missionId:row.id,projectId:row.project_id,orchestratorId:row.orchestrator_id,
      createdAt:row.created_at,
      mission:row.mission,
      mode:story?'story':semantic?'technical':'dialogue',storyCycles:story?2:null,storyTurns:turns.length,quality,reviewTasks,chainProgress,pendingStage,verifiedArtifact,
      technicalSpecialist:semantic?technicalMissionPolicy(row.mission).label:null,
      state:row.state,maxGPTSends:story?4:row.followup_policy==='review_only'?1:row.max_gpt_sends,
      taskAId:row.task_a_id,taskBId:row.task_b_id,reviewedTaskId,
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
    const chatTaskId=this.service.orchestrator(projectId,orchestratorId).chat_task_id;
    const lastUserTurn=this.db.prepare("SELECT created_at FROM messages WHERE task_id=? AND role='user' ORDER BY sequence DESC LIMIT 1")
      .get(chatTaskId);
    return {mission:this.summary(row),lastUserTurnAt:lastUserTurn?.created_at||null,
      continuousExecutionEnabled:false,
      appOwnedTechnicalReviewAvailable:false,
      legacyRecordOnly:true};
  }
}
