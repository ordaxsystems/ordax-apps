import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SupervisorCoordinator, validateSupervisorDecision } from '../product/supervisor/coordinator.mjs';
import { createGroqSupervisorPlanner } from '../product/supervisor/groq-planner.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
class MinimalFlowStore {
  constructor() {
    this.db=new DatabaseSync(':memory:');
    this.db.exec([
      'CREATE TABLE tasks(id TEXT PRIMARY KEY);',
      "INSERT INTO tasks(id) VALUES('task_test');",
      'CREATE TABLE action_ledger(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,run_id TEXT,action_type TEXT NOT NULL,resource_key TEXT,status TEXT NOT NULL,payload TEXT NOT NULL,result TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);',
      'CREATE TABLE approval_ledger(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,action_id TEXT,status TEXT NOT NULL,reason TEXT,created_at TEXT NOT NULL,resolved_at TEXT);',
      'CREATE TABLE events(seq INTEGER PRIMARY KEY,task_id TEXT,kind TEXT,payload TEXT,created_at TEXT);'
    ].join('\n'));
  }
  now(){return new Date().toISOString();}
  getTaskExecutionSnapshot(id){return this.db.prepare('SELECT id FROM tasks WHERE id=?').get(id)?{checkpoint_version:0,has_messages:false}:null;}
  event(id,kind,payload){this.db.prepare('INSERT INTO events(task_id,kind,payload,created_at) VALUES(?,?,?,?)').run(id,kind,JSON.stringify(payload),this.now());}
  requestApproval(taskId,actionId,reason){
    const id='approval_'+randomUUID();
    this.db.prepare('INSERT INTO approval_ledger(id,task_id,action_id,status,reason,created_at) VALUES(?,?,?,?,?,?)').run(id,taskId,actionId,'pending',reason,this.now());
    this.event(taskId,'approval.requested',{approval_id:id});
    return id;
  }
  finishAction(taskId,actionId,status,result){
    this.db.prepare('UPDATE action_ledger SET status=?,result=?,updated_at=? WHERE id=?').run(status,JSON.stringify(result),this.now(),actionId);
    this.event(taskId,'action.'+status,{action_id:actionId});
  }
  close(){this.db.close();}
}
function fixture(opts={}){
  const store=new MinimalFlowStore();let plans=0,sends=0;
  const supervisor=new SupervisorCoordinator({
    store,enabled:opts.enabled!==false,environment:opts.environment||'internal',
    actorId:'owner',tenantId:opts.tenantId||null,
    authorizeTask:opts.authorizeTask||(()=>true),
    planner:{decide:async ({taskId})=>{plans++;return opts.decision||{type:'send_message',taskId,content:'Run the relevant tests.',reason:'Next bounded step'};}},
    chat:{send:async()=>{sends++;if(opts.failSend)throw new Error('network_unknown');return {confirmed:true,deliveryObserved:true,responseObserved:true,effectVerified:false,runId:'run_00000001'};}}
  });
  return {store,supervisor,get plans(){return plans;},get sends(){return sends;}};
}
const input=(id='r1')=>({taskId:'task_test',requestId:id,objective:'Evolve OrdaX'});

test('supervisor model output never grants tools or crosses task identity',()=>{
  assert.throws(()=>validateSupervisorDecision({type:'shell',taskId:'task_test',reason:'go'},'task_test'),/invalid_supervisor_decision/);
  assert.throws(()=>validateSupervisorDecision({type:'send_message',taskId:'other',content:'x',reason:'go'},'task_test'),/invalid_supervisor_decision/);
  assert.throws(()=>validateSupervisorDecision({type:'send_message',taskId:'task_test',content:'x',reason:'go',grant:'root'},'task_test'),/invalid_supervisor_decision/);
});

test('disabled mode and unauthorized actor never invoke model',async()=>{
  const a=fixture({enabled:false});
  await assert.rejects(a.supervisor.plan(input()),/supervisor_disabled/);
  assert.equal(a.plans,0);a.store.close();
  const b=fixture({authorizeTask:()=>false});
  await assert.rejects(b.supervisor.plan(input()),/supervisor_access_denied/);
  assert.equal(b.plans,0);b.store.close();
});

