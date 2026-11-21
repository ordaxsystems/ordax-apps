import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-autonomy-history-'));
  const store=new Store(path.join(dir,'store.sqlite'));
  const context=Object.freeze({actorId:'owner',clientId:'test',
    workspaceSessionId:store.getWorkspaceSession().id});
  const service=new OrchestratorService({store,authorize:({context:who})=>who===context});
  let seq=0;
  const call=(operation,input={})=>service.invoke(context,operation,{
    ...(!ORCHESTRATOR_TOOLS.find(tool=>tool.operation===operation)?.readOnly
      ?{requestId:'history_'+(++seq)}:{}),...input
  });
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {store,context,service,call};
}
async function project(f){
  const created=(await f.call('mission_create',{name:'Histórico',mission:'Projeto histórico'})).result;
  return created;
}

test('autonomous execution operations are absent from the canonical Forge contract',()=>{
  const operations=new Set(ORCHESTRATOR_TOOLS.map(tool=>tool.operation));
  for(const operation of [
    'forjador_send','autonomous_continuous_set','autonomous_dialogue_continue',
    'orchestrator_analyze','orchestrator_prepare','proposal_review',
    'continuity_set','continuity_proposals_set','continuity_followup_prepare'
  ]) assert.equal(operations.has(operation),false,operation);
  const source=fs.readFileSync(new URL('../src/autonomous-dialogue.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\bstart\(context|\btick\(|continueTechnical\(|setContinuousExecution\(/);
  assert.match(source,/legacyRecordOnly:true/);
});

test('historical autonomous mission remains readable but cannot resume',async t=>{
  const f=fixture(t),p=await project(f),now=f.store.now();
  f.store.db.prepare(`INSERT INTO lab_autonomous_dialogues
    (id,workspace_session_id,actor_id,client_id,project_id,orchestrator_id,
     request_id,mission,state,max_gpt_sends,followup_policy,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'mission_history',f.context.workspaceSessionId,f.context.actorId,f.context.clientId,
      p.projectId,p.orchestratorId,'historical_request','Missão antiga',
      'reconciliation_required',2,'review_only',now,now);
  const status=await f.call('autonomous_dialogue_status',{
    projectId:p.projectId,orchestratorId:p.orchestratorId
  });
  assert.equal(status.legacyRecordOnly,true);
  assert.equal(status.continuousExecutionEnabled,false);
  assert.equal(status.appOwnedTechnicalReviewAvailable,false);
  assert.equal(status.mission.mission,'Missão antiga');
  assert.equal(status.mission.state,'reconciliation_required');
  assert.equal(status.mission.requiresReconciliation,true);
  assert.equal(typeof f.service.autonomous.start,'undefined');
  assert.equal(typeof f.service.autonomous.tick,'undefined');
  assert.equal(typeof f.service.autonomous.continueTechnical,'undefined');
});

test('removed autonomous operations fail closed as unknown operations',async t=>{
  const f=fixture(t),p=await project(f);
  for(const operation of ['autonomous_continuous_set','autonomous_dialogue_continue','forjador_send']){
    await assert.rejects(
      f.service.invoke(f.context,operation,{projectId:p.projectId,orchestratorId:p.orchestratorId}),
      /orchestrator_unknown_operation/,
      operation
    );
  }
});
