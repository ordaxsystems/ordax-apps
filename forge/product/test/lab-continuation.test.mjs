import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'forge-continuation-history-'));
  const store=new Store(path.join(dir,'store.sqlite'));
  const context=Object.freeze({actorId:'owner',clientId:'test',
    workspaceSessionId:store.getWorkspaceSession().id});
  const service=new OrchestratorService({store,authorize:({context:who})=>who===context});
  let seq=0;
  const call=(operation,input={})=>service.invoke(context,operation,{
    ...(!ORCHESTRATOR_TOOLS.find(tool=>tool.operation===operation)?.readOnly
      ?{requestId:'continuation_'+(++seq)}:{}),...input
  });
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {store,context,service,call};
}
async function setup(f){
  return (await f.call('mission_create',{name:'Continuidade',mission:'Registro histórico'})).result;
}

test('continuation module is read-only compatibility and contains no scheduler',()=>{
  const source=fs.readFileSync(new URL('../src/lab-continuation.mjs',import.meta.url),'utf8');
  const proposals=fs.readFileSync(new URL('../src/lab-next-proposal.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\bconfigure\(|\bscan\(|\btick\(|tickPeriodic\(|service\.invoke\(context,'orchestrator_analyze'/);
  assert.doesNotMatch(proposals,/\bconfigure\(|\btick\(|service\.invoke\(context,'orchestrator_prepare'/);
  assert.match(source,/legacyRecordOnly:true/);
  assert.match(proposals,/legacyRecordOnly:true/);
});

test('old enabled policies are reported as historical and never active',async t=>{
  const f=fixture(t),p=await setup(f),now=f.store.now();
  f.store.db.prepare(`INSERT INTO lab_continuation_policies
    (orchestrator_id,project_id,enabled,enabled_at,start_run_rowid,review_interval_minutes,
     last_periodic_review_at,last_periodic_state_hash)
    VALUES(?,?,?,?,?,?,?,?)`).run(
      p.orchestratorId,p.projectId,1,now,0,60,now,'a'.repeat(64));
  f.store.db.prepare(`INSERT INTO lab_next_proposal_policy
    (orchestrator_id,project_id,enabled,start_review_rowid) VALUES(?,?,?,?)`)
    .run(p.orchestratorId,p.projectId,1,0);
  const status=await f.call('continuity_status',{
    projectId:p.projectId,orchestratorId:p.orchestratorId
  });
  assert.equal(status.enabled,false);
  assert.equal(status.historicalEnabled,true);
  assert.equal(status.legacyRecordOnly,true);
  assert.equal(status.mode,'legacy_record_only');
  assert.equal(status.automaticGPTSends,false);
  assert.equal(status.periodicReview.state,'disabled');
  assert.equal(status.nextProposals.enabled,false);
  assert.equal(status.nextProposals.historicalEnabled,true);
  assert.equal(status.nextProposals.legacyRecordOnly,true);
});

test('removed continuation and App-owned decision operations are unknown',async t=>{
  const f=fixture(t),p=await setup(f);
  for(const operation of [
    'continuity_set','continuity_proposals_set','continuity_followup_prepare',
    'orchestrator_analyze','orchestrator_prepare','proposal_review'
  ]){
    await assert.rejects(
      f.service.invoke(f.context,operation,{projectId:p.projectId,orchestratorId:p.orchestratorId}),
      /orchestrator_unknown_operation/,
      operation
    );
  }
});