test('approval, durable idempotency, and no duplicate provider send',async()=>{
  const f=fixture();
  const plan=await f.supervisor.plan(input());
  assert.equal(plan.status,'pending_approval');
  assert.ok(plan.approvalId);
  assert.deepEqual(await f.supervisor.plan(input()),plan);
  assert.equal(f.plans,1);
  await assert.rejects(f.supervisor.dispatch({taskId:'task_test',actionId:plan.actionId}),/action_not_approved/);
  assert.throws(()=>f.supervisor.approve({taskId:'task_test',actionId:plan.actionId,approvalId:plan.approvalId}),/explicit_approval_required/);
  assert.equal(f.sends,0);
  f.supervisor.approve({taskId:'task_test',actionId:plan.actionId,approvalId:plan.approvalId,explicitOwnerApproval:true});
  assert.equal((await f.supervisor.dispatch({taskId:'task_test',actionId:plan.actionId})).status,'succeeded');
  await assert.rejects(f.supervisor.dispatch({taskId:'task_test',actionId:plan.actionId}),/action_not_approved/);
  assert.equal(f.sends,1);
  f.store.close();
});

test('idempotency request cannot be silently reused for different objective', async()=>{
  const f=fixture();
  await f.supervisor.plan(input('fixed-request'));
  await assert.rejects(f.supervisor.plan({
    taskId:'task_test',requestId:'fixed-request',objective:'An unrelated new objective'
  }),/supervisor_request_conflict/);
  assert.equal(f.plans,1);
  f.store.close();
});

test('interrupted app restores pending plan and approved dispatch without paid model replay', async()=>{
  const f=fixture();
  const p=await f.supervisor.plan(input('recover-001'));
  let restartedPlannerCalls=0;
  const restarted=new SupervisorCoordinator({
    store:f.store, enabled:true, actorId:'owner', authorizeTask:()=>true,
    planner:{decide:async()=>{restartedPlannerCalls++;throw new Error('model should not run');}},
    chat:{send:async()=>({confirmed:true})}
  });
  const pending=restarted.listRecoverable({taskId:'task_test'});
  assert.equal(pending.length,1);
  assert.equal(pending[0].actionId,p.actionId);
  assert.equal(pending[0].status,'pending_approval');
  assert.equal(pending[0].approvalId,p.approvalId);
  assert.equal(pending[0].approvalStatus,'pending');
  assert.equal(pending[0].decision.content,'Run the relevant tests.');
  assert.equal(pending[0].requiresReconciliation,false);
  restarted.approve({
    taskId:'task_test',actionId:p.actionId,approvalId:p.approvalId,
    explicitOwnerApproval:true
  });
  const approved=restarted.listRecoverable({taskId:'task_test'});
  assert.equal(approved[0].status,'approved');
  assert.equal(approved[0].approvalStatus,'approved');
  assert.equal(restartedPlannerCalls,0);
  assert.equal(f.plans,1);
  assert.equal(f.sends,0);
  f.store.close();
});

test('ambiguous dispatch after restart is review only, never automatic resend',async()=>{
  const f=fixture();
  const p=await f.supervisor.plan(input('unknown-receipt'));
  f.supervisor.approve({
    taskId:'task_test',actionId:p.actionId,approvalId:p.approvalId,
    explicitOwnerApproval:true
  });
  // Crash occurred after claiming dispatch, before the result could be stored.
  f.store.db.prepare("UPDATE action_ledger SET status='dispatching' WHERE id=?").run(p.actionId);
  const plans=f.supervisor.listRecoverable({taskId:'task_test'});
  assert.equal(plans[0].status,'dispatching');
  assert.equal(plans[0].requiresReconciliation,true);
  await assert.rejects(f.supervisor.dispatch({
    taskId:'task_test',actionId:p.actionId
  }),/action_not_approved/);
  assert.equal(f.sends,0);
  f.store.close();
});

test('saved plan review enforces actor identity, tenant and canonical task authorization',async()=>{
  const f=fixture({environment:'external',tenantId:'tenant-a'});
  await f.supervisor.plan(input('tenant-private'));
  const other=new SupervisorCoordinator({
    store:f.store,enabled:true,actorId:'another-user',tenantId:'tenant-b',
    environment:'external',authorizeTask:()=>true,
    planner:{decide:async()=>({})},chat:{}
  });
  assert.deepEqual(other.listRecoverable({taskId:'task_test'}),[]);
  const blocked=new SupervisorCoordinator({
    store:f.store,enabled:true,actorId:'owner',tenantId:'tenant-a',
    environment:'external',authorizeTask:()=>false,
    planner:{decide:async()=>({})},chat:{}
  });
  assert.throws(()=>blocked.listRecoverable({taskId:'task_test'}),/supervisor_access_denied/);
  f.store.close();
});

