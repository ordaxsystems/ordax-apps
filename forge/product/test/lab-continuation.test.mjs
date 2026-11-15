import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {LabContinuation} from '../src/lab-continuation.mjs';
import {ORCHESTRATOR_TOOLS} from '../src/forge-contract.mjs';

function setup(t,{confirmProposal=async()=>true,provider=null}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lab-continuity-'));
  const store=new Store(path.join(dir,'lab.sqlite'));
  const context={actorId:'owner-test',clientId:'app-test',
    workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,authorize:()=>true,confirmProposal,provider});
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  let n=0;
  const call=(op,data={})=>service.invoke(context,op,{
    ...data,
    ...(ORCHESTRATOR_TOOLS.find(tool=>tool.operation===op)?.readOnly
      ?{}
      :{requestId:'test_'+(++n)})
  });
  return {dir,store,service,context,call};
}

async function prepare(f,name='VESTE') {
  const projectId=(await f.call('project_create',{name,objective:'Validar projeto'})).result.projectId;
  const orchestratorId=(await f.call('orchestrator_create',{
    projectId,name:'Forjador',mission:'Verificar entregas'
  })).result.orchestratorId;
  const taskId=(await f.call('work_create',{
    projectId,orchestratorId,title:'Site'
  })).result.taskId;
  return {projectId,orchestratorId,taskId};
}

function finish(store,taskId) {
  const runId=store.startRun(taskId);
  store.finishRun(taskId,runId);
  return runId;
}

test('opt-in analyzes confirmed Runs locally without any second model or GPT send',async t=>{
  const f=setup(t);
  const a=await prepare(f);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  const running=f.store.startRun(a.taskId);
  assert.equal((await f.service.continuation.tick(f.context)).state,'idle');
  f.store.finishRun(a.taskId,running);
  const reviewed=await f.service.continuation.tick(f.context);
  assert.equal(reviewed.state,'analyzed');
  const status=await f.call('continuity_status',{projectId:a.projectId,orchestratorId:a.orchestratorId});
  assert.equal(status.enabled,true);
  assert.equal(status.latest.run_id,running);
  assert.equal(status.latest.state,'analyzed');
  const receipt=f.store.db.prepare('SELECT status,result FROM lab_command_receipts WHERE id=?')
    .get(status.latest.command_id);
  const result=JSON.parse(receipt.result);
  assert.equal(receipt.status,'succeeded');
  assert.equal(result.appOwned,true);
  assert.equal(result.provider,'ordax_app_policy');
  assert.equal(result.analysisObserved,true);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM runs WHERE status='running'").get().n,0);
});

test('local proposal is review-only and creates no Work or GPT Run before approval',async t=>{
  const f=setup(t);
  const a=await prepare(f);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  await f.call('continuity_proposals_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  const runId=finish(f.store,a.taskId);
  assert.equal((await f.service.continuation.tick(f.context)).state,'analyzed');
  const proposal=await f.service.continuation.tick(f.context);
  assert.equal(proposal.state,'proposed');
  assert.equal(proposal.runId,runId);
  const action=f.store.db.prepare(
    "SELECT id,status,payload FROM action_ledger WHERE action_type='orchestrator.work-proposal' ORDER BY rowid DESC LIMIT 1"
  ).get();
  assert.equal(action.status,'pending');
  const before=f.store.db.prepare(
    "SELECT COUNT(*) n FROM lab_task_bindings WHERE project_id=? AND kind='work'"
  ).get(a.projectId).n;
  assert.equal(before,1);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,1);
});

test('approved local proposal creates one durable Work draft and still sends nothing',async t=>{
  const f=setup(t);
  const a=await prepare(f);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  await f.call('continuity_proposals_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  finish(f.store,a.taskId);
  await f.service.continuation.tick(f.context);
  await f.service.continuation.tick(f.context);
  const action=f.store.db.prepare(
    "SELECT id FROM action_ledger WHERE action_type='orchestrator.work-proposal' AND status='pending' ORDER BY rowid DESC LIMIT 1"
  ).get();
  assert.ok(action?.id);
  const reviewed=await f.call('proposal_review',{
    projectId:a.projectId,orchestratorId:a.orchestratorId,actionId:action.id,approved:true
  });
  assert.equal(reviewed.status,'succeeded');
  const works=await f.call('work_list',{projectId:a.projectId,orchestratorId:a.orchestratorId});
  assert.equal(works.works.length,2);
  const created=works.works.find(work=>work.id!==a.taskId);
  assert.ok(created);
  const draft=f.store.getTaskDraft(created.id);
  assert.ok(draft.draft.length>0);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,1);
});

