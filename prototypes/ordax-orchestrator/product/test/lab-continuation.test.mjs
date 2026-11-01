import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {LabContinuation} from '../src/lab-continuation.mjs';
import {ORCHESTRATOR_TOOLS} from '../src/orchestrator-contract.mjs';

function setup(t,coordinator={available:()=>true,send:async()=>({content:'Revisão registrada; não houve envio automático.'})},{confirmProposal=null}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lab-continuity-'));
  const store=new Store(path.join(dir,'lab.sqlite'));
  const context={actorId:'owner-test',clientId:'app-test',workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,authorize:()=>true,coordinator,confirmProposal});
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  let n=0;
  const call=(op,data={})=>service.invoke(context,op,{...data,...(ORCHESTRATOR_TOOLS.find(tool=>tool.operation===op)?.readOnly?{}:{requestId:'test_'+(++n)})});
  return {dir,store,service,context,call};
}
async function prepare(f) {
  const projectId=(await f.call('project_create',{name:'VESTE',objective:'Validar loja'})).result.projectId;
  const orchestratorId=(await f.call('orchestrator_create',{projectId,name:'Coordenador',mission:'Verificar entregas'})).result.orchestratorId;
  const taskId=(await f.call('work_create',{projectId,orchestratorId,title:'Site'})).result.taskId;
  return {projectId,orchestratorId,taskId};
}
function finish(store,taskId) {
  const id=store.startRun(taskId);
  store.finishRun(taskId,id);
  return id;
}
test('opt-in analyzes only confirmed runs and never submits a GPT work message',async t=>{
  let analyzed=0;
  const f=setup(t,{available:()=>true,send:async()=>{analyzed++;return {content:'Análise confirmada'}}});
  const a=await prepare(f);
  const runId=finish(f.store,a.taskId);
  assert.deepEqual(await f.service.continuation.tick(f.context),{state:'idle'});
  assert.equal(analyzed,0);
  const enabled=await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  assert.equal(enabled.result.enabled,true);
  // The opt-in does not retroactively dispatch old Runs.
  assert.equal((await f.service.continuation.tick(f.context)).state,'idle');
  const fresh=finish(f.store,a.taskId);
  assert.notEqual(fresh,runId);
  assert.deepEqual(await f.service.continuation.tick(f.context),{state:'analyzed',runId:fresh});
  assert.equal(analyzed,1);
  assert.equal((await f.service.continuation.tick(f.context)).state,'idle');
  assert.equal(analyzed,1);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_continuation_reviews').get().n,1);
  assert.equal((await f.call('continuity_status',{projectId:a.projectId,orchestratorId:a.orchestratorId})).automaticGPTSends,false);
});
test('automatic review and proposal wait for an occupied coordinator without quarantining work',async t=>{
  let sends=0;
  const f=setup(t,{available:()=>true,send:async ({prepareWork})=>{
    sends++;
    return prepareWork?{content:'Proposta confirmada',proposal:{title:'Nova frente',
      content:'Verificar o próximo passo.',reason:'Resultado observado'}}:{content:'Análise confirmada'};
  }});
  const a=await prepare(f);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  await f.call('continuity_proposals_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  const runId=finish(f.store,a.taskId);
  const chat=f.service.orchestrator(a.projectId,a.orchestratorId).chat_task_id;
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const held=f.service.withCoordinatorTurn(chat,()=>pending);
  assert.deepEqual(await f.service.continuation.tick(f.context),{state:'coordinator_busy'});
  assert.equal(f.store.db.prepare('SELECT state FROM lab_continuation_reviews WHERE run_id=?').get(runId).state,'queued');
  assert.equal(sends,0);
  release();await held;
  assert.equal((await f.service.continuation.tick(f.context)).state,'analyzed');
  let releaseProposal;
  const waitProposal=new Promise(resolve=>{releaseProposal=resolve;});
  const heldProposal=f.service.withCoordinatorTurn(chat,()=>waitProposal);
  assert.deepEqual(await f.service.continuation.tick(f.context),{state:'coordinator_busy'});
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_next_proposals').get().n,0);
  releaseProposal();await heldProposal;
  assert.deepEqual(await f.service.continuation.tick(f.context),{state:'proposed',runId});
  assert.equal(sends,2);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('missing coordinator and pause preserve queued work without model calls',async t=>{
  const f=setup(t,{available:()=>false,send:()=>{throw Error('must not send')}});
  const a=await prepare(f);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  const runId=finish(f.store,a.taskId);
  assert.equal((await f.service.continuation.tick(f.context)).state,'blocked_coordinator');
  assert.equal((await f.call('continuity_status',{projectId:a.projectId,orchestratorId:a.orchestratorId})).state,'blocked_coordinator');
  assert.equal(f.store.db.prepare('SELECT state FROM lab_continuation_reviews WHERE run_id=?').get(runId).state,'queued');
  await f.call('orchestrator_pause',{projectId:a.projectId,orchestratorId:a.orchestratorId,paused:true});
  assert.equal((await f.service.continuation.tick(f.context)).state,'idle');
});
test('restart quarantines an unfinished API analysis instead of replaying it',async t=>{
  let sends=0;
  const f=setup(t,{available:()=>true,send:async()=>{sends++;return {content:'result'}}});
  const a=await prepare(f);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  const runId=finish(f.store,a.taskId);
  f.service.continuation.scan();
  f.store.db.prepare("UPDATE lab_continuation_reviews SET state='analyzing' WHERE run_id=?").run(runId);
  new LabContinuation({store:f.store,service:f.service});
  assert.equal(f.store.db.prepare('SELECT state FROM lab_continuation_reviews WHERE run_id=?').get(runId).state,'reconciliation_required');
  assert.equal((await f.service.continuation.tick(f.context)).state,'idle');
  assert.equal(sends,0);
});
test('uncertain transport in same mission blocks automatic analysis',async t=>{
  let sends=0;
  const f=setup(t,{available:()=>true,send:async()=>{sends++;return {content:'response'}}});
  const a=await prepare(f);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  finish(f.store,a.taskId);
  const payload={requestId:'uncertain',projectId:a.projectId,taskId:a.taskId,content:'Do not resend'};
  const id='command_test_uncertain';
  f.store.db.prepare(`INSERT INTO lab_command_receipts
    (id,workspace_session_id,actor_id,client_id,request_id,project_id,operation,input_hash,status,result,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,'uncertain',?,?,?)`).run(id,f.context.workspaceSessionId,f.context.actorId,f.context.clientId,
    payload.requestId,a.projectId,'work_send','digest',JSON.stringify({taskId:a.taskId}),f.store.now(),f.store.now());
  assert.equal((await f.service.continuation.tick(f.context)).state,'reconciliation_required');
  assert.equal(sends,0);
});

test('uncertain VESTE construction does not stop an independent verified work',async t=>{
  let analyses=0;
  const f=setup(t,{available:()=>true,send:async()=>{analyses++;return {content:'Review ready'}}});
  const a=await prepare(f);
  const other=(await f.call('work_create',{projectId:a.projectId,orchestratorId:a.orchestratorId,title:'VESTE MVP'})).result.taskId;
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  finish(f.store,a.taskId);
  const goodRun=finish(f.store,other);
  f.store.db.prepare(`INSERT INTO lab_command_receipts
    (id,workspace_session_id,actor_id,client_id,request_id,project_id,operation,input_hash,status,result,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,'uncertain',?,?,?)`).run('command_indeterminate',f.context.workspaceSessionId,
    f.context.actorId,f.context.clientId,'indeterminate',a.projectId,'work_send','hash',
    JSON.stringify({taskId:a.taskId}),f.store.now(),f.store.now());
  assert.deepEqual(await f.service.continuation.tick(f.context),{state:'analyzed',runId:goodRun});
  assert.equal(analyses,1);
  assert.equal((await f.service.continuation.tick(f.context)).state,'reconciliation_required');
});

test('opt-in makes one reviewable proposal after analysis; never opens or sends a GPT chat',async t=>{
  let analyzed=0,proposed=0;
  const f=setup(t,{available:()=>true,send:async input=>{
    if(input.prepareWork){proposed++;return {content:'Proposta pronta',proposal:{
      title:'Testar carrinho VESTE',content:'Teste localmente quantidade e total do carrinho.',
      reason:'Aceite do MVP'}};}
    analyzed++;return {content:'Verificar o carrinho.'};
  }});
  const a=await prepare(f);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  await f.call('continuity_proposals_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  const runId=finish(f.store,a.taskId);
  assert.equal((await f.service.continuation.tick(f.context)).state,'analyzed');
  assert.deepEqual(await f.service.continuation.tick(f.context),{state:'proposed',runId});
  assert.equal(analyzed,1);assert.equal(proposed,1);
  assert.equal((await f.service.continuation.tick(f.context)).state,'idle');
  assert.equal(proposed,1);
  const action=f.store.db.prepare("SELECT status FROM action_ledger WHERE action_type='orchestrator.work-proposal'").get();
  assert.equal(action.status,'pending');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_task_bindings').get().n,2);
  assert.equal((await f.call('continuity_status',{projectId:a.projectId,orchestratorId:a.orchestratorId})).nextProposals.remaining,1);
});
test('proposal automation cannot be enabled without confirmed-run analysis, and is disabled by default',async t=>{
  const f=setup(t);
  const a=await prepare(f);
  await assert.rejects(f.call('continuity_proposals_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true}),/continuation_analysis_required/);
  const status=await f.call('continuity_status',{projectId:a.projectId,orchestratorId:a.orchestratorId});
  assert.equal(status.nextProposals.enabled,false);
});
test('interrupted planning is quarantined permanently without repeating model request',async t=>{
  let planned=0;
  const f=setup(t,{available:()=>true,send:async input=>{
    if(input.prepareWork)planned++;
    return input.prepareWork?{content:'Proposta',proposal:{title:'Teste',content:'Executar teste',reason:'Revisão'}}:{content:'Análise'};
  }});
  const a=await prepare(f);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  await f.call('continuity_proposals_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  const runId=finish(f.store,a.taskId);
  await f.service.continuation.tick(f.context);
  f.store.db.prepare("INSERT INTO lab_next_proposals (review_run_id,project_id,orchestrator_id,status,updated_at) VALUES(?,?,?,'planning',?)")
    .run(runId,a.projectId,a.orchestratorId,f.store.now());
  new LabContinuation({store:f.store,service:f.service});
  assert.equal((await f.service.continuation.tick(f.context)).state,'idle');
  assert.equal(planned,0);
  assert.equal(f.store.db.prepare('SELECT status FROM lab_next_proposals WHERE review_run_id=?').get(runId).status,'reconciliation_required');
});

test('two automatic proposals per activation, with human review before local task creation',async t=>{
  let plans=0;
  const f=setup(t,{available:()=>true,send:async input=>input.prepareWork
    ? {content:'Proposta para aprovação',proposal:{title:'Teste '+(++plans),content:'Revisar o componente.',reason:'Verificação necessária'}}
    : {content:'Revisão registrada'}},{confirmProposal:()=>true});
  const a=await prepare(f);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  await f.call('continuity_proposals_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  for(let n=0;n<3;n++){
    finish(f.store,a.taskId);
    assert.equal((await f.service.continuation.tick(f.context)).state,'analyzed');
    if(n<2){
      assert.equal((await f.service.continuation.tick(f.context)).state,'proposed');
      const items=(await f.call('proposals_list',{projectId:a.projectId,orchestratorId:a.orchestratorId})).proposals;
      const pending=items.find(item=>item.status==='pending');
      assert.ok(pending);
      await f.call('proposal_review',{projectId:a.projectId,orchestratorId:a.orchestratorId,actionId:pending.actionId,approved:true});
    }else{
      assert.equal((await f.service.continuation.tick(f.context)).state,'idle');
    }
  }
  assert.equal(plans,2);
  const status=await f.call('continuity_status',{projectId:a.projectId,orchestratorId:a.orchestratorId});
  assert.equal(status.nextProposals.remaining,0);
  assert.equal(status.nextProposals.automaticGPTSends,false);
});

test('only one proposal model request can be active during a periodic tick',async t=>{
  let release,entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  let prepares=0;
  const f=setup(t,{available:()=>true,send:async input=>{
    if(input.prepareWork){prepares++;entered();await gate;return {content:'Proposta',proposal:{title:'Revisão',content:'Testar site',reason:'Critérios de aceite'}};}
    return {content:'Análise confirmada'};
  }});
  const a=await prepare(f);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  await f.call('continuity_proposals_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  finish(f.store,a.taskId);
  await f.service.continuation.tick(f.context);
  const first=f.service.continuation.tick(f.context);
  await started;
  assert.equal((await f.service.continuation.tick(f.context)).state,'busy');
  release();
  assert.equal((await first).state,'proposed');
  assert.equal(prepares,1);
});

test('continuation scan does not starve later Runs beyond the 100-row batch boundary',async t=>{
  let calls=0;
  const f=setup(t,{available:()=>false,send:async()=>{calls++;throw Error('model_should_not_run')}});
  const a=await prepare(f);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  const all=[];
  for(let i=0;i<205;i++)all.push(finish(f.store,a.taskId));
  const continuation=f.service.continuation;
  assert.equal(continuation.scan(),100);
  assert.equal(continuation.scan(),100);
  assert.equal(continuation.scan(),5);
  assert.equal(continuation.scan(),0);
  const rows=f.store.db.prepare('SELECT run_id,state FROM lab_continuation_reviews').all();
  assert.equal(rows.length,205);
  assert.equal(new Set(rows.map(row=>row.run_id)).size,205);
  assert.deepEqual(new Set(rows.map(row=>row.run_id)),new Set(all));
  assert.ok(rows.every(row=>row.state==='queued'));
  assert.equal(calls,0);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('continuation scan preserves already reviewed Runs and resumes after reinitialization',async t=>{
  const f=setup(t,{available:()=>false,send:()=>{throw Error('must_not_send')}});
  const a=await prepare(f);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  const all=Array.from({length:120},()=>finish(f.store,a.taskId));
  const continuation=f.service.continuation;
  assert.equal(continuation.scan(),100);
  const selected=all[0];
  f.store.db.prepare("UPDATE lab_continuation_reviews SET state='analyzed' WHERE run_id=?").run(selected);
  const restarted=new LabContinuation({store:f.store,service:f.service});
  assert.equal(restarted.scan(),20);
  assert.equal(restarted.scan(),0);
  assert.equal(f.store.db.prepare("SELECT state FROM lab_continuation_reviews WHERE run_id=?").get(selected).state,'analyzed');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_continuation_reviews').get().n,120);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_continuation_reviews WHERE state=?').get('analyzed').n,1);
});



test('re-enabled analysis never drains historical queued Runs from the previous opt-in',async t=>{
  let calls=0;
  const f=setup(t,{available:()=>true,send:async()=>{calls++;return {content:'Verified current review'};}});
  const a=await prepare(f);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  const previous=finish(f.store,a.taskId);
  assert.equal(f.service.continuation.scan(),1);
  const before=await f.call('continuity_status',{projectId:a.projectId,orchestratorId:a.orchestratorId});
  assert.equal(before.state,'pending');
  assert.equal(before.counts.queued,1);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:false});
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  const restored=await f.call('continuity_status',{projectId:a.projectId,orchestratorId:a.orchestratorId});
  assert.equal(restored.state,'observing');
  assert.deepEqual(restored.counts,{});
  assert.equal(restored.latest,null);
  assert.equal((await f.service.continuation.tick(f.context)).state,'idle');
  assert.equal(calls,0,'queued pre-opt-in Run must not dispatch after re-enable');
  assert.equal(f.store.db.prepare('SELECT state FROM lab_continuation_reviews WHERE run_id=?').get(previous).state,'queued',
    'historical SQLite evidence is preserved, not silently deleted');
  const current=finish(f.store,a.taskId);
  assert.deepEqual(await f.service.continuation.tick(f.context),{state:'analyzed',runId:current});
  assert.equal(calls,1);
  const status=await f.call('continuity_status',{projectId:a.projectId,orchestratorId:a.orchestratorId});
  assert.equal(status.state,'observing');
  assert.equal(status.counts.analyzed,1);
  assert.equal(status.counts.queued,undefined);
  assert.equal(status.latest.run_id,current);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_continuation_reviews').get().n,2);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('historical reconciliation does not permanently mark a new opt-in as blocked',async t=>{
  let entered,release,calls=0;
  const started=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const f=setup(t,{available:()=>true,send:async()=>{
    calls++;if(calls===1){entered();await gate;}
    return {content:'Confirmed continuation'};
  }});
  const a=await prepare(f);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  const old=finish(f.store,a.taskId);
  const pending=f.service.continuation.tick(f.context);
  await started;
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:false});
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  release();
  assert.equal((await pending).state,'reconciliation_required');
  const oldRow=f.store.db.prepare('SELECT state,reason FROM lab_continuation_reviews WHERE run_id=?').get(old);
  assert.equal(oldRow.state,'reconciliation_required');
  assert.equal(oldRow.reason,'policy_disabled');
  assert.equal((await f.call('continuity_status',{projectId:a.projectId,orchestratorId:a.orchestratorId})).state,'observing');
  const fresh=finish(f.store,a.taskId);
  assert.deepEqual(await f.service.continuation.tick(f.context),{state:'analyzed',runId:fresh});
  assert.equal(calls,2,'only fresh work from the new activation may be analyzed');
  const status=await f.call('continuity_status',{projectId:a.projectId,orchestratorId:a.orchestratorId});
  assert.equal(status.state,'observing');
  assert.equal(status.counts.reconciliation_required,undefined);
  assert.equal(status.counts.analyzed,1);
  assert.equal(status.latest.run_id,fresh);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('re-enabling one project does not discard the other project pending opt-in',async t=>{
  let calls=0;
  const f=setup(t,{available:()=>true,send:async()=>{
    calls++;return {content:'Confirmed independent project'};
  }});
  const a=await prepare(f);
  const projectId=(await f.call('project_create',{name:'Second',objective:'Independent mission'})).result.projectId;
  const orchestratorId=(await f.call('orchestrator_create',{projectId,name:'Other',mission:'Independent'})).result.orchestratorId;
  const taskId=(await f.call('work_create',{projectId,orchestratorId,title:'Independent work'})).result.taskId;
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  await f.call('continuity_set',{projectId,orchestratorId,enabled:true});
  const oldA=finish(f.store,a.taskId),waitingB=finish(f.store,taskId);
  assert.equal(f.service.continuation.scan(),2);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:false});
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  assert.deepEqual(await f.service.continuation.tick(f.context),{state:'analyzed',runId:waitingB});
  assert.equal((await f.service.continuation.tick(f.context)).state,'idle');
  assert.equal(calls,1);
  assert.equal(f.store.db.prepare('SELECT state FROM lab_continuation_reviews WHERE run_id=?').get(oldA).state,'queued');
  assert.equal((await f.call('continuity_status',{projectId:a.projectId,orchestratorId:a.orchestratorId})).state,'observing');
  assert.equal((await f.call('continuity_status',{projectId,orchestratorId})).counts.analyzed,1);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('disable and rapid re-enable during Groq analysis cannot certify or replay the old review',async t=>{
  let entered,release,calls=0;
  const started=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const f=setup(t,{available:()=>true,send:async()=>{
    calls++;entered();await gate;return {content:'Old analysis replied'};
  }});
  const a=await prepare(f);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  const runId=finish(f.store,a.taskId);
  const pending=f.service.continuation.tick(f.context);
  await started;
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:false});
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  release();
  assert.deepEqual(await pending,{state:'reconciliation_required',runId});
  const row=f.store.db.prepare('SELECT state,reason FROM lab_continuation_reviews WHERE run_id=?').get(runId);
  assert.equal(row.state,'reconciliation_required');
  assert.equal(row.reason,'policy_disabled');
  assert.equal((await f.service.continuation.tick(f.context)).state,'idle');
  assert.equal(calls,1,'a stopped analysis is not repeated after re-enable');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_next_proposals').get().n,0);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('turning off proposal policy while Groq plans never promotes old planning after re-enable',async t=>{
  let entered,release,prepares=0;
  const started=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const f=setup(t,{available:()=>true,send:async input=>{
    if(!input.prepareWork)return {content:'Confirmed analysis'};
    prepares++;entered();await gate;
    return {content:'Plan returned',proposal:{title:'Review',content:'Inspect UI',reason:'Acceptance'}};
  }});
  const a=await prepare(f);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  await f.call('continuity_proposals_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  const runId=finish(f.store,a.taskId);
  assert.equal((await f.service.continuation.tick(f.context)).state,'analyzed');
  const pending=f.service.continuation.tick(f.context);
  await started;
  await f.call('continuity_proposals_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:false});
  await f.call('continuity_proposals_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  release();
  assert.deepEqual(await pending,{state:'reconciliation_required',runId});
  const row=f.store.db.prepare('SELECT status,reason FROM lab_next_proposals WHERE review_run_id=?').get(runId);
  assert.equal(row.status,'reconciliation_required');
  assert.equal(row.reason,'proposal_policy_disabled');
  assert.equal((await f.service.continuation.tick(f.context)).state,'idle');
  assert.equal(prepares,1,'planning may not be replayed');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM lab_task_bindings WHERE kind='work'").get().n,1,
    'advisory Groq result must not create new GPT work without review');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('pausing and resuming a coordinator while analysis is in flight keeps a durable stop',async t=>{
  let entered,release,calls=0;
  const started=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const f=setup(t,{available:()=>true,send:async()=>{
    calls++;entered();await gate;return {content:'Old analysis'};
  }});
  const a=await prepare(f);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  const runId=finish(f.store,a.taskId);
  const pending=f.service.continuation.tick(f.context);
  await started;
  await f.call('orchestrator_pause',{projectId:a.projectId,orchestratorId:a.orchestratorId,paused:true});
  await f.call('orchestrator_pause',{projectId:a.projectId,orchestratorId:a.orchestratorId,paused:false});
  release();
  assert.equal((await pending).state,'reconciliation_required');
  const review=f.store.db.prepare('SELECT state,reason FROM lab_continuation_reviews WHERE run_id=?').get(runId);
  assert.equal(review.state,'reconciliation_required');
  assert.equal(review.reason,'orchestrator_paused');
  assert.equal((await f.service.continuation.tick(f.context)).state,'idle');
  assert.equal(calls,1);
});

test('pausing and resuming a coordinator mid-proposal cannot silently certify it',async t=>{
  let entered,release,calls=0;
  const started=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const f=setup(t,{available:()=>true,send:async input=>{
    if(!input.prepareWork)return {content:'Analysis finished'};
    calls++;entered();await gate;
    return {content:'Prepared',proposal:{title:'Review next',content:'Check result',reason:'Verification'}};
  }});
  const a=await prepare(f);
  await f.call('continuity_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  await f.call('continuity_proposals_set',{projectId:a.projectId,orchestratorId:a.orchestratorId,enabled:true});
  const runId=finish(f.store,a.taskId);
  assert.equal((await f.service.continuation.tick(f.context)).state,'analyzed');
  const pending=f.service.continuation.tick(f.context);
  await started;
  await f.call('orchestrator_pause',{projectId:a.projectId,orchestratorId:a.orchestratorId,paused:true});
  await f.call('orchestrator_pause',{projectId:a.projectId,orchestratorId:a.orchestratorId,paused:false});
  release();
  assert.equal((await pending).state,'reconciliation_required');
  const review=f.store.db.prepare('SELECT status,reason FROM lab_next_proposals WHERE review_run_id=?').get(runId);
  assert.equal(review.status,'reconciliation_required');
  assert.equal(review.reason,'orchestrator_paused');
  assert.equal((await f.service.continuation.tick(f.context)).state,'idle');
  assert.equal(calls,1);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_task_bindings').get().n,2);
});

// Simulate a real session cutover on the SAME SQLite/Store. Old project
// records and receipts remain durable; they must not drive the new session.
function rotateActiveWorkspace(store,oldSessionId) {
  const id='session_rotated_'+Date.now()+'_'+Math.random().toString(16).slice(2);
  const now=store.now();
  store.db.prepare("UPDATE workspace_sessions SET status='closed',updated_at=? WHERE id=?")
    .run(now,oldSessionId);
  store.db.prepare('INSERT INTO workspace_sessions(id,status,metadata,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run(id,'active','{}',now,now);
  store.workspaceSession={id};
  return id;
}

test('continuation does not consume another workspace pending analysis after session cutover',async t=>{
  const observed=[];
  const f=setup(t,{available:()=>true,send:async payload=>{
    observed.push({taskId:payload.taskId,prepareWork:payload.prepareWork===true});
    return {content:'Revisão do workspace atual'};
  }});
  const previous=await prepare(f);
  await f.call('continuity_set',{projectId:previous.projectId,orchestratorId:previous.orchestratorId,enabled:true});
  const oldRun=finish(f.store,previous.taskId);
  assert.equal(f.service.continuation.scan(),1);
  const nextId=rotateActiveWorkspace(f.store,f.context.workspaceSessionId);
  const next={...f.context,workspaceSessionId:nextId};
  assert.equal((await f.service.continuation.tick(f.context)).state,'blocked_workspace');
  assert.equal((await f.service.continuation.tick(next)).state,'idle');
  assert.equal(f.store.db.prepare('SELECT state FROM lab_continuation_reviews WHERE run_id=?').get(oldRun).state,'queued');
  assert.equal(observed.length,0);

  let count=0;
  const call=(operation,data)=>f.service.invoke(next,operation,{...data,requestId:'current_'+(++count)});
  const projectId=(await call('project_create',{name:'Current',objective:'Testar isolamento'})).result.projectId;
  const orchestratorId=(await call('orchestrator_create',{projectId,name:'Atual',mission:'Verificar'})).result.orchestratorId;
  const taskId=(await call('work_create',{projectId,orchestratorId,title:'Frente atual'})).result.taskId;
  await call('continuity_set',{projectId,orchestratorId,enabled:true});
  const runId=finish(f.store,taskId);
  assert.deepEqual(await f.service.continuation.tick(next),{state:'analyzed',runId});
  assert.equal(observed.length,1);
  assert.equal(f.store.db.prepare('SELECT state FROM lab_continuation_reviews WHERE run_id=?').get(oldRun).state,'queued');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('proposals from an old workspace cannot be planned or counted in the new workspace',async t=>{
  const proposals=[];
  const f=setup(t,{available:()=>true,send:async payload=>{
    if(payload.prepareWork){
      proposals.push(payload.taskId);
      return {content:'Proposta para revisão',proposal:{
        title:'Nova frente',content:'Verificar a nova frente sem envio',reason:'Conferência'}};
    }
    return {content:'Análise confirmada'};
  }});
  const previous=await prepare(f);
  await f.call('continuity_set',{projectId:previous.projectId,orchestratorId:previous.orchestratorId,enabled:true});
  await f.call('continuity_proposals_set',{projectId:previous.projectId,orchestratorId:previous.orchestratorId,enabled:true});
  const oldRun=finish(f.store,previous.taskId);
  assert.equal((await f.service.continuation.tick(f.context)).state,'analyzed');
  const nextId=rotateActiveWorkspace(f.store,f.context.workspaceSessionId);
  const next={...f.context,workspaceSessionId:nextId};
  assert.equal((await f.service.continuation.tick(next)).state,'idle');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_next_proposals').get().n,0);
  let count=0;
  const call=(operation,data)=>f.service.invoke(next,operation,{...data,requestId:'next_'+(++count)});
  const projectId=(await call('project_create',{name:'Atual',objective:'Continuidade'})).result.projectId;
  const orch=(await call('orchestrator_create',{projectId,name:'Atual',mission:'Revisar'})).result;
  const taskId=(await call('work_create',{projectId,orchestratorId:orch.orchestratorId,title:'Novo trabalho'})).result.taskId;
  await call('continuity_set',{projectId,orchestratorId:orch.orchestratorId,enabled:true});
  await call('continuity_proposals_set',{projectId,orchestratorId:orch.orchestratorId,enabled:true});
  const runId=finish(f.store,taskId);
  assert.equal((await f.service.continuation.tick(next)).state,'analyzed');
  assert.deepEqual(await f.service.continuation.tick(next),{state:'proposed',runId});
  assert.deepEqual(proposals,[orch.chatTaskId]);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_next_proposals WHERE review_run_id=?').get(oldRun).n,0);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM lab_next_proposals WHERE review_run_id=?').get(runId).n,1);
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('workspace cutover during an in-flight Groq analysis cannot certify a stale review',async t=>{
  let started,finishSend;
  const entered=new Promise(resolve=>{started=resolve;});
  const gate=new Promise(resolve=>{finishSend=resolve;});
  const f=setup(t,{available:()=>true,send:async()=>{
    started();await gate;return {content:'Resposta tardia'};
  }});
  const old=await prepare(f);
  await f.call('continuity_set',{projectId:old.projectId,orchestratorId:old.orchestratorId,enabled:true});
  const runId=finish(f.store,old.taskId);
  const pending=f.service.continuation.tick(f.context);
  await entered;
  rotateActiveWorkspace(f.store,f.context.workspaceSessionId);
  finishSend();
  assert.equal((await pending).state,'reconciliation_required');
  const record=f.store.db.prepare('SELECT state,reason FROM lab_continuation_reviews WHERE run_id=?').get(runId);
  assert.equal(record.state,'reconciliation_required');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('workspace cutover during a pending Groq proposal cannot certify stale planning',async t=>{
  let entered,release;
  const started=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const f=setup(t,{available:()=>true,send:async input=>{
    if(input.prepareWork) {
      entered();await gate;
      return {content:'Proposta tardia',proposal:{title:'Revisão',content:'Não enviar',reason:'Conferir'}};
    }
    return {content:'Análise concluída'};
  }});
  const old=await prepare(f);
  await f.call('continuity_set',{projectId:old.projectId,orchestratorId:old.orchestratorId,enabled:true});
  await f.call('continuity_proposals_set',{projectId:old.projectId,orchestratorId:old.orchestratorId,enabled:true});
  const runId=finish(f.store,old.taskId);
  assert.equal((await f.service.continuation.tick(f.context)).state,'analyzed');
  const pending=f.service.continuation.tick(f.context);
  await started;
  rotateActiveWorkspace(f.store,f.context.workspaceSessionId);
  release();
  assert.equal((await pending).state,'reconciliation_required');
  const record=f.store.db.prepare('SELECT status FROM lab_next_proposals WHERE review_run_id=?').get(runId);
  assert.equal(record.status,'reconciliation_required');
  assert.equal(f.store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});


test('uncertain GPT work in one project cannot starve another project automatic proposal',async t=>{
  const proposals=[];
  const f=setup(t,{available:()=>true,send:async input=>{
    if(input.prepareWork){
      proposals.push(input.projectId);
      return {content:'Proposta independente',proposal:{title:'Verificar resultado',content:'Revisar a evidência.',reason:'Teste concluído'}};
    }
    return {content:'Análise confirmada'};
  }});
  const a=await prepare(f);
  const projectB=(await f.call('project_create',{name:'Independente',objective:'Revisar outra missão'})).result.projectId;
  const orchestratorB=(await f.call('orchestrator_create',{projectId:projectB,name:'B',mission:'Revisar B'})).result.orchestratorId;
  const taskB=(await f.call('work_create',{projectId:projectB,orchestratorId:orchestratorB,title:'Entrega B'})).result.taskId;
  for(const [projectId,orchestratorId] of [[a.projectId,a.orchestratorId],[projectB,orchestratorB]]){
    await f.call('continuity_set',{projectId,orchestratorId,enabled:true});
    await f.call('continuity_proposals_set',{projectId,orchestratorId,enabled:true});
  }
  const runA=finish(f.store,a.taskId),runB=finish(f.store,taskB);
  assert.equal((await f.service.continuation.tick(f.context)).state,'analyzed');
  assert.equal((await f.service.continuation.tick(f.context)).state,'analyzed');
  // Force the blocked review to be older; the global queue must prefer B.
  const db=f.store.db;
  db.prepare('UPDATE lab_continuation_reviews SET updated_at=? WHERE run_id=?')
    .run('2000-01-01T00:00:00.000Z',runA);
  db.prepare('UPDATE lab_continuation_reviews SET updated_at=? WHERE run_id=?')
    .run('2030-01-01T00:00:00.000Z',runB);
  db.prepare(`INSERT INTO lab_command_receipts
    (id,workspace_session_id,actor_id,client_id,request_id,project_id,operation,input_hash,status,result,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,'uncertain',?,?,?)`)
    .run('receipt_blocked_project_a',f.context.workspaceSessionId,f.context.actorId,f.context.clientId,
      'blocked_project_a',a.projectId,'work_send','digest',
      JSON.stringify({taskId:a.taskId}),f.store.now(),f.store.now());
  assert.deepEqual(await f.service.continuation.tick(f.context),{state:'proposed',runId:runB});
  assert.deepEqual(proposals,[projectB]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lab_next_proposals WHERE review_run_id=?').get(runA).n,0);
  assert.equal(db.prepare('SELECT status FROM lab_next_proposals WHERE review_run_id=?').get(runB).status,'proposed');
  assert.equal((await f.service.continuation.tick(f.context)).state,'reconciliation_required');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM lab_task_bindings WHERE kind='work'").get().n,2);
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('pending approval in one coordinator does not starve a separate coordinator proposal',async t=>{
  const proposals=[];
  const f=setup(t,{available:()=>true,send:async input=>{
    if(input.prepareWork){
      proposals.push(input.projectId);
      return {content:'Proposta para revisão',proposal:{title:'Nova revisão',content:'Inspecionar entrega independente.',reason:'Aceite necessário'}};
    }
    return {content:'Análise registrada'};
  }});
  const a=await prepare(f);
  const projectB=(await f.call('project_create',{name:'Projeto B',objective:'Revisar B'})).result.projectId;
  const orchestratorB=(await f.call('orchestrator_create',{projectId:projectB,name:'B',mission:'Validar B'})).result.orchestratorId;
  const taskB=(await f.call('work_create',{projectId:projectB,orchestratorId:orchestratorB,title:'Entrega B'})).result.taskId;
  for(const [projectId,orchestratorId] of [[a.projectId,a.orchestratorId],[projectB,orchestratorB]]){
    await f.call('continuity_set',{projectId,orchestratorId,enabled:true});
    await f.call('continuity_proposals_set',{projectId,orchestratorId,enabled:true});
  }
  const firstA=finish(f.store,a.taskId);
  assert.deepEqual(await f.service.continuation.tick(f.context),{state:'analyzed',runId:firstA});
  assert.deepEqual(await f.service.continuation.tick(f.context),{state:'proposed',runId:firstA});
  // Approval of the previous proposal for A is deliberately pending.
  const secondA=finish(f.store,a.taskId),runB=finish(f.store,taskB);
  assert.equal((await f.service.continuation.tick(f.context)).state,'analyzed');
  assert.equal((await f.service.continuation.tick(f.context)).state,'analyzed');
  const db=f.store.db;
  db.prepare('UPDATE lab_continuation_reviews SET updated_at=? WHERE run_id=?')
    .run('2000-01-01T00:00:00.000Z',secondA);
  db.prepare('UPDATE lab_continuation_reviews SET updated_at=? WHERE run_id=?')
    .run('2030-01-01T00:00:00.000Z',runB);
  assert.deepEqual(await f.service.continuation.tick(f.context),{state:'proposed',runId:runB});
  assert.deepEqual(proposals,[a.projectId,projectB]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lab_next_proposals WHERE review_run_id=?').get(secondA).n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM action_ledger WHERE action_type='orchestrator.work-proposal' AND status='pending'").get().n,2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM lab_task_bindings WHERE kind='work'").get().n,2);
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});


test('unavailable coordinator A does not starve queued analysis in independent project B',async t=>{
  let unavailableProject=null;
  const analyzed=[];
  const f=setup(t,{available:projectId=>projectId!==unavailableProject,
    send:async input=>{analyzed.push(input.projectId);return {content:'Análise independente confirmada'};}});
  const a=await prepare(f);
  const projectB=(await f.call('project_create',{name:'Disponível B',objective:'Independente'})).result.projectId;
  const orchestratorB=(await f.call('orchestrator_create',{projectId:projectB,name:'B',mission:'Revisar B'})).result.orchestratorId;
  const workB=(await f.call('work_create',{projectId:projectB,orchestratorId:orchestratorB,title:'B'})).result.taskId;
  for(const [projectId,orchestratorId] of [[a.projectId,a.orchestratorId],[projectB,orchestratorB]])
    await f.call('continuity_set',{projectId,orchestratorId,enabled:true});
  const runA=finish(f.store,a.taskId),runB=finish(f.store,workB);
  assert.equal(f.service.continuation.scan(),2);
  const db=f.store.db;
  db.prepare('UPDATE lab_continuation_reviews SET updated_at=? WHERE run_id=?').run('2000-01-01',runA);
  db.prepare('UPDATE lab_continuation_reviews SET updated_at=? WHERE run_id=?').run('2030-01-01',runB);
  unavailableProject=a.projectId;
  assert.deepEqual(await f.service.continuation.tick(f.context),{state:'analyzed',runId:runB});
  assert.deepEqual(analyzed,[projectB]);
  assert.equal(db.prepare('SELECT state FROM lab_continuation_reviews WHERE run_id=?').get(runA).state,'queued');
  assert.equal((await f.service.continuation.tick(f.context)).state,'blocked_coordinator');
  unavailableProject=null;
  assert.deepEqual(await f.service.continuation.tick(f.context),{state:'analyzed',runId:runA});
  assert.deepEqual(analyzed,[projectB,a.projectId]);
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('occupied coordinator A does not starve independently available coordinator B',async t=>{
  const analyzed=[];
  const f=setup(t,{available:()=>true,
    send:async input=>{analyzed.push(input.projectId);return {content:'Confirmação'};}});
  const a=await prepare(f);
  const projectB=(await f.call('project_create',{name:'Livre B',objective:'Independente'})).result.projectId;
  const orchestratorB=(await f.call('orchestrator_create',{projectId:projectB,name:'B',mission:'Revisar B'})).result.orchestratorId;
  const workB=(await f.call('work_create',{projectId:projectB,orchestratorId:orchestratorB,title:'B'})).result.taskId;
  for(const [projectId,orchestratorId] of [[a.projectId,a.orchestratorId],[projectB,orchestratorB]])
    await f.call('continuity_set',{projectId,orchestratorId,enabled:true});
  const runA=finish(f.store,a.taskId),runB=finish(f.store,workB);
  f.service.continuation.scan();
  const db=f.store.db;
  db.prepare('UPDATE lab_continuation_reviews SET updated_at=? WHERE run_id=?').run('2000-01-01',runA);
  db.prepare('UPDATE lab_continuation_reviews SET updated_at=? WHERE run_id=?').run('2030-01-01',runB);
  let release;
  const held=new Promise(resolve=>{release=resolve;});
  const aChat=f.service.orchestrator(a.projectId,a.orchestratorId).chat_task_id;
  const pending=f.service.withCoordinatorTurn(aChat,()=>held);
  assert.deepEqual(await f.service.continuation.tick(f.context),{state:'analyzed',runId:runB});
  assert.deepEqual(analyzed,[projectB]);
  assert.equal(db.prepare('SELECT state FROM lab_continuation_reviews WHERE run_id=?').get(runA).state,'queued');
  release();await pending;
  assert.deepEqual(await f.service.continuation.tick(f.context),{state:'analyzed',runId:runA});
  assert.deepEqual(analyzed,[projectB,a.projectId]);
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('unavailable coordinator A does not starve an independent next-work proposal',async t=>{
  let unavailableProject=null;
  const proposals=[];
  const f=setup(t,{available:projectId=>projectId!==unavailableProject,
    send:async input=>input.prepareWork
      ?(proposals.push(input.projectId),{content:'Proposta confirmada',
        proposal:{title:'Inspecionar resultado',content:'Revisar entrega confirmada',reason:'Aceite'}})
      :{content:'Análise confirmada'}});
  const a=await prepare(f);
  const projectB=(await f.call('project_create',{name:'Proposta B',objective:'Independente'})).result.projectId;
  const orchestratorB=(await f.call('orchestrator_create',{projectId:projectB,name:'B',mission:'Revisar B'})).result.orchestratorId;
  const workB=(await f.call('work_create',{projectId:projectB,orchestratorId:orchestratorB,title:'B'})).result.taskId;
  for(const [projectId,orchestratorId] of [[a.projectId,a.orchestratorId],[projectB,orchestratorB]]){
    await f.call('continuity_set',{projectId,orchestratorId,enabled:true});
    await f.call('continuity_proposals_set',{projectId,orchestratorId,enabled:true});
  }
  const runA=finish(f.store,a.taskId),runB=finish(f.store,workB);
  assert.equal((await f.service.continuation.tick(f.context)).state,'analyzed');
  assert.equal((await f.service.continuation.tick(f.context)).state,'analyzed');
  const db=f.store.db;
  db.prepare('UPDATE lab_continuation_reviews SET updated_at=? WHERE run_id=?').run('2000-01-01',runA);
  db.prepare('UPDATE lab_continuation_reviews SET updated_at=? WHERE run_id=?').run('2030-01-01',runB);
  unavailableProject=a.projectId;
  assert.deepEqual(await f.service.continuation.tick(f.context),{state:'proposed',runId:runB});
  assert.deepEqual(proposals,[projectB]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lab_next_proposals WHERE review_run_id=?').get(runA).n,0);
  assert.equal((await f.service.continuation.tick(f.context)).state,'blocked_coordinator');
  unavailableProject=null;
  assert.deepEqual(await f.service.continuation.tick(f.context),{state:'proposed',runId:runA});
  assert.deepEqual(proposals,[projectB,a.projectId]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM action_ledger WHERE action_type='orchestrator.work-proposal' AND status='pending'").get().n,2);
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