test('uncertain chat send remains indeterminate and is never replayed',async()=>{
  const f=fixture({failSend:true});
  const p=await f.supervisor.plan(input());
  f.supervisor.approve({taskId:'task_test',actionId:p.actionId,approvalId:p.approvalId,explicitOwnerApproval:true});
  assert.equal((await f.supervisor.dispatch({taskId:'task_test',actionId:p.actionId})).status,'indeterminate');
  await assert.rejects(f.supervisor.dispatch({taskId:'task_test',actionId:p.actionId}),/action_not_approved/);
  assert.equal(f.sends,1);f.store.close();
});

test('invalid model plan is indeterminate and cannot reach chat',async()=>{
  const f=fixture({decision:{type:'run_command',taskId:'task_test',reason:'not allowed'}});
  await assert.rejects(f.supervisor.plan(input()),/invalid_supervisor_decision/);
  assert.equal(f.store.db.prepare('SELECT status FROM action_ledger').get().status,'indeterminate');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM approval_ledger').get().n,0);
  assert.equal(f.sends,0);f.store.close();
});

test('hold proposals require neither approval nor sending',async()=>{
  const f=fixture({decision:{type:'hold',taskId:'task_test',reason:'Dependency blocked'}});
  const p=await f.supervisor.plan(input());
  assert.equal(p.status,'held');assert.equal(p.approvalId,null);
  const recover=f.supervisor.listRecoverable({taskId:'task_test'});
  assert.equal(recover[0].status,'held');
  assert.equal(recover[0].requiresReconciliation,false);
  assert.equal(f.sends,0);f.store.close();
});

test('external mode cannot bypass tenant-bound authorization',async()=>{
  const f=fixture({environment:'external',tenantId:'tenant-a',authorizeTask:x=>x.tenantId==='tenant-b'});
  await assert.rejects(f.supervisor.plan(input()),/supervisor_access_denied/);
  assert.equal(f.plans,0);f.store.close();
});

test('Groq adapter calls official endpoint, with bounded JSON proposal',async()=>{
  let seen;
  const p=createGroqSupervisorPlanner({apiKey:'test-not-a-secret',fetchImpl:async(url,opts)=>{
    seen={url,opts};
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({
      type:'hold',taskId:'task_test',reason:'Needs clarification'
    })}}]}),{status:200,headers:{'Content-Type':'application/json'}});
  }});
  const d=await p.decide({taskId:'task_test',objective:'Review one issue',environment:'internal'});
  assert.equal(d.type,'hold');
  assert.equal(seen.url,'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(seen.opts.headers.Authorization,'Bearer test-not-a-secret');
  assert.equal(JSON.parse(seen.opts.body).response_format.type,'json_object');
});

test('Groq errors never echo credentials and do not automatically retry',async()=>{
  let calls=0;
  const p=createGroqSupervisorPlanner({apiKey:'DO-NOT-ECHO',fetchImpl:async()=>{
    calls++;throw new Error('DO-NOT-ECHO');
  }});
  await assert.rejects(p.decide({taskId:'task_test',objective:'Review issue',environment:'internal'}),
    error=>error.message==='supervisor_model_transport_unknown');
  assert.equal(calls,1);
});

const realPath=path.join(root,'product','src','store.mjs');
if(fs.existsSync(realPath)){
  test('real Flow Store uses the same canonical action and approval ledgers',async()=>{
    const {Store}=await import(pathToFileURL(realPath).href);
    const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-supervisor-test-'));
    const store=new Store(path.join(folder,'lab.sqlite'));
    try{
      const task=store.createTask('Integration');
      const supervisor=new SupervisorCoordinator({store,enabled:true,actorId:'owner',
        authorizeTask:()=>true,
        planner:{decide:async()=>({type:'send_message',taskId:task.id,content:'Check status',reason:'One step'})},
        chat:{send:async()=>({confirmed:true,deliveryObserved:true,responseObserved:true,effectVerified:false,runId:'run_00000002'})}
      });
      const p=await supervisor.plan({taskId:task.id,requestId:'integration',objective:'Review status'});
      assert.equal(p.status,'pending_approval');
      assert.equal(store.getTask(task.id).pending_approvals.length,1);
      supervisor.approve({taskId:task.id,actionId:p.actionId,approvalId:p.approvalId,explicitOwnerApproval:true});
      assert.equal((await supervisor.dispatch({taskId:task.id,actionId:p.actionId})).status,'succeeded');
      assert.ok(store.events(task.id).some(e=>e.kind==='supervisor.chat.dispatching'));
    }finally{store.close();fs.rmSync(folder,{recursive:true,force:true});}
  });
}

