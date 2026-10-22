import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {OrchestratorService} from '../src/orchestrator-service.mjs';
import {LabContinuation} from '../src/lab-continuation.mjs';

function setup(t,coordinator={available:()=>true,send:async()=>({content:'Revisão registrada; não houve envio automático.'})}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lab-continuity-'));
  const store=new Store(path.join(dir,'lab.sqlite'));
  const context={actorId:'owner-test',clientId:'app-test',workspaceSessionId:store.getWorkspaceSession().id};
  const service=new OrchestratorService({store,authorize:()=>true,coordinator});
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  let n=0;
  const call=(op,data={})=>service.invoke(context,op,{...data,...(['continuity_status','work_list'].includes(op)?{}:{requestId:'test_'+(++n)})});
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