test('paused Forjador does not enqueue or analyze new Runs',async t=>{
  const f=setup(t);
  const a=await prepare(f);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  finish(f.store,a.taskId);
  await f.call('orchestrator_pause',{
    projectId:a.projectId,orchestratorId:a.orchestratorId,paused:true
  });
  assert.equal((await f.service.continuation.tick(f.context)).state,'idle');
  assert.equal(f.store.db.prepare(
    'SELECT COUNT(*) n FROM lab_continuation_reviews WHERE project_id=?'
  ).get(a.projectId).n,0);
});

test('restart quarantines an unfinished local analysis and never replays it',async t=>{
  const f=setup(t);
  const a=await prepare(f);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  const runId=finish(f.store,a.taskId);
  f.service.continuation.scan();
  f.store.db.prepare(
    "UPDATE lab_continuation_reviews SET state='analyzing' WHERE run_id=?"
  ).run(runId);
  const reopened=new LabContinuation({store:f.store,service:f.service,context:f.context});
  const row=f.store.db.prepare(
    'SELECT state,reason FROM lab_continuation_reviews WHERE run_id=?'
  ).get(runId);
  assert.equal(row.state,'reconciliation_required');
  assert.equal(row.reason,'interrupted_review');
  assert.equal(reopened.status(a.projectId,a.orchestratorId).state,'reconciliation_required');
  assert.equal((await reopened.tick(f.context)).state,'idle');
});

test('uncertain transport blocks only its own project continuation',async t=>{
  const f=setup(t,{provider:{send:async()=>({})}});
  const a=await prepare(f,'A');
  const b=await prepare(f,'B');
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  await f.call('continuity_set',{projectId:b.projectId,orchestratorId:b.orchestratorId,enabled:true});
  const runA=finish(f.store,a.taskId);
  const runB=finish(f.store,b.taskId);
  f.service.continuation.scan();
  const uncertain=await f.call('work_send',{
    projectId:a.projectId,taskId:a.taskId,content:'Envio intencionalmente sem confirmação'
  });
  assert.equal(uncertain.status,'uncertain');
  const result=await f.service.continuation.tick(f.context);
  assert.equal(result.state,'analyzed');
  assert.equal(result.runId,runB);
  assert.equal(f.store.db.prepare(
    'SELECT state FROM lab_continuation_reviews WHERE run_id=?'
  ).get(runA).state,'queued');
});

test('proposal policy is capped at two proposals per activation',async t=>{
  const f=setup(t);
  const a=await prepare(f);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  await f.call('continuity_proposals_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  const extra1=(await f.call('work_create',{projectId:a.projectId,orchestratorId:a.orchestratorId,title:'B'})).result.taskId;
  const extra2=(await f.call('work_create',{projectId:a.projectId,orchestratorId:a.orchestratorId,title:'C'})).result.taskId;
  finish(f.store,a.taskId);finish(f.store,extra1);finish(f.store,extra2);
  for(let i=0;i<3;i++)assert.equal((await f.service.continuation.tick(f.context)).state,'analyzed');
  assert.equal((await f.service.continuation.tick(f.context)).state,'proposed');
  const first=f.store.db.prepare(
    "SELECT id FROM action_ledger WHERE action_type='orchestrator.work-proposal' AND status='pending' ORDER BY rowid LIMIT 1"
  ).get();
  assert.ok(first?.id);
  await f.call('proposal_review',{projectId:a.projectId,orchestratorId:a.orchestratorId,
    actionId:first.id,approved:false});
  assert.equal((await f.service.continuation.tick(f.context)).state,'proposed');
  const status=await f.call('continuity_status',{projectId:a.projectId,orchestratorId:a.orchestratorId});
  assert.equal(status.nextProposals.proposed,2);
  assert.equal(status.nextProposals.remaining,0);
  assert.equal(f.store.db.prepare(
    "SELECT COUNT(*) n FROM action_ledger WHERE action_type='orchestrator.work-proposal'"
  ).get().n,2);
});

test('disabling continuity keeps history but stops future local analysis',async t=>{
  const f=setup(t);
  const a=await prepare(f);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  const first=finish(f.store,a.taskId);
  assert.equal((await f.service.continuation.tick(f.context)).state,'analyzed');
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:false});
  const second=finish(f.store,a.taskId);
  assert.equal((await f.service.continuation.tick(f.context)).state,'idle');
  assert.equal(f.store.db.prepare(
    'SELECT state FROM lab_continuation_reviews WHERE run_id=?'
  ).get(first).state,'analyzed');
  assert.equal(f.store.db.prepare(
    'SELECT COUNT(*) n FROM lab_continuation_reviews WHERE run_id=?'
  ).get(second).n,0);
});
