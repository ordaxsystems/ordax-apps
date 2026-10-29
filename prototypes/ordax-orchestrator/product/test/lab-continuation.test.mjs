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
